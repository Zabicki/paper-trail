-- S-05: the per-category aggregation primitive behind the Kategorie board
-- (FR-014), honouring the same large-recurring-cost exclusion as
-- entries_summary (FR-015). One round trip serves all three of Board B's
-- charts.
--
-- WHY A SECOND FUNCTION AND NOT A WIDER entries_summary. Board A's data path
-- is shipped and verified; widening its return type would force every
-- consumer to re-handle rows it never asked for. This is additive and inert
-- until the Worker calls it, which is what makes it safe in the window where
-- CI has applied migrations but not yet deployed the new Worker.
--
-- WHY A FUNCTION AT ALL. Same constraint as entries_summary: PostgREST's
-- aggregate support groups by *columns*, and B3 needs
-- date_trunc(bucket, occurred_on) × category_id — a grouping *expression*
-- PostgREST has no syntax for. Every sum is also accumulated in Postgres
-- `numeric`, so no chain of JS float additions exists in the data path.
--
-- WHY `security invoker`. RLS must keep applying to the caller. A
-- `security definer` variant would run as the owner, bypass the entries
-- policies, and force `user_id = auth.uid()` to be re-established by hand
-- inside the body — a second, hand-written copy of the isolation guarantee
-- that pgTAP would then have to prove separately. As an invoker function it
-- inherits the exact policies already proven for direct table access, and
-- supabase/tests/entries_category_summary_test.sql proves the inheritance
-- holds through the RPC path.
--
-- WHY NO `deleted_at` FILTER on the categories join. Identical reasoning to
-- entries_summary: entries survive category deletion by design (the FK has no
-- `on delete` clause, which is precisely why categories are soft-deleted), so
-- a `deleted_at is null` here would silently drop every entry filed under a
-- category the user has since deleted. Here the consequence is sharper than
-- on Board A — it would be a missing slice, and the board total would
-- disagree with Board A's Wydatki tile.
--
-- WHY `e.type = 'expense'` IS HARDCODED. FR-014 is about *spending*
-- distribution, and mixing two disjoint category sets into one share-of-total
-- is a category error rather than a feature flag. Parameterising it would
-- invite exactly that. src/lib/services/entries.ts:216
-- (listEntryDaysForMonth) sets the precedent for a product rule living in the
-- query rather than in a parameter.
--
-- WHY THREE GROUPING SETS. Row interpretation:
--   bucket_start non-null                  → a B3 cell (bucket × category)
--   bucket_start null, category_id non-null → that category's range total (B1/B2)
--   both null                               → the range grand total
-- The empty set is the load-bearing one: it makes the percentage denominator
-- an exact Postgres numeric rather than a JavaScript sum of per-category
-- floats — which is the drift S-02's finding F4 forwarded to this work.
--
-- p_bucket reaches date_trunc as a bound parameter, never string
-- concatenation, so there is no injection surface; an out-of-set value raises
-- a Postgres error and the zod enum at the API edge is the real validation.

create function public.entries_category_summary(
  p_from date,
  p_to date,
  p_bucket text,
  p_exclude_recurring boolean default false
)
returns table (bucket_start date, category_id bigint, category_name text, category_color text, total numeric)
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
    sum(e.amount) as total
  from public.entries e
  join public.categories c on c.id = e.category_id
  where e.occurred_on between p_from and p_to
    and e.type = 'expense'
    and (not p_exclude_recurring or not c.is_recurring)
  group by grouping sets (
    ((date_trunc(p_bucket, e.occurred_on::timestamp))::date, c.id, c.name, c.color),
    (c.id, c.name, c.color),
    ()
  );
$$;

-- Granted explicitly rather than relying on Postgres's default `public`
-- execute grant, matching the deny-by-default posture of the table policies:
-- `anon` must not be able to call this at all.
revoke execute on function public.entries_category_summary(date, date, text, boolean) from public, anon;
grant execute on function public.entries_category_summary(date, date, text, boolean) to authenticated;
