begin;
select plan(19);

-- Proves F-01's isolation guarantee on public.categories: a signed-in user
-- can read and write only their own rows. Impersonates the two fixed seed
-- users (supabase/seed.sql) by switching role to `authenticated` and setting
-- the `request.jwt.claim.sub` GUC that auth.uid() reads — no GoTrue sign-in
-- involved. See plan's Critical Implementation Details for why both matter:
-- superuser sessions bypass RLS entirely unless `role` is switched too.
--
-- Also proves S-01's schema additions: per-user case-insensitive name
-- uniqueness (scoped so it never blocks a *different* user reusing a name),
-- the fixed color palette check constraint, and is_recurring/color defaults.
--
-- ...and S-09's `icon` column DEFAULT. NOT covered (and unprovable here): that
-- a stored icon name is one of the ~116 the picker offers. The column carries
-- no CHECK constraint by decision (see
-- 20260818090000_add_category_icon.sql) — `z.enum(categoryIconValues)` in
-- src/lib/services/categories.ts is the only guard, so a raw
-- `update categories set icon = 'nonsense'` succeeds at the database layer.
-- Same category of gap as the app-layer soft-delete filtering below, and a
-- permanent manual re-verification requirement per
-- context/foundation/lessons.md.
--
-- ...and S-03's `kind` discriminant: its check constraint and its 'expense'
-- default. NOT covered (and unprovable here): that kind is immutable after
-- creation. That is enforced only by updateCategorySchema omitting the field
-- in src/lib/services/categories.ts — a raw `update categories set kind = …`
-- succeeds at the database layer. Same category of gap as the app-layer
-- soft-delete filtering above; see context/foundation/lessons.md.

-- === User A ===
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.categories (name) values ('Groceries');

select is(
  (select count(*) from public.categories)::int, 1,
  'user A sees exactly one row after inserting their own category'
);

select is(
  (select user_id from public.categories where name = 'Groceries')::text,
  '11111111-1111-1111-1111-111111111111',
  'inserted row''s user_id defaulted to auth.uid() of user A'
);

select is(
  (select color from public.categories where name = 'Groceries')::text,
  '#64748b',
  'color defaults to the slate swatch when not specified'
);

select is(
  (select icon from public.categories where name = 'Groceries')::text,
  'tag',
  'icon defaults to the neutral tag glyph when not specified'
);

select is(
  (select is_recurring from public.categories where name = 'Groceries')::boolean,
  false,
  'is_recurring defaults to false when not specified'
);

select is(
  (select kind from public.categories where name = 'Groceries')::text,
  'expense',
  'kind defaults to expense when not specified'
);

select throws_ok(
  $$ insert into public.categories (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'Spoofed') $$,
  '42501',
  null,
  'user A cannot spoof user_id to claim user B''s identity on insert'
);

select throws_ok(
  $$ insert into public.categories (name) values ('GROCERIES') $$,
  '23505',
  null,
  'user A cannot create a second category whose name matches an existing one case-insensitively'
);

select throws_ok(
  $$ insert into public.categories (name, color) values ('Out Of Palette', '#000000') $$,
  '23514',
  null,
  'a color outside the fixed 12-value palette is rejected by the check constraint'
);

select throws_ok(
  $$ insert into public.categories (name, kind) values ('Not A Kind', 'transfer') $$,
  '23514',
  null,
  'a kind outside expense/income is rejected by the check constraint'
);

insert into public.categories (name) values ('Utilities');

select is(
  (select count(*) from public.categories)::int, 2,
  'user A sees two rows after adding a second, distinctly-named category'
);

-- === User B ===
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*) from public.categories)::int, 0,
  'user B cannot see user A''s rows'
);

insert into public.categories (name) values ('Rent');

select is(
  (select count(*) from public.categories)::int, 1,
  'user B sees exactly their own row after inserting, not user A''s'
);

insert into public.categories (name) values ('Utilities');

select is(
  (select count(*) from public.categories)::int, 2,
  'user B can use the same category name as user A — uniqueness is scoped per user, not global'
);

update public.categories set name = 'Hacked' where name = 'Groceries';

select is(
  (select count(*) from public.categories where name = 'Hacked')::int, 0,
  'user B''s update naming user A''s row by content affects zero rows'
);

delete from public.categories where name = 'Groceries';

select is(
  (select count(*) from public.categories where name = 'Rent')::int, 1,
  'user B''s delete attempt on user A''s row leaves user B''s own row untouched'
);

-- === Back to the superuser session role: confirm user A's rows survived ===
-- These see EVERY row in the table, RLS included — so they are scoped to the
-- two seed users. Left unqualified they also count whatever manual dev
-- testing left behind, and a suite that goes red for environmental reasons
-- trains you to ignore red. This is the only automated proof of the isolation
-- guarantee and it does not run in CI, so it has to stay trustworthy on a
-- database that was not freshly reset.
reset role;

select is(
  (select count(*) from public.categories
     where name = 'Groceries'
       and user_id = '11111111-1111-1111-1111-111111111111')::int, 1,
  'user A''s original row still exists, untouched by user B''s update/delete attempts'
);

select is(
  (select count(*) from public.categories
     where name = 'Utilities'
       and user_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222'))::int, 2,
  'exactly two Utilities rows exist — one per user — proving name uniqueness is per-user, not global'
);

select is(
  (select count(*) from public.categories
     where user_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222'))::int, 4,
  'exactly four rows exist total across both seed users, confirming no cross-user leakage or loss'
);

select * from finish();
rollback;
