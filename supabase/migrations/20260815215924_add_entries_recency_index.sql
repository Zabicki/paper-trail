-- S-03 review follow-up (F6): the entry form's recency ordering had no index.
--
-- listCategoriesForEntryForm (src/lib/services/entries.ts) runs
--   select category_id, created_at from entries
--   where type = $1 order by created_at desc limit 50
-- with RLS adding `user_id = auth.uid()`. The existing
-- entries_user_id_occurred_on_idx cannot serve that ORDER BY, so Postgres
-- scanned and sorted the user's entire entry history to satisfy a LIMIT 50.
--
-- S-03 made that twice as expensive: the dashboard now loads the expense and
-- income chip lists in parallel, so every dashboard load paid for two full
-- sorts, growing without bound as entries accumulate.
--
-- Column order matches the query: user_id (RLS equality) → type (equality) →
-- created_at desc (the ordering), so the LIMIT can stop at 50 index entries.
--
-- Additive and index-only: nothing reads or writes differently because of it,
-- so it is safe in the window where CI has pushed the schema but not yet
-- deployed the Worker.

create index entries_user_id_type_created_at_idx
  on public.entries (user_id, type, created_at desc);
