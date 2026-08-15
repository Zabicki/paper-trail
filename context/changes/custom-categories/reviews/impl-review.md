<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Custom Categories (S-01)

- **Plan**: context/changes/custom-categories/plan.md
- **Scope**: Phase 1 of 3 (full plan review — all 3 phases)
- **Date**: 2026-08-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Unguarded `request.json()` parse can bypass the structured-error convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/categories/index.ts:35, src/pages/api/categories/[id].ts:37
- **Detail**: `await context.request.json()` is not wrapped in try/catch. A malformed JSON body or wrong `Content-Type` throws uncaught, two lines before the deliberate `safeParse` validation-failure branch that returns a clean `{error, field}` 400. Astro turns the uncaught throw into a generic 500 instead, which is inconsistent with the careful structured-error handling the rest of both routes use for every other failure mode.
- **Fix**: Wrap the `.json()` call in try/catch and return the same `{error}` 400 shape as the zod-validation-failure branch on parse failure.
- **Decision**: PENDING

### F2 — `updateCategorySchema` aliases `createCategorySchema`, making PATCH behave as PUT

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/services/categories.ts:15
- **Detail**: `createCategorySchema`'s `color`/`isRecurring` fields carry `.default(...)`, so a `PATCH` body sending only `{name: "Foo"}` would silently reset `color`/`isRecurring` to their defaults rather than leaving them untouched — zod fills in the default before the value ever reaches Postgres. Not exploitable today: `CategoriesManager.tsx` always submits the full `{name, color, isRecurring}` triple on every edit. But the route's contract is effectively "PUT wearing a PATCH verb," and any future caller sending a genuinely partial payload would get silent data loss on the untouched fields.
- **Fix A ⭐ Recommended**: Document the contract explicitly — rename the export or add a comment stating `PATCH` requires the full triple (matches current behavior, zero code change, makes the footgun visible to the next reader).
  - Strength: Free, immediate, and honest about what the endpoint actually does — no risk of introducing a merge bug.
  - Tradeoff: Doesn't fix the footgun, just labels it; a future caller could still get bitten if they don't read the comment.
  - Confidence: HIGH — this matches how the only current caller already uses the endpoint.
  - Blind spot: None significant — no other caller exists yet.
- **Fix B**: Make `updateCategorySchema` genuinely partial (`createCategorySchema.partial()`) and have `updateCategory` merge onto the existing row before writing.
  - Strength: Makes PATCH behave like PATCH; safe for any future partial-payload caller.
  - Tradeoff: Requires an extra read-before-write (or a Postgres-side `coalesce`) in `updateCategory`, adding real complexity for a caller that doesn't exist yet.
  - Confidence: MEDIUM — reasonable but is solving for a caller that isn't there.
  - Blind spot: Haven't confirmed whether any near-term slice (S-02+) will call this endpoint with partial payloads.
- **Decision**: PENDING

### F3 — No automated (pgTAP or curl) coverage of soft-delete's runtime effect; only manually verified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: supabase/tests/categories_rls_test.sql (whole file); src/lib/services/categories.ts:58,93,116
- **Detail**: The pgTAP suite proves the schema/RLS layer (uniqueness, palette check, defaults) but never exercises `deleted_at` — soft-delete filtering lives entirely in the TypeScript service layer (`.is("deleted_at", null)`), which pgTAP structurally cannot reach (it drives raw SQL against Postgres, not the Node/Workers service code). The only verification that a soft-deleted category actually disappears from a user's own list, and that its name becomes reusable, was the human manual-testing pass (plan Manual Testing Step 6, Progress 3.7) — there is no automated regression guard if this behavior breaks later.
- **Fix**: Accept as a documented gap rather than build new test infra — this repo has no JS test framework (per CLAUDE.md) and pgTAP is DB-layer-only by design, so closing this gap "for real" would mean introducing a new testing tool for one behavior. Record it as a follow-up/lesson so a future slice that touches this code path knows to re-verify manually rather than assuming coverage exists.
- **Decision**: FIXED — recorded as a lesson in context/foundation/lessons.md ("Soft-delete and other app-layer-only invariants aren't provable by pgTAP")

### F4 — Two files changed outside the plan's stated file list (both self-disclosed, both benign)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/dashboard.astro (commit 7fdb6e0); supabase/seed.sql (commit bc78f65)
- **Detail**: `dashboard.astro` was modified to render `<Topbar />` so `/categories` is reachable post-signin — not in Phase 3's "Changes Required" list. `seed.sql` was modified to fix a pre-existing GoTrue NULL-scan bug blocking real password sign-in for the seeded test users — not in Phase 2's "Changes Required" list. Both were flagged to the user live during implementation and approved in the moment (via AskUserQuestion for the seed.sql fix; disclosed directly for the dashboard.astro change), so this is undocumented-in-plan-*text* scope, not a hidden or unapproved change.
- **Fix**: Add a short note to plan.md's Current State Analysis or References section recording these two additions, so a future reader of the plan alone (without this conversation's context) understands why those files appear in the diff.
- **Decision**: FIXED — added an "## Addendum" section to plan.md documenting both files and their commits

### F5 — RLS has no defense-in-depth for `deleted_at`; isolation of a user's own deleted rows relies solely on app-layer filtering

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260815125827_create_categories_table.sql:27-46 (F-01's RLS policies, unchanged); src/lib/services/categories.ts:58,93,116
- **Detail**: F-01's RLS policies are ownership-only (`(select auth.uid()) = user_id`) and know nothing about `deleted_at`. Cross-*user* isolation is airtight regardless (RLS enforces it unconditionally at the DB level). But protection of a user's *own* already-soft-deleted rows from being re-read or re-mutated exists only because every current query in `categories.ts` remembers to add `.is("deleted_at", null)` — there's no DB-level backstop. No current code path forgets it, so nothing is exploitable today.
- **Fix**: No action needed now. If a future table adopts this same soft-delete pattern, consider folding `deleted_at is null` into the RLS policy's `using` expression itself for defense-in-depth, rather than relying on every future query author to remember the app-layer filter.
- **Decision**: SKIPPED

### F6 — `handleAdd`/`handleSaveEdit` have no explicit `catch` for network-level fetch rejection

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/categories/CategoriesManager.tsx (handleAdd, handleSaveEdit)
- **Detail**: Both handlers rely on `try/finally` (no `catch`) plus the call site's `void handleAdd(...)` to reset their loading flag; a network-level `fetch` rejection (not just a non-OK response) would surface only as a console-logged unhandled rejection rather than a user-visible error message, though the loading state does still reset correctly via `finally`. The mount effect's fetch does have an explicit `catch`, so this is an inconsistency in rigor rather than a functional bug.
- **Fix**: Add a `catch` block to both handlers that sets the same error state used for non-OK responses, so a network failure surfaces the same inline message a validation error would.
- **Decision**: FIXED — added catch blocks to handleAdd and handleSaveEdit in CategoriesManager.tsx
