begin;
select plan(9);

-- Proves F-01's isolation guarantee on public.categories: a signed-in user
-- can read and write only their own rows. Impersonates the two fixed seed
-- users (supabase/seed.sql) by switching role to `authenticated` and setting
-- the `request.jwt.claim.sub` GUC that auth.uid() reads — no GoTrue sign-in
-- involved. See plan's Critical Implementation Details for why both matter:
-- superuser sessions bypass RLS entirely unless `role` is switched too.

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

select throws_ok(
  $$ insert into public.categories (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'Spoofed') $$,
  '42501',
  null,
  'user A cannot spoof user_id to claim user B''s identity on insert'
);

-- === User B ===
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  (select count(*) from public.categories)::int, 0,
  'user B cannot see user A''s row'
);

insert into public.categories (name) values ('Rent');

select is(
  (select count(*) from public.categories)::int, 1,
  'user B sees exactly their own row after inserting, not user A''s'
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

-- === Back to the superuser session role: confirm user A's row survived ===
reset role;

select is(
  (select count(*) from public.categories where name = 'Groceries')::int, 1,
  'user A''s original row still exists, untouched by user B''s update/delete attempts'
);

select is(
  (select count(*) from public.categories)::int, 2,
  'exactly two rows exist total across both users, confirming no cross-user leakage or loss'
);

select * from finish();
rollback;
