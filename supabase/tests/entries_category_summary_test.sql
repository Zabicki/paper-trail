begin;
select plan(25);

-- Proves S-05's per-category aggregation primitive,
-- public.entries_category_summary. Like entries_summary's suite, the
-- aggregation logic IS reachable from raw SQL, so it gets real coverage.
-- Seven properties are asserted here:
--
--   1. cross-user isolation through the function — it is `security invoker`,
--      so the entries and categories policies must keep applying;
--   2. `anon` cannot execute it at all (the explicit revoke in the migration);
--   3. three-level grouping-set arithmetic: bucket rows sum to the
--      per-category grand totals, which sum to the () range grand total;
--   4. expense-only filtering — income never appears in any row;
--   5. the p_exclude_recurring filter drops exactly the recurring category;
--   6. an entry under a SOFT-DELETED category is still counted, and still
--      reports that category's name and colour;
--   7. day / week / month bucket arithmetic, including Monday-first weeks.
--
-- NOT covered here (client code, unreachable from pgTAP — the same category of
-- gap context/foundation/lessons.md names): the top-N selection rule, the
-- duplicate-colour shift rule, the percentage arithmetic and its zero
-- denominator guard, the zod query-parameter validation, the ≤400 bucket-count
-- guard, and every UI behaviour. All are manual-only and named as a permanent
-- re-verification requirement in the plan's Testing Strategy.
--
-- Fixture dates sit in 2027 for the same reason entries_summary_test.sql's do:
-- the function takes no user filter, so the post-`reset role` scoping trick
-- categories_rls_test.sql uses is unavailable and the assertions are instead
-- kept away from any date a human would plausibly have hand-entered locally.
--
-- 2027-03-01 is a Monday, which is what makes the week-bucket assertions below
-- a real test of date_trunc's Monday-first alignment.

-- === Fixture, inserted as the superuser before any role switch ===
-- user_id must be explicit: the column default is auth.uid(), which is null
-- in a superuser session and would trip the not-null constraint.
--
-- 'CatSum Food A' and 'CatSum Fun A' deliberately share one colour: the fixed
-- 12-hex palette has no per-user uniqueness constraint, so duplicates are a
-- state the database is entitled to be in and the function must report
-- faithfully. Resolving them into distinguishable shades is the client's job.

insert into public.categories (user_id, name, color, kind, is_recurring, deleted_at) values
  ('11111111-1111-1111-1111-111111111111', 'CatSum Food A',   '#22c55e', 'expense', false, null),
  ('11111111-1111-1111-1111-111111111111', 'CatSum Fun A',    '#22c55e', 'expense', false, null),
  ('11111111-1111-1111-1111-111111111111', 'CatSum Rent A',   '#ef4444', 'expense', true,  null),
  -- Soft-deleted, with an entry still filed under it. The function must not
  -- inherit the service layer's `deleted_at is null` habit.
  ('11111111-1111-1111-1111-111111111111', 'CatSum Ghost A',  '#8b5cf6', 'expense', false, now()),
  ('11111111-1111-1111-1111-111111111111', 'CatSum Salary A', '#84cc16', 'income',  false, null),
  ('22222222-2222-2222-2222-222222222222', 'CatSum Food B',   '#3b82f6', 'expense', false, null);

insert into public.entries (user_id, category_id, type, amount, occurred_on) values
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Food A'),   'expense', 10.00,   '2027-03-03'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Food A'),   'expense', 20.00,   '2027-03-05'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Fun A'),    'expense', 30.00,   '2027-03-03'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Rent A'),   'expense', 100.00,  '2027-03-03'),
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Ghost A'),  'expense', 5.00,    '2027-03-04'),
  -- The following Monday, so the week buckets have a boundary to fall across.
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Fun A'),    'expense', 40.00,   '2027-03-08'),
  -- Income, in range. It must appear in no row of any call.
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Salary A'), 'income',  1000.00, '2027-03-08'),
  -- April, so the month bucket has something to separate March from.
  ('11111111-1111-1111-1111-111111111111',
   (select id from public.categories where name = 'CatSum Food A'),   'expense', 7.00,    '2027-04-02'),
  ('22222222-2222-2222-2222-222222222222',
   (select id from public.categories where name = 'CatSum Food B'),   'expense', 55.00,   '2027-03-03');

-- === User A: day buckets ===
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-03' and category_name = 'CatSum Food A'),
  10.00::numeric,
  'a bucket row carries one category''s total for one day'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_name = 'CatSum Food A'),
  30.00::numeric,
  'the bucket_start-null row carries that category''s range grand total'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_id is null),
  205.00::numeric,
  'the both-null row carries the range grand total across every category'
);

-- The whole point of the third, empty grouping set: the range total is
-- computed by Postgres rather than re-summed from per-category floats in
-- JavaScript, so these equalities are properties of the function.
select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_id is null),
  (select sum(total) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_id is not null),
  'the () range total equals the sum of the per-category grand totals'
);

select is(
  (select sum(total) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_id is not null),
  (select sum(total) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is not null),
  'the per-category grand totals equal the sum of their own bucket rows'
);

select is(
  (select count(*) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day'))::int,
  11,
  'the day call returns six bucket rows, four per-category totals and one range total'
);

select is(
  (select count(*) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where category_name = 'CatSum Salary A')::int,
  0,
  'the income category appears in no row — the board is expense-only by decision'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start = '2027-03-04' and category_name = 'CatSum Ghost A'),
  5.00::numeric,
  'an entry whose category is soft-deleted is still counted'
);

select is(
  (select category_color from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_name = 'CatSum Ghost A'),
  '#8b5cf6',
  'a soft-deleted category still reports its own colour, not a fallback'
);

select is(
  (select count(distinct category_id) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where category_color = '#22c55e')::int,
  2,
  'two distinct categories report the same palette hex — the collision the client must resolve'
);

-- === User A: the FR-015 recurring-cost filter ===

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day', true)
     where bucket_start is null and category_id is null),
  105.00::numeric,
  'p_exclude_recurring lowers the range total by exactly the recurring category''s contribution'
);

select is(
  (select count(*) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day', true)
     where category_name = 'CatSum Rent A')::int,
  0,
  'p_exclude_recurring removes the recurring category from every row, not just the totals'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day', true)
     where bucket_start is null and category_name = 'CatSum Food A'),
  30.00::numeric,
  'p_exclude_recurring leaves every non-recurring category untouched'
);

-- === User A: week buckets (Monday-first) ===

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'week')
     where bucket_start = '2027-03-01' and category_name = 'CatSum Food A'),
  30.00::numeric,
  'the week bucket collapses 03-03 and 03-05 onto the Monday 2027-03-01'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'week')
     where bucket_start = '2027-03-08' and category_name = 'CatSum Fun A'),
  40.00::numeric,
  'the following Monday starts a new week bucket for the same category'
);

select is(
  (select count(*) from public.entries_category_summary('2027-03-01', '2027-03-31', 'week'))::int,
  10,
  'the week call returns five bucket rows, four per-category totals and one range total'
);

-- === User A: month buckets ===

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start = '2027-03-01' and category_name = 'CatSum Food A'),
  30.00::numeric,
  'the month bucket collapses all of March''s food onto the first of the month'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start = '2027-04-01' and category_name = 'CatSum Food A'),
  7.00::numeric,
  'April lands in its own month bucket for the same category'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start is null and category_name = 'CatSum Food A'),
  37.00::numeric,
  'the per-category grand total spans the whole two-month range, not one bucket'
);

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-04-30', 'month')
     where bucket_start is null and category_id is null),
  212.00::numeric,
  'the range total spans the whole two-month range too'
);

-- === User B: the isolation guarantee, through the function ===
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  (select total from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where bucket_start is null and category_id is null),
  55.00::numeric,
  'user B''s range total contains none of user A''s 205.00'
);

select is(
  (select count(*) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day'))::int,
  3,
  'user B sees one bucket row, one category total and one range total — none of user A''s eleven'
);

select is(
  (select count(*) from public.entries_category_summary('2027-03-01', '2027-03-31', 'day')
     where category_name like 'CatSum%A')::int,
  0,
  'not one of user A''s categories reaches user B, though they share the date range'
);

-- === The execute grant: anon denied, authenticated allowed ===
--
-- Asserted against the privilege catalog rather than by calling the function
-- as anon. ⚠ The Supabase local Postgres image SEGFAULTS when a function
-- EXECUTE denial is raised inside a `set local role`-impersonated transaction
-- — precisely pgTAP's impersonation mechanism — taking the whole backend and
-- the rest of the suite with it. entries_summary_test.sql:225-249 documents
-- the reproduction and why has_function_privilege proves the same property.

reset role;

select ok(
  not has_function_privilege('anon', 'public.entries_category_summary(date, date, text, boolean)', 'execute'),
  'anon has no execute privilege on entries_category_summary — the migration''s revoke holds'
);

select ok(
  has_function_privilege('authenticated', 'public.entries_category_summary(date, date, text, boolean)', 'execute'),
  'authenticated does have execute privilege, so the revoke did not overshoot'
);

select * from finish();
rollback;
