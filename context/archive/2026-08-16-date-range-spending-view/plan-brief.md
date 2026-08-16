# Date-Range Spending View (S-04) — Plan Brief

> Full plan: `context/changes/date-range-spending-view/plan.md`
> Research: `context/foundation/charts_recommendations.md` (condensed from `charts_analysis.md`)

## What & Why

Roadmap slice **S-04**: a `/reports` page where the user picks a quick-select date range (FR-013) and can hide large recurring costs (FR-015), seeing four KPI tiles and two charts over that range. The PRD's third product insight is that day-to-day spending stays invisible until fixed costs are filtered out, and that existing tools bury that option — this slice makes the filter a first-class, always-visible control rather than a buried one.

## Starting Point

No range or aggregate capability exists anywhere. `GET /api/entries` hard-requires `?date=`, and the only range query returns bare date strings for the calendar. `Entry.category` doesn't carry `isRecurring`, so FR-015 can't even be applied client-side today. No charting library, no currency formatter, and `.dark` is never applied to `<html>` — so every page runs light design tokens behind a forced dark gradient.

## Desired End State

A signed-in user opens `/reports` from the Topbar, lands on the last 30 days with recurring costs included, and can switch among seven range presets and flip one prominent toggle. Four tiles — Wydatki, Przychody, Bilans, Średnia dzienna — each carry a percentage delta against the preceding equal-length period. Below them, a grouped expense/income bar chart and a two-line cumulative chart comparing this period's spending pace against the last. Both controls live in the URL, so the view is linkable, reloadable and back-navigable.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Charting library | Recharts, pinned exact, via `shadcn add chart` | SVG means both colour systems (`--chart-*` tokens and per-category hex) are plain CSS; canvas libraries force both through JS. | Research |
| Chart forms | Grouped bars (A1), stat tiles (A2), cumulative lines (A3) | Expense and income aren't parts of a whole, so stacking would assert a false relationship. | Research |
| Bucket granularity | Derived from range length, never a user control | Keeps FR-013 to a single preset picker, matching the product's low-friction posture. | Research |
| Page location | New `/reports` route (English path, Polish "Raporty" label) | Keeps `/dashboard` as the pure ≤4-interaction entry path the north star is measured on. | Plan |
| Slice scope | All three Board A items, income included, with a Bilans tile | The aggregate already groups by `type`, so income is free at the SQL layer; S-03 shipped income entry. | Plan |
| Recurring filter default | **Off**, with a prominent sticky toggle, not persisted | Defaulting on trades a buried option for a hidden one, where totals silently disagree with what the user believes they spent. | Plan |
| Aggregation mechanism | Postgres RPC, `stable security invoker` | PostgREST cannot `GROUP BY date_trunc(…)`; invoker semantics keep RLS applying, and summing in `numeric` closes S-02's float-drift flag. | Plan |
| Range totals | `grouping sets` in the same function | Grand totals are exact in Postgres rather than a JavaScript re-sum of bucket values. | Plan |
| Data fetching | Client-side fetch in the island | Matches every island already in the repo; one code path for initial load and control changes. | Plan |
| Control state | URL query params, `pushState` + `popstate` | Back button works, the view is linkable, and the filter's state is somewhere the user can actually see it. | Plan |
| Currency formatting | Shared `src/lib/format.ts`, day view migrated onto it | Introduces the cross-cutting concern once and stops a third `toFixed(2)` copy appearing in S-05. | Plan |
| Chart theming | Apply `.dark` to `<html>`, then use `--chart-*` | Makes the dark tokens already in `global.css` correct for the background they render on, and fixes app-wide low-contrast text at the same time. | Plan |
| Verification | pgTAP for RLS *and* aggregate arithmetic | Unlike soft-delete, this logic is reachable from raw SQL, so it can genuinely be proven rather than assumed. | Plan |

## Scope

**In scope:** the `entries_summary` Postgres function + pgTAP suite; `src/lib/services/reports.ts` and `GET /api/entries/summary`; shared currency formatter (with `DayEntriesList` migrated); `.dark` activation; Recharts install; the `/reports` route, control bar, KPI tiles and empty state; charts A1 and A3.

**Out of scope:** Board B (S-05 — donut, category ranking, `category_id` index); Board C (heatmap, net-flow line, Sankey); FR-016 custom-range UI; drill-down from chart to entries; persisting the toggle; widening `Entry.category`; any test framework.

## Architecture / Approach

```
/reports (client:load island)
  └─ URL params (range, recurring)
       → resolveRange() + bucketFor()   [client-side; "today" must be a browser local date]
       → GET /api/entries/summary?from&to&bucket&recurring
            → reports.ts service
                 → 2 × rpc("entries_summary")  [current + previous, in parallel]
                      → date_trunc + GROUP BY GROUPING SETS, sum(amount) in Postgres numeric
                      → RLS applies (security invoker)
       → EntriesSummary { bucket, current, previous }
            → KpiTiles · TrendChart · CumulativeChart
```

Bottom-up phasing: the primitive whose failure mode is a silent cross-user leak lands first and alone, and Phase 4 delivers a complete, shippable FR-013/FR-015 outcome before any chart renders.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Aggregation primitive | Migration + `entries_summary` + pgTAP suite | A `deleted_at` filter copied from habit would silently drop entries under deleted categories |
| 2. Service + endpoint | `reports.ts`, aggregate DTOs, `GET /api/entries/summary`, route protection | RPC results are untyped — the row cast must survive `strictTypeChecked` |
| 3. Presentation foundations | `format.ts`, `.dark` activation, pinned Recharts + `chart.tsx` | The `.dark` change is app-wide; visual regression on already-shipped pages |
| 4. Controls + KPI tiles | `/reports` route, URL-driven range picker, sticky toggle, four tiles, empty state | URL/history sync and empty-previous-period deltas |
| 5. Charts A1 + A3 | Grouped trend bars, cumulative comparison lines | shadcn `chart.tsx` typing churn vs Recharts 3.x under `strictTypeChecked` |

**Prerequisites:** S-01 and S-02 are done (both archived). Local Supabase running (Docker, ~7 GB) for `db reset` and `supabase test db`. Seed users from `supabase/seed.sql` plus a month of hand-entered test data — the dataset is otherwise near-empty by design.

**Estimated effort:** ~5 sessions, one per phase, with Phase 4 the largest. Slice is shippable after Phase 4 if the library integration proves worse than budgeted.

## Open Risks & Assumptions

- **This slice ships into an empty dataset.** The PRD concedes v1 starts empty and the roadmap warns S-04 "will look thin in testing regardless of how well it is built." That is a data problem, not a quality signal — but it means manual verification depends on hand-seeded entries, and the empty-state paths will be exercised far more than the populated ones. It is also the strongest argument for revisiting Open Roadmap Question 1 (bulk import).
- **shadcn's `chart.tsx` has repeatedly broken against Recharts 3.x typings.** One hand-patch is budgeted; the version is pinned exact so an unrelated `npm install` can't reintroduce it. If it proves worse, Phase 4 is still a shippable slice.
- **The `.dark` fix is deliberately larger than this slice.** It corrects a pre-existing mismatch across every shipped page. The alternative — a third colour system scoped to `/reports` — was rejected, but the blast radius is real and Phase 3's manual verification is where it gets caught.
- **`formatCurrency` changes `/dashboard`'s appearance**, a page governed by the ≤4-interaction / ≤10-second NFR. Re-verifying that path is an explicit Phase 3 criterion.
- **Assumption: `Intl` compact notation renders acceptably for `pl-PL`** on axis ticks. If it reads poorly, fall back to plain grouped digits without a symbol; no other decision depends on it.

## Success Criteria (Summary)

- A user can answer "what did I spend over the last month, and how does that compare to the month before?" from one page in one interaction, and remove large recurring costs from that answer in one more.
- Every figure on the page is summed in Postgres, so no total drifts from what the underlying entries add up to.
- Two users signed in side by side see numbers derived only from their own entries — proven by pgTAP through the new function, not assumed.
