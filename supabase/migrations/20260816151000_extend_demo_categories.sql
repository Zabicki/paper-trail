-- S-05: extends the demo account to ~30 expense categories, so FR-014's
-- readability criterion is reproducible rather than hand-built.
--
-- WHY THIS EXISTS. 20260816120000_seed_demo_account.sql seeds ten categories.
-- Ten never trigger the Kategorie board's top-N collapse and — drawn from a
-- 12-hex palette — never produce a colour duplicate either. Both of the
-- mechanisms this slice exists to build would therefore be verifiable only
-- against data the next contributor cannot recreate.
--
-- WHAT THE DISTRIBUTION IS SHAPED TO EXERCISE, over the whole
-- 2026-05-16 .. 2026-08-16 window:
--   * a head of nine categories above 2% of total, so the "top 8 OR above 2%,
--     whichever gives fewer" rule actually has to choose (it picks 8);
--   * a tail of eighteen categories each below 1%, so `Pozostałe (n)` is
--     genuinely long;
--   * several colour collisions, including Jedzenie/Restauracje (both
--     '#22c55e') where BOTH members land in the visible head — that pair is
--     what makes the duplicate-shift rule observable, and Jedzenie being the
--     larger is what keeps the exact palette hex on the category the user is
--     most likely to be looking at;
--   * three tail categories on '#64748b' (Szary), so the residual noted in
--     src/components/reports/distribution.ts — a real grey category reading
--     close to the grey `Pozostałe` slice — is observable rather than
--     theoretical.
--
-- WHY NO auth.* WRITE. Unlike the migration it extends, this one touches only
-- public.categories and public.entries, guarded on the demo user existing. The
-- deploy job applies migrations between the build and `wrangler deploy`; a
-- write into a supabase_auth_admin-owned schema in that window is what S-04
-- finding F3 flagged as capable of aborting a deploy. This migration is simply
-- inert on any database where the demo account was never created.
--
-- ⚠ INHERITS S-04 FINDING F5. Like the migration it extends, this data is
-- pinned to the absolute window 2026-05-16 .. 2026-08-16. Once real time moves
-- past 2026-08-16, every preset except `Cały okres` and `Od początku roku`
-- renders empty for this account. Re-pinning the window is a deliberate future
-- change, not a bug to patch around.
--
-- Amounts come from modular arithmetic on the day offset rather than random(),
-- exactly as the original seed does, so dev and prod get byte-identical data
-- and a number that looks wrong on a chart traces back to a specific day.

insert into public.categories (user_id, name, color, kind, is_recurring)
select
  '33333333-3333-3333-3333-333333333333',
  v.name,
  v.color,
  'expense',
  false
from (values
  -- Head. Restauracje shares Jedzenie's green and Paliwo shares Transport's
  -- blue; in both pairs the larger member is the one that keeps the exact hex.
  ('Restauracje',       '#22c55e'),
  ('Paliwo',            '#3b82f6'),
  -- Tail. Colours repeat freely — with 30 categories over a 12-hex palette
  -- and no uniqueness constraint, that is the normal state, not an edge case.
  ('Ubrania',           '#06b6d4'),
  ('Kosmetyki',         '#ec4899'),
  ('Prezenty',          '#64748b'),
  ('Książki',           '#64748b'),
  ('Papiernicze',       '#64748b'),
  ('Fryzjer',           '#8b5cf6'),
  ('Apteka',            '#ef4444'),
  ('Kino',              '#eab308'),
  ('Kawa',              '#f97316'),
  ('Prasa',             '#84cc16'),
  ('Rośliny',           '#22c55e'),
  ('Chemia domowa',     '#14b8a6'),
  ('Parking',           '#3b82f6'),
  ('Sport',             '#f59e0b'),
  ('Hobby',             '#8b5cf6'),
  ('Zwierzęta',         '#06b6d4'),
  ('Elektronika',       '#eab308'),
  ('Darowizny',         '#ec4899'),
  ('Naprawy',           '#f97316'),
  ('Poczta',            '#84cc16')
) as v(name, color)
where exists (select 1 from auth.users where id = '33333333-3333-3333-3333-333333333333')
on conflict do nothing;

-- Day-to-day spending for the new categories. The `%` selectors give each one
-- its own cadence and — with distinct moduli — keep them from all firing on
-- the same days, which would produce a tidier stacked chart than any real
-- household ever generates.
--
-- The `not exists` guard makes this re-runnable: entries carry no natural
-- unique key, so without it a second application would double every amount and
-- silently change the distribution this migration exists to pin down.
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
    -- Head: both comfortably above 2% of the window's total.
    ('Restauracje',   days.n % 5  = 2,  round((45 + (days.n * 31) % 80  + ((days.n * 23) % 100) / 100.0)::numeric, 2)),
    ('Paliwo',        days.n % 8  = 3,  round((90 + (days.n * 13) % 80  + ((days.n * 41) % 100) / 100.0)::numeric, 2)),
    -- Tail: every one of these stays below 1% of the window's total.
    ('Ubrania',       days.n % 26 = 9,  round((55 + (days.n * 23) % 110 + ((days.n * 7)  % 100) / 100.0)::numeric, 2)),
    ('Kosmetyki',     days.n % 20 = 8,  round((25 + (days.n * 29) % 55  + ((days.n * 13) % 100) / 100.0)::numeric, 2)),
    ('Prezenty',      days.n % 29 = 11, round((40 + (days.n * 19) % 60  + ((days.n * 17) % 100) / 100.0)::numeric, 2)),
    ('Książki',       days.n % 23 = 6,  round((25 + (days.n * 17) % 45  + ((days.n * 29) % 100) / 100.0)::numeric, 2)),
    ('Papiernicze',   days.n % 31 = 13, round((12 + (days.n * 11) % 25  + ((days.n * 3)  % 100) / 100.0)::numeric, 2)),
    ('Fryzjer',       days.n % 27 = 4,  round((50 + (days.n * 13) % 40  + ((days.n * 19) % 100) / 100.0)::numeric, 2)),
    ('Apteka',        days.n % 19 = 8,  round((18 + (days.n * 23) % 50  + ((days.n * 11) % 100) / 100.0)::numeric, 2)),
    ('Kino',          days.n % 25 = 12, round((30 + (days.n * 7)  % 30  + ((days.n * 37) % 100) / 100.0)::numeric, 2)),
    ('Kawa',          days.n % 13 = 2,  round((9  + (days.n * 5)  % 16  + ((days.n * 43) % 100) / 100.0)::numeric, 2)),
    ('Prasa',         days.n % 33 = 15, round((8  + (days.n * 3)  % 14  + ((days.n * 53) % 100) / 100.0)::numeric, 2)),
    ('Rośliny',       days.n % 37 = 20, round((22 + (days.n * 29) % 55  + ((days.n * 61) % 100) / 100.0)::numeric, 2)),
    ('Chemia domowa', days.n % 17 = 7,  round((15 + (days.n * 31) % 35  + ((days.n * 5)  % 100) / 100.0)::numeric, 2)),
    ('Parking',       days.n % 15 = 3,  round((6  + (days.n * 7)  % 14  + ((days.n * 23) % 100) / 100.0)::numeric, 2)),
    ('Sport',         days.n % 21 = 9,  round((35 + (days.n * 13) % 45  + ((days.n * 31) % 100) / 100.0)::numeric, 2)),
    ('Hobby',         days.n % 26 = 14, round((28 + (days.n * 19) % 60  + ((days.n * 7)  % 100) / 100.0)::numeric, 2)),
    ('Zwierzęta',     days.n % 18 = 5,  round((20 + (days.n * 11) % 40  + ((days.n * 47) % 100) / 100.0)::numeric, 2)),
    ('Elektronika',   days.n % 41 = 22, round((60 + (days.n * 37) % 90  + ((days.n * 19) % 100) / 100.0)::numeric, 2)),
    ('Darowizny',     days.n % 35 = 17, round((30 + (days.n * 23) % 50  + ((days.n * 29) % 100) / 100.0)::numeric, 2)),
    ('Naprawy',       days.n % 43 = 25, round((70 + (days.n * 17) % 110 + ((days.n * 13) % 100) / 100.0)::numeric, 2)),
    ('Poczta',        days.n % 39 = 19, round((10 + (days.n * 13) % 20  + ((days.n * 41) % 100) / 100.0)::numeric, 2))
) as spec(category_name, applies, amount)
-- The join key must be the key the unique index and the `on conflict` clause
-- above already use: categories_user_id_name_lower_idx
-- (20260815145611_add_category_fields.sql) is a PARTIAL unique index on
-- lower(name) WHERE deleted_at IS NULL. Two consequences, both silent:
--
--   * Without `deleted_at is null`, a soft-deleted row and a live row can share
--     a name — the insert above succeeds because the deleted row sits outside
--     the index predicate — and this join would then match BOTH, inserting two
--     entries per applicable day. entries_category_summary deliberately has no
--     deleted_at filter, so both would be counted: the category's total doubles
--     and half of it is filed under a category invisible on /categories. The
--     `not exists` guard cannot catch it, being keyed on category_id, which
--     differs between the two rows.
--   * Matching exact `name` against a lower(name) uniqueness rule means a demo
--     category already named e.g. `kawa` makes the insert a no-op AND leaves
--     this join finding nothing — silently omitting a category from the very
--     distribution this migration exists to pin down.
--
-- The demo account is a live shared login and this migration reaches hosted
-- through CI's `supabase db push`, so both paths are reachable in production.
join public.categories cat
  on cat.user_id = '33333333-3333-3333-3333-333333333333'
 and lower(cat.name) = lower(spec.category_name)
 and cat.deleted_at is null
where spec.applies
  and not exists (
    select 1 from public.entries e
    where e.user_id = '33333333-3333-3333-3333-333333333333'
      and e.category_id = cat.id
  );
