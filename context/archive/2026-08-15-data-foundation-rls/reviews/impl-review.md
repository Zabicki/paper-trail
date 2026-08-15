<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-User Data Foundation (F-01) Implementation Plan

- **Plan**: context/changes/data-foundation-rls/plan.md
- **Scope**: Phase 3 of 3 (full plan — all phases complete)
- **Date**: 2026-08-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Seed users' NULL auth token columns undermine the "manual sign-in" claim

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/seed.sql:6-9 (comment claim) and the two `auth.users` inserts
- **Detail**: The seed file's comment claims the two seeded accounts "also work for a manual email/password sign-in sanity check." Live-schema inspection confirms `confirmation_token`, `recovery_token`, `email_change_token_new`, and `email_change` are nullable with no default, and the seeded rows leave all four as actual `NULL`. GoTrue's password-grant login path scans these into non-nullable Go string fields — a well-documented Supabase self-host gotcha that produces a NULL-scan error. This wasn't confirmed live (the sandbox only starts the `db` container, not `auth`/GoTrue), so it's schema-evidence-based rather than a reproduced failure — but the schema state matches the failure mode exactly.
- **Fix A ⭐ Recommended**: Set `confirmation_token = ''`, `recovery_token = ''`, `email_change_token_new = ''`, `email_change = ''` explicitly in both `auth.users` insert rows, so the seeded accounts genuinely support the sign-in path the comment already claims.
  - Strength: Makes the existing comment true for a trivial cost (four empty-string literals); doesn't touch the pgTAP path at all, since pgTAP impersonation never goes through GoTrue.
  - Tradeoff: A few more columns to keep in sync if the seed rows are edited later.
  - Confidence: MEDIUM — the NULL-scan failure mode is well-documented, but unconfirmed live in this environment.
  - Blind spot: Never tested an actual password sign-in against these two seeded users through GoTrue.
- **Fix B**: Soften the seed.sql comment to describe these as pgTAP-only fixtures and drop the "manual sign-in sanity check" claim, leaving the NULL columns as-is.
  - Strength: Zero schema risk; matches what this change actually required (only pgTAP impersonation, never real sign-in).
  - Tradeoff: Loses the (currently unverified) convenience of reusing these same users for a real manual sign-in check later.
  - Confidence: HIGH — only requires narrowing a claim, not touching schema.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — Stale test-path comments in two files

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260815125826_enable_pgtap.sql:2, supabase/seed.sql:2
- **Detail**: Both comments reference `supabase/tests/database/*.test.sql` / `supabase/tests/database/categories_rls.test.sql` — a path that never existed. `supabase test new` actually generates a flat `supabase/tests/<name>_test.sql` (no `database/` subdirectory), which is where `categories_rls_test.sql` actually sits. Harmless functionally (the suite still runs and passes), but misleading to the next reader who goes looking for `supabase/tests/database/`.
- **Fix**: Update both comments to reference `supabase/tests/categories_rls_test.sql`.
- **Decision**: PENDING

### F3 — Categories migration has no explicit transaction wrapper

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260815125827_create_categories_table.sql:6-46
- **Detail**: `create table` and the later `alter table ... enable row level security` are separate statements with no explicit `begin;`/`commit;` around them. If the Supabase CLI's migration runner doesn't itself wrap each file in a single transaction, there's a theoretical window between the two statements where the table would exist without RLS. Low real-world risk here (migrations run before the app ever serves traffic in this single-developer flow), but this file is the template every later table's migration will copy, so removing even the theoretical gap is cheap insurance.
- **Fix**: Wrap the migration's statements in explicit `begin;` / `commit;`.
- **Decision**: PENDING

## What was checked and found clean (no findings)

- **RLS correctness**: `relrowsecurity = true` confirmed live; four separate policies (one per operation), all `to authenticated`, all keyed on `(select auth.uid()) = user_id`; no blanket `for all` policy; no `anon` policy (relying on correct RLS default-deny, confirmed `anon` *does* hold table-level GRANTs but is still blocked by RLS).
- **`auth.uid()` wrapping**: correctly wrapped in `(select ...)` inside every policy expression (perf best practice), and correctly *not* wrapped in the column `default` (which would be invalid Postgres syntax — subqueries can't appear in column defaults).
- **Insert-spoof protection**: verified live — a user cannot override the `user_id` default to claim another identity; the pgTAP suite's `throws_ok` assertion on SQLSTATE `42501` passes.
- **pgTAP correctness**: role/JWT-claim impersonation (`set local role authenticated; set local request.jwt.claim.sub = ...`) actually exercises RLS rather than running as bypass-capable superuser; assertions are non-tautological (row counts, spoof rejection, no-op cross-user writes, total-row-count leak/loss check). Re-ran live: 9/9 pass.
- **Migration idempotency**: `enable_pgtap.sql` uses `create extension if not exists`; `create_categories_table.sql`'s plain `create table` is correct (not idempotent, as expected for a tracked migration).
- **FK/index hygiene**: `categories_user_id_idx` exists on the FK column; `on delete cascade` is appropriate for owned-row cleanup.
- **Data types**: `bigint generated always as identity`, `uuid`, `text`, `timestamptz not null default now()` — all appropriate, matches Supabase/Postgres best practices.
- **Naming convention**: both migrations match `YYYYMMDDHHmmss_short_description.sql` exactly.
- **CLAUDE.md doc edit**: "Data layer" section and the "RLS on day one" anchor link both updated accurately; content matches the implemented pattern.
- **Scope discipline**: `git diff --name-only 8db2788^..26840e9` shows exactly the 5 planned implementation files changed (plus the change's own plan artifacts) — no unplanned files, no `src/` code touched.
- **Success criteria**: all automated checks re-run fresh and passing (`supabase db reset`, `pg_policies` 4-row check, `supabase test db` 9/9, `npm run lint` exit 0); all manual Progress checkboxes have observable evidence in the session transcript (no rubber-stamping).
