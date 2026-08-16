-- S-04: the single aggregation primitive every chart in S-04 and S-05 reads
-- through. Bucketed expense/income sums over a date range, with an optional
-- large-recurring-cost exclusion (FR-015).
--
-- WHY A FUNCTION AT ALL. PostgREST's aggregate support groups by *columns*;
-- date_trunc('week', occurred_on) is a grouping *expression*, which has no
-- PostgREST syntax. Time bucketing therefore has to happen either here or in
-- JavaScript — and doing it here is also what closes S-02's forward-flagged
-- float-drift finding (F4): every sum is accumulated in Postgres `numeric`,
-- so no chain of JS float additions exists anywhere in the data path.
--
-- WHY `security invoker`. RLS must keep applying to the caller. A
-- `security definer` function would run as the owner, bypass the entries
-- policies entirely, and force the `user_id = auth.uid()` predicate to be
-- re-established by hand inside the body — a second, hand-written copy of the
-- isolation guarantee that pgTAP would then have to prove separately. As an
-- invoker function it inherits the exact policies already proven for direct
-- table access, and supabase/tests/entries_summary_test.sql proves the
-- inheritance holds through the RPC path.
--
-- WHY NO `deleted_at` FILTER on the categories join. Every service in the repo
-- appends `.is("deleted_at", null)`, and copying that habit here would
-- silently drop every entry filed under a category the user has since deleted.
-- Entries survive category deletion by design — the FK has no `on delete`
-- clause, which is precisely why categories are soft-deleted. The join exists
-- only to read `is_recurring`; it must never remove rows.
--
-- WHY `grouping sets`. The `bucket_start is null` rows are the range grand
-- totals per entry type, summed in Postgres alongside the bucket rows rather
-- than re-summed from them in JavaScript. Exact totals for free.
--
-- p_bucket reaches date_trunc as a bound parameter, never string
-- concatenation, so there is no injection surface; an out-of-set value raises
-- a Postgres error and the zod enum at the API edge is the real validation.

create function public.entries_summary(
  p_from date,
  p_to date,
  p_bucket text,
  p_exclude_recurring boolean default false
)
returns table (bucket_start date, entry_type text, total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (date_trunc(p_bucket, e.occurred_on::timestamp))::date as bucket_start,
    e.type as entry_type,
    sum(e.amount) as total
  from public.entries e
  join public.categories c on c.id = e.category_id
  where e.occurred_on between p_from and p_to
    and (not p_exclude_recurring or not c.is_recurring)
  group by grouping sets (
    ((date_trunc(p_bucket, e.occurred_on::timestamp))::date, e.type),
    (e.type)
  );
$$;

-- Granted explicitly rather than relying on Postgres's default `public`
-- execute grant, matching the deny-by-default posture of the table policies:
-- `anon` must not be able to call this at all.
revoke execute on function public.entries_summary(date, date, text, boolean) from public, anon;
grant execute on function public.entries_summary(date, date, text, boolean) to authenticated;
