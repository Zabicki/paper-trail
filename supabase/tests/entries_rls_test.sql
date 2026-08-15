begin;
select plan(15);

-- Proves S-02's isolation guarantee on public.entries: a signed-in user can
-- read and write only their own rows, mirroring categories_rls_test.sql's
-- two-seed-user impersonation pattern.
--
-- NOT covered here (and deliberately so): that category_id belongs to the
-- same user as the entry. Postgres FK constraints check row existence, not
-- ownership, and are not subject to RLS on the referenced table — a raw SQL
-- insert referencing another user's category_id succeeds at the database
-- layer. The actual prevention is an app-layer re-check in
-- src/lib/services/entries.ts (createEntry), which pgTAP cannot reach since
-- it drives raw SQL directly. See plan's Critical Implementation Details and
-- context/foundation/lessons.md's soft-delete-and-app-layer-invariants entry
-- for the same category of gap. Phase 1's manual verification step proves
-- the FK-alone behavior this test suite cannot.

-- === User A ===
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.categories (name) values ('Groceries A');

insert into public.entries (category_id, amount, occurred_on)
values ((select id from public.categories where name = 'Groceries A'), 12.50, '2026-08-10');

select is(
  (select count(*) from public.entries)::int, 1,
  'user A sees exactly one row after inserting their own entry'
);

select is(
  (select user_id from public.entries where occurred_on = '2026-08-10')::text,
  '11111111-1111-1111-1111-111111111111',
  'inserted row''s user_id defaulted to auth.uid() of user A'
);

select is(
  (select type from public.entries where occurred_on = '2026-08-10')::text,
  'expense',
  'type defaults to expense when not specified'
);

select throws_ok(
  $$ insert into public.entries (user_id, category_id, amount, occurred_on)
     values ('22222222-2222-2222-2222-222222222222',
             (select id from public.categories where name = 'Groceries A'), 5, '2026-08-11') $$,
  '42501',
  null,
  'user A cannot spoof user_id to claim user B''s identity on insert'
);

select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on)
     values ((select id from public.categories where name = 'Groceries A'), 0, '2026-08-11') $$,
  '23514',
  null,
  'amount <= 0 fails the check constraint (zero)'
);

select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on)
     values ((select id from public.categories where name = 'Groceries A'), -5, '2026-08-11') $$,
  '23514',
  null,
  'amount <= 0 fails the check constraint (negative)'
);

select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on, type)
     values ((select id from public.categories where name = 'Groceries A'), 5, '2026-08-11', 'transfer') $$,
  '23514',
  null,
  'an invalid type value is rejected by the check constraint'
);

insert into public.categories (name) values ('Utilities A');
insert into public.entries (category_id, amount, occurred_on)
values ((select id from public.categories where name = 'Utilities A'), 30.00, '2026-08-11');

select is(
  (select count(*) from public.entries)::int, 2,
  'user A sees two rows after adding a second entry'
);

-- === User B ===
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*) from public.entries)::int, 0,
  'user B cannot see user A''s entries'
);

insert into public.categories (name) values ('Rent B');
insert into public.entries (category_id, amount, occurred_on)
values ((select id from public.categories where name = 'Rent B'), 100.00, '2026-08-12');

select is(
  (select count(*) from public.entries)::int, 1,
  'user B sees exactly their own row after inserting, not user A''s'
);

update public.entries set amount = 999.99 where occurred_on = '2026-08-10';

select is(
  (select count(*) from public.entries where amount = 999.99)::int, 0,
  'user B''s update naming user A''s row by content affects zero rows'
);

delete from public.entries where occurred_on = '2026-08-10';

select is(
  (select count(*) from public.entries where occurred_on = '2026-08-11' and amount = 30.00)::int, 0,
  'user B has no visibility into user A''s remaining rows either'
);

-- === Anon role: zero rows, zero writes ===
reset role;
set local role anon;

select is(
  (select count(*) from public.entries)::int, 0,
  'anon role sees zero entries'
);

select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on)
     values ((select id from public.categories limit 1), 5, '2026-08-13') $$,
  '42501',
  null,
  'anon role cannot insert an entry'
);

-- === Back to the superuser session role: confirm user A's rows survived ===
reset role;

select is(
  (select count(*) from public.entries where occurred_on = '2026-08-10')::int, 1,
  'user A''s original row still exists, untouched by user B''s update/delete attempts'
);

select * from finish();
rollback;
