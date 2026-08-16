<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Date-Range Spending View (S-04)

- **Plan**: context/changes/date-range-spending-view/plan.md
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-08-16
- **Verdict**: NEEDS ATTENTION (triaged 2026-08-16 — 3 fixed, 7 accepted/skipped)
- **Findings**: 0 critical, 4 warnings, 6 observations
- **Commit range**: `fbca0d4..c94af06` (7 commits, 30 files, +3599/−20)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING → PASS after F2 fix |
| Architecture | PASS |
| Pattern Consistency | WARNING → PASS after F4 fix |
| Success Criteria | PASS |

Automated criteria re-run at HEAD: `npm run lint` clean, `npx astro check` 0 errors/0 warnings, `npm run build` passes with the reports island in its own chunk (411 KB, separate from the dashboard's 12.7 KB `DayView`), `recharts` pinned exact with no caret, `npx supabase db reset` applies all 8 migrations, `npx supabase test db` green at Files=3 / Tests=61.

Every file the plan names is present in the diff. `recharts` is the only dependency added. All seven "What We're NOT Doing" boundaries hold: no `entries.category_id` index, no category-distribution work, `Entry.category` not widened, no test framework, no custom range picker, no drill-down, no toggle persistence, and netting confined to the Bilans tile.

## Findings

### F1 — Demo account reaches production through a migration, inverting CLAUDE.md's seed-user rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline / Safety & Quality
- **Location**: supabase/migrations/20260816120000_seed_demo_account.sql:24-55
- **Detail**: The migration creates an email-confirmed, password-sign-in-capable account (`demo@papertrail.app`, uuid `3333…`) plus 10 categories and 163 entries. Migrations are the one channel that always reaches the hosted database, so this lands in production on the next approved deploy. Two problems. First, it contradicts the plan's own Migration Notes (plan.md:542: *"no schema change, no data migration, nothing to backfill"*) and is covered by no phase or success criterion — it was added mid-flight on user request, outside the plan. Second, CLAUDE.md's `--include-seed` prohibition exists specifically to keep fixed test users out of the hosted `auth.users`; this achieves what that rule forbids, through the one channel the rule does not name.

  **Explicitly NOT a finding**: the committed bcrypt digest is not a practical exposure. The password is 24 random alphanumerics (~143 bits of entropy), so it is not brute-forceable at any cost factor. The review agent's "offline-crackable at leisure" claim is wrong and was discarded. The real exposure is that the plaintext was transmitted in a chat transcript, and that a permanent known-identity account will exist in production. Blast radius is bounded by RLS to that account's own synthetic rows.
- **Fix A ⭐ Recommended**: Split the migration — create the auth user out of band (Supabase dashboard or admin API), and reduce the migration to seeding `public.categories` / `public.entries` for that uuid, guarded by `where exists (select 1 from auth.users where id = '3333…')`.
  - Strength: Keeps `auth.*` writes out of the deploy path entirely, which also dissolves F3. Honours the intent of the `--include-seed` rule while still giving prod the demo data.
  - Tradeoff: The account creation becomes a manual step that is not reproducible from the repo, so a fresh `supabase db reset` locally would need the seed user added to `supabase/seed.sql` separately.
  - Confidence: HIGH — the guard pattern is standard and the split is mechanical.
  - Blind spot: Have not verified which admin path the user prefers for creating the prod account.
- **Fix B**: Keep it as-is and rotate the password after first sign-in.
  - Strength: Zero rework; the account is demo-only and RLS-isolated, and the user explicitly asked for prod propagation.
  - Tradeoff: Leaves an undocumented divergence from CLAUDE.md that the next contributor will read as precedent, and keeps F3's deploy risk live.
  - Confidence: MEDIUM — safe in practice, but the precedent cost is real and hard to reverse once merged.
  - Blind spot: Whether anything else in the pipeline assumes `auth.users` is untouched by migrations.
- **Decision**: SKIPPED — accepted as-is. Demo account is RLS-isolated and holds only synthetic data; the deliberate call is to keep the single-mechanism migration.

### F2 — Cumulative chart's previous-period line is misaligned and truncated for week/month buckets

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/reports/CumulativeChart.tsx:63-67
- **Detail**: `data` indexes `previousSeries` by bucket position, but `previousRange` (src/lib/services/reports.ts:67-70) makes the two ranges equal in **days**, not in bucket count. Shifting by N days re-aligns the range against Monday / first-of-month boundaries, so the two ranges can enumerate different numbers of buckets. Verified by sweeping all of 2026:

  | preset | mismatched days | prev shorter | prev longer |
  |---|---|---|---|
  | Poprzedni miesiąc | 91/365 | 60 | 31 |
  | Ostatnie 3 miesiące | 34/365 | 17 | 17 |
  | Od początku roku | 24/365 | 15 | 9 |
  | Cały okres | 19/365 | 19 | 0 |
  | Ten miesiąc | 4/365 | 2 | 2 |

  Day-bucketed presets (Ostatnie 7 dni, Ostatnie 30 dni, and the default view) are always aligned — this only affects week and month buckets. **It reproduces today**: on 2026-08-16, "Poprzedni miesiąc" gives current=5 week-buckets, previous=6, so the reference line's final bucket is silently dropped and the previous period's total is understated on the chart.

  When previous is *shorter*, the trailing `previous: null` values still reach the tooltip: `src/components/ui/chart.tsx:206` guards on `item.value !== undefined`, which `null` passes, so `formatCurrency(Number(null))` renders `0,00 zł` — the exact false claim the file's own comment at :51-53 says it is avoiding. (The truncation is confirmed by the sweep; the tooltip consequence is confirmed by code path but was not observed in a browser.)

  Even where bucket counts match, bucket 0 of each range can span a different number of days, so the "day 1 vs day 1" claim at :59-62 is approximate for week/month.
- **Fix A ⭐ Recommended**: Index the comparison by elapsed days from each range's start rather than by bucket position, and make the tooltip formatter return `null` for non-finite values instead of formatting them.
  - Strength: Fixes the alignment claim at its root rather than papering over the symptom, and makes the "same position in the period" promise literally true for every bucket size.
  - Tradeoff: More arithmetic in `CumulativeChart`; needs a re-verification pass over 5.8/5.9 on a week-bucketed preset.
  - Confidence: HIGH — the day offset is already computable from `enumerateBuckets` output and `inclusiveDayCount`.
  - Blind spot: Have not checked how the reindexed series reads visually when the previous period's buckets straddle the current one's.
- **Fix B**: Pad `previousSeries` to the current length and null-guard the tooltip, leaving the position indexing alone.
  - Strength: Much smaller change; removes the `0,00 zł` misreport and the silent truncation.
  - Tradeoff: The off-by-one-bucket misalignment remains, so the two lines still compare slightly different windows on week/month ranges.
  - Confidence: HIGH — mechanical.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. `cumulativeExpense` now returns an `elapsedDays` per bucket (days from the range's `from` to the last day that running total covers), and `sampleAt` reads the previous series at the current bucket's elapsed offset instead of its index. Tooltip formatting moved behind `tooltipAmount(value: unknown)`, which returns `null` for a null/non-numeric datum rather than letting `Number(null)` render `0,00 zł`. Verified numerically on the 2026-08-16 "Poprzedni miesiąc" case: previous-period total previously reported as 500 against a true 600 (sixth bucket dropped); now reports 600. lint / `astro check` / build all clean after the change.

### F3 — Writing to `auth.*` can abort the deploy in the build→deploy window

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260816120000_seed_demo_account.sql:24-55
- **Detail**: The migration inserts into `auth.users` and `auth.identities`, a schema owned by `supabase_auth_admin` on hosted projects. The role `supabase db push` connects as is not guaranteed INSERT there, and the hosted GoTrue version may not carry the same column set as the local image (CLI 2.98.2). CI runs `supabase db push` *after* the build and *before* `wrangler deploy` — the exact window CLAUDE.md flags — so a failure here leaves a built-but-undeployed pipeline. This has been verified locally only; nothing proves it against the hosted schema.
- **Fix**: Adopt F1's Fix A, which removes `auth.*` writes from the migration entirely. If keeping the current shape, dry-run it against the hosted project before merging.
- **Decision**: SKIPPED — risk accepted. A failed `db push` surfaces in CI and blocks the deploy rather than corrupting state.

### F4 — Date arithmetic duplicated across the server/client boundary with no cross-reference

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/reports.ts:45-61, src/components/reports/range.ts:48-90
- **Detail**: `pad`, `addDays` and `inclusiveDayCount` now exist in two copies, and `addMonths` in a third (src/components/entries/date-utils.ts:32). The coupling is load-bearing but invisible: the server's `previousRange` and the client's `enumerateBuckets` must agree on day arithmetic or zero-filling breaks silently — and F2 is exactly what happens when the two drift apart in their notion of period length. Neither copy references the other. The split itself is deliberate (the client resolves "today" locally, the server never derives dates), so this is about discoverability, not layering.
- **Fix A ⭐ Recommended**: Add a cross-reference comment at both sites naming the other copy and stating the invariant they must jointly preserve.
  - Strength: Zero behavioural risk, and it is the invariant — not the code — that actually needs to be visible. Matches how this repo already documents cross-file coupling (e.g. `range.ts:80-83` on `date_trunc` alignment).
  - Tradeoff: The duplication itself remains, so a future edit can still touch one copy only.
  - Confidence: HIGH — comment-only.
  - Blind spot: None significant.
- **Fix B**: Extract the shared primitives into a module under `src/lib/`.
  - Strength: Makes divergence structurally impossible.
  - Tradeoff: Pulls a client-side concern into `src/lib/`, and `range.ts` was deliberately co-located with the feature per the `date-utils.ts` precedent the plan cites; this partly undoes that decision.
  - Confidence: MEDIUM — depends whether the bundler keeps the shared module out of the server chunk cleanly.
  - Blind spot: Have not checked the chunking impact.
- **Decision**: FIXED via Fix A. Both modules now carry a `⚠` block naming the other copy and stating the invariant: `previousRange` defines the comparison period in equal inclusive DAYS, not equal bucket counts, so consumers must compare in days. `range.ts` additionally records the `date_trunc` alignment requirement. Both cite the F2 regression as the concrete failure that assumption produced.

### F5 — Demo data is pinned to a hardcoded 2026-05-16 .. 2026-08-16 window

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260816120000_seed_demo_account.sql:92,119-136,149-156
- **Detail**: Absolute dates are what make the data byte-identical between dev and prod, but once real time moves past 2026-08-16 every preset except "Cały okres" and "Od początku roku" renders empty for the demo account — the opposite of what a demo account is for. Flagged when the migration was written; recorded here so it is not lost.
- **Fix**: Accept for now and add a follow-up to re-anchor the dates relative to `current_date` if the account is meant to stay useful.
- **Decision**: SKIPPED — accepted. The account exists to test this slice now; re-anchor if it needs a longer life.

### F6 — pgTAP `anon` denial asserted via catalog lookup instead of the planned `throws_ok`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/tests/entries_summary_test.sql:222-260
- **Detail**: The plan specified `anon` executing the function raises `42501` via `throws_ok`. The implementation asserts `has_function_privilege` instead. The substitution is documented at :223-248 with a minimal repro showing the Supabase local Postgres image segfaults (signal 11) whenever a function-level EXECUTE denial is raised inside a `set local role` transaction — pgTAP's own impersonation mechanism — with no PaperTrail code involved, and confirms the real PostgREST path still returns a clean `42501`. Sound call, thoroughly justified; noted only because the assertion that runs is not the one the plan named.
- **Fix**: None needed. Leave as-is.
- **Decision**: SKIPPED — no action. The substitution is correct and the in-file repro documents it fully.

### F7 — `all-time` resolves to 20 years back rather than the planned `1970-01-01`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/reports/range.ts:39-46,111
- **Detail**: The plan called for `1970-01-01`. That would imply ~680 month buckets and trip the plan's own ≤400-bucket guard on every "Cały okres" load — the plan's two clauses were mutually incompatible. The implementation resolves 20 years back instead, documented in-code with that reasoning. This is implementation catching a plan defect, not drift.
- **Fix**: None needed. Consider back-porting the correction into the plan text if it is used as a reference for S-05.
- **Decision**: FIXED — back-ported. plan.md's Phase 4 `resolveRange` clause now states the relative floor and carries a dated correction note explaining that the original `1970-01-01` contradicted Phase 2's ≤400-bucket guard, flagged for S-05.

### F8 — `Średnia dzienna`'s delta is always identical to `Wydatki`'s

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/components/reports/KpiTiles.tsx:50-51,56,58
- **Detail**: Because `previousRange` guarantees equal day counts, `(E_c/n − E_p/n)/(E_p/n)` reduces exactly to `(E_c − E_p)/E_p`. The tile therefore prints a percentage the user has already read one tile to the left. The comment at :46-49 notices the equal length but keeps the delta anyway.
- **Fix**: Drop the delta line from the Średnia dzienna tile, or replace it with something the other tiles do not already say.
- **Decision**: SKIPPED — accepted. A redundant delta is harmless and keeps the four tiles visually uniform.

### F9 — `MAX_BUCKETS` guards UI correctness, not the database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/reports.ts:26,151
- **Detail**: An authenticated user can POST directly to `/rest/v1/rpc/entries_summary` with any range, bypassing the 400-bucket check and receiving a PostgREST-truncated 1000-row result. Only their own data is reachable, so there is no isolation impact — worth recording that the guard protects the chart's correctness rather than the database.
- **Fix**: None needed. Documented here so a future reader does not mistake it for an enforcement boundary.
- **Decision**: SKIPPED — no action. This report is the record; there is no isolation impact.

### F10 — The aggregate silently drops entries filed under another user's category

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260816103000_add_entries_summary_function.sql:53
- **Detail**: The inner `join public.categories` is RLS-scoped. `create_entries_table.sql:31-36` already documents that the FK cannot enforce category ownership and that only the service layer does. If that app-layer check were ever bypassed, the affected entry would vanish from `/reports` while still appearing in the day list — a silent divergence between two views of the same data, and precisely the class of app-layer-only invariant `context/foundation/lessons.md` warns about.
- **Fix**: `left join` plus `coalesce(c.is_recurring, false)` would fail closed (entry counted, treated as non-recurring) instead of disappearing. Low priority while the service check holds.
- **Decision**: SKIPPED — accepted. The service-layer ownership check holds; revisit if that path ever changes.
