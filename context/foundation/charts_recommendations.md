# Charts — decisions for planning

Condensed from `charts_analysis.md` (market research, full library comparison, and rationale live there).
Input for `/10x-plan` on **S-04 `date-range-spending-view`** and **S-05 `category-distribution-view`**.

Currency: single (PLN). UI copy: Polish.

---

## Hard constraints

Data surface is two tables only — `entries` (`amount numeric(10,2) > 0`, `type`, `occurred_on date`, `category_id`) and `categories` (`name`, `kind`, `color`, `is_recurring`, `deleted_at`).

1. **Amounts are always positive.** Income is a sign flip driven by `type`, never a negative amount. Netting requires applying the sign yourself.
2. **No account balances, no budgets.** Net worth, cash-flow balance, budget-vs-actual, age-of-money and merchant breakdowns are **not implementable** — do not plan them. A cumulative _net flow_ line is the only honest substitute and must never be labelled a balance.

---

## Library: Recharts, pinned, via `npx shadcn@latest add chart`

Covers 7 of the 8 library-backed charts. Chosen because:

- **SVG → theming is free.** Two colour systems must coexist: `--chart-1..5` (already in `src/styles/global.css`, `:root` + `.dark` + `@theme inline`) for series, and the 12 user-chosen hex values in `CATEGORY_COLORS` (`src/types.ts`) for categories. Both are plain `fill` attributes. Canvas libraries (ECharts, Chart.js) force both through JS and a hand-maintained dark-mode object.
- **Declarative React** matches every existing island; `components.json` is already configured.
- **`accessibilityLayer` on by default in v3** (ARIA + arrow-key nav) — matters because `eslint-plugin-jsx-a11y` runs as errors.
- ~50 KB gzip, tree-shakeable. Data volume here (≤365 buckets, ≤30 categories) makes the canvas-performance case for ECharts/Chart.js irrelevant.

**Two risks to plan for:**

- **Pin the version.** shadcn's `chart.tsx` churned against Recharts 3.x typings (`payload` dropped from tooltip props; `NameType`/`ValueType` imports moved). Under `strictTypeChecked` this breaks the build. Budget one hand-patch.
- **Recharts' `Sankey` is bare** (`{nodes, links}`, minimal styling). C4 is deferred anyway; because Astro islands are separately bundled, a different library for that one island later costs only that island's bytes.
- _Not_ needed: the `react-is` override from search results — that was the React 19 RC era; this repo is on stable 19.2.6.

---

## Charts to build

`<bucket>` = auto-derived from range length: ≤30 days → day, ≤3 months → week, else month. Not a user control.

### Board A — Przegląd · S-04 · FR-013, FR-015

| #   | Chart                                                                                                  | Form                                                  | Aggregate                                          |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| A1  | Trend wydatków i przychodów                                                                            | **Grouped** bars (not stacked — not parts of a whole) | `GROUP BY date_trunc(<bucket>, occurred_on), type` |
| A2  | KPI: Wydatki / Przychody / Bilans / Średnia dzienna, each with % delta vs previous equal-length period | Stat tiles — **no chart library**                     | Scalar sums × 2 ranges                             |
| A3  | Skumulowane wydatki: ten vs poprzedni okres                                                            | 2 cumulative lines, previous muted/dashed             | A1 buckets, running total × 2 ranges               |

A2 is the cheapest high-value item — plain divs. Make **Bilans** visually distinct from the two gross tiles: `DayEntriesList.tsx` deliberately never nets income against expense for a day, and a netted range total is a different claim.

### Board B — Kategorie · S-05 · FR-014, FR-015

| #   | Chart                                              | Form                                        | Aggregate                                                 |
| --- | -------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| B1  | Rozkład wg kategorii                               | Donut, total in centre                      | `GROUP BY category_id`                                    |
| B2  | Ranking kategorii                                  | Sorted horizontal bars, amount + % of total | same as B1                                                |
| B3  | Kategorie w czasie                                 | Stacked bars per bucket                     | `GROUP BY date_trunc(<bucket>, occurred_on), category_id` |
| B4  | Zmiana wg kategorii vs poprzedni okres — **Later** | Diverging ± bars, zero reference line       | B1 aggregate × 2 ranges                                   |

**All four colour by `category.color`**, not by `--chart-*`. The dot colour already appears in `CategoryPicker.tsx` and `DayEntriesList.tsx`; charts must match or the visual language breaks.

**B1 + B2 are the proposed answer to S-05's open readability unknown:**

- **Top-N + "Pozostałe"** — render the N largest individually, collapse the tail into one neutral-grey slice labelled with its count (`Pozostałe (7)`), expandable on click. N ≈ 8, or "above 2% of total", whichever gives fewer slices.
- **Donut ↔ ranking toggle** — the donut answers _share_; the horizontal bars answer _rank and amount_ and degrade gracefully to any category count (they just get taller and scroll). This is the escape hatch at 30 categories.

For B3, compute top-N **once over the whole range**, not per bucket, or colours won't mean the same thing across bars.

### Board C — Rytm · no slice owns these yet · all **Later**

| #   | Chart                                    | Form                                                | Aggregate                         |
| --- | ---------------------------------------- | --------------------------------------------------- | --------------------------------- |
| C1  | Kalendarz-heatmapa dziennych wydatków    | Month grid, colour intensity — **no chart library** | `GROUP BY occurred_on`, one month |
| C3  | Skumulowany bilans (przychody − wydatki) | Running-total line                                  | A1 buckets, netted                |
| C4  | Sankey: przychody → kategorie wydatków   | Flow diagram                                        | 2 × `GROUP BY category_id`        |

- **C1 is the best value-per-effort item on the list and needs no library**, so it need not wait for S-04 or the library decision. `MonthCalendar.tsx` already renders the Monday-first grid, already fetches per-month data, already marks days by a boolean; this widens that to an intensity. Use a **sequential single-hue** scale, and keep "missing day" visually distinct from "zero spent" — different facts, and `/api/entries/days` already computes missing days deliberately. Natural drill-down: tap a heavy day → that day's entries.
- **C3 must be labelled a cumulative flow, not a balance.** For a user starting from zero it trends like a net-worth line, which makes mislabelling tempting and wrong.
- **C4 needs data to exist first.** PRD: v1 starts empty. Structure here is thin (income categories → "Środki" → expense categories) since `kind` makes the sets disjoint and there is no budget/account layer. Apply the same top-N collapse as B1.

### Shared control bar

- Range presets (FR-013): last 7 days, last 30 days, this month, last month, last 3 months, YTD, all time. **Custom ranges are FR-016, parked.**
- **"Ukryj duże koszty cykliczne"** toggle (FR-015) applying to _every_ chart on the page — the FR says "from any view".
- Nothing else. No account/merchant/tag filters — those fields don't exist.

---

## Prerequisites

1. **No range or aggregate API exists.** `GET /api/entries` requires `?date=YYYY-MM-DD`. The only range query is `listEntryDaysForMonth` (returns bare dates). Need roughly `GET /api/entries/summary?from&to&bucket&excludeRecurring`, with aggregation in `src/lib/services/` per `entries.ts` conventions.
2. **`Entry.category` can't express FR-015.** `src/types.ts` picks only `id | name | color` — no `isRecurring`. Prefer a separate aggregate DTO over widening the `Pick`, since chart endpoints return sums, not entries.
3. **Aggregate in SQL, not JS.** `DayEntriesList.tsx:29-33` carries an explicit forward-flag from S-02's review F4: `numeric(10,2)` arrives as a JS float, and _"the real fix (aggregate in SQL, or carry integer minor units) belongs with S-04/S-05's aggregation work."_ Range sums are exactly that case. Summing in Postgres also avoids shipping raw rows per chart.
4. **`entries.category_id` has no index.** Existing: `entries_user_id_occurred_on_idx (user_id, occurred_on)` covers the date filter. All Board B charts `GROUP BY category_id` — measure, expect to want one.
5. **No currency formatter anywhere.** `formatAmount` is `n.toFixed(2)` — no symbol, no separator, no `Intl.NumberFormat` in the repo. Charts need a shared `pl-PL`/PLN formatter plus a compact axis-tick variant. Introduce it deliberately, once, not per chart.
6. **RLS.** Aggregates read through the RLS-scoped client like existing services. Note the `entries` FK on `category_id` checks existence but **not ownership** (FK checks bypass RLS) — that's why `assertCategoryUsable` exists. Don't reach for a `security definer` function without re-establishing the `user_id` predicate.
7. **Astro:** chart islands are `client:visible` (below fold, unlike `DayView`'s `client:load`); pass server-fetched aggregates as props. **Recharts is client-only — do not server-render it.** No native modules, so no `workerd` violation.
8. **New routes go in `PROTECTED_ROUTES`** (`src/middleware.ts`, prefix-matched). Middleware already sets `Cache-Control: private, no-store` — don't add caching to aggregate endpoints.

---

## Decisions still needed

1. **Does the recurring filter default on or off?** (S-04 unknown, owner: user.) Recommendation: **off, with a prominent sticky toggle.** The PRD's complaint is that tools _"bury this option"_; defaulting on trades a buried option for a hidden one, where totals silently disagree with what the user thinks they spent.
2. **Confirm the FR-014 readability strategy** and N (top-N + "Pozostałe" + donut/ranking toggle, above).
3. **Where does Board C live?** Its own slice (S-06 is taken by `receipt-parsing`, so a new number), or folded in? C1 arguably isn't a "charts" slice at all — it extends an existing component and needs no library.
4. **Where do charts live?** New `/reports` route vs sections on `dashboard.astro`. The dashboard is currently one `client:load` `DayView` island focused on today's entry, and the PRD's binding constraint is _entry friction_ — a separate route keeps that path clean.
