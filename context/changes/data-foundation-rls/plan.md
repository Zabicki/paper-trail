# Per-User Data Foundation (F-01) Implementation Plan

## Overview

Establish the migration pipeline and per-user row-level-security pattern that every later PaperTrail table (categories, expenses, incomes, receipts) will copy — proven end-to-end, locally, on one real table: a minimal `categories` table. This is the first data-layer code in the repo; `supabase/migrations/` does not exist yet and no table access exists anywhere in `src/`.

## Current State Analysis

- **No `supabase/migrations/` directory, no `supabase/seed.sql`, no `supabase/tests/`.** Confirmed by directory listing — this change creates all three.
- **Auth is fully wired, data access is not.** `src/lib/supabase.ts` builds a `@supabase/ssr` client from cookies; `src/middleware.ts` resolves `context.locals.user`. Every DB call the app will ever make goes through the **anon key** (`.env.example` explicitly: "Use the anon / public key, never the service-role key"), riding the signed-in user's session. There is no service-role bypass anywhere in the app — **RLS is the only isolation boundary that exists.**
- **`supabase link` has never been run against the hosted project** (`context/deployment/deploy-plan.md` Phase 4) — it needs the DB password, which the operator doesn't have on hand. The roadmap explicitly marks this "not gating." This plan proves the pattern locally only; hosted linking is an explicit follow-up (see What We're NOT Doing).
- **No test framework is installed** (`CLAUDE.md`: "If tests are wanted, that's a setup decision to raise with the user"). Confirmed no vitest/playwright/jest anywhere in `package.json`. This plan uses **pgTAP** — bundled with the Supabase CLI's local Postgres, not a JS framework — decided with the user rather than assumed.
- **`[db.seed]` is already enabled** in `supabase/config.toml`, pointing at `./seed.sql` (relative to `supabase/`), which doesn't exist yet. `supabase db reset` already expects to run it.

## Desired End State

- `supabase/migrations/` contains two migrations: one enabling the `pgtap` extension, one creating `public.categories` with row-level security enabled in the same migration that creates the table (per `CLAUDE.md`'s hard rule).
- Four granular, per-operation RLS policies exist on `categories`, scoped to the `authenticated` role: select/insert/update/delete, each keyed on `auth.uid() = user_id`.
- `supabase/seed.sql` creates two fixed, deterministic test users directly in `auth.users` (+ matching `auth.identities` rows).
- `supabase/tests/database/categories_rls.test.sql` is a pgTAP suite that, on a clean `supabase db reset`, proves: a user can read/write only their own rows, cannot see the other seeded user's rows, and cannot spoof another user's `id` on insert.
- `supabase db reset && supabase test db` passes locally from a clean state, with zero manual steps.
- `CLAUDE.md`'s "Data layer (not yet built)" section is rewritten to describe the established pattern instead of its absence.

### Key Discoveries:

- `src/lib/supabase.ts:6-8` — `createClient()` returns `null` on missing env vars; irrelevant to this plan (no `src/` code is touched), but confirms every future data-access helper built on top of this foundation must follow the same null-check convention.
- `context/deployment/deploy-plan.md:211` — "`wrangler rollback` reverts the Worker only — never the schema." Migrations in this plan must be written knowing there is no automated schema rollback.
- `supabase/config.toml:60-65` — `[db.seed]` already `enabled = true`, `sql_paths = ["./seed.sql"]`. Seeding is a zero-config extension of what's already there, not new plumbing.
- Supabase's local Postgres image ships `pgtap` and `pgcrypto` pre-installed; both only need `create extension if not exists`, not a package install.

## What We're NOT Doing

- **Not** running `supabase link` or pushing migrations to the hosted project. Local-only for this change; hosted linking is a short manual follow-up the user runs before S-01 needs a real signed-in user against production (needs the DB password, which the agent cannot obtain).
- **Not** building out the full `categories` feature (rename semantics, the `is_recurring` flag, per-user uniqueness on `name`). That's S-01's job — this table exists only to prove the RLS pattern, kept to the minimum columns (`id`, `user_id`, `name`, `created_at`).
- **Not** wiring `supabase gen types typescript` or creating `src/types.ts`. Deferred until a slice actually needs shared entity types.
- **Not** adding a CI job that spins up Postgres/Docker to run the pgTAP suite. Verification stays a local, manually-run command for now.
- **Not** touching any `src/` code, any API route, or any UI. This foundation is data-layer + verification only.

## Implementation Approach

One migration creates the table and its RLS policies together (never a window where the table exists without RLS). A second, separate migration enables `pgtap` — kept apart from the schema migration because it's testing infrastructure, not product schema, even though (harmlessly) it also lands in any future hosted push. Verification uses pgTAP because it runs directly against local Postgres via the already-installed Supabase CLI, requires no new JS dependency, and is Supabase's documented way to test RLS — sidestepping the "no test framework" gap by testing at the SQL layer rather than needing a JS runner.

`user_id` defaults to `auth.uid()` at the column level so a client that forgets to set it fails safe (scoped to itself) rather than open to spoofing; the `WITH CHECK` clause on the insert and update policies closes the one way a client could still override that default (passing an explicit `user_id` for another user in the insert/update statement).

## Critical Implementation Details

### RLS testing requires simulating both role and JWT claim

pgTAP tests run through `supabase test db` connect as a superuser-equivalent role, which **bypasses RLS entirely** unless the session's effective role is switched. Each test block must do both of the following before any assertion, not just one:

```sql
set local role authenticated;
set local request.jwt.claim.sub = '<seeded-user-uuid>';
```

`auth.uid()` reads `current_setting('request.jwt.claim.sub', true)` under the hood — this is how the test suite impersonates each seeded user without going through GoTrue sign-in at all. Forgetting `set local role authenticated` is the single most likely way this test suite would silently pass while testing nothing (superuser sees every row regardless of policy).

### Seeding `auth.users` needs a matching `auth.identities` row

A bare insert into `auth.users` is enough for the pgTAP impersonation trick above (it only needs the row to exist for the `user_id` foreign key and doesn't call GoTrue). But if the seeded users are ever used to manually sign in through the app UI for a sanity check, a missing `auth.identities` row silently breaks email/password login even though `auth.users` looks correct. Seed both tables together to avoid that trap later.

## Phase 1: Categories table with row-level security

### Overview

Create the migration pipeline's first migration: `public.categories`, RLS enabled in the same statement block, four granular per-operation policies.

### Changes Required:

#### 1. pgTAP extension migration

**File**: `supabase/migrations/<timestamp>_enable_pgtap.sql` (generate via `supabase migration new enable_pgtap`)

**Intent**: Make the `pgtap` extension available so Phase 2's test suite can run. Kept as its own migration since it's testing infrastructure, not product schema.

**Contract**: `create extension if not exists pgtap with schema extensions;` — Supabase's local Postgres image ships pgTAP pre-installed, so this only activates it.

#### 2. Categories table + RLS migration

**File**: `supabase/migrations/<timestamp>_create_categories_table.sql` (generate via `supabase migration new create_categories_table`)

**Intent**: The one real table proving the per-user isolation pattern. Minimal on purpose — `id`, `user_id`, `name`, `created_at` only; S-01 extends this later with its own migrations.

**Contract**: `public.categories(id bigint generated always as identity pk, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, name text not null, created_at timestamptz not null default now())`. `alter table ... enable row level security;` in the same migration, plus an explicit index on `user_id` (Postgres does not auto-index FK columns). Four policies, each `to authenticated`, with `auth.uid()` wrapped in `(select ...)` inside the policy expressions for per-statement rather than per-row evaluation (a plain `default auth.uid()` at the column level, since Postgres column defaults can't contain a subquery):
- `select` — `using ((select auth.uid()) = user_id)`
- `insert` — `with check ((select auth.uid()) = user_id)`
- `update` — `using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)`
- `delete` — `using ((select auth.uid()) = user_id)`

No policy is defined for `anon` — Postgres RLS default-denies any role with no matching policy, which is what keeps unauthenticated access disallowed per the PRD's Access Control section.

*Refined during implementation against Supabase's own Postgres best-practices (bigint identity over random UUID avoids index fragmentation at negligible cost here since RLS, not ID obscurity, is the isolation boundary; the FK column needs an explicit index; wrapping `auth.uid()` in the policies avoids a per-row function call). None of this changes the plan's intent or decisions — only the SQL implementing them.*

### Success Criteria:

#### Automated Verification:

- `supabase db reset` applies both migrations cleanly against local Docker Postgres with no errors
- A `pg_policies` query against `public.categories` returns exactly 4 rows, one per operation (select/insert/update/delete), each with `roles = {authenticated}`

#### Manual Verification:

- In Supabase Studio's Table Editor (`categories` → RLS), confirm RLS shows enabled and all four policies are listed with the expected `USING`/`WITH CHECK` expressions

---

## Phase 2: pgTAP verification suite

### Overview

Seed two deterministic test users and write the pgTAP suite that proves the isolation guarantee — the "verified by test rather than assumed" bar from the roadmap.

### Changes Required:

#### 1. Fixed seed users

**File**: `supabase/seed.sql`

**Intent**: Two known, stable users so the RLS suite is deterministic on every `supabase db reset`, matching the already-enabled `[db.seed]` config.

**Contract**: Insert two rows each into `auth.users` and `auth.identities`, with fixed UUIDs (e.g. `11111111-1111-1111-1111-111111111111` and `22222222-2222-2222-2222-222222222222`) the test suite references directly. See Critical Implementation Details for why both tables need rows.

#### 2. RLS pgTAP test suite

**File**: `supabase/tests/database/categories_rls.test.sql` (generate via `supabase test new categories_rls`)

**Intent**: Prove, per seeded user: they can insert and read only their own row, cannot see the other seeded user's row, cannot update or delete the other user's row, and cannot spoof `user_id` on insert to claim another user's identity.

**Contract**: A `pgTAP` `plan()`/`finish()` test file using `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` to switch identity between the two seeded users (see Critical Implementation Details), asserting via `is()`/`throws_ok()` on row counts and rejected spoofed inserts.

### Success Criteria:

#### Automated Verification:

- `supabase test db` runs the suite against a freshly reset local database and reports 0 failures

#### Manual Verification:

- In Supabase Studio's Auth panel, confirm both seeded users exist with the exact UUIDs referenced in `seed.sql` and the test file

---

## Phase 3: End-to-end local verification and documentation

### Overview

Run the full pipeline from a clean state, confirm it's reproducible, and correct the now-stale "not yet built" data-layer documentation.

### Changes Required:

#### 1. Clean-state verification run

**File**: n/a (command sequence, not a file change)

**Intent**: Confirm the whole pipeline — migrations, seed, pgTAP suite — is reproducible from zero with a single command sequence, not just "worked once."

**Contract**: `supabase db reset && supabase test db` succeeds twice in a row from a clean state.

#### 2. `CLAUDE.md` data-layer section update

**File**: `CLAUDE.md`

**Intent**: The "Data layer (not yet built)" section currently states no tables and no migrations exist — no longer true after this change.

**Contract**: Rewrite that section (and its `#data-layer-not-yet-built` anchor referenced from the RLS hard rule at the top) to describe: `supabase/migrations/` naming convention now has real examples, the RLS policy shape established (4 policies, `to authenticated`, `auth.uid() = user_id`), pgTAP as the verification method under `supabase/tests/database/`, and that hosted `supabase link` + `db push` remain outstanding (needs the DB password) before any table reaches production.

### Success Criteria:

#### Automated Verification:

- `supabase db reset && supabase test db` passes twice consecutively from a clean state
- `npm run lint` still passes (CLAUDE.md edits don't affect ESLint scope, but this confirms nothing else broke)

#### Manual Verification:

- Manually connect as each seeded test user (via `psql` with `set local role authenticated; set local request.jwt.claim.sub = ...`, or Studio's SQL editor) and confirm cross-user category rows are invisible and unwritable — a final human sanity check beyond the automated pgTAP suite
- Confirm `CLAUDE.md`'s data-layer section reads accurately against the new state
- Confirm the hosted-linking follow-up (`supabase link --project-ref <ref>` then `supabase db push`, needing the DB password) is clearly flagged as the user's next manual step before S-01 touches production

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- N/A — no application code is touched in this change.

### Integration Tests:

- The Phase 2 pgTAP suite **is** the integration test: it runs against a real local Postgres with real RLS enforcement, not a mock.

### Manual Testing Steps:

1. `supabase db reset` from a clean checkout, confirm no errors.
2. `supabase test db`, confirm 0 failures.
3. In Studio, inspect `categories`' RLS policies and the two seeded users directly.
4. Impersonate each seeded user via `psql`/Studio SQL editor and manually confirm isolation, independent of the automated suite.

## Performance Considerations

None — a 4-policy RLS check on a single-column-indexed (`user_id`, via the FK) table has negligible overhead at this project's stated scale (small user count, low QPS).

## Migration Notes

No existing data to migrate — this is the first table in the project. `wrangler rollback` (per `context/deployment/deploy-plan.md`) never reverts a schema migration; any future hosted push of these migrations must be treated as one-directional unless a corresponding down-migration is written by hand.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01
- Change identity: `context/changes/data-foundation-rls/change.md`
- Deploy runbook (hosted linking follow-up): `context/deployment/deploy-plan.md` Phase 4
- RLS hard rule: `CLAUDE.md` — "RLS on day one"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Categories table with row-level security

#### Automated

- [x] 1.1 `supabase db reset` applies both migrations cleanly
- [x] 1.2 `pg_policies` query returns exactly 4 rows for `categories`, all `roles = {authenticated}`

#### Manual

- [x] 1.3 Studio Table Editor confirms RLS enabled and all four policies listed with expected expressions

### Phase 2: pgTAP verification suite

#### Automated

- [ ] 2.1 `supabase test db` reports 0 failures against a freshly reset database

#### Manual

- [ ] 2.2 Studio Auth panel confirms both seeded users exist with the exact UUIDs used in tests

### Phase 3: End-to-end local verification and documentation

#### Automated

- [ ] 3.1 `supabase db reset && supabase test db` passes twice consecutively from a clean state
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Manual cross-user impersonation check confirms isolation independent of pgTAP
- [ ] 3.4 `CLAUDE.md` data-layer section reads accurately against the new state
- [ ] 3.5 Hosted-linking follow-up is clearly flagged as the user's next manual step
