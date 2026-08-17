# Reports Readability Fixes — Y-Axis Width and All-Time Range Implementation Plan

## Overview

Two defects on the shipped `/reports` surface, both of which make a correct number unreadable or a correct preset useless:

1. All three chart Y-axes hardcode `width={44}`, while their ticks are formatted with `pl-PL` compact notation — `12,5 tys.` is roughly nine characters and overflows that box, so the leading digit is clipped for any bucket above 1000 zł.
2. `Cały okres` resolves to a relative twenty-year floor, so it plots ~252 empty month buckets in front of the handful the user actually has.

Both are fixed in one phase. They share the same acceptance surface (the reports boards render readable, honestly-scoped charts), neither touches the schema, and the roadmap already notes they are "the same defect seen from opposite ends" — the twenty-year floor exists *because* of the bucket-count guard, and a real first-entry date removes the condition that guard was tripping on.

## Current State Analysis

**The axis half.** `src/components/reports/TrendChart.tsx:62`, `src/components/reports/CumulativeChart.tsx:140` and `src/components/reports/CategoryTrendChart.tsx:139` each render an identical `<YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCurrencyCompact} />`. `formatCurrencyCompact` (`src/lib/format.ts:37`) is a `pl-PL` `notation: "compact"` formatter, whose output at realistic magnitudes is:

| Value | Tick text |
| --- | --- |
| 999 | `999` |
| 1 000 | `1 tys.` |
| 12 500 | `12,5 tys.` |
| 1 250 000 | `1,3 mln` |

44px fits about five characters at the chart's tick font size, so anything from `1 tys.` upward is cut on the left. This is not an edge case: a month bucket of ordinary household spending exceeds 1000 zł.

Recharts is pinned at `3.10.1`, where `YAxisWidth = number | 'auto'` (`node_modules/recharts/types/state/cartesianAxisSlice.d.ts:121`) and `getCalculatedYAxisWidth` (`node_modules/recharts/types/util/YAxisUtils.d.ts:12`) measures the rendered ticks. So `width="auto"` is a typed, first-class option at the pinned version — no patch, no override.

**The all-time half.** `src/components/reports/range.ts:62` defines `ALL_TIME_YEARS_BACK = 20`, consumed at `range.ts:127`. Its own comment records why the epoch was rejected: `src/lib/services/reports.ts:45` refuses any range implying more than `MAX_BUCKETS = 400` buckets, and 1970 → today is ~680 months, so an epoch floor would 400 the request every time.

Range resolution is entirely client-side and there is no first-entry lookup anywhere in the repo. Both boards resolve the preset themselves inside their fetch effect — `OverviewBoard.tsx:85` and `CategoriesBoard.tsx:90` — using a browser-local `today`, then send concrete `from`/`to`/`bucket` to the aggregate endpoints. Nothing about that flow changes here; only what `all-time` resolves to changes.

**Constraints discovered:**

- No page in the repo queries Supabase server-side today (`grep createClient src/pages/*.astro` is empty) — every page renders an island that fetches an API route. Passing server data *into* an island is established, though: `src/pages/auth/signin.astro:16` does `<SignInForm serverError={error} client:load />`.
- `Astro.locals.user` is a full Supabase `User` (`src/env.d.ts`), so `created_at` is available on the page for free — the same source `src/pages/api/entries/days.ts:52` uses for its account-creation floor.
- `entries_user_id_occurred_on_idx (user_id, occurred_on)` already covers `order by occurred_on asc limit 1` under the RLS `user_id` predicate. **No migration in this change.**
- `entries` has no `deleted_at` — entry deletion is hard (see `supabase/migrations/20260815164539_create_entries_table.sql`), so a first-entry lookup needs no soft-delete filter. It must also *not* filter on the category's `deleted_at`: both summary RPCs deliberately count entries filed under soft-deleted categories (`20260816103000_add_entries_summary_function.sql:21`), and a first-entry date that disagreed with what the aggregate counts would put the range start after the earliest plotted bar.
- The entry edit form's date field is a bare `type="date"` input with no `min`/`max` (`src/components/entries/DayEntriesList.tsx:197`) and the service validates with a `/^\d{4}-\d{2}-\d{2}$/` regex only (`src/lib/services/entries.ts:18`), so a mis-typed year like `0202` is storable and would push all-time past the 400-bucket guard.

## Desired End State

On `/reports`, every Y-axis tick is fully legible at every magnitude the data reaches, on both boards and all three charts, in the browser and at mobile width. `Cały okres` plots from the user's earliest recorded entry to today — so a three-week-old account gets day buckets over three weeks rather than 252 empty months — and falls back to the account-creation date when the user has no entries at all.

Verified by: loading `/reports?range=all-time` on both boards and reading the caption and the first bar; and by loading a range whose buckets exceed 1000 zł and reading the axis.

### Key Discoveries:

- `width="auto"` is typed and supported at the pinned Recharts `3.10.1` — `YAxisWidth = number | 'auto'` (`node_modules/recharts/types/state/cartesianAxisSlice.d.ts:121`).
- The twenty-year floor is self-documented as a workaround for `MAX_BUCKETS = 400` (`src/components/reports/range.ts:55-62` and `src/lib/services/reports.ts:31-45`) — the replacement constant should carry the same explanation, now as a clamp rather than a floor.
- `range.ts:11-25` states that its date helpers are a deliberate second copy of `reports.ts`'s and that changing the arithmetic requires re-checking `previousRange` and `bucketCountUpperBound`. This change adds no new arithmetic — it only changes which date `all-time` starts at — so that coupling is untouched.
- Account-creation floor precedent: `src/pages/api/entries/days.ts:52` (`user.created_at.slice(0, 10)`).
- Island-props precedent: `src/pages/auth/signin.astro:16`.

## What We're NOT Doing

- **No caption changes.** The `range.from – range.to` caption (`ReportsView.tsx:119-121`) keeps its raw ISO form. Formatting it in Polish, or labelling the all-time start as "od pierwszego wpisu", is out of scope.
- **No change to the `MAX_BUCKETS` guard, `bucketCountUpperBound`, or the truncation check.** They stay exactly as they are, as the second line of defence for hand-crafted URLs.
- **No change to `formatCurrencyCompact` or any other formatter.** The axis bug is fixed by sizing the axis, not by shortening Polish number language app-wide.
- **No change to the recurring filter's semantics**, to the preset list, to `bucketFor`, or to either aggregate endpoint or RPC.
- **No migration, no new index, no new API route.**
- **No `min`/`max` on the entry date input.** The outlier clamp handles the reporting consequence; tightening entry validation is a separate concern in a different slice's surface.
- **No refresh of the first-entry date within a page session.** It is resolved once per page render; see Critical Implementation Details.

## Implementation Approach

The axis half is a prop change on three charts, with no shared abstraction introduced — three identical one-line edits are cheaper to read than a wrapper component, and the charts already repeat their axis config by design.

The all-time half moves *only the start date* of one preset from a hardcoded constant to a server-resolved value:

```
reports.astro (server)
  ├─ createClient(headers, cookies)  → getFirstEntryDate()  → "2026-08-02" | null
  ├─ Astro.locals.user.created_at                           → "2026-08-01"
  └─ allTimeStart = firstEntry ?? accountCreated ?? today
        │
        └─ <ReportsView allTimeStart={…} client:load />
              ├─ OverviewBoard   → resolveRange(preset, today, allTimeStart)
              └─ CategoriesBoard → resolveRange(preset, today, allTimeStart)
```

`resolveRange` gains a third parameter and uses it for the `all-time` case only; every other preset is untouched. The clamp lives inside that same case, so no caller can forget it.

Why a server prop rather than a new route: the value is needed *before* the first summary request can be built, so a route would mean two sequential round trips and a new loading branch in a component that currently has none. Why not folded into the summary endpoint: bucket derivation would have to move server-side, producing a second copy of `bucketFor` — precisely the duplication `src/lib/services/reports.ts:227-233` warns is the point at which the client and server halves stop agreeing.

## Critical Implementation Details

**The first-entry date is unfiltered, and that is deliberate.** `getFirstEntryDate` ignores the recurring-cost filter, so toggling `Ukryj duże koszty cykliczne` never moves the X-axis. If the start were re-resolved against the filtered set, flipping the toggle could re-scale the axis and even re-bucket day→week, making the two views of the same range hard to compare — and it would need a fetch per toggle. The visible cost is that with the filter on, an all-time range can open with a few leading zero buckets before the first non-recurring entry. That is the correct trade: the toggle should change the bars, not the axis.

**Session staleness.** The value is resolved once per page render. A user who logs their very first entry in another tab and switches back to an already-open `/reports` sees the account-creation fallback until they reload. `src/middleware.ts` sets `Cache-Control: private, no-store`, so any navigation to `/reports` re-resolves it. This is acceptable because the only case where the number changes is the transition from zero entries to one.

**`createClient()` can return `null`.** `reports.astro` is the first page in the repo to call it, so it must null-check per the repo's hard rule (`src/lib/supabase.ts`, and see `src/pages/api/entries/summary.ts:17-20`). With Supabase unconfigured the page must still render — fall back to the account-creation date, or `today` if there is no user either. A red config banner already tells the user what is wrong; the reports page must not 500 on top of it.

**No test framework exists in this repo**, and neither half of this change is reachable by pgTAP: the axis fix is rendering, and the all-time fix is a service query plus client arithmetic. Per `context/foundation/lessons.md`, the plan states this explicitly rather than implying coverage — automated verification here is lint/type-check/build only, and the behavioural proof is the manual checklist below. That manual step is a permanent re-verification requirement for any future change to `resolveRange` or the chart axes.

## Phase 1: Legible axes and a real all-time range

### Overview

Both fixes land together. They share no code, so either can be written first, but they are verified against the same page and released as one change.

### Changes Required:

#### 1. Chart Y-axis width

**File**: `src/components/reports/TrendChart.tsx` (line 62), `src/components/reports/CumulativeChart.tsx` (line 140), `src/components/reports/CategoryTrendChart.tsx` (line 139)

**Intent**: Let the axis size itself to its rendered ticks so the leading digit of a compact `pl-PL` amount is never cut. Applied identically to all three charts — no shared wrapper, matching how these charts already repeat their axis config.

**Contract**: `<YAxis … width="auto" … />` replacing `width={44}` on each. `YAxisWidth = number | 'auto'` at the pinned Recharts `3.10.1`, so this type-checks under `strictTypeChecked` with no cast. Leave `tickLine`, `axisLine` and `tickFormatter` exactly as they are. Add a one-line comment on one of the three (or on each, matching local comment density) recording *why* the fixed width was wrong: `formatCurrencyCompact` output such as `12,5 tys.` is wider than any constant that also suits `50`.

#### 2. First-entry lookup

**File**: `src/lib/services/reports.ts`

**Intent**: Expose the earliest date the user has any entry on, so the reports page can resolve `Cały okres` against real data. Placed in `reports.ts` rather than `entries.ts` because it exists to resolve a report range and belongs beside the other range vocabulary (`previousRange`, `MAX_BUCKETS`), not beside the entry CRUD.

**Contract**: `export async function getFirstEntryDate(supabase: SupabaseClient): Promise<string | null>` — a single-row read of `entries.occurred_on` ordered ascending, limit 1, returning the ISO date string or `null` when the user has no entries. RLS supplies the `user_id` predicate, so the existing `entries_user_id_occurred_on_idx` covers it; no explicit user filter and no `security definer`. **No `deleted_at` filter on the joined category** — the summary RPCs deliberately count entries under soft-deleted categories, and this date must agree with them. Errors propagate the way the module's other functions do (throw the `PostgrestError`); the caller decides the fallback.

#### 3. Server-resolved all-time start

**File**: `src/pages/reports.astro`

**Intent**: Resolve one value on the server — the date `Cały okres` should start at — and hand it to the island, so no extra round trip and no extra loading state are needed for the preset.

**Contract**: Create the Supabase client from `Astro.request.headers` / `Astro.cookies`, null-check it, call `getFirstEntryDate`, and compute `allTimeStart = firstEntry ?? Astro.locals.user?.created_at.slice(0, 10) ?? <today>`. Pass it as `<ReportsView allTimeStart={allTimeStart} client:load />`. The fallback chain must not throw when Supabase is unconfigured or the client returns `null` — the page still renders, per Critical Implementation Details. Note in a comment that this is the repo's first server-side data read in a page, and why (the value is needed before the first fetch can be built).

#### 4. All-time preset resolution

**File**: `src/components/reports/range.ts`

**Intent**: Replace the twenty-year floor with the caller-supplied start date, clamped so that an absurdly back-dated entry cannot push the range past the aggregate's bucket guard and take the whole board down.

**Contract**: `resolveRange(preset: RangePreset, today: string, allTimeStart: string)` — a third required parameter, used only by the `all-time` branch, which returns `{ from: max(allTimeStart, todayMinusClampYears), to: today }` (lexicographic comparison, as `days.ts:55-58` and `summary.ts:44` already do for ISO dates). Delete `ALL_TIME_YEARS_BACK` and introduce the clamp constant in its place, carrying forward the existing comment's reasoning in its new form: `MAX_BUCKETS = 400` in `src/lib/services/reports.ts` bounds a month-bucketed span to ~33 years, so the clamp is what keeps a mis-typed year from turning a valid preset into a 400. Making the parameter required rather than optional is deliberate — a defaulted parameter would let a future caller silently reintroduce a hardcoded floor.

#### 5. Prop threading

**File**: `src/components/reports/ReportsView.tsx`, `src/components/reports/OverviewBoard.tsx`, `src/components/reports/CategoriesBoard.tsx`

**Intent**: Carry `allTimeStart` from the page down to the two components that actually resolve the range, without changing where range resolution happens.

**Contract**: `ReportsView` takes `{ allTimeStart: string }` as its first props (it has none today) and forwards it to both boards; each board adds it to its props interface, passes it as the third argument to its `resolveRange` call (`OverviewBoard.tsx:85`, `CategoriesBoard.tsx:90`), and adds it to that effect's dependency array. `ReportsView`'s own seeding call at line 67 takes it too, so the first-paint caption agrees with what the boards fetch. It is a plain string and stable across renders, so it introduces no re-fetch loop.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` completes without error
- `npm run lint` passes (ESLint `strictTypeChecked` + `stylisticTypeChecked` + `react-compiler` as errors)
- `npm run build` succeeds
- `grep -rn "width={44}\|ALL_TIME_YEARS_BACK" src/` returns nothing

#### Manual Verification:

- On a range whose buckets exceed 1000 zł, the Y-axis ticks on **Wydatki i przychody**, **Skumulowane wydatki** and **Kategorie w czasie** are fully visible — no clipped leading digit — at desktop and at mobile width
- Small-magnitude ranges (ticks like `50`) do not leave an obviously oversized empty gutter, and the plot area does not visibly jump between range switches
- `Cały okres` on Board A plots from the first recorded entry, with the caption's `from` matching that entry's date and no run of empty leading buckets
- `Cały okres` on Board B (`?board=categories&range=all-time`) shows the same start date as Board A
- With entries spanning under 30 days, `Cały okres` renders **day** buckets (it previously always rendered months) — this is the observable proof the bucket guard is no longer being worked around
- Toggling `Ukryj duże koszty cykliczne` on `Cały okres` does not move the X-axis start
- A fresh account with zero entries shows `Cały okres` starting at its creation date and each board's empty-state copy, with no error
- Every other preset (7 days, 30 days, this month, last month, 3 months, YTD) resolves exactly as before

**Implementation Note**: This is a single-phase change; the manual checklist above is the release gate. Automated verification cannot reach either fix (no test framework, and neither half is pgTAP-reachable) — confirm the manual list with the human before considering the change done.

---

## Testing Strategy

### Unit Tests:

None — there is no test framework installed in this repo (no vitest/playwright/jest, no test script). Adding one is a setup decision outside this change's scope.

### Integration Tests:

None. `npx supabase test db` is unaffected: no migration, no RLS change, no new table. Re-run it only to confirm nothing regressed, and run `npm ci` first so the pinned `2.98.2` CLI is used (`context/foundation/lessons.md`).

### Manual Testing Steps:

1. `npm ci`, then `npm run dev`; read the port from the dev-server banner rather than assuming 4321.
2. Sign in and open `/reports`. On the default 30-day range, confirm the Y-axis ticks on **Wydatki i przychody** and **Skumulowane wydatki** read in full.
3. Switch to **Kategorie** and confirm the same for **Kategorie w czasie**.
4. Pick a range large enough that a bucket exceeds 1000 zł (YTD, or 3 months) and re-check all three axes — this is the case the old 44px box clipped.
5. Narrow the viewport to a phone width and repeat step 4.
6. Select `Cały okres` on both boards; confirm the caption's `from` equals the earliest entry, that the first bucket contains data, and that both boards agree.
7. With entries spanning fewer than 30 days, confirm `Cały okres` renders day buckets.
8. Toggle the recurring filter while on `Cały okres`; confirm the axis start does not move.
9. Sign in as a second account with no entries; confirm `Cały okres` shows the creation date and the empty-state copy, with no error banner.
10. Walk every remaining preset and confirm the caption and bucket granularity are unchanged from before.
11. Optional outlier check: temporarily edit one entry's date to a mis-typed year (e.g. `0202-01-01`) via the day list's edit form, confirm `Cały okres` still renders rather than erroring, then set it back.

## Performance Considerations

The first-entry lookup adds one indexed single-row query to the `/reports` server render — `entries_user_id_occurred_on_idx` makes it an index scan with `limit 1`. It is not on the entry path, which is the only path the PRD's NFR budget governs.

`width="auto"` measures tick text on the client each render; Recharts keeps a `widthHistory` to damp oscillation. At ≤400 buckets and ≤30 categories this is not a measurable cost.

The change is also a net *reduction* in work for `Cały okres`: the aggregate stops being asked for ~252 month buckets and is asked for the handful the user actually has.

## Migration Notes

None. No schema change, no new index, no RPC change — so the CI ordering trap (migrations applied before the Worker deploys) does not apply to this change.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-08
- Change notes: `context/changes/reports-axis-and-all-time-range/change.md`
- Chart decisions: `context/foundation/charts_recommendations.md`
- Prior slices: `context/archive/2026-08-16-date-range-spending-view/`, `context/archive/2026-08-16-category-distribution-view/`
- Lessons: `context/foundation/lessons.md` (app-layer invariants aren't pgTAP-provable; pin the CLI before diagnosing)
- Bucket guard: `src/lib/services/reports.ts:31-45`
- Client/server date-helper coupling: `src/components/reports/range.ts:11-25`
- Account-creation floor precedent: `src/pages/api/entries/days.ts:52`
- Island-props precedent: `src/pages/auth/signin.astro:16`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Legible axes and a real all-time range

#### Automated

- [x] 1.1 `npx astro sync` completes without error
- [x] 1.2 `npm run lint` passes
- [x] 1.3 `npm run build` succeeds
- [x] 1.4 `grep -rn "width={44}\|ALL_TIME_YEARS_BACK" src/` returns nothing

#### Manual

- [x] 1.5 Y-axis ticks fully visible on all three charts above 1000 zł, desktop and mobile
- [x] 1.6 Small-magnitude ranges leave no oversized gutter and the plot area does not jump between switches
- [x] 1.7 `Cały okres` on Board A starts at the first recorded entry, caption agrees, no empty leading buckets
- [x] 1.8 `Cały okres` on Board B shows the same start date as Board A
- [x] 1.9 Sub-30-day history renders day buckets on `Cały okres`
- [x] 1.10 Recurring-filter toggle does not move the `Cały okres` X-axis start
- [x] 1.11 Zero-entry account shows creation date plus empty-state copy, no error
- [x] 1.12 All six other presets resolve exactly as before
