-- S-06 review finding F4: make the receipt-confirm write idempotent.
--
-- THE HOLE. POST /api/receipts/entries had no request id, no client key and no
-- server-side dedupe, so createEntriesBatch minted fresh ids on every call. On
-- mobile a committed POST whose response is lost leaves the user reading
-- "Spróbuj ponownie" with the button re-enabled — one tap and a 24-line receipt
-- becomes 48 entries. Nothing downstream could notice: the review's sum check
-- compares items against the printed paragon total, not against what is already
-- stored, and DayView's dedupe is keyed on the server `id`, which differs
-- between the two writes. It was the one path in the app where a single lost
-- response silently doubled a whole receipt's worth of financial data.
--
-- WHY TWO COLUMNS AND NOT ONE. `batch_id` alone cannot be the unique key: a
-- receipt is N rows that all share it. And no natural per-item key exists —
-- two identical coffees at 9.00 on one paragon are a legitimate pair of rows,
-- so (batch_id, category_id, amount, description) would reject real data.
-- `batch_seq` is the item's position in the confirmed list, assigned by the
-- service from the array index and never sent by the client. Together they
-- identify "line k of batch B", which is exactly the granularity a retry
-- repeats.
--
-- WHY A PLAIN CONSTRAINT AND NOT A PARTIAL INDEX. The obvious shape here would
-- be `... where batch_id is not null`, mirroring
-- categories_user_id_name_lower_idx. It cannot be used: PostgREST emits
-- `on conflict (cols) do nothing` with no index_predicate, and Postgres will
-- only infer a PARTIAL unique index when the statement carries a matching
-- predicate — so the insert would fail outright with "no unique or exclusion
-- constraint matching the ON CONFLICT specification". A plain constraint is
-- inferable, and it costs nothing in correctness because Postgres treats NULLs
-- as distinct by default: every manually created entry has both columns NULL
-- and is therefore unique against every other, no matter how many exist.
--
-- WHY user_id IS IN THE KEY. A batch id is client-generated, so two users could
-- in principle present the same uuid. Scoping the key by user_id means one
-- user's retry can never collide with — or reveal the existence of — another
-- user's batch, and it keeps the constraint consistent with the row-scoped RLS
-- policies rather than cutting across them.
--
-- Additive and backward-compatible in both directions, which matters because CI
-- runs `supabase db push` between the build and `wrangler deploy`
-- (.github/workflows/ci.yml): for one window the *previous* Worker version
-- serves against this schema. That Worker never selects these columns and never
-- writes them, so its inserts land as (NULL, NULL) — distinct under the
-- constraint, never a conflict. Same reasoning as
-- 20260816140000_add_entry_description.sql.
--
-- No RLS change: the existing four per-operation policies on public.entries are
-- row-scoped ((select auth.uid()) = user_id) and cover every column, present and
-- future.

alter table public.entries
  add column batch_id uuid,
  add column batch_seq smallint;

-- Both or neither. A batch_id without a position could not be deduped, and a
-- position without a batch is meaningless — either would be a service-layer bug
-- writing a row that looks idempotent and is not.
alter table public.entries
  add constraint entries_batch_columns_together
  check ((batch_id is null) = (batch_seq is null));

alter table public.entries
  add constraint entries_batch_item_key
  unique (user_id, batch_id, batch_seq);
