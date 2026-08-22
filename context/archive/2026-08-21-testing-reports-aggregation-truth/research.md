---
date: 2026-08-21T19:39:08+02:00
researcher: Krzysztof
git_commit: 6ba66727c0237e2bc4f4f0ea8a86452a5d8236f2
branch: master
repository: paper-trail
topic: "Reports aggregation truth: prove a displayed figure is correct or absent"
tags: [research, codebase, reports, aggregation, testing, rollout-phase-3]
status: complete
last_updated: 2026-08-21
last_updated_by: Krzysztof
---

# Research: Reports aggregation truth — prove a displayed figure is correct or absent

**Date**: 2026-08-21T19:39:08+02:00
**Researcher**: Krzysztof
**Git Commit**: `6ba66727c0237e2bc4f4f0ea8a86452a5d8236f2`
**Branch**: `master`
**Repository**: paper-trail

## Research Question

Rollout Phase 3 of `context/foundation/test-plan.md` — ground the four
contexts §2 risk #2 requires research to establish, per
`test-plan.md:65`:

1. the row-count ceiling on the data path and the behaviour at it;
2. where the total is computed relative to per-category rows;
3. how range presets resolve to concrete dates;
4. where filter state lives relative to the caption that reports it.

Risk response intent (`change.md:22-26`): prove a figure is either correct
or absent — never a plausible number derived from a partial result set —
and that filter state always matches the numbers displayed.

## Summary

**The guards this phase must protect already exist. None of them is
asserted anywhere, at any layer.**

The reports path carries three deliberate "correct or absent" mechanisms,
and all three were added reactively — two by implementation review after
the feature shipped, one by a follow-up defect slice:

| Guard                                                        | Anchor                                                                 | Origin                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------- |
| `MAX_BUCKETS = 400`, pre-flight, throws `RangeTooLargeError` | `src/lib/services/reports.ts:46`, checked at `:188-190` and `:358-360` | S-04 planned (`e4ae841`)                  |
| `POSTGREST_MAX_ROWS = 1000`, post-flight exact length check  | `src/lib/services/reports.ts:45`, checked at `:381-383`                | S-05 **impl-review F1**, commit `5ee5465` |
| `ALL_TIME_MAX_MONTHS_BACK = 396`, silent left-edge clamp     | `src/components/reports/range.ts:69`, applied at `:136-141`            | S-08, after ship (`cc6eb46`)              |

Both pgTAP suites on this path **explicitly disclaim** the application-layer
rules as out of reach and name them a permanent manual-verification
requirement — `supabase/tests/entries_summary_test.sql:17-22` and
`supabase/tests/entries_category_summary_test.sql:20-25`. That disclaimer was
written before a JS runner existed. `lessons.md:11` records that "therefore
manual forever" no longer follows: since `testing-runner-bootstrap`
(2026-08-21) these route to a unit or service test. **Phase 3 is the phase
that discharges that debt.**

The good news for cost × signal: **every target is reachable at the cheapest
layer.** `src/components/reports/distribution.ts` and
`src/components/reports/range.ts` are pure — no React, no `astro:*`, no
network — so they are plain Vitest unit tests with zero mocking and zero
config change. `src/lib/services/reports.ts` only `import type`s the Supabase
client (`reports.ts:3`), so it is service-integration-testable per §6.2. **One
harness change is required**: the existing `supabase-fake` exposes no `.rpc()`,
and the entire reports path goes through `.rpc()`.

The single most important finding for fixture design: **the truncation this
phase exists to prevent is a PostgREST behaviour, not a Postgres one.** pgTAP
talks to Postgres directly and never crosses `max_rows`, so pgTAP
_structurally cannot_ reproduce the failure — no matter how large the fixture.
The guard is a pure `array.length` comparison in TypeScript, so a Vitest
fixture of ≥1000 synthetic rows reaches it exactly and in milliseconds. The
"fixture sized past the ceiling" the plan asks for is cheap, and it belongs in
Vitest, not pgTAP.

## Detailed Findings

### 1. The row ceiling — inventory and behaviour at the boundary

Nine ceilings sit on or near this path. Only three are reachable through the UI.

| #   | Ceiling                                | Value        | Anchor                                         | Behaviour at the boundary |
| --- | -------------------------------------- | ------------ | ---------------------------------------------- | ------------------------- |
| C1  | PostgREST `max_rows`                   | 1000         | `supabase/config.toml:18`                      | **silent truncation**     |
| C2  | `POSTGREST_MAX_ROWS` (TS mirror of C1) | 1000         | `src/lib/services/reports.ts:45`               | throws → 400              |
| C3  | `MAX_BUCKETS`                          | 400          | `src/lib/services/reports.ts:46`               | throws → 400, pre-flight  |
| C4  | `ALL_TIME_MAX_MONTHS_BACK`             | 396          | `src/components/reports/range.ts:69`           | **silent clamp**          |
| C5  | `bucketFor` thresholds                 | 30 / 92 days | `src/components/reports/range.ts:148-157`      | granularity switch        |
| C6  | `TOP_N` / `MIN_SHARE`                  | 8 / 0.02     | `src/components/reports/distribution.ts:23-24` | collapse, labelled        |
| C7  | colour slots                           | 36 (12 × 3)  | `src/components/reports/distribution.ts:74-75` | silent reuse              |
| C8  | `.limit(1)` on `getFirstEntryDate`     | 1            | `src/lib/services/reports.ts:257`              | by design                 |
| C9  | `RECENCY_LOOKBACK`                     | 50           | `src/lib/services/entries.ts:436,457`          | **not on this path**      |

Neither RPC contains a SQL `LIMIT`
(`supabase/migrations/20260816103000_add_entries_summary_function.sql:47-60`;
`supabase/migrations/20260818090000_add_category_icon.sql:124-142`, the current
definition). There is no `.range()` anywhere in `src/`. `summaryQuerySchema`
(`reports.ts:21-28`) bounds date _format_ and two enums only — **nothing bounds
the span between `from` and `to`**; that is C3's job.

**C3 is pre-flight and refuses rather than truncates.** The route comment states
the doctrine this phase is named after — `src/pages/api/entries/summary.ts:56-63`:

```ts
// Refused rather than truncated: PostgREST would cap the result at 1000
// rows and return a partial aggregate that still looks like a valid
// answer. A wrong number is worse than an error.
if (error instanceof RangeTooLargeError) {
```

**C2 is post-flight, exact, and exists only on the category endpoint** —
`src/lib/services/reports.ts:375-383`:

```ts
// Exact truncation detection, because MAX_BUCKETS cannot bound this
// response's width (see its comment). PostgREST truncates silently, and
// grouping-set row order is unspecified — so the row dropped may well be the
// `()` grand total, which would leave `total` at 0 and make every consumer
// render 0% beside a real złoty amount. Raising the same error as the range
// guard means the route's existing 400 mapping already covers it.
if ((result.data?.length ?? 0) >= POSTGREST_MAX_ROWS) {
  throw new RangeTooLargeError();
}
```

Note it is `>=`, not `>` — an exactly-1000-row result is rejected as
truncated. A deliberate conservative false positive.

**`getEntriesSummary` has no equivalent check.** It relies entirely on an
arithmetic argument stated in the `MAX_BUCKETS` comment (`reports.ts:32-44`):
`entries_summary` returns ≤2 rows per bucket, so 400 buckets ≈ 802 rows,
provably clear of 1000. That argument is load-bearing and asserted nowhere. It
holds only while the RPC's grouping sets stay `((bucket, type), (type))`
(`…103000_….sql:56-59`).

#### Cardinality — which ceiling bites first, and where the fixture boundary is

`entries_category_summary` uses three grouping sets
(`…add_category_icon.sql:137-141`), so worst-case rows for N categories over
B buckets is **N·(B+1) + 1**.

| Scenario                                       | Buckets | N   | Rows   | Verdict               |
| ---------------------------------------------- | ------- | --- | ------ | --------------------- |
| Year range, 30 categories (UI → month)         | 12      | 30  | 391    | safe                  |
| 30-day range, 30 categories (UI → day)         | 30      | 30  | 931    | safe, thin margin     |
| 30-day range, **33** categories                | 30      | 33  | 1024   | **C2 fires → 400**    |
| "Cały okres", 3 years, 30 categories (→ month) | 36      | 30  | 1111   | **C2 fires → 400**    |
| Crafted `bucket=day` over 400 days, 30 cats    | 400     | 30  | 12 031 | C2 fires; C3 does not |

**C2 bites first on the category endpoint; C3 is effectively dead there** —
400 month buckets is 33 years, and C4 already clamps "Cały okres" to 397 months.

The demo seed carries **32 categories**
(`20260816120000_seed_demo_account.sql` + `20260816151000_extend_demo_categories.sql`,
per `20260818090000_add_category_icon.sql:31-33`). Dense over 30 days:
32·31 + 1 = **993 rows — one category short of tripping the guard.** That is
the concrete form of the anti-pattern `test-plan.md:65` warns about.

#### The failure this phase is named after, from the archive

`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:67`
— finding **F1**, ❌ CRITICAL, the defect that produced the REJECTED verdict:

> Grouping-set output order is unspecified and the `()` set is emitted last,
> so the row most likely dropped is the grand total. `total` then stays at its
> initializer `0` and every consumer degrades quietly instead of failing:
> `shareOf` returns 0 for everything, `aboveMinShare` falls back to
> `categories.length` so top-N selection silently switches rule, the donut
> centre reads `0,00 zł`, and every ranking row prints `0%` beside a real
> złoty amount.

Decision was **FIXED**, not accepted (`impl-review.md:78`), with an
acknowledged cost (`:70`): "A legitimate view (`Cały okres` on a mature
account with many categories) becomes an error rather than a chart."

A related finding was **accepted**:
`context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:151-159`
(F9) — an authenticated user can POST directly to `/rest/v1/rpc/entries_summary`
and receive a truncated 1000-row result, bypassing C3 entirely. **Decision:
SKIPPED.** The guard protects UI correctness, not the database. A test must not
assert otherwise.

### 2. Where the total is computed, and whether percentages share it

**Two SQL aggregates, both exact Postgres `numeric`** (`entries.amount` is
`numeric(10,2)`, `20260815164539_create_entries_table.sql:12`):

- **T1** `…103000_….sql:51-59` — `sum(e.amount)` grouped by
  `grouping sets ((bucket, type), (type))`. The `(type)` set is the per-type
  range grand total (`bucket_start` null). Board A only.
- **T2** `…add_category_icon.sql:125-141` — same join plus `e.type = 'expense'`,
  grouped by `grouping sets ((bucket, cat…), (cat…), ())`. The `()` set is the
  **percentage denominator**, and the migration says so
  (`20260816150000_….sql:45-48`): _"The empty set is the load-bearing one: it
  makes the percentage denominator an exact Postgres numeric rather than a
  JavaScript sum of per-category floats."_

**The service assigns, never accumulates.** `reports.ts:154-160` takes
`totals.income`/`totals.expense` from the null-bucket rows; `reports.ts:314-317`
takes `total` from the both-null row. Exactly two parse points, both `Number()`
— `reports.ts:150` and `reports.ts:310` — on a field typed `number | string`
because PostgREST may serialise `numeric` either way (`reports.ts:127-129`).

**For every real category, percentage and amount share one denominator.**
`share = category.total / total` (`distribution.ts:228,292`) where `total` is
the SQL `()` row; the amount rendered beside it is the same `category.total`.
Confirmed at review:
`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:276`
— "The percentage denominator is the SQL `()` row, never a JS sum."

**Three places where the denominator deliberately differs — all three are
characterisation targets, not bugs:**

1. **`Pozostałe`** — `distribution.ts:302` sums the tail with a JS
   `reduce` float, then `CategoryRanking.tsx:70` and `CategoryDonut.tsx:74`
   divide that float by the exact SQL `total`. Numerator and denominator come
   from different arithmetic. Sub-grosz, invisible after `formatCurrency`, but
   it is **the one place where the parts are not guaranteed to sum to the whole
   by construction**.
2. **Ranking bar width** — `CategoryRanking.tsx:60` uses `share / maxShare`,
   not `share / total`. Documented at `:30-34` and justified at
   `impl-review.md:256`: "with 30 categories the leader sits ~17% and every bar
   would be a stub."
3. **Donut arc geometry** — Recharts normalises arcs against its own float sum
   of the `data` array (`CategoryDonut.tsx:144-145`), while the printed share
   and centre label use the SQL total.

**Zero-denominator is guarded in four places**, never reaching a division:
`distribution.ts:228` (`shareOf` returns 0), `:231` (share floor skipped so
selection degrades to top-N alone), `CategoryDonut.tsx:74`,
`CategoryRanking.tsx:70`. A fifth guard exists for bar geometry —
`CategoryRanking.tsx:74` uses `Number.EPSILON` because `Math.max()` over an
empty array is `-Infinity`.

**Percentages are never re-normalised to 100.** `formatShare`
(`src/lib/format.ts:36-39`) is `Intl.NumberFormat("pl-PL", { style: "percent",
maximumFractionDigits: 1 })`. Nine rows at 11.11% render as nine × `11,1%` =
99,9%. Deliberate; a test must pin it rather than "fix" it.

**Degenerate case, reachable and unguarded**: if `total > 0` but every category
sits at or below `MIN_SHARE` (≈50+ categories), `aboveMinShare = 0`
(`distribution.ts:230-231`), so `visibleCount = 0`, `visible` is empty and the
board renders a single `Pozostałe (n)` row at ~100%.

**Cross-board agreement is unasserted.** Board A's "Wydatki" tile
(`KpiTiles.tsx:56`, from T1) and Board B's donut centre
(`CategoryDonut.tsx:166`, from T2's `()` row) are two independent SQL
aggregates of the same population. They should agree; nothing cross-checks
them. `20260816150000_….sql:27-33` flags exactly this.

### 3. How range presets resolve to concrete dates

Seven presets, one table and one switch — `src/components/reports/range.ts:35-47`,
`:118-143`. Default `last-30-days` (`:47`).

**`resolveRange(preset, today, allTimeStart)` takes "today" as a required
parameter** (`range.ts:118`), and `allTimeStart` is required rather than
defaulted on purpose (`:115-117`): _"a default would let a future caller
silently reintroduce a hardcoded floor."_ **This makes the whole module
deterministic under Vitest with no clock faking.** Its complete import list
(`range.ts:27-28`) is `POLISH_MONTH_NAMES` from `@/components/entries/date-utils`
(a plain string array, zero imports of its own) and a type-only `@/types`.

**"All time" is a real date, resolved server-side per render**, not a sentinel:
`src/pages/reports.astro:30-31` computes
`allTimeStart = getFirstEntryDate() ?? user.created_at.slice(0,10) ?? todayUTC`,
passed as a prop at `:42`. `getFirstEntryDate` (`reports.ts:252-264`) is a
`min(occurred_on)` expressed as `.order(…).limit(1)` with **no** `user_id`
filter (RLS supplies it), no `deleted_at` filter, and **no recurring filter** —
deliberate, per `reports.ts:245-247`, so toggling FR-015 never moves the X-axis.

**C4 then clamps the left edge silently** (`range.ts:136-141`):

```ts
case "all-time": {
  const floor = addMonths(today, -ALL_TIME_MAX_MONTHS_BACK);
  return { from: allTimeStart > floor ? allTimeStart : floor, to: today };
}
```

396 months ≈ 33 years, sized so 397 month buckets stays under C3
(`range.ts:60-68`). The caption prints the _clamped_ `from`, so the label is
internally consistent — but the preset no longer means "all time", with no
signal. This is a truncation with no error, which is precisely the risk
statement's shape.

**Inclusive-vs-exclusive end bounds match.** TS adds `+1`
(`range.ts:112`, duplicated at `reports.ts:93-98`); SQL uses
`where e.occurred_on between p_from and p_to` (`…103000_….sql:54`,
`…150000_….sql:74`), inclusive both ends. No `< to` anywhere. **The displayed
range and the summed range agree.**

**One deliberate TS/SQL asymmetry**: `bucket_start` is
`date_trunc(p_bucket, …)::date`, which can land _before_ `range.from` for
week/month buckets. `enumerateBuckets` reproduces that on purpose
(`range.ts:164-182`), with `startOfWeek` Monday-first (`:103-109`) to match
`date_trunc('week', …)`.

**"Today" is always the browser's local date** —
`src/components/entries/date-utils.ts:1-11`, called at `OverviewBoard.tsx:88`
and `CategoriesBoard.tsx:96`. Everything is `YYYY-MM-DD` strings; `Date` objects
appear only transiently inside `Date.UTC(...)` arithmetic (`range.ts:75-97`), so
no DST or offset shift is possible in the arithmetic itself.

**Two real UTC-vs-local seams remain**, both at `reports.astro:30`:
`user.created_at.slice(0,10)` is a UTC calendar date compared against a
browser-local `today`, and the last-resort fallback is
`new Date().toISOString().slice(0,10)` (UTC on workerd). A zero-entry user who
signs up at 23:30 in a UTC-behind timezone gets `allTimeStart` one day ahead of
their local `today`; `resolveRange` then returns `from > to`, the request is
rejected at `summary.ts:46-51` with 400, and the board shows a generic
"could not load".

### 4. Where filter state lives, relative to the caption

**React `useState` in `ReportsView.tsx:60`, mirrored to URL search params** —
read on load at `:33-50`, written with `pushState` at `:90-100`, re-read on
`popstate` at `:80-88`. `RangePicker` and `RecurringToggle` are fully
controlled, no local state.

**The exclusion happens in SQL, never in TS.** `reports.ts:193` and `:368` map
`recurring === "hidden"` to `p_exclude_recurring`; the predicate is
`and (not p_exclude_recurring or not c.is_recurring)`
(`…103000_….sql:55`, `…add_category_icon.sql:136`). `src/types.ts:205-207`
records that `Entry.category` is deliberately _not_ widened with `isRecurring`
for exactly this reason.

**The caption** is `ReportsView.tsx:133-136`, driven by `view.recurringHidden`
— the same state passed to the board as a prop. `ReportsView.tsx:104-111`
records that it inherited the invariant a pinned control bar used to protect.

**Can caption and numbers disagree?**

- **Range half: no, by construction.** `range` is not derived in `ReportsView`;
  each board pushes it up via `onRangeResolved(range)` **synchronously before
  its `await`** (`OverviewBoard.tsx:88-98`, `CategoriesBoard.tsx:96-106`), from
  the exact object the request is built from. This closes S-05 finding F9
  (`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:203-212`),
  where a caption frozen at mount was off by a day from the money below it.
- **Stale fetch: no.** Both effects use a per-run `cancelled` flag
  (`CategoriesBoard.tsx:84,114-126`; `OverviewBoard.tsx:79,106-118`).
- **Recurring half: a one-paint window.** `view.recurringHidden` flips
  synchronously in `applyView` (`:91`), while `setSummary(null)` lives in a
  passive `useEffect` that React runs _after_ paint. So one frame shows the new
  caption above the previous figures. **This needs the component layer §3
  Phase 5 delivers; it is not reachable at this phase's layers.**
- **A narrower asymmetry**: `fromSearch` (`:40`) treats any non-`"hidden"` value
  as _shown_, so `/reports?recurring=yes` lands on shown in both caption and
  query — consistent, but silently.

### 5. What the existing test layers already prove — and explicitly do not

`supabase/tests/entries_summary_test.sql` (plan 23) and
`entries_category_summary_test.sql` (plan 26) already cover the SQL half
properly: cross-user isolation through `security invoker`, the `anon` execute
revoke, grouping-set arithmetic summing bucket → category → grand total,
expense-only filtering, `p_exclude_recurring` dropping exactly the recurring
rows, entries under soft-deleted categories still counted, and Monday-first
week alignment.

**Do not duplicate any of that.** Both files then name their own gaps:

> `entries_summary_test.sql:17-22` — NOT covered here: the zod
> query-parameter validation, the ≤400 bucket-count guard, the previous-period
> derivation, and the client-side local-date resolution of range presets. All
> four are manual-only …

> `entries_category_summary_test.sql:20-25` — … and adds the top-N selection
> rule, the duplicate-colour shift rule, the percentage arithmetic and its
> zero denominator guard …

**Neither file mentions the 1000-row truncation check.** C2 — the guard added
by impl-review specifically to prevent the failure this phase is named after —
is proven by no test at either layer.

### 6. Testability and the one harness change required

| Module                                                | Value imports                                                         | Layer                    | Blocked?              |
| ----------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ | --------------------- |
| `src/components/reports/distribution.ts`              | `CATEGORY_COLORS` from `@/types` (zero imports)                       | unit §6.1                | **no**                |
| `src/components/reports/range.ts`                     | `POLISH_MONTH_NAMES` from `date-utils` (zero imports)                 | unit §6.1                | **no**                |
| `src/lib/services/reports.ts`                         | `zod`, `DEFAULT_CATEGORY_ICON`; Supabase is `import type` only (`:3`) | service integration §6.2 | **no**                |
| `src/pages/api/entries/{summary,category-summary}.ts` | `@/lib/supabase` at value level                                       | route, `vi.mock`         | no — precedent exists |

None of these is on §6.1's unreachable list (`test-plan.md:213-220`). The route
pattern is already proven by `src/pages/api/receipts/entries.test.ts`.

**The harness gap**: `src/lib/services/__fixtures__/supabase-fake.ts:53-67`
exposes `from/select/in/is/eq/order/upsert/insert/update/delete/maybeSingle/single/then`
— **no `.rpc()` and no `.limit()`**. The entire reports service path is
`.rpc()` (`reports.ts:200`, `:206`, `:364`) plus one `.limit(1)` (`:257`).
Extending the fake with those two methods is the phase's only harness work.

Two ordering notes for whoever writes it. `getEntriesSummary` issues its two
RPCs inside `Promise.all` (`reports.ts:199-212`), evaluated in array order
(current, then previous), so the fake's call-order queue stays deterministic —
but the §6.2 cookbook already flags queue-ordering as the thing readers get
wrong, so the test should pin the order with an assertion rather than assume
it. And `rpc` is a terminal call awaited directly, not a chain link, so it
must both record and resolve.

## Code References

- `src/lib/services/reports.ts:32-46` — the `MAX_BUCKETS` / `POSTGREST_MAX_ROWS` doctrine comment; the two constants
- `src/lib/services/reports.ts:188-190`, `:358-360` — the pre-flight bucket guard, both callers
- `src/lib/services/reports.ts:375-383` — the exact truncation tripwire, category endpoint only
- `src/lib/services/reports.ts:145-183`, `:304-353` — grouping-set row discrimination and reshaping
- `src/lib/services/reports.ts:19,22-23` — the loose `DATE_PATTERN` regex, both reports endpoints
- `src/lib/services/reports.ts:252-264` — `getFirstEntryDate`, the `.limit(1)` min-date probe
- `src/components/reports/range.ts:118-143` — `resolveRange`, all seven presets
- `src/components/reports/range.ts:136-141` — the all-time silent clamp
- `src/components/reports/range.ts:148-157` — `bucketFor` granularity thresholds
- `src/components/reports/distribution.ts:220-307` — `resolveDistribution`: top-N, min-share, zero guard, de-collision walk
- `src/components/reports/distribution.ts:302` — `collapsedTotal`, the one JS float sum
- `src/components/reports/ReportsView.tsx:133-136` — the range + filter caption
- `src/pages/api/entries/summary.ts:56-63` — "A wrong number is worse than an error"
- `src/lib/services/__fixtures__/supabase-fake.ts:53-67` — `QueryFake`; the `.rpc()` gap
- `supabase/config.toml:18` — `max_rows = 1000`
- `supabase/tests/entries_summary_test.sql:17-22`, `entries_category_summary_test.sql:20-25` — the self-declared gaps

## Architecture Insights

- **The "correct or absent" doctrine is already written down in this codebase**,
  in the route comment at `summary.ts:56-63` and the constant comment at
  `reports.ts:32-44`. Phase 3 does not need to invent a policy; it needs to put
  teeth on one that exists and has never been asserted.
- **Exactness is a deliberate architectural property, defended in SQL.** The
  `()` grouping set exists solely to make the percentage denominator an exact
  `numeric` rather than a JS float sum (`20260816150000_….sql:45-48`); `types.ts:227`
  and `:273-276` restate it as a DTO contract. The three float-sum sites
  (`distribution.ts:302`, `CategoryTrendChart.tsx:73`, `CumulativeChart.tsx:50-66`)
  are the deliberate, bounded exceptions.
- **Two ceilings guard the same hazard at different layers, and only one is
  exact.** C3 bounds _buckets_ and is a heuristic; C2 counts _rows_ and is
  exact. The S-05 review's insight was that C3's arithmetic argument holds for
  a 2-rows-per-bucket response and collapses for an N-categories-wide one. Any
  future RPC on this path inherits that question.
- **PostgREST, not Postgres, is where the silence lives.** This is the
  structural reason pgTAP cannot close this risk and Vitest can.
- **A guard that errors correctly can still fail the user.** C2 raises
  `RangeTooLargeError` → 400 with a specific Polish message and a `field`
  hint, and then both boards discard the response body
  (`OverviewBoard.tsx:101-113`, `CategoriesBoard.tsx:109-121`) and render a
  generic "could not load" indistinguishable from a network failure. The
  figure is correctly absent; the reason is lost.

## Historical Context (from prior changes)

- `context/archive/2026-08-16-date-range-spending-view/plan.md:215,241` — C3
  introduced (S-04), correct for Board A's 2-rows-per-bucket shape.
- `context/archive/2026-08-16-category-distribution-view/plan.md:500` — the
  mis-prediction that let F1 through: _"In practice `bucketFor` caps a
  year-long range at ~12 month buckets, so the product stays small."_
- `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:54-78`
  — **F1**, the CRITICAL truncation finding, its two reachable trigger paths
  with row arithmetic, and the FIXED decision. Commit `5ee5465`.
- `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:151-159`
  — **F9**, direct-RPC bypass of C3, **SKIPPED, accepted**.
- `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:161-169`
  — **F10**, the inner join silently dropping entries under another user's
  category, **SKIPPED, accepted** while the service-layer check holds. This is
  risk #3's archive citation and belongs to §3 Phase 4, not here.
- `context/archive/2026-08-17-reports-axis-and-all-time-range/` — S-08, both
  halves found _after ship_; `plan.md:92`: _"No test framework exists in this
  repo, and neither half of this change is reachable by pgTAP … a permanent
  re-verification requirement."_ That statement is what this phase retires.
- `context/foundation/roadmap.md:233` — the pinned filter bar reversed to a
  caption in S-11, shipped straight to `master` with no change folder:
  _"Anything that pins a control bar again inherits that trade."_
- `context/foundation/charts_recommendations.md:63-64`, `charts_analysis.md:179`
  — the **external oracle** for `TOP_N = 8` / `MIN_SHARE = 0.02`: _"N ≈ 8, or
  'above 2% of total', whichever gives fewer slices."_ Written before the code,
  which is exactly what §6.1's oracle rule asks for.
- `context/foundation/prd.md:119-122` — **FR-014** carries an explicit
  readability criterion ("remains readable regardless of how many categories
  are defined"); **FR-015** stands as a toggle, challenged and upheld.

## Related Research

- `context/changes/testing-runner-bootstrap/research.md` — _Addendum: OQ6 spike
  result_, the empirical `getViteConfig` finding behind §6.1's limit.
- `context/archive/2026-08-21-testing-receipt-confirm-integrity/` — Phase 2,
  which established the §6.2 service-integration pattern and the
  `supabase-fake` this phase must extend.

## Open Questions

1. **Is the hosted `max_rows` actually 1000?** `supabase/config.toml:18`
   configures the **local** stack only. `POSTGREST_MAX_ROWS = 1000`
   (`reports.ts:45`) is a hardcoded mirror of an _assumed_ remote value, and the
   `deploy` job only does `link` + `db push` — it never touches API settings. If
   hosted differs, C2 is wrong in both directions: too low truncates before the
   check fires, too high rejects valid ranges. Worth one console check; it is
   the assumption the entire guard rests on.
2. **Should the unasserted arithmetic argument behind `getEntriesSummary` be
   pinned?** "≤2 rows per bucket × 400 buckets = 802 < 1000" is the only thing
   standing between Board A and silent truncation, and it lives in a comment. A
   cheap test could pin the grouping-set width; whether that is worth a row is a
   cost × signal call for the plan.
3. **How should C4's silent clamp be classified?** A user with entries older
   than 33 years silently loses the left edge of "Cały okres" with no signal —
   a truncation without an error, which is the exact shape §2 risk #2 forbids.
   Is this an accepted residual to pin as characterisation, or a defect this
   phase surfaces and hands onward? It is a behaviour question, not a test
   question, so the plan should decide it explicitly rather than let the test
   encode an answer.
4. **Does the loose date regex belong in this phase's scope?**
   `DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/` (`reports.ts:19`) governs both
   reports endpoints and accepts `2026-02-30`. Downstream, `bucketCountUpperBound`
   silently normalises it (`Date.UTC(2026, 1, 30)` → 2026-03-02), so **the
   ceiling guard is computed over a different window than the one sent to
   Postgres**, which then rejects the cast and returns a 500 with a non-JSON
   body. `test-plan.md:369-376` already records this class from Phase 2 and
   notes these two copies survived unfixed. It is squarely "a range resolving
   to the wrong window" — but fixing it is a code change, not a test, and this
   is a testing phase.
5. **Is the discarded 400 body in scope?** Both boards throw away the specific
   "Wybrany zakres jest zbyt duży" message. Asserting the route returns it is
   cheap and in scope; making the board _show_ it is a UI change and probably
   is not.
6. **Cross-board total agreement** — Board A's Wydatki tile and Board B's donut
   centre are independent aggregates of the same population with no cross-check.
   A single service-level test that runs both against one fixture and asserts
   equality would be high signal, but it needs the fake to serve two different
   RPC shapes in one test. Feasible; worth deciding deliberately.
