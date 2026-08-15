-- F-01: proves the per-user RLS pattern every later table copies.
-- Minimal shape on purpose (id, user_id, name, created_at) — S-01 extends this
-- with is_recurring / rename semantics. RLS is enabled in this same migration
-- per CLAUDE.md's hard rule: a table must never exist without it, even briefly.

create table public.categories (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Postgres does not auto-index foreign key columns; this one is also the
-- column every RLS policy below filters on.
create index categories_user_id_idx on public.categories (user_id);

alter table public.categories enable row level security;

-- Four granular, per-operation policies scoped to `authenticated` only.
-- No policy is defined for `anon`, so unauthenticated requests get zero rows
-- and zero writes by Postgres's RLS default-deny — satisfying the PRD's
-- "unauthenticated access to any expense or income data is disallowed".
--
-- auth.uid() is wrapped in `(select ...)` in every policy so it's evaluated
-- once per statement rather than once per row (see security-rls-performance).

create policy "categories_select_own" on public.categories
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "categories_insert_own" on public.categories
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "categories_update_own" on public.categories
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "categories_delete_own" on public.categories
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
