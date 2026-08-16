begin;
select plan(20);

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
--
-- ALSO NOT covered (S-03, same reason): that an entry's `type` matches its
-- category's `kind`. Nothing in the schema ties the two columns together — a
-- raw SQL insert can pair an income with an expense-kind category and the
-- database will accept it. The only enforcement is the pre-write check in
-- createEntry/updateEntry (src/lib/services/entries.ts), which pgTAP cannot
-- reach. Any future change to that module must re-verify the invariant by
-- hand; see the plan's Testing Strategy.
--
-- S-03 additions below: the entries_update_own / entries_delete_own policies
-- created by this table's migration were never exercised until now. They are
-- asserted on *affected row count*, not throws_ok — RLS filters the rows out
-- silently rather than raising, so a cross-user UPDATE/DELETE is a successful
-- statement that touches nothing.

-- Affected-row-count probe for the S-03 write-policy assertions. Postgres
-- refuses a data-modifying CTE anywhere but the top level of a statement, so
-- each UPDATE/DELETE attempt lands its RETURNING count in here first and is
-- asserted afterwards. Created (and granted) as the superuser, before the
-- role switch below.
create temporary table rls_write_probe (label text primary key, affected int not null);
grant select, insert on rls_write_probe to authenticated;

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

-- entries_update_own / entries_delete_own, finally exercised. Counting what
-- each statement actually touched is the only way to tell "RLS filtered every
-- row" apart from "the statement ran fine" — both look identical to the
-- caller, since neither raises.

with attempted as (
  update public.entries set amount = 999.99 where occurred_on = '2026-08-10' returning id
)
insert into rls_write_probe select 'b_updates_a', count(*)::int from attempted;

select is(
  (select affected from rls_write_probe where label = 'b_updates_a'), 0,
  'entries_update_own: user B''s UPDATE against user A''s row affects zero rows'
);

with attempted as (
  delete from public.entries where occurred_on = '2026-08-10' returning id
)
insert into rls_write_probe select 'b_deletes_a', count(*)::int from attempted;

select is(
  (select affected from rls_write_probe where label = 'b_deletes_a'), 0,
  'entries_delete_own: user B''s DELETE against user A''s row affects zero rows'
);

with attempted as (
  update public.entries set amount = 111.00 where occurred_on = '2026-08-12' returning id
)
insert into rls_write_probe select 'b_updates_own', count(*)::int from attempted;

select is(
  (select affected from rls_write_probe where label = 'b_updates_own'), 1,
  'entries_update_own: user B can update their own row'
);

with attempted as (
  delete from public.entries where occurred_on = '2026-08-12' returning id
)
insert into rls_write_probe select 'b_deletes_own', count(*)::int from attempted;

select is(
  (select affected from rls_write_probe where label = 'b_deletes_own'), 1,
  'entries_delete_own: user B can delete their own row'
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
-- Scoped to the seed users for the reason categories_rls_test.sql:128-134
-- spells out: these see EVERY row in the table, RLS included, so left
-- unqualified they also count whatever manual dev testing left behind on the
-- same date. That is not hypothetical — S-04's local demo dataset put entries
-- on 2026-08-10 and turned both of these red, one of them with a bare
-- "more than one row returned by a subquery" error rather than a test
-- failure. A suite that goes red for environmental reasons trains you to
-- ignore red, and this is the only automated proof of the isolation
-- guarantee.
reset role;

select is(
  (select count(*) from public.entries
     where occurred_on = '2026-08-10'
       and user_id = '11111111-1111-1111-1111-111111111111')::int, 1,
  'user A''s original row still exists, untouched by user B''s update/delete attempts'
);

select is(
  (select amount from public.entries
     where occurred_on = '2026-08-10'
       and user_id = '11111111-1111-1111-1111-111111111111')::numeric,
  12.50::numeric,
  'user A''s row still carries its original amount — user B''s UPDATE changed nothing'
);

select * from finish();
rollback;
