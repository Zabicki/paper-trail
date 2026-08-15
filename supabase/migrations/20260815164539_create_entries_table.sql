-- S-02: the entries table backing "log an expense against today". Designed
-- from day one to also carry S-03's income as a same-table sign flip (see
-- plan's Key Decisions) via the `type` discriminant below — this slice only
-- ever writes 'expense'. RLS is enabled in this same migration per
-- CLAUDE.md's hard rule: a table must never exist without it, even briefly.

create table public.entries (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id bigint not null references public.categories (id),
  type text not null default 'expense' check (type in ('expense', 'income')),
  amount numeric(10, 2) not null check (amount > 0),
  occurred_on date not null,
  created_at timestamptz not null default now()
);

-- Covers the FK-index requirement (category_id's FK has no index need here
-- since nothing in this slice queries by category — see plan's Not Doing)
-- and the two query shapes this slice needs: by-day and by-month-range,
-- both filtered on user_id first.
create index entries_user_id_occurred_on_idx on public.entries (user_id, occurred_on);

alter table public.entries enable row level security;

-- Four granular, per-operation policies scoped to `authenticated` only,
-- identical shape to categories'. update/delete exist now for schema
-- completeness and RLS-suite symmetry even though no route uses them yet
-- (S-03 exercises them). No policy for `anon`, so unauthenticated requests
-- get zero rows and zero writes by Postgres's RLS default-deny.
--
-- NOTE: category_id's FK constraint checks row existence only, not
-- ownership — Postgres FK checks are not subject to RLS on the referenced
-- table. A user could reference another user's category_id and the FK alone
-- would accept it. This is re-checked in the service layer
-- (src/lib/services/entries.ts) before insert; pgTAP cannot prove that
-- app-layer check (see context/foundation/lessons.md).

create policy "entries_select_own" on public.entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "entries_insert_own" on public.entries
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "entries_update_own" on public.entries
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "entries_delete_own" on public.entries
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
