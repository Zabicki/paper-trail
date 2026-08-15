-- S-03: the expense/income discriminant on categories. Income entries need
-- something valid to point at, because entries.category_id is NOT NULL and
-- stays that way — an income references an income-kind category rather than
-- relaxing the FK.
--
-- Additive with a default on purpose: CI runs `supabase db push` between the
-- build and `wrangler deploy` (.github/workflows/ci.yml), so for one window
-- the *previous* Worker runs against this schema. Nothing shipped so far
-- selects or writes `kind`, and every existing row backfills to 'expense',
-- so that window is safe. Never add a NOT NULL column without a default here.
--
-- No index: per-user category counts are tiny and every query is already
-- user_id-scoped by RLS. No policy change either — kind carries no ownership
-- semantics, exactly as 20260815145611_add_category_fields.sql reasoned about
-- color/is_recurring.
--
-- categories_user_id_name_lower_idx is deliberately left alone: a name stays
-- unique per user across *both* kinds. That matches how a user thinks about
-- naming and avoids a per-kind unique index nobody has asked for.
--
-- NOTE: kind is immutable *by application convention only* — updateCategorySchema
-- in src/lib/services/categories.ts omits the field. A raw SQL `update
-- categories set kind = …` succeeds at the database layer. pgTAP cannot prove
-- that app-layer rule (see context/foundation/lessons.md); Phase 1's manual
-- verification records the gap rather than closing it.

alter table public.categories
  add column kind text not null default 'expense' check (kind in ('expense', 'income'));
