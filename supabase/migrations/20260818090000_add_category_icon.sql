-- S-09: a category is identified by a user-chosen ICON rather than a
-- user-chosen colour (FR-004 / FR-014 / FR-018).
--
-- WHY THIS MIGRATION ONLY ADDS. `.github/workflows/ci.yml` runs
-- `supabase db push` between the build and `wrangler deploy`, so between those
-- two steps the PREVIOUS Worker runs against THIS schema. Everything here must
-- therefore be backward-compatible with the currently-deployed code: `icon` is
-- added, `category_icon` is added to entries_category_summary's return, and
-- nothing is removed. The old Worker keeps selecting `color` and reading
-- `category_color`, both of which still exist. Dropping them is the follow-up
-- change `category-color-drop`, which trails this one by exactly one deploy.
--
-- WHY NO CHECK CONSTRAINT ON `icon`. The allowed set is ~116 lucide names that
-- exist to be curated — a CHECK would make every addition to the picker a
-- migration. The set is enforced by `z.enum(categoryIconValues)` in
-- src/lib/services/categories.ts instead.
--
-- ⚠ CONSEQUENCE, per context/foundation/lessons.md: that makes the
-- allowed-value invariant APP-LAYER-ONLY and therefore NOT pgTAP-provable. A
-- raw `update categories set icon = 'nonsense'` succeeds at the database
-- layer, and src/components/categories/CategoryIcon.tsx degrades an unknown
-- name to the `tag` fallback rather than crashing the render. Only the column
-- DEFAULT is asserted in supabase/tests/categories_rls_test.sql; verifying
-- that the API rejects an off-list name is a permanent manual step for any
-- future change to this schema or to that service.

alter table public.categories add column icon text not null default 'tag';

-- ONE-SHOT BACKFILL CONVENIENCE, NOT A MAINTAINED FEATURE.
--
-- Keyed on lowercased Polish category names so the demo account's 32
-- categories (20260816120000_seed_demo_account.sql,
-- 20260816151000_extend_demo_categories.sql) and a dozen other common ones
-- come out of the migration with a sensible glyph instead of 32 identical
-- tags. Nothing reads this mapping again: a category created after this
-- migration gets its icon from the picker, and a rename does not re-derive
-- one. Do not extend it expecting it to apply to new rows.
--
-- Anything not matched keeps the column default, 'tag'.
update public.categories c
set icon = m.icon
from (values
  -- Demo-seed categories (all 32)
  ('jedzenie',        'utensils'),
  ('restauracje',     'utensils-crossed'),
  ('kawa',            'coffee'),
  ('transport',       'car'),
  ('paliwo',          'fuel'),
  ('parking',         'parking-circle'),
  ('rata samochodu',  'car-front'),
  ('dom',             'sofa'),
  ('czynsz',          'house'),
  ('naprawy',         'wrench'),
  ('chemia domowa',   'droplet'),
  ('rośliny',         'flower-2'),
  ('abonamenty',      'credit-card'),
  ('elektronika',     'smartphone'),
  ('poczta',          'mail'),
  ('rozrywka',        'party-popper'),
  ('kino',            'clapperboard'),
  ('hobby',           'puzzle'),
  ('sport',           'dumbbell'),
  ('książki',         'book-open'),
  ('prasa',           'newspaper'),
  ('papiernicze',     'pencil'),
  ('zdrowie',         'heart-pulse'),
  ('apteka',          'pill'),
  ('fryzjer',         'scissors'),
  ('kosmetyki',       'sparkles'),
  ('ubrania',         'shirt'),
  ('zwierzęta',       'paw-print'),
  ('prezenty',        'gift'),
  ('darowizny',       'heart'),
  ('wynagrodzenie',   'banknote'),
  ('freelance',       'briefcase'),
  -- Common names a real account is likely to carry
  ('zakupy',          'shopping-cart'),
  ('rachunki',        'receipt-text'),
  ('podróże',         'plane'),
  ('edukacja',        'graduation-cap'),
  ('internet',        'wifi'),
  ('telefon',         'phone'),
  ('prąd',            'zap'),
  ('woda',            'droplet'),
  ('gaz',             'flame'),
  ('ubezpieczenie',   'shield-check'),
  ('oszczędności',    'piggy-bank'),
  ('inwestycje',      'trending-up')
) as m(name, icon)
where lower(c.name) = m.name;

-- Postgres cannot alter a function's `returns table` shape in place, so adding
-- category_icon means drop + recreate. The body below is
-- 20260816150000_add_entries_category_summary_function.sql verbatim with three
-- additions; see that file for the full rationale on `security invoker`, the
-- absent `deleted_at` filter, the hardcoded `e.type = 'expense'` and the three
-- grouping sets. category_color is deliberately KEPT — see the deploy-ordering
-- note in this file's header.
--
-- ⚠ c.icon must appear in BOTH non-empty grouping sets. Omitting it from
-- either produces a "column must appear in the GROUP BY clause" error at
-- migration time — or, worse in a variant that compiles, a silently wrong
-- aggregate.
drop function public.entries_category_summary(date, date, text, boolean);

create function public.entries_category_summary(
  p_from date,
  p_to date,
  p_bucket text,
  p_exclude_recurring boolean default false
)
returns table (
  bucket_start date,
  category_id bigint,
  category_name text,
  category_color text,
  category_icon text,
  total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (date_trunc(p_bucket, e.occurred_on::timestamp))::date as bucket_start,
    c.id as category_id,
    c.name as category_name,
    c.color as category_color,
    c.icon as category_icon,
    sum(e.amount) as total
  from public.entries e
  join public.categories c on c.id = e.category_id
  where e.occurred_on between p_from and p_to
    and e.type = 'expense'
    and (not p_exclude_recurring or not c.is_recurring)
  group by grouping sets (
    ((date_trunc(p_bucket, e.occurred_on::timestamp))::date, c.id, c.name, c.color, c.icon),
    (c.id, c.name, c.color, c.icon),
    ()
  );
$$;

-- Re-issued because a dropped function takes its grants with it. Same
-- deny-by-default posture as the original: `anon` must not be able to call it.
revoke execute on function public.entries_category_summary(date, date, text, boolean) from public, anon;
grant execute on function public.entries_category_summary(date, date, text, boolean) to authenticated;
