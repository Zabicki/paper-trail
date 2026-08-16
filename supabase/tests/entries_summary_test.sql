begin;
select plan(23);

-- Proves S-04's aggregation primitive, public.entries_summary. Unlike the
-- soft-delete visibility rule (see context/foundation/lessons.md), the
-- aggregation logic IS reachable from raw SQL, so it gets real coverage rather
-- than a manual-only note. Four properties are asserted here:
--
--   1. cross-user isolation through the function — it is `security invoker`,
--      so the entries policies must keep applying to the caller;
--   2. `anon` cannot execute it at all (the explicit revoke in the migration);
--   3. day / week / month bucket arithmetic, including Monday-first weeks and
--      the `bucket_start is null` grand totals matching their bucket rows;
--   4. the p_exclude_recurring filter drops exactly the recurring-category
--      entries and nothing else.
--
-- NOT covered here (application code, unreachable from pgTAP — the same
-- category of gap lessons.md names): the zod query-parameter validation, the
-- ≤400 bucket-count guard, the previous-period derivation, and the
-- client-side local-date resolution of range presets. All four are
-- manual-only and are named as a permanent re-verification requirement in the
-- plan's Testing Strategy.
--
-- Fixture dates sit in 2027 deliberately. The post-`reset role` scoping trick
-- categories_rls_test.sql uses is unavailable here — the function takes no
-- user filter — so the assertions are instead kept away from any date a human
-- would plausibly have hand-entered while testing the app locally.
--
-- 2027-03-01 is a Monday, which is what makes the week-bucket assertions
-- below a real test of date_trunc's Monday-first alignment.

-- === Fixture, inserted as the superuser before any role switch ===
-- user_id must be explicit: the column default is auth.uid(), which is null
-- in a superuser session and would trip the not-null constraint.

insert into public.categories (user_id, name, kind, is_recurring, deleted_at) values
  ('11111111-1111-1111-1111-111111111111', 'Summary Food A',   'expense', false, null),
  ('11111111-1111-1111-1111-111111111111', 'Summary Rent A',   'expense', true,  null),
  ('11111111-1111-1111-1111-111111111111', 'Summary Salary A', 'income',  false, null),
  -- Soft-deleted, with an entry still filed under it. The function must not
  -- inherit the service layer's `deleted_at is null` habit.
  ('11111111-1111-1111-1111-111111111111', 'Summary Ghost A',  'expense', false, now()),
  ('22222222-2222-2222-2222-222222222222', 'Summary Food B',   'expense', false, null);

insert into public.entries (user_id, category_id, type, amount, occurred_on) values
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'Summary Food A'),   'expense', 10.00,   '2027-03-03'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'Summary Rent A'),   'expense', 100.00,  '2027-03-03'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'Summary Ghost A'),  'expense', 5.00,    '2027-03-04'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'Summary Food A'),   'expense', 20.00,   '2027-03-05'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'Summary Salary A'), 'income',  1000.00, '2027-03-08'),
  -- April, so the month bucket has something to separate March from.
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'Summary Food A'),   'expense', 7.00,    '2027-04-02'),
  ('22222222-2222-2222-2222-222222222222',
   (select id from public.categories where name = 'Summary Food B'),   'expense', 55.00,   '2027-03-03');

-- === User A: day buckets ===
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-03' and entry_type = 'expense'),
  110.00::numeric,
  'day bucket sums the two expenses filed on 2027-03-03'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-05' and entry_type = 'expense'),
  20.00::numeric,
  'day bucket reports 2027-03-05''s expense in its own bucket'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-08' and entry_type = 'income'),
  1000.00::numeric,
  'income is bucketed separately from expense on its own day'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and entry_type = 'expense'),
  135.00::numeric,
  'the bucket_start is null row carries the range grand total for expense'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and entry_type = 'income'),
  1000.00::numeric,
  'the bucket_start is null row carries the range grand total for income'
);

-- The whole point of `grouping sets`: the grand total is computed by Postgres
-- rather than re-summed from the bucket rows, so this equality is a property
-- of the function, not an arithmetic coincidence.
select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and entry_type = 'expense'),
  (select sum(total) from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is not null and entry_type = 'expense'),
  'the expense grand total equals the sum of its own bucket rows'
);

select is(
  (select count(*) from public.entries_summary('2027-03-01', '2027-03-31', 'day'))::int,
  6,
  'user A''s day call returns exactly their four bucket rows plus two grand totals'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-04' and entry_type = 'expense'),
  5.00::numeric,
  'an entry whose category is soft-deleted is still counted'
);

-- === User A: week buckets (Monday-first) ===

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'week')
     where bucket_start = '2027-03-01' and entry_type = 'expense'),
  135.00::numeric,
  'week bucket collapses 03-03, 03-04 and 03-05 onto the Monday 2027-03-01'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'week')
     where bucket_start = '2027-03-08' and entry_type = 'income'),
  1000.00::numeric,
  'the following Monday starts a new week bucket'
);

select is(
  (select count(*) from public.entries_summary('2027-03-01', '2027-03-31', 'week'))::int,
  4,
  'week call returns two bucket rows plus two grand totals'
);

-- === User A: month buckets ===

select is(
  (select total from public.entries_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start = '2027-03-01' and entry_type = 'expense'),
  135.00::numeric,
  'month bucket collapses all of March''s expenses onto the first of the month'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start = '2027-04-01' and entry_type = 'expense'),
  7.00::numeric,
  'April lands in its own month bucket'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start is null and entry_type = 'expense'),
  142.00::numeric,
  'the grand total spans the whole two-month range, not one bucket'
);

-- === User A: the FR-015 recurring-cost filter ===

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day', true)
     where bucket_start = '2027-03-03' and entry_type = 'expense'),
  10.00::numeric,
  'p_exclude_recurring drops the recurring-category expense and leaves the rest of the day'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day', true)
     where bucket_start is null and entry_type = 'expense'),
  35.00::numeric,
  'p_exclude_recurring lowers the expense grand total by exactly the recurring contribution'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day', true)
     where bucket_start is null and entry_type = 'income'),
  1000.00::numeric,
  'p_exclude_recurring leaves income untouched'
);

-- === User B: the isolation guarantee, through the function ===
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-03' and entry_type = 'expense'),
  55.00::numeric,
  'user B''s identical call reports only user B''s expense on the shared date'
);

select is(
  (select total from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and entry_type = 'expense'),
  55.00::numeric,
  'user B''s grand total contains none of user A''s 135.00'
);

select is(
  (select count(*) from public.entries_summary('2027-03-01', '2027-03-31', 'day'))::int,
  2,
  'user B sees one bucket row and one grand total — none of user A''s six'
);

select is(
  (select count(*) from public.entries_summary('2027-03-01', '2027-03-31', 'day')
     where entry_type = 'income')::int,
  0,
  'user B sees no income rows at all, though user A has one in the same range'
);

-- === The execute grant: anon denied, authenticated allowed ===
--
-- Asserted against the privilege catalog rather than by actually calling the
-- function as anon and expecting 42501 (which is what the plan specified).
-- ⚠ The Supabase local Postgres image (CLI 2.98.2) SEGFAULTS when a function
-- EXECUTE denial is raised inside a `set local role`-impersonated transaction
-- — precisely pgTAP's impersonation mechanism. The whole backend dies with
-- signal 11 and every connection is dropped, taking the rest of the suite
-- with it. Nothing about this function or about anon is special; a bare
--
--   begin;
--   create function f() returns int language sql as $$ select 1 $$;
--   revoke execute on function f() from public, authenticated;
--   set local role authenticated; select f();
--
-- reproduces it with no PaperTrail code involved. Table-level 42501s are fine
-- (entries_rls_test.sql raises one as anon and the server survives), and so
-- is the same denial over the real PostgREST path — an unauthenticated POST
-- to /rest/v1/rpc/entries_summary returns a clean 42501 JSON body. This is a
-- pgTAP-only trap, and it only surfaces now because this is the repo's first
-- function.
--
-- has_function_privilege proves the same property the throws_ok would have:
-- the grant is where it should be and nowhere else. If a future CLI/image
-- upgrade fixes the segfault, this can go back to throws_ok — but there is no
-- reason to, the catalog check is the more direct assertion.

reset role;

select ok(
  not has_function_privilege('anon', 'public.entries_summary(date, date, text, boolean)', 'execute'),
  'anon has no execute privilege on entries_summary — the migration''s revoke holds'
);

select ok(
  has_function_privilege('authenticated', 'public.entries_summary(date, date, text, boolean)', 'execute'),
  'authenticated does have execute privilege, so the revoke did not overshoot'
);

select * from finish();
rollback;
