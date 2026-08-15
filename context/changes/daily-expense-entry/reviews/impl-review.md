<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Daily Expense Entry (S-02, North Star)

- **Plan**: context/changes/daily-expense-entry/plan.md
- **Scope**: Phase 4 of 4 (full plan — all phases complete)
- **Date**: 2026-08-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification (re-run live, not from Progress checkboxes)

- `npx supabase db reset` — clean apply of all 4 migrations ✅
- `npx supabase test db` — `Files=2, Tests=31, Result: PASS` ✅
- `npm run lint` — 0 errors ✅
- `npx astro check` — 0 errors, 0 warnings ✅
- `npm run build` — succeeds ✅

## Findings

### F1 — Stale-day race when saving mid-navigation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/entries/DayView.tsx:79-82
- **Detail**: `handleSaved` does `setEntries((prev) => [...(prev ?? []), entry])` unconditionally. The `EntryForm` submit closure correctly bakes in the `occurredOn` active at click time, so the *persisted* data is always correct — but if a user submits for day A, then switches to day B before the POST response lands, the late response's `handleSaved` call splices day A's entry into what's now rendered as day B's list. Self-corrects only once day B's own fetch resolves. Not a data-integrity bug, but a reachable UI glitch.
- **Fix**: Guard the append — only splice `entry` into `entries` if `entry.occurredOn` matches the currently-selected day (read via a ref, since the closure over `selectedDate` is otherwise stale); skip the append and rely on the calendar's own refresh when it doesn't match.
- **Decision**: FIXED — added `selectedDateRef` (synced via `useEffect`) and guarded the append in `handleSaved`; calendar refresh still bumps unconditionally so the just-saved day's red marking still clears.

### F2 — Three unplanned side-fixes bundled into this change's commit range

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: astro.config.mjs (b7fdc71); eslint.config.js, src/components/Welcome.astro, src/pages/api/auth/signin.ts, src/pages/index.astro (734b747)
- **Detail**: Neither commit's changes appear anywhere in plan.md's "Changes Required." Both sub-agents independently read the actual diffs and judged them benign and well-justified: `resolve.dedupe: ["react","react-dom"]` fixes a real `useFormStatus` hydration crash (confirmed `SubmitButton` usage); the `eslint.config.js` change is a narrowly-scoped, documented parser-incompatibility workaround limited to `*.astro` files; and deleting `Welcome.astro` + rewriting `index.astro` into an auth-state redirect + retargeting `signin.ts`'s success redirect to `/dashboard` are one coherent, correctly-reasoned consequence of repurposing `/dashboard` as the real landing screen (no dangling `Welcome` references found). None introduce risk or regress other config. Still, the auth-flow and homepage-routing changes are user-facing behavior change outside this plan's stated scope, and the plan is now silently inaccurate as a historical record of what shipped in this change.
- **Fix**: Append a short addendum note to plan.md (e.g. under "What We're NOT Doing" or a new "Addenda" section) documenting these three side-fixes and why they were folded in here rather than filed separately.
- **Decision**: FIXED — added an "Addenda" section to plan.md documenting all three side-fixes and the rationale for folding them in here.

### F3 — `ApiErrorBody`/`parseErrorBody` now duplicated a second time

- **Severity**: 👁️ OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/components/entries/EntryForm.tsx
- **Detail**: The error-body-parsing helper first introduced for `CategoriesManager.tsx` is copy-pasted again here rather than extracted to `src/lib/`. Not introduced as a new problem by this change, but now duplicated twice, which is worth factoring out.
- **Decision**: FIXED — extracted `ApiErrorBody`/`parseErrorBody` to `src/lib/api-error.ts`; both `EntryForm.tsx` and `CategoriesManager.tsx` now import the shared helper.

### F4 — `numeric(10,2)` amounts surface as JS `number` — future summation risk

- **Severity**: 👁️ OBSERVATION
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260815164539_create_entries_table.sql; src/components/entries/DayEntriesList.tsx
- **Detail**: Fine for this slice's single-entry display (`toFixed(2)`), but PostgREST returns `numeric` as a JS `number`, and floating-point drift becomes a real concern once a later slice (F-03/S-05 aggregation) starts summing many `amount` values. Not actionable now — flagging for whoever builds the aggregation views.
- **Decision**: SKIPPED — no action in this slice; forward-looking note for the S-05 aggregation work.
