# Reports Aggregation Truth Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` §3, covering §2 risk #2: _a
KPI or chart reads plausibly but is wrong_. The reports path already carries
three deliberate "correct or absent" mechanisms. **None of them is asserted
anywhere, at any layer.** This plan puts automated teeth on all three at the
cheapest layer that reaches them, extends the shared Supabase fake with the two
methods the reports path needs, and closes the one date-validation hole that
lets the ceiling guard be computed over a different window than the one actually
queried.

## Current State Analysis

The three guards, all added reactively rather than by plan:

| Guard                                                        | Anchor                                                                 | Origin                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------- |
| `MAX_BUCKETS = 400`, pre-flight, throws `RangeTooLargeError` | `src/lib/services/reports.ts:46`, checked at `:188-190` and `:358-360` | S-04, planned                             |
| `POSTGREST_MAX_ROWS = 1000`, post-flight exact length check  | `src/lib/services/reports.ts:45`, checked at `:381-383`                | S-05 **impl-review F1**, commit `5ee5465` |
| `ALL_TIME_MAX_MONTHS_BACK = 396`, silent left-edge clamp     | `src/components/reports/range.ts:69`, applied at `:136-141`            | S-08, found after ship                    |

Both pgTAP suites on this path explicitly disclaim the application-layer rules
as out of reach and name them a permanent manual-verification requirement
(`supabase/tests/entries_summary_test.sql:17-22`,
`entries_category_summary_test.sql:20-25`). That disclaimer predates the JS
runner. `lessons.md:11` records that "therefore manual forever" no longer
follows. **This phase is what discharges that debt.**

Critically: **the truncation this phase exists to prevent is a PostgREST
behaviour, not a Postgres one.** pgTAP talks to Postgres directly and never
crosses `max_rows`, so pgTAP _structurally cannot_ reproduce the failure at any
fixture size. The guard is a plain `array.length` comparison in TypeScript, so a
Vitest fixture of ≥1000 synthetic rows reaches it exactly, in milliseconds.

Everything this phase targets is reachable at the cheapest layer.
`src/components/reports/distribution.ts` and `src/components/reports/range.ts`
are pure — no React, no `astro:*`, no network. `src/lib/services/reports.ts`
only `import type`s the Supabase client (`reports.ts:3`), so §6.2 applies
unchanged. The routes need `vi.mock` on `@/lib/supabase`, a pattern
`src/pages/api/receipts/entries.test.ts` already proves.

**One harness gap.** `src/lib/services/__fixtures__/supabase-fake.ts:53-67`
exposes `from/select/in/is/eq/order/upsert/insert/update/delete/maybeSingle/single/then`
— no `.rpc()` and no `.limit()`. The entire reports service path is `.rpc()`
(`reports.ts:200`, `:206`, `:364`) plus one `.limit(1)` (`:257`).

## Desired End State

`npm run test` covers the three guards and the arithmetic they protect. A
regression in any of them — a widened grouping set, a loosened ceiling, a
re-bucketed preset, a percentage divided by a JS sum instead of the SQL `()`
row, a route that stops mapping `RangeTooLargeError` to a 400 — turns a named
test red rather than shipping a plausible wrong number.

Verified by: the full suite green; each new assertion confirmed **seen red**
against a deliberate break, then reverted; `npm run typecheck` and `npm run lint`
clean; and `test-plan.md` §3 row 3 reading `complete` with §6.1/§6.2/§6.6
updated.

### Key Discoveries

- `resolveRange(preset, today, allTimeStart)` takes `today` as a **required
  parameter** (`range.ts:118`), and `allTimeStart` is required rather than
  defaulted on purpose (`:115-117`). The whole module is therefore deterministic
  under Vitest with **no clock faking and no mocking**.
- The truncation check is `>=`, not `>` (`reports.ts:381`) — an exactly-1000-row
  result is rejected as truncated. A deliberate conservative false positive; a
  test must pin the boundary at exactly 1000, not at 1001.
- `getEntriesSummary` has **no** truncation check. It relies on an arithmetic
  argument in a comment (`reports.ts:32-44`): `entries_summary` returns ≤2 rows
  per bucket, so 400 buckets ≈ 802 rows. That argument is load-bearing, asserted
  nowhere, and holds only while the RPC's grouping sets stay `((bucket, type), (type))`
  (`20260816103000_add_entries_summary_function.sql:56-59`).
- **The service assigns totals, never accumulates.** `reports.ts:154-160` takes
  `totals.income`/`totals.expense` from the null-bucket rows; `reports.ts:314-317`
  takes `total` from the both-null row. Two `Number()` parse points, on a field
  typed `number | string` because PostgREST may serialise `numeric` either way.
- **`Pozostałe` is the one place the parts are not guaranteed to sum to the
  whole by construction.** `distribution.ts:302` sums the tail with a JS
  `reduce` float; consumers divide that float by the exact SQL `total`.
- **Percentages are never re-normalised to 100.** `formatShare`
  (`src/lib/format.ts:36-39`) uses `maximumFractionDigits: 1`, so nine rows at
  11.11% render as nine × `11,1%` = 99,9%. Deliberate — pin it, do not "fix" it.
- `context/foundation/charts_recommendations.md:63-64` and
  `charts_analysis.md:179` are a **genuine pre-code external oracle** for
  `TOP_N = 8` / `MIN_SHARE = 0.02`: _"N ≈ 8, or 'above 2% of total', whichever
  gives fewer slices."_ Written before the implementation, which is exactly what
  §6.1's oracle rule asks for.
- `enumerateBuckets` deliberately reproduces `date_trunc`'s behaviour of placing
  the first bucket start **before** `range.from` for week and month buckets
  (`range.ts:164-182`), with Monday-first `startOfWeek` (`:103-109`).
- `S-04` finding **F9** — an authenticated user POSTing directly to
  `/rest/v1/rpc/entries_summary` bypasses the bucket guard entirely — was
  **SKIPPED and accepted** (`context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:151-159`).
  The guard protects UI correctness, not the database. **No test may assert
  otherwise.**
- The route test pattern composes the recording fake with a small `auth.getUser`
  surface (`src/pages/api/receipts/entries.test.ts:90`) — the reports routes call
  `supabase.auth.getUser()` before validating, so they need the same.

## What We're NOT Doing

- **Not testing the colour derivation in `distribution.ts`** — slot derivation,
  HSL tier shifts, the greedy de-collision walk, and its documented
  membership-dependent residual (`distribution.ts:268-284`). A wrong colour is a
  cosmetic defect; a wrong number is risk #2. Cost × signal argues against it,
  and the walk's residual is already measured and written down.
- **Not adding a truncation check to `getEntriesSummary`.** Its premise
  (802 < 1000) is provably true today, so a mirrored guard could only ever fire
  after a migration already broke the premise. The premise itself is pinned in
  Phase 3 instead.
- **Not making the all-time clamp visible to the user.** It is characterised as
  an accepted residual (see Phase 1), not surfaced as a defect. Signalling it is
  a UI change needing the component layer §3 Phase 5 delivers.
- **Not making the boards show the specific 400 message.** Both boards discard
  the response body and render a generic "could not load"
  (`OverviewBoard.tsx:101-113`, `CategoriesBoard.tsx:109-121`). The figure is
  correctly absent; the reason is lost. That is a UI change, out of reach at
  this phase's layers.
- **Not testing the one-paint caption window.** `view.recurringHidden` flips
  synchronously in `applyView` while `setSummary(null)` runs in a passive
  effect after paint, so one frame shows the new caption above the old figures.
  Reachable only at the component layer — §3 Phase 5.
- **Not asserting the direct-RPC bypass (F9).** Accepted by decision.
- **Not duplicating what pgTAP already proves**: cross-user isolation via
  `security invoker`, the `anon` execute revoke, grouping-set arithmetic summing
  bucket → category → grand total, expense-only filtering,
  `p_exclude_recurring`'s row selection, entries under soft-deleted categories
  still counting, Monday-first week alignment in SQL.
- **Not delivering §6.4.** The route tests here borrow the proven pattern;
  §6.4's ownership pattern (request as A for B's resource, assert refusal, assert
  cache headers) remains §3 Phase 4's deliverable.
- **Not touching the two remaining copies of the shape regex** in
  `services/receipts.ts` and `api/entries/index.ts`. Neither is on this phase's
  path.

## Implementation Approach

Five phases, ordered so nothing waits on work it does not need:

Pure units first (Phases 1–2) — they need no harness change and no mocking, and
they cover the two modules where risk #2's arithmetic actually lives. Then the
harness extension plus the service tests it unblocks (Phase 3), which is where
the truncation tripwire — the defect this phase is named after — finally gets an
assertion. Then the route layer (Phase 4), which needs both the extended fake
and the validation fix. Documentation last (Phase 5). This mirrors the shape
rollout Phase 2 used.

Every expectation is hand-written from an external oracle, never derived by
calling the code under test (§6.1). Every new assertion must be **seen red**
against a deliberate break before the phase is called done.

## Critical Implementation Details

**`rpc` is a terminal call, not a chain link.** `supabase.rpc(...)` is awaited
directly (`reports.ts:200`, `:364`), unlike the builder chain where `then`
resolves the queued response. The fake's `rpc` must therefore both **record and
resolve** — return an awaitable that consumes the queue — while every existing
builder method returns the chainable client. `limit` is an ordinary chain link
and follows the existing pattern.

**Queue order in `getEntriesSummary` is `Promise.all`, not sequential.**
`reports.ts:199-212` issues two RPCs inside `Promise.all`, evaluated in array
order (current, then previous). The queue stays deterministic — but §6.2 already
flags queue-ordering as the thing readers get wrong, so the test must **pin the
order with an assertion** on the recorded `rpc` arguments rather than assume it.

**The Polish messages in `summaryQuerySchema` are user-facing copy.** Both
routes forward `issue.message` as the response `error` and `issue.path[0]` as
`field` (`summary.ts:40-41`, `category-summary.ts:44-45`). The Phase 4 swap to
`z.iso.date()` must preserve both the invalid-type and invalid-format messages
per field, or the change is a silent copy regression rather than a validation
fix.

## Phase 1: Range Resolution Units

### Overview

`src/components/reports/range.ts` is pure, deterministic, and owns two of the
four contexts risk #2 names: how range presets resolve to concrete dates, and
the silent left-edge clamp. No harness change, no mocking, no clock faking.

### Changes Required

#### 1. Range unit suite

**File**: `src/components/reports/range.test.ts` (new)

**Intent**: Pin preset → concrete-date resolution, the bucket-granularity
thresholds, and the bucket enumeration that must line up with Postgres'
`date_trunc`, so a change to any of them fails loudly instead of silently
re-bucketing or inventing empty buckets.

**Contract**: Exercises the module's exported surface — `resolveRange`,
`bucketFor`, `enumerateBuckets`, `inclusiveDayCount`, `addDays`,
`formatBucketLabel`, `isRangePreset`, `DEFAULT_RANGE_PRESET`. Cases to cover:

- **All seven presets** against a fixed `today`, with expectations written from
  the calendar rather than computed. Include the month-end cases the arithmetic
  exists for: `last-month` from a 31-day month landing on a 28-day one, and
  `last-3-months`' deliberate `+1` (`range.ts:129-133`) which keeps the span at
  90–92 days so it cannot tip over `bucketFor`'s 92-day boundary.
- **`bucketFor` at its exact thresholds** — 30 days → `day`, 31 → `week`, 92 →
  `week`, 93 → `month` (`range.ts:148-157`). These are the boundaries, and the
  oracle is the source's own documented rule, not a re-derivation.
- **`enumerateBuckets` produces a leading bucket that predates `range.from`**
  for week and month, matching `date_trunc`. Oracle:
  `20260816103000_add_entries_summary_function.sql`'s `date_trunc(p_bucket, …)::date`
  and Postgres' documented Monday-first `date_trunc('week', …)`. Assert a
  mid-week `from` yields a Monday first bucket.
- **Inclusive end bounds.** `inclusiveDayCount` counts both ends; SQL uses
  `between p_from and p_to`. A 7-day preset must span exactly 7 days.

**Oracle note required in the file header**: the calendar itself, Postgres'
documented `date_trunc` semantics, and `range.ts`'s own stated rules read as a
spec — never a value obtained by calling `resolveRange`.

#### 2. The all-time clamp, as characterisation

**File**: `src/components/reports/range.test.ts`

**Intent**: Pin `ALL_TIME_MAX_MONTHS_BACK`'s silent left-edge clamp
(`range.ts:136-141`) as an **accepted residual**, so the behaviour cannot drift
unnoticed and the next reader cannot mistake the pin for an endorsement.

**Contract**: Two cases — an `allTimeStart` inside the floor is returned
unchanged; one older than 396 months back is silently replaced by the floor,
with `to` unchanged. The comment must state plainly that this encodes an
accepted trade, name the decision record (`range.ts:60-68`, sized so 397 month
buckets stays under `MAX_BUCKETS`), and record the acknowledged cost: a user
with entries older than ~33 years loses the left edge of "Cały okres" with no
signal. Follows §6.2's characterisation-comment convention.

### Success Criteria

#### Automated Verification

- Suite passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- Each preset expectation traced by hand against a calendar, not against a
  second run of `resolveRange`
- Teeth check: break `last-3-months` by removing the `+1`, confirm the
  92-day-boundary case fails legibly, revert
- Teeth check: break `startOfWeek` to Sunday-first, confirm the
  `enumerateBuckets` alignment case fails, revert

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding.

---

## Phase 2: Distribution Model Units

### Overview

`src/components/reports/distribution.ts` decides which categories Board B
renders individually and what share each one reports. It owns the third context
risk #2 names — where the total is computed relative to per-category rows — at
the client end. Selection and share arithmetic only; the colour derivation is
explicitly out of scope.

### Changes Required

#### 1. Distribution unit suite

**File**: `src/components/reports/distribution.test.ts` (new)

**Intent**: Pin the selection rule, the share denominator, and the collapsed
tail, so a percentage can never come to mean something other than "of the SQL
range total".

**Contract**: Exercises `resolveDistribution` and `formatCollapsedLabel` over
hand-built `CategorySummary` fixtures (`src/types.ts:262-277`). Cases:

- **Whichever rule yields fewer slices wins** (`distribution.ts:230-232`):
  ten categories all above 2% → 8 visible, 2 collapsed; three categories → 3
  visible, none collapsed (top-N never pads); twelve categories where only five
  clear 2% → 5 visible. Oracle: `charts_recommendations.md:63-64`, written
  before the code.
- **`share` is of the SQL `total`, not of the visible subset**
  (`distribution.ts:228,292`). Assert a visible slice's `share` against a
  hand-computed quotient using the fixture's `total`, with a fixture whose
  visible slices deliberately do **not** sum to `total`.
- **Zero-total guard** (`distribution.ts:228-231`): with `total = 0`, every
  `share` is `0` — never `NaN` — and selection degrades to top-N alone because
  the share floor cannot apply. `NaN` renders as a blank slice rather than an
  error, which is why the guard is explicit rather than trusted.
- **`collapsedTotal` is the tail's sum** (`distribution.ts:302`), computed once
  here rather than three times in three charts (review finding F10). Assert it
  equals the hand-added tail amounts, and note in the comment that this is the
  **one place** where numerator and denominator come from different arithmetic —
  a JS float sum divided by an exact Postgres `numeric`.
- **The degenerate case** (`distribution.ts:230-231`): `total > 0` but every
  category at or below `MIN_SHARE` → `aboveMinShare = 0`, `visible` empty, the
  board renders a single `Pozostałe (n)` row at ~100%. Reachable and unguarded;
  characterise it.
- **Percentages are not re-normalised to 100.** Nine equal categories at 11.11%
  each format to `11,1%`, summing to 99,9%. Oracle: `Intl.NumberFormat`'s
  documented `maximumFractionDigits` behaviour and `src/lib/format.ts:36-39`.
  Pin it; a future reader must not "fix" it.
- **`formatCollapsedLabel`** emits `Pozostałe (n)` with the collapsed count.

**Oracle note required in the file header**: `charts_recommendations.md:63-64`
and `charts_analysis.md:179` for the selection rule, `src/types.ts:273-276` for
the DTO contract that `total` is the `()` grouping-set row, and arithmetic done
by hand. State explicitly that the colour derivation is out of scope and why.

### Success Criteria

#### Automated Verification

- Suite passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- Every expected share hand-computed from the fixture's `total`, never from a
  call to `resolveDistribution`
- Teeth check: change `MIN_SHARE` to `0.2`, confirm exactly the selection cases
  go red and the share cases stay green, revert
- Teeth check: change `shareOf`'s zero guard to a bare division, confirm the
  zero-total case fails on `NaN`, revert

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Harness Extension and Aggregation Truth

### Overview

The phase's centre of gravity. Extends the shared Supabase fake with the two
methods the reports path needs, then asserts the truncation tripwire, the bucket
ceiling, the total-assignment discipline, and — for the first time anywhere —
that Board A and Board B agree about the same population.

### Changes Required

#### 1. Extend the recording fake

**File**: `src/lib/services/__fixtures__/supabase-fake.ts`

**Intent**: Add `rpc` and `limit` so the reports service path is reachable at
all. This is the phase's only harness work, and rollout Phases 4–5 inherit it.

**Contract**: `QueryFake` gains two members. `limit` is an ordinary chain link —
`(...args) => record("limit", args)`, same as `order`. `rpc` is **not**: it is a
terminal call awaited directly rather than a chain link, so it must record the
call _and_ resolve the next queued response.

```ts
// `rpc` is terminal — reports.ts awaits it directly rather than continuing a
// chain — so unlike every method above it must both record AND resolve. The
// call is recorded before the queue is consumed, so a queue-exhaustion error
// still names the rpc that hit it.
rpc: (...args: unknown[]) => {
  record("rpc", args);
  return Promise.resolve(nextResponse());
},
```

Extend the file's header comment: the queue is still consumed in **await**
order, and `rpc` consumes one entry per call. Note that `Promise.all` over two
`rpc` calls consumes in array order.

#### 2. The truncation tripwire

**File**: `src/lib/services/reports.test.ts` (new)

**Intent**: Assert the guard that S-05 impl-review finding F1 added — the one
this whole rollout phase is named after — and that pgTAP structurally cannot
reach.

**Contract**: `getCategorySummary` against a synthetic response of exactly
`POSTGREST_MAX_ROWS` rows must reject with `RangeTooLargeError`; at 999 rows it
must succeed. The check is `>=` (`reports.ts:381`), so **1000 is the rejecting
case, not 1001** — a deliberate conservative false positive that the test must
encode as such.

Build the oversized fixture programmatically (a generator producing N distinct
`(bucket_start, category_id)` rows) rather than by hand — this is the "fixture
sized **past** the ceiling" `test-plan.md:65` asks for, and the anti-pattern it
names is a fixture too small to reach the boundary that actually broke.

The comment must record **why this cannot be a pgTAP test**: `max_rows` is a
PostgREST behaviour, pgTAP talks to Postgres directly, and no fixture size
changes that. It must also record the accepted cost from
`impl-review.md:70` — a legitimate view ("Cały okres" on a mature account with
many categories) becomes an error rather than a chart — and the archived
row arithmetic that makes it reachable: 30-day range × 33 categories = 1024
rows; the demo seed's 32 categories over 30 days = 993, **one category short of
tripping the guard**.

#### 3. The bucket ceiling, both callers

**File**: `src/lib/services/reports.test.ts`

**Intent**: Pin `MAX_BUCKETS` as pre-flight — it refuses **before** issuing the
request, which is the difference between an error and a truncated answer.

**Contract**: `getEntriesSummary` and `getCategorySummary` each reject with
`RangeTooLargeError` for a `bucket: "day"` range spanning 401 days, and succeed
at 400. Assert **no `rpc` call was recorded** on the rejecting path — pre-flight
is the property, not merely the throw. Oracle: `reports.ts:46` and the
`bucketCountUpperBound` rules at `:112-123`.

#### 4. Total assignment, never accumulation

**File**: `src/lib/services/reports.test.ts`

**Intent**: Pin that both services take their totals from grouping-set rows
rather than summing the buckets, and that the `number | string` serialisation
both PostgREST forms are handled.

**Contract**:

- `toRangeSummary` via `getEntriesSummary`: a fixture whose null-bucket rows
  carry totals that deliberately **differ** from the sum of its bucketed rows.
  The returned `totals.expense`/`totals.income` must equal the null-bucket
  values, proving assignment (`reports.ts:154-160`) rather than accumulation.
- `toCategorySummary` via `getCategorySummary`: the both-null `()` row is the
  `total` (`reports.ts:314-317`), again with bucketed rows that do not sum to it.
- **Both `numeric` serialisations**: one fixture using `"123.45"` strings and one
  using `123.45` numbers must produce identical results. Oracle:
  `reports.ts:127-129`, which states PostgREST is entitled to either.
- **Row-order independence**: grouping-set order is unspecified
  (`reports.ts:176-178`, `:345-348`), so a fixture with rows shuffled must
  produce the same output, with `points` sorted ascending by `bucketStart` and
  `categories` sorted descending by total with a `localeCompare` name tie-break.
- **`category_id === null` with a non-null bucket is skipped**
  (`reports.ts:322-324`) rather than crashing.

#### 5. Board A's row-width premise

**File**: `src/lib/services/reports.test.ts`

**Intent**: Put teeth on the arithmetic argument that is the only thing standing
between Board A and silent truncation — "≤2 rows per bucket, so 400 buckets ≈
802 rows" — which today lives solely in a comment.

**Contract**: A `getEntriesSummary` fixture at the maximum documented width (one
`expense` and one `income` row per bucket, plus the two `(type)` grand-total
rows) reshapes without loss: every bucket appears once in `points` with both
values populated. The comment names the oracle —
`20260816103000_add_entries_summary_function.sql:56-59`'s
`grouping sets ((bucket, type), (type))` — and states the coupling plainly:
**this pins the shape the service reshapes, not the shape Postgres returns**, so
a migration that widens the grouping sets must update this fixture, and the
premise at `reports.ts:32-44` must be re-checked with it. That coupling note is
the load-bearing part; without it the test reads as broader than it is.

#### 6. `getFirstEntryDate`

**File**: `src/lib/services/reports.test.ts`

**Intent**: Pin the min-date probe "Cały okres" resolves against, including its
three deliberate omissions.

**Contract**: Assert the recorded chain is exactly
`from("entries")` → `select("occurred_on")` → `order("occurred_on", { ascending: true })`
→ `limit(1)`. The absences are the point (`reports.ts:235-247`): **no**
`user_id` filter (RLS supplies it), **no** `deleted_at` filter on the joined
category, **no** recurring filter — so toggling FR-015 never moves the X-axis.
Also assert `null` on an empty result and the date on a populated one.

#### 7. Cross-board total agreement

**File**: `src/lib/services/reports.test.ts`

**Intent**: The one check that catches both boards being individually correct
and jointly wrong. Board A's "Wydatki" tile (`KpiTiles.tsx:56`, from
`entries_summary`) and Board B's donut centre (`CategoryDonut.tsx:166`, from
`entries_category_summary`'s `()` row) are two independent SQL aggregates of the
same population. Nothing cross-checks them; the migration comment
(`20260816150000_….sql:27-33`) flags exactly this.

**Contract**: One hand-built population of expenses across categories and
buckets, projected **by hand** into the two RPC response shapes — Board A's
`((bucket, type), (type))` rows and Board B's `((bucket, cat), (cat), ())` rows.
Run `getEntriesSummary` and `getCategorySummary` against those fixtures and
assert `current.totals.expense === categorySummary.total`, and that the
per-category totals sum to the same figure.

The fixture must be derived from the stated population, **not** from either
service's output — that is the oracle rule, and it is what makes this test
capable of failing. State in the comment that this asserts the two **reshaping
paths** agree given consistent inputs; it does not prove the two SQL functions'
predicates agree, which is the pgTAP suites' half.

#### 8. Error propagation

**File**: `src/lib/services/reports.test.ts`

**Intent**: A PostgREST failure must reach the caller unchanged, not degrade
into an empty aggregate that renders as zeros.

**Contract**: An `error` on the current RPC, on the previous RPC, and on the
category RPC each rethrows the original object (`reports.ts:214-219`, `:371-373`).
Mirrors `entries.test.ts:395-441`.

### Success Criteria

#### Automated Verification

- Suite passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint` — note §6.2's caveat: test files get no lint
  exemption, so `strictTypeChecked` applies and canned responses stay
  `{ data: unknown; error: unknown }`
- The oversized fixture case runs in the suite's existing time envelope (the
  whole suite was ~460 ms after Phase 2; a 1000-row array should not change that
  materially)

#### Manual Verification

- Hosted `max_rows` **verified in the Supabase console** for the linked project,
  and the observed value recorded here and at `reports.ts:45`. This is the
  assumption the entire C2 guard rests on: `supabase/config.toml:18` configures
  the **local** stack only, and the `deploy` job does `link` + `db push` without
  ever touching API settings. If hosted differs, the guard is wrong in both
  directions — too low truncates before the check fires, too high rejects valid
  ranges.
- Teeth check: change the tripwire to `>` , confirm the exactly-1000 case fails,
  revert
- Teeth check: change `toCategorySummary` to accumulate `total` from the
  per-category rows instead of reading the `()` row, confirm the assignment case
  and the cross-board case both fail, revert
- Teeth check: move the `MAX_BUCKETS` check after the `rpc` call, confirm the
  "no rpc recorded" assertion fails, revert
- Cross-board fixture traced by hand: the stated population, both projections,
  and the expected total, all written before running anything

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Route Boundary and the Date-Validation Fix

### Overview

The service throwing is only half the story if the route swallows it. This phase
asserts the 400 mapping on both reports endpoints, and closes the validation
hole that lets the ceiling guard be computed over a different window than the
one sent to Postgres.

### Changes Required

#### 1. Replace the shape regex with real calendar validation

**File**: `src/lib/services/reports.ts`

**Intent**: `DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/` (`reports.ts:19`) accepts
`2026-02-30`. Downstream, `bucketCountUpperBound` silently normalises it via
`Date.UTC(2026, 1, 30)` → 2026-03-02, so **the ceiling guard is computed over a
different window than the one sent to Postgres**, which then rejects the cast
and returns a 500 with a non-JSON body. That is "a range resolving to the wrong
window" — risk #2's own words. Phase 2 of the rollout fixed the same class in
`services/entries.ts` and verified `z.iso.date()` against the installed zod
`4.4.3`; this finishes the job on the path this phase owns.

**Contract**: `summaryQuerySchema` (`reports.ts:21-28`) — both `from` and `to`
move from `z.string(msg).regex(DATE_PATTERN, …)` to zod's ISO date type, and
`DATE_PATTERN` is deleted if nothing else in the module uses it. **The Polish
messages must be preserved per field** — `"Nieprawidłowa data początkowa"` and
`"Nieprawidłowa data końcowa"` — for both the wrong-type and the invalid-format
cases, because both routes forward `issue.message` verbatim as user-facing copy
and `issue.path[0]` as `field`. Neither `bucket` nor `recurring` changes.

Leave the two remaining copies (`services/receipts.ts`, `api/entries/index.ts`)
alone and record in the §6.6 notes that they survive.

#### 2. Schema unit cases

**File**: `src/lib/services/reports.test.ts`

**Intent**: Prove the swap tightened semantics without loosening shape.

**Contract**: Mirrors `entries.test.ts:456-522`. Impossible-but-well-shaped dates
(`2026-02-30`, `2026-13-45`, `2026-04-31`, `2026-02-29`) rejected on both `from`
and `to`, with `issues[0].path` naming the right field; malformed inputs
(`""`, `14.08.2026`, `2026-8-14`, `2026-08-14T00:00:00Z`) still rejected;
`2024-02-29` and an ordinary date accepted. Assert the **exact Polish message**
for each field. Oracle: the calendar — 2026 is not a leap year, April has 30
days — consulted from nothing in this repository.

#### 3. Route boundary suites

**Files**: `src/pages/api/entries/summary.test.ts` (new),
`src/pages/api/entries/category-summary.test.ts` (new)

**Intent**: Pin what the caller is **told** when a figure is correctly absent.
The `instanceof RangeTooLargeError` mapping is exactly the wiring a refactor
breaks silently, and a thrown error that becomes a 500 with a non-JSON body is
indistinguishable to the user from the truncation this phase prevents.

**Contract**: `vi.mock("@/lib/supabase")` with the module-scope mutable holder
and `await import()` afterwards, per §6.1's third option and the working shape
at `src/pages/api/receipts/entries.test.ts:38-49`. Compose the extended
recording fake with an `auth.getUser` surface, as that file does at `:90`. Per
route:

- Guard trips → **400** with body `{ error: "Wybrany zakres jest zbyt duży", field: "to" }`.
  Both routes hand-write this string (`summary.ts:61`, `category-summary.ts:65`);
  it is user-facing copy and the oracle is the route read as a contract.
- `from > to` → **400** with `{ error: "Data początkowa nie może być późniejsza niż końcowa", field: "from" }`
  (`summary.ts:46-51`, `category-summary.ts:49-54`).
- Invalid `from`/`to`/`bucket` → **400** carrying the schema's message and field.
- No user → **401**. This is not auth _mechanics_ (§7 excludes those) — it is
  what auth **gates**, and it must be asserted before validation, since a
  malformed query string must not be distinguishable from a missing session.
- Happy path → **200** with the summary body.

Drive both routes against the **real** service and the recording fake rather
than a mocked service, so the mapping proves actual wiring — the same reason
`receipts/entries.test.ts:31-34` gives.

### Success Criteria

#### Automated Verification

- Suite passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full build passes: `npm run build` — the schema change touches a module both
  routes import

#### Manual Verification

- `/reports` exercised in the browser across several presets with the recurring
  toggle both ways; figures and caption unchanged from before the schema swap
- A hand-crafted `?from=2026-02-30` request now returns a **400 with a JSON
  body** naming `from`, where it previously produced a 500 with a non-JSON body
- Teeth check: revert the `instanceof RangeTooLargeError` branch in one route,
  confirm that route's 400 case fails and the other stays green, restore
- Teeth check: drop one Polish message from the schema, confirm the exact-message
  assertion fails, restore

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Cookbook and Plan Sync

### Overview

Fold what this phase learned back into the living documents, so the next reader
does not re-derive it. `test-plan.md` §6 is the canonical answer to "how do I
add a test for X in this project?" and is what `/10x-tdd` reads.

### Changes Required

#### 1. Cookbook §6.2 — the extended fake

**File**: `context/foundation/test-plan.md`

**Intent**: §6.2's fake description enumerates its builder methods and states the
queue rule. Both need updating, and `rpc`'s terminal nature is exactly the kind
of thing a reader gets wrong.

**Contract**: The method list in §6.2 gains `rpc` and `limit`. Add that `rpc` is
**terminal** — it records _and_ resolves, rather than returning the chainable
object — and that a `Promise.all` over two `rpc` calls consumes the queue in
array order. Keep the existing "queued in call order, NOT keyed by table"
emphasis; it is still the headline.

#### 2. Cookbook §6.1 — reachability, third data point

**File**: `context/foundation/test-plan.md`

**Intent**: §6.1's limit was already corrected once by Phase 2. This phase adds
two pure modules under `src/components/` that are unit-testable with no mocking
at all, which the current text does not anticipate.

**Contract**: Note that co-located pure modules under `src/components/` —
`range.ts`, `distribution.ts` — are plain unit targets: the co-location
convention is about feature ownership, not about React. `range.ts` in particular
takes `today` as a required parameter, so it needs no clock faking; a module that
resolves "now" internally would not be reachable this cheaply.

#### 3. §6.6 — Phase 3 notes

**File**: `context/foundation/test-plan.md`

**Intent**: The two-or-three-line record of what this phase taught.

**Contract**: A `**Phase 3 — Reports aggregation truth**` block covering:

- **PostgREST, not Postgres, is where the silence lives.** `max_rows` truncates
  at the API layer; pgTAP talks to Postgres directly and cannot reach it at any
  fixture size. That is the structural reason both pgTAP suites' "manual forever"
  disclaimers were wrong, and why a 1000-row Vitest fixture closes it in
  milliseconds.
- **A guard that errors correctly can still fail the user.** C2 raises a 400
  with a specific Polish message and a `field` hint, and both boards then discard
  the body and render a generic "could not load". The figure is correctly
  absent; the reason is lost. Left as-is — it needs the §3 Phase 5 component
  layer.
- **The shape-regex class has two survivors.** `services/receipts.ts` and
  `api/entries/index.ts` still carry `/^\d{4}-\d{2}-\d{2}$/`. Phase 2 fixed two
  copies, Phase 3 fixed two more; name the remaining two so the next phase on
  either path knows.
- **Hosted `max_rows`, as observed.** Record the value read from the console and
  the date, the way §4 rows carry `checked:` dates.
- **Route tests borrowed, §6.4 not delivered.** The `vi.mock` pattern was reused
  from `receipts/entries.test.ts`; §6.4's ownership pattern is still §3 Phase 4's.

#### 4. §3 rollout table and §8 ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Advance the orchestrator's state.

**Contract**: §3 row 3 Status → `complete`. §8's strategy-review line updated to
note Phase 3 complete. §4's `API mocking` row's note extended to mention the
fake now covers RPC paths.

#### 5. Constant annotation

**File**: `src/lib/services/reports.ts`

**Intent**: Turn the hardcoded mirror into a dated observation.

**Contract**: The comment above `POSTGREST_MAX_ROWS` (`reports.ts:32-45`) records
what the hosted project's row limit was observed to be and on what date, and
that `supabase/config.toml:18` governs the local stack only while the `deploy`
job never touches hosted API settings.

#### 6. Change identity

**File**: `context/changes/testing-reports-aggregation-truth/change.md`

**Contract**: `status: complete`, `updated: <today>`.

### Success Criteria

#### Automated Verification

- Full suite passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full build passes: `npm run build`

#### Manual Verification

- §6.2 read end-to-end by someone who has not seen the fake: the `rpc`-is-terminal
  rule is understandable without opening the fixture
- §3 row 3 reads `complete` and `/10x-test-plan --status` advances to Phase 4

---

## Testing Strategy

### Unit Tests

- `range.ts` — seven presets against a fixed `today`; `bucketFor` at 30/31/92/93
  days; `enumerateBuckets` week/month leading-bucket alignment with `date_trunc`;
  inclusive end bounds; the all-time clamp as characterisation
- `distribution.ts` — top-N vs min-share (fewer wins); share denominator is the
  SQL total; zero-total guard yields 0 not `NaN`; `collapsedTotal`; the
  all-below-min-share degenerate case; percentages not re-normalised to 100
- `summaryQuerySchema` — impossible-but-well-shaped dates rejected per field with
  the right Polish message; malformed shapes still rejected; leap day accepted

### Integration Tests

- `getCategorySummary` at exactly 1000 rows (rejects) and 999 (succeeds)
- `MAX_BUCKETS` pre-flight on both callers, with no `rpc` recorded on refusal
- Totals assigned from grouping-set rows, both `numeric` serialisations,
  row-order independence
- Board A's ≤2-rows-per-bucket premise pinned against the migration's grouping
  sets
- `getFirstEntryDate`'s exact chain and its three deliberate omissions
- **Cross-board agreement**: one population, two hand-written projections, one
  asserted total
- Error propagation on all three RPC paths
- Both reports routes: 400 mappings with exact body and field, 401, 200

### Manual Testing Steps

1. Read the hosted project's API row-limit setting in the Supabase console;
   record the value and the date
2. Open `/reports`, cycle every preset on both boards with the recurring toggle
   in both positions; confirm figures and caption agree and nothing changed from
   before the schema swap
3. Request `/api/entries/summary?from=2026-02-30&to=2026-03-01&bucket=day`;
   confirm a 400 with a JSON body naming `from`
4. Run each named teeth check, confirm the expected test fails legibly, revert

## Performance Considerations

The oversized fixture is a 1000-element array built in-process; the guard it
reaches is an `array.length` comparison. Phase 2 left the whole suite at ~460 ms
and this should not move it materially. If it does, generate the fixture lazily
inside the case rather than at module scope.

## Migration Notes

No schema change. The only production change is `summaryQuerySchema`'s
validation, which is **strictly narrowing**: every input accepted after the
change was accepted before. Inputs it newly rejects (`2026-02-30` and friends)
previously produced a 500 with a non-JSON body, so no working client loses a
behaviour it relied on. No migration ordering concern and nothing for the
`deploy` job's schema-before-code window.

## References

- Research: `context/changes/testing-reports-aggregation-truth/research.md`
- Change identity: `context/changes/testing-reports-aggregation-truth/change.md`
- Rollout row: `context/foundation/test-plan.md` §3 Phase 3; risk response
  `test-plan.md:65`
- Service-integration pattern: `context/foundation/test-plan.md` §6.2
- Reference service test: `src/lib/services/entries.test.ts`
- Reference route test: `src/pages/api/receipts/entries.test.ts`
- Reference unit test: `src/lib/text.test.ts`
- The defect this phase is named after:
  `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:54-78` (F1)
- Accepted, must not be asserted otherwise:
  `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:151-159` (F9)
- Selection-rule oracle: `context/foundation/charts_recommendations.md:63-64`,
  `context/foundation/charts_analysis.md:179`
- Prior phase: `context/archive/2026-08-21-testing-receipt-confirm-integrity/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Range Resolution Units

#### Automated

- [x] 1.1 Suite passes: `npm run test` — 41fb01b
- [x] 1.2 Type checking passes: `npm run typecheck` — 41fb01b
- [x] 1.3 Linting passes: `npm run lint` — 41fb01b

#### Manual

- [x] 1.4 Each preset expectation traced by hand against a calendar — 41fb01b
- [x] 1.5 Teeth check: remove `last-3-months`' `+1`, confirm the 92-day-boundary case fails, revert — 41fb01b
- [x] 1.6 Teeth check: `startOfWeek` to Sunday-first, confirm the `enumerateBuckets` alignment case fails, revert — 41fb01b

### Phase 2: Distribution Model Units

#### Automated

- [x] 2.1 Suite passes: `npm run test` — 7b39e78
- [x] 2.2 Type checking passes: `npm run typecheck` — 7b39e78
- [x] 2.3 Linting passes: `npm run lint` — 7b39e78

#### Manual

- [x] 2.4 Every expected share hand-computed from the fixture's `total` — 7b39e78
- [x] 2.5 Teeth check: `MIN_SHARE` to `0.2`, confirm only the selection cases go red, revert — 7b39e78
- [x] 2.6 Teeth check: `shareOf`'s zero guard to a bare division, confirm the zero-total case fails on `NaN`, revert — 7b39e78

### Phase 3: Harness Extension and Aggregation Truth

#### Automated

- [x] 3.1 Suite passes: `npm run test` — 6578d90
- [x] 3.2 Type checking passes: `npm run typecheck` — 6578d90
- [x] 3.3 Linting passes: `npm run lint` — 6578d90
- [x] 3.4 The oversized fixture case runs in the suite's existing time envelope — 6578d90

#### Manual

- [x] 3.5 Hosted `max_rows` verified in the Supabase console; value and date recorded — 6578d90
- [x] 3.6 Teeth check: tripwire to `>`, confirm the exactly-1000 case fails, revert — 6578d90
- [x] 3.7 Teeth check: accumulate `total` instead of reading the `()` row, confirm assignment and cross-board cases fail, revert — 6578d90
- [x] 3.8 Teeth check: move the `MAX_BUCKETS` check after the `rpc` call, confirm the "no rpc recorded" assertion fails, revert — 6578d90
- [x] 3.9 Cross-board fixture traced by hand before running anything — 6578d90

### Phase 4: Route Boundary and the Date-Validation Fix

#### Automated

- [x] 4.1 Suite passes: `npm run test`
- [x] 4.2 Type checking passes: `npm run typecheck`
- [x] 4.3 Linting passes: `npm run lint`
- [x] 4.4 Full build passes: `npm run build`

#### Manual

- [x] 4.5 `/reports` exercised across presets and both toggle positions; figures unchanged
- [x] 4.6 `?from=2026-02-30` returns a 400 with a JSON body naming `from`
- [x] 4.7 Teeth check: revert one route's `instanceof` branch, confirm only that route's 400 case fails, restore
- [x] 4.8 Teeth check: drop one Polish message, confirm the exact-message assertion fails, restore

### Phase 5: Cookbook and Plan Sync

#### Automated

- [ ] 5.1 Full suite passes: `npm run test`
- [ ] 5.2 Type checking passes: `npm run typecheck`
- [ ] 5.3 Linting passes: `npm run lint`
- [ ] 5.4 Full build passes: `npm run build`

#### Manual

- [ ] 5.5 §6.2's `rpc`-is-terminal rule understandable without opening the fixture
- [ ] 5.6 §3 row 3 reads `complete` and `/10x-test-plan --status` advances to Phase 4
