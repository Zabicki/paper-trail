begin;
select plan(16);

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
  (select is_recurring from public.categories where name = 'Groceries')::boolean,
  false,
  'is_recurring defaults to false when not specified'
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
reset role;

select is(
  (select count(*) from public.categories where name = 'Groceries')::int, 1,
  'user A''s original row still exists, untouched by user B''s update/delete attempts'
);

select is(
  (select count(*) from public.categories where name = 'Utilities')::int, 2,
  'exactly two Utilities rows exist — one per user — proving name uniqueness is per-user, not global'
);

select is(
  (select count(*) from public.categories)::int, 4,
  'exactly four rows exist total across both users, confirming no cross-user leakage or loss'
);

select * from finish();
rollback;
