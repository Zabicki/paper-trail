# Category Distribution View (S-05) — Plan Brief

> Full plan: `context/changes/category-distribution-view/plan.md`
> Chart decisions: `context/foundation/charts_recommendations.md`

## What & Why

A **Kategorie** board on `/reports` showing how expenses distribute across the user's own categories (FR-014), honouring the recurring-cost filter (FR-015). The PRD's own challenge round flagged the risk this slice exists to answer: freely-defined categories produce a long tail of small slices that becomes noise exactly when there is finally enough data to care. Readability at any category count is an acceptance condition here, not a refinement.

## Starting Point

S-04 shipped a complete, verified `/reports` page: a `stable security invoker` aggregation function, a service + endpoint, a sticky control bar with seven range presets and the recurring toggle, URL-driven state via `pushState`, KPI tiles and two Recharts charts. What it does **not** have is any per-category aggregate — `entries_summary` groups only by `(date_trunc(bucket), type)`. It also deferred the `entries.category_id` index question to this slice, and left three findings that land here: F4 (duplicated date arithmetic), F5 (demo data pinned to a stale window) and F10 (an entry under a foreign category silently vanishing from the aggregate).

## Desired End State

Selecting **Kategorie** keeps the current range and toggle and shows a donut with the range total in its centre, a ranking list beneath it (colour swatch, name, proportional bar, amount, % of total), and a stacked bar chart of the same categories over the range's buckets. The long tail collapses into one expandable `Pozostałe (n)`. `/reports?board=categories&range=ytd&recurring=hidden` restores exactly that view, and the back button steps through board changes as it already does through range changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Chart scope | B1 donut + B2 ranking + B3 stacked-over-time; B4 dropped | The three MVP charts in `charts_analysis.md:170-172`; B4 has no FR behind it. | Plan |
| Placement | Board switcher on `/reports`, `board` as a third URL param | FR-015 says "from any view" — one shared control bar, not a second copy. | Plan |
| Kind | Expenses only | FR-014 says *spending* distribution; mixing disjoint `kind` sets into one share-of-total is a category error. | Plan |
| Long tail | Top 8, **or** above 2% of total, whichever gives fewer slices | The documented proposal; the dual rule holds up both when one category dominates and when spend is flat. | Research |
| Colour collisions | Deterministic shift: first occurrence keeps its hex, later duplicates shift lightness | 12 fixed hexes and no uniqueness rule means 30 categories *must* repeat; every arc has to be distinguishable. | Plan |
| Colour ordering | Resolved over the **full** sorted list, not the visible subset | Otherwise expanding `Pozostałe` recolours arcs already on screen. | Plan |
| Aggregate shape | New `entries_category_summary` function + new endpoint | One round trip serves all three charts, and top-N is computed once from the grand totals as `charts_analysis.md:184` requires. | Plan |
| Interaction | `Pozostałe` expands in place; no per-category drill-down | Delivers the readability mechanism's one interaction without a new query, route or URL param. | Plan |
| Readability fixture | Extend the demo account to ~30 categories via migration | Makes FR-014's acceptance criterion reproducible rather than hand-built. | Plan |

## Scope

**In scope:** per-category SQL aggregate + pgTAP; demo-data extension; service, DTOs and `GET /api/entries/category-summary`; board switcher and the `ReportsView` split; the shared distribution model (top-N + colour resolution); donut, ranking and stacked-over-time charts.

**Out of scope:** B4 change-vs-previous-period; Board C; income distribution; per-category drill-down; an index on `entries.category_id`; any change to `Entry`, `Category` or `entries_summary`; persisting the board choice; a colour-uniqueness constraint; a test framework.

## Architecture / Approach

```
entries_category_summary(from, to, bucket, excludeRecurring)   ← 3 grouping sets
  ├─ bucket_start + category_id  → B3 cells
  ├─ category_id only            → B1/B2 grand totals
  └─ ()                          → exact range total (percentage denominator)
        ↓  getCategorySummary (reuses reports.ts guards + date helpers)
        ↓  GET /api/entries/category-summary
CategoriesBoard → resolveDistribution() ── one model ──→ Donut · Ranking · Stacked
                   (top-N + colour map, computed once over the range)
```

The distribution model is the load-bearing piece: computed once from the grand totals, it decides what renders individually, what collapses, and what colour each category gets — which is what makes the three charts agree.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Aggregation primitive + demo data | `entries_category_summary`, pgTAP, ~30-category demo account | Silent cross-user leak if the function shape drifts from `entries_summary`'s |
| 2. Service, DTOs, endpoint | `getCategorySummary` + `/api/entries/category-summary` | Three-way grouping-set fold typing cleanly under `strictTypeChecked` |
| 3. Switcher, distribution model, ranking | Board B shippable with no chart library | Moving Board A's fetch out of `ReportsView` regresses shipped S-04 behaviour |
| 4. Donut (B1) | Share-of-total reading with an expandable tail | First `PieChart` in the repo; per-datum fill and dynamic `ChartConfig` are unproven here |
| 5. Kategorie w czasie (B3) | Stacked category mix over the range's buckets | Colour/series stability across buckets |

**Prerequisites:** S-04 archived (done); local Supabase + Docker for `db reset` and pgTAP; the demo account existing locally.
**Estimated effort:** ~4-5 sessions across 5 phases, with phase 3 the largest.

## Open Risks & Assumptions

- **The colour-shift rule departs from `charts_recommendations.md:59`,** which says charts must match the category dot exactly or the visual language breaks. The chosen mitigation is that the *larger* of any duplicate pair keeps its exact hex — so the category the user is actually looking at still matches. The smaller one will not.
- **`Pozostałe` uses `var(--muted-foreground)`, but a visible category can still be `#64748b` (Szary).** The count label and always-last position are what disambiguate; accepted as a residual.
- **F10 becomes more visible here.** An entry under a foreign category was a slightly-low bucket on Board A; here it is a missing slice, and the board total would disagree with Board A's `Wydatki` tile. Phase 2 verification cross-checks the two aggregates for exactly this reason.
- **Demo data inherits F5** — pinned to `2026-05-16 .. 2026-08-16`, so most presets go empty for that account once real time moves past it.
- **The no-index decision is reasoned, not yet measured.** Phase 1 requires an `explain analyze` to falsify it.

## Success Criteria (Summary)

- A user with 30 categories sees at most nine arcs and can reach every one of them, with no two visible slices sharing a colour.
- The donut centre, the ranking sum and Board A's `Wydatki` tile agree for any range and toggle state.
- Range, recurring toggle and board all live in the URL, restore on reload, and step through the back button.
