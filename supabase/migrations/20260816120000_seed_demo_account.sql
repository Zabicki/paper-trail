-- A demo account with three months of categories and entries, for exercising
-- /reports (S-04) against data that looks like a real household's.
--
-- WHY A MIGRATION AND NOT supabase/seed.sql: seed.sql is local-only. CLAUDE.md
-- is explicit that `supabase db push` in the deploy job is the ONLY path to the
-- hosted database and that --include-seed must never be passed. A migration is
-- therefore the single mechanism that lands this in both dev (`supabase db
-- reset`) and prod (next approved deploy).
--
-- WHY ONLY A HASH IS COMMITTED: github.com/Zabicki/paper-trail is a PUBLIC
-- repo, and this account is created in production with a confirmed email. The
-- bcrypt digest below is all that lives in git; the plaintext was handed over
-- out of band. Do not add the plaintext to this file, a comment, or .env.example.
--
-- The token columns set to '' are the same GoTrue quirk seed.sql documents:
-- confirmation_token / recovery_token / email_change_token_new / email_change
-- have no column default, and GoTrue's Go driver cannot scan NULL into them —
-- a real password sign-in 500s with "converting NULL to string is unsupported".
--
-- TO REMOVE THIS ACCOUNT: `delete from auth.users where id =
-- '33333333-3333-3333-3333-333333333333';` in a follow-up migration. The
-- cascade on both tables' user_id FK takes the categories and entries with it.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated',
  'authenticated',
  'demo@papertrail.app',
  '$2a$10$tDfVmJFK6e3a4Nt360.1LOvWlk/v/chX5Rm7odNS4uSMgQSV/Rwui',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '', '', '', ''
)
on conflict do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, created_at, updated_at
) values (
  '33333333-3333-3333-3333-333333333333',
  '33333333-3333-3333-3333-333333333333',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"demo@papertrail.app"}',
  'email',
  now(),
  now()
)
on conflict do nothing;

-- Colours are drawn from the fixed 12-value palette the CHECK constraint in
-- 20260815145611_add_category_fields.sql enforces.
--
-- is_recurring is set ONLY on expense categories. public.entries_summary's
-- p_exclude_recurring filter is type-blind — it drops any entry whose category
-- carries the flag, income included — so flagging a salary would make
-- "Ukryj duże koszty cykliczne" quietly lower Przychody too. That also matches
-- how a user reads the control: it hides recurring *costs*.
insert into public.categories (user_id, name, color, kind, is_recurring) values
  ('33333333-3333-3333-3333-333333333333', 'Jedzenie',        '#22c55e', 'expense', false),
  ('33333333-3333-3333-3333-333333333333', 'Transport',       '#3b82f6', 'expense', false),
  ('33333333-3333-3333-3333-333333333333', 'Rozrywka',        '#8b5cf6', 'expense', false),
  ('33333333-3333-3333-3333-333333333333', 'Zdrowie',         '#ec4899', 'expense', false),
  ('33333333-3333-3333-3333-333333333333', 'Dom',             '#f59e0b', 'expense', false),
  ('33333333-3333-3333-3333-333333333333', 'Czynsz',          '#ef4444', 'expense', true),
  ('33333333-3333-3333-3333-333333333333', 'Rata samochodu',  '#f97316', 'expense', true),
  ('33333333-3333-3333-3333-333333333333', 'Abonamenty',      '#14b8a6', 'expense', true),
  ('33333333-3333-3333-3333-333333333333', 'Wynagrodzenie',   '#84cc16', 'income',  false),
  ('33333333-3333-3333-3333-333333333333', 'Freelance',       '#06b6d4', 'income',  false)
on conflict do nothing;

-- Variable day-to-day spending over 2026-05-16 .. 2026-08-16 (three months).
--
-- Amounts come from modular arithmetic on the day offset rather than random(),
-- so dev and prod get byte-identical data and a number that looks wrong on the
-- chart can be traced back to a specific day. The `%` selectors are what give
-- each category its own cadence: near-daily groceries, transport every third
-- day, entertainment roughly weekly, health and home a few times a month.
insert into public.entries (user_id, category_id, type, amount, occurred_on)
select
  '33333333-3333-3333-3333-333333333333',
  cat.id,
  'expense',
  spec.amount,
  days.day
from generate_series(date '2026-05-16', date '2026-08-16', interval '1 day') as g(day)
cross join lateral (select g.day::date as day, (g.day::date - date '2026-05-16')::int as n) as days
cross join lateral (
  values
    ('Jedzenie',  days.n % 9 <> 4, round((22 + (days.n * 37) % 78 + ((days.n * 29) % 100) / 100.0)::numeric, 2)),
    ('Transport', days.n % 3 = 0,  round((9 + (days.n * 17) % 42 + ((days.n * 7) % 100) / 100.0)::numeric, 2)),
    ('Rozrywka',  days.n % 7 = 5,  round((35 + (days.n * 53) % 150 + ((days.n * 11) % 100) / 100.0)::numeric, 2)),
    ('Zdrowie',   days.n % 16 = 9, round((45 + (days.n * 61) % 230 + ((days.n * 3) % 100) / 100.0)::numeric, 2)),
    ('Dom',       days.n % 11 = 6, round((28 + (days.n * 43) % 210 + ((days.n * 19) % 100) / 100.0)::numeric, 2))
) as spec(category_name, applies, amount)
join public.categories cat
  on cat.user_id = '33333333-3333-3333-3333-333333333333'
 and cat.name = spec.category_name
where spec.applies;

-- Fixed monthly costs. These are the entries the FR-015 toggle exists for: rent
-- and the car payment together dwarf a day's groceries, and on the cumulative
-- chart each one is the step change that hides the day-to-day shape until it is
-- filtered out.
insert into public.entries (user_id, category_id, type, amount, occurred_on)
select
  '33333333-3333-3333-3333-333333333333',
  (select id from public.categories
    where user_id = '33333333-3333-3333-3333-333333333333' and name = v.category_name),
  'expense',
  v.amount,
  v.occurred_on
from (values
  ('Czynsz',         2800.00, date '2026-06-05'),
  ('Czynsz',         2800.00, date '2026-07-05'),
  ('Czynsz',         2800.00, date '2026-08-05'),
  ('Rata samochodu', 1250.00, date '2026-06-12'),
  ('Rata samochodu', 1250.00, date '2026-07-12'),
  ('Rata samochodu', 1250.00, date '2026-08-12'),
  ('Abonamenty',       54.99, date '2026-05-20'),
  ('Abonamenty',       39.99, date '2026-05-24'),
  ('Abonamenty',       54.99, date '2026-06-03'),
  ('Abonamenty',       29.99, date '2026-06-08'),
  ('Abonamenty',       39.99, date '2026-06-20'),
  ('Abonamenty',       54.99, date '2026-07-03'),
  ('Abonamenty',       29.99, date '2026-07-08'),
  ('Abonamenty',       39.99, date '2026-07-20'),
  ('Abonamenty',       54.99, date '2026-08-03'),
  ('Abonamenty',       29.99, date '2026-08-08')
) as v(category_name, amount, occurred_on);

-- Income. Salary lands on the 10th so the current, still-running month already
-- has one — a range whose income were all in the past would make Bilans read as
-- catastrophic on the "Ten miesiąc" preset for no reason other than pay date.
insert into public.entries (user_id, category_id, type, amount, occurred_on)
select
  '33333333-3333-3333-3333-333333333333',
  (select id from public.categories
    where user_id = '33333333-3333-3333-3333-333333333333' and name = v.category_name),
  'income',
  v.amount,
  v.occurred_on
from (values
  ('Wynagrodzenie', 8500.00, date '2026-06-10'),
  ('Wynagrodzenie', 8500.00, date '2026-07-10'),
  ('Wynagrodzenie', 8500.00, date '2026-08-10'),
  ('Freelance',     1200.00, date '2026-06-20'),
  ('Freelance',      950.00, date '2026-07-30'),
  ('Freelance',     1800.00, date '2026-08-06')
) as v(category_name, amount, occurred_on);
