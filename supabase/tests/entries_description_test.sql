begin;
select plan(6);

-- S-06: the schema half of entries.description
-- (20260816140000_add_entry_description.sql). Deliberately a separate file
-- rather than additions to entries_rls_test.sql — that suite's whole claim is
-- the per-user isolation guarantee, and it must keep passing *unchanged*
-- across this migration to be evidence that the column changed nothing about
-- RLS.
--
-- NOT covered here, and it cannot be: that the *service layer* writes
-- description (createEntry, createEntriesBatch) and leaves it alone on update
-- (updateEntrySchema omits the field). pgTAP drives raw SQL and cannot reach
-- TypeScript — see context/foundation/lessons.md. The plan's Testing Strategy
-- names those as permanently manual-only.

select has_column('public', 'entries', 'description', 'entries has a description column');

select col_is_null('public', 'entries', 'description', 'description is nullable');

select col_type_is('public', 'entries', 'description', 'text', 'description is text');

-- === The length bound, exercised as a user ===
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.categories (name) values ('Groceries desc');

insert into public.entries (category_id, amount, occurred_on, description)
values ((select id from public.categories where name = 'Groceries desc'), 8.99, '2026-08-14', repeat('x', 200));

select is(
  (select char_length(description) from public.entries where occurred_on = '2026-08-14'), 200,
  'a 200-character description is accepted'
);

select throws_ok(
  $$ insert into public.entries (category_id, amount, occurred_on, description)
     values ((select id from public.categories where name = 'Groceries desc'), 8.99, '2026-08-15',
             repeat('x', 201)) $$,
  '23514',
  null,
  'a 201-character description fails the check constraint'
);

-- NULL is the value every manually-entered row carries, so the check has to
-- tolerate it rather than merely happening to.
insert into public.entries (category_id, amount, occurred_on)
values ((select id from public.categories where name = 'Groceries desc'), 3.50, '2026-08-16');

select ok(
  (select description is null from public.entries where occurred_on = '2026-08-16'),
  'description defaults to null when not supplied'
);

reset role;

select * from finish();
rollback;
