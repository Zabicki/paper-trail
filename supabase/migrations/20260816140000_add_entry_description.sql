-- S-06: somewhere for a parsed receipt line-item name to land. A wrong
-- categorisation is only diagnosable after the fact if the product name that
-- produced it survives the confirm — "Masło extra 82% 200g" tells you why the
-- model picked Groceries; a bare 8.99 does not.
--
-- Nullable with no default, and deliberately so. Every entry created by the
-- manual form has no description and never will; NULL is the honest value for
-- "there was no line item", not a placeholder to be backfilled.
--
-- Additive and backward-compatible in both directions, which matters because
-- CI runs `supabase db push` between the build and `wrangler deploy`
-- (.github/workflows/ci.yml): for one window the *previous* Worker version
-- serves against this schema. That Worker never selects `description`, so the
-- window is safe. Same reasoning as 20260815181500_add_category_kind.sql.
--
-- The length bound is a hallucination guard, not a UI constraint. The value
-- originates from a language model reading a photograph; without a ceiling a
-- garbled parse could write an unbounded string into every user's row. 200
-- characters is far above any real receipt line and matches the zod bound in
-- src/lib/services/entries.ts, which is where the trim-and-reject lives. The
-- check tolerates NULL by Postgres's usual three-valued rule.
--
-- No RLS change: the existing four per-operation policies on public.entries
-- are row-scoped ((select auth.uid()) = user_id) and cover every column,
-- present and future. No index either — description is never a filter.

alter table public.entries
  add column description text check (char_length(description) <= 200);
