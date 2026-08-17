begin;
select plan(10);

-- S-06 review finding F4: the schema half of the receipt-confirm idempotency
-- key (20260817190000_add_entry_batch_key.sql). A separate file rather than
-- additions to entries_rls_test.sql, for the same reason
-- entries_description_test.sql is separate: that suite's whole claim is the
-- per-user isolation guarantee, and it must keep passing *unchanged* across this
-- migration to be evidence that the new columns changed nothing about RLS.
--
-- NOT covered here, and it cannot be: that createEntriesBatch assigns batch_seq
-- from the array index, resends the same batch_id on a retry, and re-selects the
-- stored rows when the upsert returns fewer than it was given. pgTAP drives raw
-- SQL and cannot reach TypeScript — see context/foundation/lessons.md. Those
-- remain manual-only, alongside the three invariants the plan already names.
--
-- What IS proven here is the property the service layer leans on: that a replay
-- of the same (user, batch, seq) tuples cannot write a second row.

select has_column('public', 'entries', 'batch_id', 'entries has a batch_id column');
select has_column('public', 'entries', 'batch_seq', 'entries has a batch_seq column');
select col_is_null('public', 'entries', 'batch_id', 'batch_id is nullable');
select col_type_is('public', 'entries', 'batch_id', 'uuid', 'batch_id is uuid');

-- The constraint must be a plain UNIQUE, not a partial index: PostgREST emits
-- `on conflict (cols) do nothing` with no index_predicate, and Postgres only
-- infers a partial unique index when the statement carries a matching one. A
-- partial index here would make every receipt confirm fail outright.
select col_is_unique(
  'public', 'entries', array['user_id', 'batch_id', 'batch_seq'],
  '(user_id, batch_id, batch_seq) is unique'
);

-- === Exercised as a user ===
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.categories (name) values ('Groceries batch');

-- A two-line receipt.
insert into public.entries (category_id, amount, occurred_on, batch_id, batch_seq)
values
  ((select id from public.categories where name = 'Groceries batch'), 8.99, '2026-08-14',
   'aaaaaaaa-0000-4000-8000-000000000001', 0),
  ((select id from public.categories where name = 'Groceries batch'), 3.50, '2026-08-14',
   'aaaaaaaa-0000-4000-8000-000000000001', 1);

select is(
  (select count(*)::int from public.entries where batch_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 2,
  'a two-line batch writes two rows'
);

-- The whole point: the same batch replayed cannot double the receipt.
select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on, batch_id, batch_seq)
     values ((select id from public.categories where name = 'Groceries batch'), 8.99, '2026-08-14',
             'aaaaaaaa-0000-4000-8000-000000000001', 0) $$,
  '23505',
  null,
  'replaying (batch_id, batch_seq) violates the unique constraint'
);

-- ... and `on conflict do nothing`, which is what the service actually emits,
-- turns that violation into a no-op rather than an error.
insert into public.entries (category_id, amount, occurred_on, batch_id, batch_seq)
values ((select id from public.categories where name = 'Groceries batch'), 8.99, '2026-08-14',
        'aaaaaaaa-0000-4000-8000-000000000001', 0)
on conflict (user_id, batch_id, batch_seq) do nothing;

select is(
  (select count(*)::int from public.entries where batch_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 2,
  'on conflict do nothing leaves the batch at two rows'
);

-- Manual entries carry NULL in both columns. Postgres treats NULLs as distinct,
-- so the constraint must not cap them at one row — the whole design depends on
-- this, since every non-receipt entry ever created looks identical under the key.
insert into public.entries (category_id, amount, occurred_on)
values
  ((select id from public.categories where name = 'Groceries batch'), 1.00, '2026-08-15'),
  ((select id from public.categories where name = 'Groceries batch'), 2.00, '2026-08-15');

select is(
  (select count(*)::int from public.entries where occurred_on = '2026-08-15' and batch_id is null), 2,
  'multiple rows with NULL batch keys coexist'
);

-- Both or neither, so a half-set key can never masquerade as idempotent.
select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on, batch_id)
     values ((select id from public.categories where name = 'Groceries batch'), 5.00, '2026-08-16',
             'aaaaaaaa-0000-4000-8000-000000000002') $$,
  '23514',
  null,
  'batch_id without batch_seq fails the together-or-neither check'
);

reset role;

select * from finish();
rollback;
