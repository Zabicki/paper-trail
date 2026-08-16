# Charts & dashboards analysis

Status: analysis only — no library installed, no code written, no migrations added.
Inputs: market research (competitor products), the schema as it exists today, `prd.md`, `roadmap.md`.
Outputs consumed by: roadmap slices **S-04 `date-range-spending-view`** and **S-05 `category-distribution-view`**, both currently `proposed`.

Currency assumption throughout: **single currency (PLN)**, per the PRD non-goal _"all amounts are in a single currency"_. No FX layer; charts sum `numeric(10,2)` directly.

---

## 0. What PaperTrail can and cannot plot

Read this before proposing any chart, including in future revisions of this document.

The entire data surface is two tables:

| `public.entries` |                                 | `public.categories` |                                  |
| ---------------- | ------------------------------- | ------------------- | -------------------------------- |
| `amount`         | `numeric(10,2)`, CHECK `> 0`    | `name`              | `text`                           |
| `type`           | `'expense' \| 'income'`         | `kind`              | `'expense' \| 'income'`          |
| `occurred_on`    | `date` (no timezone)            | `is_recurring`      | `boolean` not null default false |
| `category_id`    | FK → `categories(id)`, not null | `color`             | one of 12 fixed hex values       |
| `user_id`        | FK → `auth.users(id)`           | `deleted_at`        | soft delete                      |

Two consequences shape everything below:

1. **Amounts are always positive.** Income is a sign flip driven by `type`, never a negative `amount`. Any chart that nets income against expense has to apply the sign itself.
2. **There are no account balances and no budgets.** PaperTrail records _flows_, not _stocks_, and has no planned/target amounts.

Therefore the following charts — which are the headline features of nearly every competitor — **are not implementable in PaperTrail at all**, regardless of which library is chosen:

| Not implementable                                  | Why                                                                       | Who ships it                   |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| Net worth over time                                | No account balances, no assets/liabilities                                | YNAB, Actual, Monarch, Copilot |
| Cash flow (balance of budgeted accounts over time) | Same — Actual's cash flow charts _account balances_, not transaction sums | Actual                         |
| Budget vs actual / budget progress bars            | No budget or target amounts anywhere in the schema                        | YNAB, Firefly III, Monarch     |
| Age of money                                       | Requires account balances and inflow dating                               | YNAB                           |
| Merchant / payee breakdown                         | No payee or merchant field; `categories` is the only dimension            | Monarch, Actual                |
| Account filter on every report                     | Single implicit account                                                   | YNAB, Actual, Monarch          |

The closest honest substitute for a net-worth line is a **cumulative net flow** (chart C3 below), which must be labelled as such and never presented as a balance.

---

## 1. Market analysis

### 1.1 YNAB

Three web reports, all sharing one filter bar (**categories × timeframe × accounts**) with select-all/select-none and preset ranges (this month, this year, all time) alongside custom ranges.

- **Spending → Totals** — a color-coded donut of spending share. Hovering gives amount + % of total; clicking a slice or legend entry **drills into that group's subcategories**, and the right-hand panel recomputes totals and averages for the drilled scope. Clicking a subcategory opens the underlying transactions.
- **Spending → Trends** — the same data as a stacked bar chart, one bar per month, with a trendline. Same drill-down behaviour. YNAB explicitly markets this as the "lifestyle creep" check.
- **Income v Expense** — a month-by-month table, income above (green) and expenses below (red), with a per-category **average column** and a net total per month coloured red or green. YNAB's own guidance says the average column is the most useful part: comparing a category's six-month average against its target is what drives a decision.
- **Net Worth** — assets in blue, debts in red, with a trend line for the difference. _Not implementable here._
- **Age of Money** (mobile) — _not implementable here._

Transferable ideas: the **totals ↔ trends toggle over one dataset**, the **average alongside the total**, and **drill-down from aggregate into transactions**.

### 1.2 Actual Budget

A fully customizable **multi-dashboard** model — users create as many dashboards as they like from widgets: Cash Flow graph, Net Worth graph, Spending Analysis, Summary card, Calendar card, Text widget, Custom Reports, Crossover Point.

- **Custom report builder** — the most interesting piece. Five renderings (table, bar, line, area, donut) over one query, with:
  - **Type**: Payment (outflows) / Deposit (inflows) / Net
  - **Split by**: Category, Group, Payee, Account, or Month
  - **Mode**: Total vs Time (Total = one aggregate; Time = monthly breakdown)
  - **Range**: _live_ filters (This month, Year to date) that update dynamically vs _static_ fixed date pairs
  - Per-category include/exclude checkboxes, plus arbitrary field filters
- **Spending Analysis** — compares spending across periods to highlight trends and areas of over/under spend.
- The **table view** deliberately shows sum _and_ average per category alongside the chart, echoing YNAB.

Transferable ideas: the **live vs static date range** distinction (a "last 30 days" that keeps moving is a different object from a fixed pair), and **quick ranges** (1/3/6 months, 1 year, YTD, previous YTD, all time).

### 1.3 Monarch Money

Structurally the cleanest model, and the closest analogue to what PaperTrail needs. Three tabs — Cash Flow, Spending, Income — and **every tab splits into two view modes**:

- **Breakdown** (totals): donut chart, horizontal bar chart, or — on Cash Flow — the Sankey diagram
- **Trends** (change over time): grouped or stacked bar charts

Both modes share the same filter set (date range, categories, tags, amounts) and the same interaction contract: hover for detail, click through to transactions.

Two details worth stealing outright:

1. **Display-by is a first-class control**, not a chart type: Category, Group, Merchant, or **Fixed / Flexible**. That last option partitions spending into structural and discretionary cost — which is _exactly_ PaperTrail's FR-015 recurring/non-recurring split. Monarch treats it as a dimension you view by, not merely a filter you switch off.
2. **Timeframe granularity is explicit**: Daily, Weekly, Monthly, Quarterly, Yearly. Default range is "Last 12 months", with presets from "Last 7 days" through "All time".

The Sankey ("river of money") is repeatedly described in reviews as the fan-favourite and the single feature competitors lack.

### 1.4 Firefly III

Self-hosted, report-heavy. Scope for every report is **accounts × date range × (budgets | categories | tags)**. The category report deliberately **includes income alongside expense** — its documented rationale is that this lets you check whether a raise actually amounted to anything after tax. Reports combine an income/expense bar chart, a daily balance line, and a category pie, plus per-category trend lines.

A community tool (`firefly-iii-sankey`) generates Sankey diagrams from the API, with a notable design detail: **categories below a threshold are collapsed into an `[OTHER CATEGORIES]` bucket** to keep the diagram readable. That is the same long-tail problem FR-014 raises, solved the same way.

### 1.5 The lightweight cohort (Flowly, Eira, Fourmio, Spendaily, GoSpend)

These are the closer match to PaperTrail's product shape — manual entry, no bank sync, friction-minimising. They almost entirely skip balance-sheet reporting and lead instead on **rhythm**:

- **Calendar / month grid with per-day spending indicators** (Fourmio: colour-coded income vs expense days; Spendaily: "visual spending calendar" to spot overspend patterns mid-month)
- **GitHub-style year activity grid** and daily-spend heatmaps (Flowly, Eira)
- Streaks, no-spend days, milestone badges
- A donut for category share + a bar chart for category comparison, and little else

This cohort validates that a day-grid heatmap is a legitimate primary visualization for a manual tracker, not a novelty.

### 1.6 What the market says PaperTrail should build

| Pattern                                            | Seen in                          | Applies here?                                      |
| -------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Totals ↔ Trends toggle over one dataset            | YNAB, Monarch                    | **Yes** — B1↔B2 and Board A                        |
| Donut for share, horizontal bar for ranking        | YNAB, Monarch, Flowly            | **Yes** — the FR-014 readability answer            |
| Long tail collapsed into an "Other" bucket         | Firefly sankey tool, Monarch     | **Yes** — "Pozostałe"                              |
| Fixed/Flexible as a _dimension_, not just a filter | Monarch                          | **Yes** — this is FR-015                           |
| Average shown next to the total                    | YNAB, Actual                     | **Yes** — cheap, high value                        |
| Preset ranges, live vs static                      | YNAB, Actual, Monarch            | **Yes** — FR-013 is presets-only                   |
| Explicit bucket granularity (daily…yearly)         | Monarch                          | **Yes** — drives A1's auto-bucketing               |
| Drill from aggregate into transactions             | YNAB, Monarch                    | **Later** — the day view already exists to land on |
| Calendar/heatmap of daily spend                    | Fourmio, Flowly, Eira, Spendaily | **Yes** — C1                                       |
| Sankey income → expense                            | Monarch, Firefly (community)     | **Yes, later** — C4                                |
| Net worth / cash flow / budgets                    | YNAB, Actual, Monarch, Firefly   | **No** — structurally impossible (§0)              |

---

## 2. Proposed dashboards

Ten charts across three boards. **Two of the ten need no charting library at all.**

Legend: **MVP** = belongs in the slice as currently scoped; **Later** = valuable but beyond what S-04/S-05 promise today.

### Board A — Przegląd

Roadmap slice **S-04**. Requirements **FR-013** (quick-select ranges) and **FR-015** (exclude large recurring costs).

| #      | Chart                                       | Form                              | Aggregate needed                                   | Scope   |
| ------ | ------------------------------------------- | --------------------------------- | -------------------------------------------------- | ------- |
| **A1** | Trend wydatków i przychodów                 | Grouped or stacked bars over time | `GROUP BY date_trunc(<bucket>, occurred_on), type` | **MVP** |
| **A2** | Kafelki KPI + zmiana vs poprzedni okres     | Stat tiles — **no chart library** | Scalar sums over two ranges                        | **MVP** |
| **A3** | Skumulowane wydatki: ten vs poprzedni okres | Two cumulative lines              | A1's buckets, running total, over two ranges       | **MVP** |

**A1 — Trend wydatków i przychodów.** The workhorse; YNAB's Income v Expense and Monarch's Trends are both this chart. Expense and income as two series per bucket.

Bucket granularity should be derived from range length rather than exposed as yet another control, keeping FR-013 to a single preset picker:

| Range                         | Bucket | Approx. bars |
| ----------------------------- | ------ | ------------ |
| Last 7 days                   | day    | 7            |
| Last 30 days                  | day    | 30           |
| Last 3 months                 | week   | ~13          |
| Year to date / last 12 months | month  | ≤12          |

Grouped bars read better for "did I earn more than I spent"; stacked is wrong here because expense and income are not parts of a whole. Recommend **grouped**, with income in the emerald already used for income amounts in `DayEntriesList.tsx` and expense in `--chart-1`.

**A2 — Kafelki KPI.** Four tiles: **Wydatki**, **Przychody**, **Bilans** (income − expense), **Średnia dzienna** (expense ÷ days in range), each with a % delta against the immediately preceding equal-length period. This is the cheapest item on the entire list — plain `div`s, no library — and answers the most common question before any chart is read. The average-alongside-total idea is lifted directly from YNAB and Actual.

Note that `DayEntriesList.tsx` deliberately never nets expense against income for a single day. **Bilans** over a range is a different claim and is fine, but it should be visually distinct from the two gross tiles so the two conventions don't get confused.

**A3 — Skumulowane wydatki.** Two cumulative lines on one axis: the current period and the previous equal-length period, both starting at zero. Answers _"am I ahead of last month's pace?"_ while the period is still running, rather than after it closes. This is Actual's Spending Analysis idea. The previous-period line should be visually subordinate (muted, or dashed).

Interaction with FR-015: when the recurring filter is on, a fixed rent payment on the 5th stops producing the step change that otherwise dominates the shape of both curves — which is precisely the PRD's stated complaint about existing tools.

**Deliberately not proposed for Board A:** a _Stałe vs zmienne_ stacked bar (recurring vs non-recurring per bucket, Monarch's Fixed/Flexible-as-a-chart). It was offered and not selected. Recording it here because it is the one competitor pattern that maps 1:1 onto FR-015 and would show _why_ the filter matters rather than only applying it. Worth revisiting if the on/off toggle turns out to under-explain itself.

### Board B — Kategorie

Roadmap slice **S-05**. Requirements **FR-014** (distribution that stays readable at any category count) and **FR-015**.

| #      | Chart                                  | Form                        | Aggregate needed                                          | Scope     |
| ------ | -------------------------------------- | --------------------------- | --------------------------------------------------------- | --------- |
| **B1** | Rozkład wydatków wg kategorii          | Donut, top-N + "Pozostałe"  | `GROUP BY category_id`                                    | **MVP**   |
| **B2** | Ranking kategorii                      | Sorted horizontal bars      | Same aggregate as B1                                      | **MVP**   |
| **B3** | Kategorie w czasie                     | Stacked bars per bucket     | `GROUP BY date_trunc(<bucket>, occurred_on), category_id` | **MVP**   |
| **B4** | Zmiana wg kategorii vs poprzedni okres | Diverging ± horizontal bars | B1's aggregate over two ranges                            | **Later** |

All four colour by **each category's own `color`** — the 12 fixed hex values in `CATEGORY_COLORS` (`src/types.ts`) — not by a generic chart palette. The category colour is user-chosen and already visible as a dot in `CategoryPicker.tsx` and `DayEntriesList.tsx`; charts must stay consistent with it or the visual language breaks. The `--chart-1..5` variables are for series that aren't categories (A1's expense/income, A3's two periods).

**B1 + B2 are the proposed answer to FR-014's readability clause.** The requirement is amended in the PRD with _"the view remains readable regardless of how many categories are defined"_, and the roadmap leaves the strategy open. The proposal is a two-part mechanism:

1. **Top-N + "Pozostałe".** Render the N largest categories individually and collapse the remainder into a single neutral-grey `Pozostałe` slice, labelled with how many categories it contains (`Pozostałe (7)`). Clicking it expands the tail. This is Monarch's approach and the one the Firefly Sankey tool uses via a threshold. Suggested N ≈ 8, or dynamically "categories above 2% of total", whichever yields fewer slices.
2. **A donut ↔ ranking toggle.** The donut answers _share_; the horizontal bar chart answers _rank and amount_ and — unlike a pie — degrades gracefully to any number of categories, because it simply gets taller and scrolls. When a user has 30 categories, the toggle is the escape hatch. Monarch ships exactly this pairing (Breakdown: donut _or_ horizontal bar).

The donut should carry the period total in its centre. The ranking should carry amount **and** % of total per row.

**B3 — Kategorie w czasie.** Stacked bars, one per A1 bucket, showing the category mix drifting. Top-N + "Pozostałe" applies here too, and the N should be computed **once over the whole range**, not per bucket, or the colours will not mean the same thing from one bar to the next. Reuses A1's bucketing logic wholesale.

**B4 — Zmiana wg kategorii.** Diverging horizontal bars around a zero line: which categories grew, which shrank, versus the previous equal-length period. Marked **Later** because it is the only Board B chart with no FR backing it — it is the "lifestyle creep" report YNAB markets on, and genuinely useful, but S-05 does not promise it.

### Board C — Rytm

**Beyond current roadmap scope.** No slice owns these today; §5 asks where they belong. (Note S-06 is already taken by `receipt-parsing` — a Board C slice would be new.)

| #      | Chart                                  | Form                                                | Aggregate needed                      | Scope             |
| ------ | -------------------------------------- | --------------------------------------------------- | ------------------------------------- | ----------------- |
| **C1** | Kalendarz-heatmapa dziennych wydatków  | Month grid, colour intensity — **no chart library** | `GROUP BY occurred_on` for one month  | **Later (cheap)** |
| **C3** | Skumulowany bilans                     | Running-total line                                  | A1's buckets, netted                  | **Later**         |
| **C4** | Sankey: przychody → kategorie wydatków | Flow diagram                                        | Two `GROUP BY category_id` aggregates | **Later**         |

**C1 — Kalendarz-heatmapa.** The highest value-per-effort item on the whole list, and the one most aligned with PaperTrail's product shape. `src/components/entries/MonthCalendar.tsx` already renders a Monday-first 7-column month grid with month arrows, already fetches per-month data from `/api/entries/days`, and already marks days by a boolean. Extending "has entries / doesn't" to "spent this much" is a colour-intensity pass over an existing grid plus a wider endpoint response. `date-utils.ts` supplies `POLISH_WEEKDAY_LABELS`, `daysInMonth`, `firstWeekdayOfMonth` and `formatMonthLabel`.

Requires **no charting library**, which matters: it means C1 does not have to wait for the library decision or for S-04, and it can also serve double duty in the existing day-entry flow (see a heavy day, tap it, land on that day's entries — the drill-down interaction YNAB and Monarch have, for free).

Colour scale must be sequential and single-hue, not the categorical palette. Keep the existing "missing day" marker distinguishable from "zero spent" — they are different facts, and `/api/entries/days` already computes missing days deliberately.

**C3 — Skumulowany bilans.** A running total of income − expense over the range. **This is a cumulative flow, not a balance**, and must be labelled as such — it does not represent money held anywhere, only what has been recorded since the range started. Given a user who starts on day one with no opening balance, it does trend the same way a net-worth line would, which makes mislabelling it tempting and wrong.

**C4 — Sankey.** Income sources → categories → expense categories, Monarch's most-praised report. Two structural cautions:

1. The PRD notes explicitly that **v1 starts empty** ("quick-select date ranges have little to range over in the first weeks"). A Sankey needs a full period of _both_ income and expense entries to say anything; on sparse data it is an empty box.
2. PaperTrail's income categories and expense categories are disjoint sets (`categories.kind`), and there is no intermediate "budget" or "account" layer, so the diagram is a simple two-column flow: income categories → a single "Środki" node → expense categories. That is thinner than Monarch's, and it should be built only once there is data to justify it.

Apply the same long-tail collapse as B1 — the Firefly tool's `[OTHER CATEGORIES]` threshold exists for exactly this reason.

**Deliberately not proposed:** _Wydatki wg dnia tygodnia_ (average spend Pon–Nie). Offered, not selected. Cheap and complementary to C1 — worth revisiting if C1 lands and weekday patterns turn out to be what people actually read out of it.

### 2.4 Cross-cutting controls

All three boards share one control bar, following YNAB/Actual/Monarch:

- **Range preset picker** (FR-013): last 7 days, last 30 days, this month, last month, last 3 months, year to date, all time. Custom ranges are **FR-016, explicitly parked** as nice-to-have.
- **"Ukryj duże koszty cykliczne"** toggle (FR-015), applying to _every_ chart on the page — the FR says "from any view". The roadmap flags the default as an open question; see §5.
- Nothing else. No account filter (single account), no merchant filter (no merchant field), no tag filter (no tags).

---

## 3. Library analysis

### 3.1 What the chosen chart set actually demands

| Primitive                     | Charts | Notes                              |
| ----------------------------- | ------ | ---------------------------------- |
| Grouped/stacked vertical bars | A1, B3 | ≤52 buckets, 2–9 series            |
| Horizontal bars, sorted       | B2     | Up to ~30 rows, scrolls            |
| Diverging horizontal bars (±) | B4     | Needs a zero reference line        |
| Line, multi-series            | A3, C3 | ≤52 points per line                |
| Donut with centre label       | B1     | ≤9 slices after collapse           |
| Sankey                        | C4     | The only exotic form               |
| _None_                        | A2, C1 | Stat tiles; existing calendar grid |

**Worst-case data volume: ~365 daily buckets and ≤30 categories.** This single fact decides much of the comparison — the canvas-rendering performance advantage that ECharts and Chart.js are sold on buys nothing here. Recharts' documented SVG jank threshold (~1,000 points) is never approached.

### 3.2 Three repo facts that constrain the choice

1. **The Recharts runway is already laid.** `src/styles/global.css` defines `--chart-1`…`--chart-5` in oklch for `:root` and `.dark`, plus `--color-chart-1..5` in the `@theme inline` block. `components.json` is configured (new-york, neutral, cssVariables, lucide, `@/components/ui`). These are shadcn's chart conventions, already present.
2. **Two colour systems must coexist.** Series colours come from the `--chart-*` CSS variables (theme-aware); category colours come from 12 raw hex values chosen by the user. An SVG library lets both be ordinary `fill` attributes. A canvas library forces both through JavaScript.
3. **Everything runs on `workerd`, never Node.** Per `CLAUDE.md`, no native modules; `astro dev` runs on the Workers runtime. Charts are client-only islands regardless, but this specifically neutralises one library's best differentiator (§3.4).

Plus one lint fact: **`eslint-plugin-jsx-a11y` runs as errors**, alongside `strictTypeChecked` and `react-compiler`.

### 3.3 Recommendation — Recharts, via `npx shadcn@latest add chart`

Covers **seven of the eight** library-backed charts idiomatically (`BarChart` with `layout="vertical"` for B2/B4, `LineChart` for A3/C3, `PieChart` with `innerRadius` for B1, `Sankey` for C4).

| Why                        | Detail                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matches the codebase       | Declarative React components; every island in `src/components/` is written this way                                                                         |
| Theming works for free     | SVG → `fill="var(--color-expense)"` and `fill={category.color}` are both just CSS. Dark mode comes from `global.css` with no chart-side code                |
| Integration is one command | `components.json` already configured; the wrapper will match `ui/button.tsx`, `input.tsx`, `checkbox.tsx`                                                   |
| Accessibility              | v3 enables `accessibilityLayer` **by default** — ARIA roles plus arrow-key navigation between data points. Material given jsx-a11y-as-errors                |
| Size                       | ~50 KB gzipped, tree-shakeable (`sideEffects: false`, ESM output). React runtime is already paid for — `dashboard.astro` ships a `client:load` island today |
| Coverage                   | `Sankey`, `Treemap`, `ComposedChart`, `Brush`, `SunburstChart`, `RadialBarChart` all exported                                                               |
| Ecosystem                  | ~3.6M weekly downloads, the most-used React-specific charting library; largest pool of answers for the exact React+shadcn combination                       |

**Two caveats, recorded honestly:**

**(a) The Sankey is Recharts' weak spot.** `Sankey` takes a bare `{nodes: [], links: [{source, target, value}]}` structure with a minimal styling surface; anything polished means writing custom node and link renderers. ECharts' and Nivo's Sankeys are markedly better out of the box.

This is _not_ a reason to reject Recharts, because **Astro islands are separately-bundled chunks**. Building A1/A3/B1–B4/C3 in Recharts now and revisiting C4 later costs nothing: a second library confined to one `client:visible` island adds bytes only to that island, on a page the user may never scroll to. C4 is marked **Later** for independent reasons (§2.3), so the decision does not need making yet.

**(b) The wrapper is the real risk, not the library.** shadcn's `chart.tsx` churned repeatedly against Recharts 3.x typings — issues [#7669](https://github.com/shadcn-ui/ui/issues/7669) and [#9892](https://github.com/shadcn-ui/ui/issues/9892), PRs [#8486](https://github.com/shadcn-ui/ui/pull/8486) and #10147. `payload` disappearing from the tooltip props type, and the `NameType`/`ValueType` imports moving out of `recharts/types/component/DefaultTooltipContent` toward a top-level `TooltipValueType`, both broke builds. Under `strictTypeChecked` this will surface immediately.

Mitigation: **pin the Recharts version** rather than carrying a caret range, and budget for one hand-patch of `chart.tsx`'s tooltip typings. Also expect the `ResponsiveContainer` width/height warning documented in #8486 — since Recharts 3.3 the responsive container is built into the charts, and the `min-h-[…] w-full` class on `ChartContainer` is what actually makes it size correctly.

**Not needed:** the `"overrides": { "react-is": "…" }` workaround that dominates older search results. That was the React 19 **RC** era; `react-is` peer deps were fixed in Recharts 2.15, and this repo is on stable React 19.2.6.

### 3.4 Alternatives considered

#### Apache ECharts (`echarts` + `echarts-for-react`)

**Benefits.** The widest coverage of the four by a distance: native Sankey (far better than Recharts'), treemap with built-in drill-down and breadcrumbs, and a **built-in `calendar` coordinate system** that would deliver C1 as a first-class chart. Its `dataZoom` component (wheel zoom + range slider) would hand you **parked FR-016's custom date range for free**, which is a genuine, concrete win no other option offers. Accessibility is real: ARIA descriptions auto-generated from the chart config, plus **decal patterns** as a secondary encoding for colourblind users — the best colourblind story of the four. Canvas/WebGL rendering scales to millions of points. Apache-licensed, 64k stars, very active.

**Drawbacks.**

- **The API fights the codebase.** Everything is an imperative `setOption` configuration object driven from a `useEffect`, with manual `init`/`dispose` lifecycle. Nothing in `src/components/` looks like this, and `react-compiler` runs as an error here — imperative refs into a third-party instance are exactly the pattern that invites friction.
- **Canvas severs it from Tailwind.** CSS variables cannot reach canvas pixels. You would read computed styles in JS or hand-maintain a light/dark theme object, and re-initialise or re-`setOption` every chart on theme change. Given that this project has _two_ colour systems to feed (§3.2), that is the single biggest cost.
- ~80–130 KB gzipped à la carte, more with the full build.
- **Its best differentiator is unusable here.** ECharts has genuine server-side SVG rendering — which would be a real advantage for an SSR-first Astro app — but it requires Node APIs, and this app runs on `workerd`. On Cloudflare it degrades to the same client-only island as everything else.
- No shadcn integration; tooltips and legends won't match the existing glass UI without custom work.

**Verdict:** the right choice if data volumes were 10k+ points, or if `dataZoom` were needed to deliver FR-016 now. Neither is true. You would pay a substantial integration and theming tax for capabilities the data doesn't require.

#### Nivo (`@nivo/core` + per-chart packages)

**Benefits.** The closest call. Best out-of-the-box accessibility of the four among mainstream React libraries. Ships **`@nivo/calendar`** and **`@nivo/sankey`** natively, which would absorb both of Board C's awkward charts (C1 and C4) cleanly — the two charts Recharts handles worst. SVG by default with a Canvas variant behind the same API for larger data. `@react-spring` transitions are the most polished of the four.

**Drawbacks.**

- **Its theming fights Tailwind.** Nivo carries its own JavaScript `theme` object (text fill, tooltip container, grid stroke, axis styling). Chart colours and dark-mode variants would live in a second place, disconnected from `global.css`, re-derived by hand — the exact problem the `--chart-*` variables already in the repo exist to prevent.
- ~82 KB gzipped, and one npm package per chart type (`@nivo/bar`, `@nivo/pie`, `@nivo/line`, `@nivo/calendar`, `@nivo/sankey`) — five packages for this chart set.
- Slower release cadence than Recharts; 13.6k stars vs 27k, ~450k weekly downloads vs 3.6M, so a meaningfully smaller pool of answers for the Astro/shadcn/React 19 combination.
- No shadcn integration.

**Verdict:** the deciding factor is that **C1 needs no library at all** (the month grid already exists) and **C4 is deferred**. Nivo's two headline advantages for this project therefore evaporate, while its theming cost stays and applies to all seven remaining charts. It would win if C1 and C4 were first-slice must-haves and Tailwind-token theming were negotiable.

#### Chart.js + react-chartjs-2

**Benefits.** The simplest API of the four and the shallowest learning curve. Largest total volume of community documentation and Q&A of any charting library. ~66 KB gzipped, less with selective component registration. Canvas performance handles millions of points. `react-chartjs-2` is a thin, stable wrapper.

**Drawbacks.** Loses on all three axes that matter for this repo:

- **Canvas kills CSS-variable theming**, identically to ECharts, with the same two-colour-system consequence.
- **Sankey, treemap and calendar-matrix all require separately-maintained third-party plugins** (`chartjs-chart-sankey`, `chartjs-chart-treemap`, `chartjs-chart-matrix`). The size advantage evaporates the moment C4 lands, and each plugin is an independent maintenance and React-19-compatibility risk.
- **Weakest accessibility of the four.** Canvas is opaque to screen readers; there is no keyboard navigation between data points and no ARIA generation. Against a repo running `eslint-plugin-jsx-a11y` as errors, this is the wrong direction — and unlike lint, it is not something the linter will catch, since it's invisible at the JSX level.
- The thin React wrapper means chart instance/ref lifecycle management lands on you.

**Verdict:** would win if the chart set were three simple cartesian charts and nothing more. At ten charts including a donut and a Sankey, its simplicity advantage inverts.

#### Also considered, briefly

- **visx (Airbnb)** — thin D3 primitives, excellent TypeScript, maximum control, ~30–50 KB. But you build axes, tooltips, legends and responsiveness yourself. Wrong trade for a solo project that wants eight charts working quickly; slow release cadence.
- **TradingView Lightweight Charts** — smallest (~12 KB gzip) and best-in-class, but purpose-built for financial time series and candlesticks. No donut, no treemap, no Sankey. Not applicable.
- **Victory** — its main selling point is React Native compatibility, which is irrelevant here.

### 3.5 Head-to-head

|                            | Recharts                            | ECharts                   | Nivo                 | Chart.js              |
| -------------------------- | ----------------------------------- | ------------------------- | -------------------- | --------------------- |
| Rendering                  | SVG                                 | Canvas/WebGL              | SVG + Canvas         | Canvas                |
| Bundle (gzip)              | ~50 KB                              | ~80–130 KB                | ~82 KB               | ~66 KB                |
| API style                  | Declarative React                   | Imperative config         | Declarative React    | Config + thin wrapper |
| Tailwind / CSS-var theming | **Native**                          | No (JS theme object)      | No (JS theme object) | No (JS options)       |
| Per-category hex colours   | Trivial (`fill`)                    | Via `itemStyle`           | Via `colors` fn      | Via `backgroundColor` |
| shadcn integration         | **Yes, official**                   | No                        | No                   | No                    |
| a11y                       | Keyboard nav, ARIA (v3 default)     | ARIA + colourblind decals | **Best**             | **Weakest**           |
| Sankey                     | Bare                                | **Excellent**             | Good                 | Plugin                |
| Calendar heatmap           | No (not needed — C1 is hand-rolled) | **Built-in**              | **Built-in**         | Plugin                |
| Handles this data volume   | Yes                                 | Yes                       | Yes                  | Yes                   |
| Weekly downloads           | 3.6M                                | 800k                      | 450k                 | 2.5M (wrapper)        |
| Main risk here             | shadcn `chart.tsx` typing churn     | Integration + theming tax | Theming duplication  | a11y + plugin sprawl  |

**Decision: Recharts**, pinned, installed via `npx shadcn@latest add chart`. Revisit only for C4, and only if C4 is actually built.

---

## 4. Implementation prerequisites

None of this exists yet. A future S-04/S-05 plan has to close these gaps.

**1. There is no range or aggregate API.**
`GET /api/entries` (`src/pages/api/entries/index.ts`) **requires `?date=YYYY-MM-DD`** and returns one day's rows. The only existing range query in the codebase is `listEntryDaysForMonth` in `src/lib/services/entries.ts`, which returns bare date strings for the calendar's missing-day markers. **No endpoint accepts a date range, and none returns aggregates.** A new endpoint is required, roughly:

```
GET /api/entries/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|week|month&excludeRecurring=true
```

with the aggregation living in `src/lib/services/` alongside the existing services, per the conventions in `entries.ts`.

**2. `Entry.category` cannot express FR-015.**
`src/types.ts` declares `category: Pick<Category, "id" | "name" | "color">` — **`isRecurring` is not carried**. The recurring-cost filter therefore cannot be applied against the current DTO client-side. Either widen the `Pick`, or (better) define a separate aggregate DTO, since the chart endpoints return sums rather than entries anyway.

**3. Aggregate in SQL, not in JavaScript.**
`src/components/entries/DayEntriesList.tsx:29-34` carries an explicit forward-flag from S-02's review:

> PostgREST hands back `numeric(10,2)` as a JS number, so these totals inherit binary-float rounding. Acceptable here because the sum is bounded to one day's rows; **the real fix (aggregate in SQL, or carry integer minor units) belongs with S-04/S-05's aggregation work.**

Range aggregates are precisely the case that flag was reserved for. Summing hundreds of rows in JS floats and displaying the result to two decimals will drift. Sum in Postgres (where `numeric` is exact) and return the aggregate, which also avoids shipping raw entry rows to the client for every chart.

**4. `entries.category_id` has no index.**
Existing indexes are `entries_user_id_occurred_on_idx (user_id, occurred_on)` — which serves the date-range filter well — and `entries_user_id_type_created_at_idx`. B1/B2/B3/B4 all `GROUP BY category_id`; measure before adding an index, but expect to want one.

**5. RLS still applies, and ownership is not enforced by the FK.**
Any new aggregate query must run through the RLS-scoped client, exactly as the existing services do. The `entries` migration documents that the `category_id` foreign key checks existence but **not ownership** (FK checks bypass RLS), which is why `assertCategoryUsable` exists in `entries.ts`. Aggregates read only through RLS-filtered selects, so this is a non-issue for reads — but do not be tempted into a `security definer` function without re-establishing the `user_id` predicate.

**6. UI copy is Polish; there is no currency formatter.**
Every product string written by S-01/S-02/S-03 is Polish — `"Duży koszt cykliczny"`, `"Wydatki"` / `"Przychody"`, `POLISH_MONTH_NAMES`, `POLISH_WEEKDAY_LABELS`. Chart labels, legends, tooltips and axis ticks follow suit. Note that **no `Intl.NumberFormat` exists anywhere in the repo** — `formatAmount` in `DayEntriesList.tsx` is `n.toFixed(2)` with no currency symbol and no thousands separator. Charts want a shared formatter (`pl-PL`, PLN, and a compact variant for axis ticks); introducing one is a small cross-cutting change that should be done deliberately rather than per-chart.

**7. Astro integration.**
Chart islands should be `client:visible`, not the `client:load` used by `DayView` — they sit below the fold, and `client:visible` defers both the chart chunk and (if it hydrates first) the React runtime until the user scrolls. Consider `rootMargin` so the fetch starts slightly early. Pass server-fetched aggregates down as props rather than fetching from inside the island where the page already has the data. **Recharts is client-only — do not attempt to server-render it.** No native modules are involved, so no `workerd` constraint is violated.

**8. `Cache-Control: private, no-store`.**
`src/middleware.ts` already sets this for authenticated requests. Any new chart page or API route inherits it — do not add caching headers to aggregate endpoints. This is one of the two silent paths to breaking per-user isolation (see `CLAUDE.md`).

---

## 5. Open questions

**5.1 Does the recurring-cost filter default to on or off?**
The roadmap assigns this to the user and marks it non-blocking. The PRD's Socratic note records that defaulting exclusion _on_ was challenged and FR-015 stands as written — _"the user gets both views on demand"_ — but that settles the mechanism, not the default.

Recommendation, not a decision: **default off, and make the toggle prominent.** The PRD's stated pain is that existing tools _"bury this option"_; defaulting on trades a buried option for a hidden one, where totals silently disagree with what the user believes they spent. Off-by-default with a visible, sticky toggle exposes the mechanism rather than pre-applying it. Consider persisting the choice per user once it is exercised.

**5.2 What is the readability strategy at high category counts?**
Proposed answer (§2.2): **top-N + "Pozostałe"** with an **expandable tail**, plus a **donut ↔ horizontal-ranking toggle** as the escape hatch. Needs confirmation, along with N (suggested: 8, or "above 2% of total", whichever gives fewer slices).

**5.3 Does Board C become its own slice, or fold into S-04/S-05?**
(S-06 is already `receipt-parsing`, so a Board C slice would take a new number.)
C1 in particular is unusual: it needs no charting library, extends an existing component, and could ship independently of — even before — the library decision. It may not belong in a "charts" slice at all.

**5.4 Should the bucket granularity be user-controllable?**
§2.1 proposes deriving it from range length to keep FR-013 to a single control. Monarch exposes it explicitly (Daily/Weekly/Monthly/Quarterly/Yearly). Deriving it is simpler and matches PaperTrail's low-friction posture; exposing it is more powerful. Recommend deriving it for MVP.

**5.5 Where do the charts live?**
A new `/reports` (or `/podsumowanie`) page, or additional sections on `dashboard.astro`? The dashboard is currently a single `client:load` `DayView` island focused on today's entry — the PRD's binding constraint is _entry friction_, and charts below the entry form could dilute that. A separate route keeps the entry path clean. **New protected routes must be added to `PROTECTED_ROUTES` in `src/middleware.ts`** (prefix-matched via `startsWith`).

---

## 6. Sources

Market research conducted via Exa, August 2026.

- YNAB — [Budget Reports blog](https://www.ynab.com/blog/ynab-reports-and-data), [Income v Expense help](https://support.ynab.com/en_us/income-v-expense-Byu1BYWRq)
- Actual Budget — [Reports Dashboard](https://actualbudget.org/docs/reports/), [Custom Reports](https://actualbudget.org/docs/reports/custom-reports/)
- Monarch Money — [Using Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports), [Cash Flow](https://help.monarch.com/hc/en-us/articles/20504904768020-Cash-Flow)
- Firefly III — [How to read reports](https://docs.firefly-iii.org/how-to/firefly-iii/finances/reports/), [`firefly-iii-sankey`](https://registry.npmjs.org/firefly-iii-sankey)
- Lightweight cohort — [Flowly](https://flowlybudget.com/), [Eira](https://www.eira.co/), [Fourmio calendar](https://fourmio.com/en/features/calendar/), [Spendaily](https://www.spendaily.com/features)
- Library comparison — [Gerald Chen, _Choosing a React Chart Library_](https://chenguangliang.com/en/posts/blog152_react-chart-libraries-comparison/) (Apr 2026), [Recharts accessibility wiki](https://github.com/recharts/recharts/wiki/Recharts-and-accessibility), [ECharts SSR handbook](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/), [ECharts ARIA](https://echarts.apache.org/handbook/en/best-practices/aria/)
- Recharts v3 / shadcn friction — shadcn-ui/ui [#7669](https://github.com/shadcn-ui/ui/issues/7669), [#9892](https://github.com/shadcn-ui/ui/issues/9892), [PR #8486](https://github.com/shadcn-ui/ui/pull/8486); recharts [#4558](https://github.com/recharts/recharts/issues/4558)
- Astro — [Islands architecture](https://docs.astro.build/en/concepts/islands/), [@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- shadcn chart API verified against current docs via Context7 (`/websites/ui_shadcn`); Recharts exports verified via Context7 (`/recharts/recharts`).
