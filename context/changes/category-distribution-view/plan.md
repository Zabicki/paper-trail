# Category Distribution View (S-05) Implementation Plan

## Overview

Deliver roadmap slice **S-05**: a **Kategorie** board on `/reports` showing how expenses distribute across the user's own categories (FR-014), honouring the recurring-cost filter (FR-015), and staying readable regardless of how many categories are defined. This is Board B from `context/foundation/charts_recommendations.md`.

The slice adds a second aggregation primitive — the same shape as S-04's, with `category_id` as a second grouping dimension — and one genuinely new client concept: a **distribution model** that decides, once per range, which categories are rendered individually, which collapse into `Pozostałe`, and what colour each one gets. All three charts read that single model, which is what makes their colours mean the same thing.

## Current State Analysis

**S-04 shipped a complete, verified `/reports` page and this slice extends it in place.** What exists:

- `public.entries_summary(p_from, p_to, p_bucket, p_exclude_recurring)` — `stable security invoker`, `set search_path = ''`, no `user_id` predicate in the body (isolation is inherited RLS), no `deleted_at` filter on the `categories` join, `grouping sets` for exact grand totals, execute revoked from `public, anon` and granted to `authenticated` (`supabase/migrations/20260816103000_add_entries_summary_function.sql:36-66`). **It groups only by `(date_trunc(bucket), type)` — `category_id` appears nowhere in the grouping or the return type.**
- `src/lib/services/reports.ts` — `summaryQuerySchema` (`:10-17`), `MAX_BUCKETS = 400` and `RangeTooLargeError` (`:26-33`), `previousRange` (`:84`), `getEntriesSummary` (`:165`) issuing two parallel `rpc()` calls.
- `src/pages/api/entries/summary.ts` — the route preamble every data route uses: `createClient` → 500 if null → `getUser()` → 401 → *then* zod validation.
- `src/components/reports/ReportsView.tsx` — one `client:load` island, no props, `ViewState { preset, recurringHidden }` derived from `window.location.search`, `pushState` on change, a `popstate` listener, a `cancelled` closure guard on the fetch, and a strict error → loading → empty → content branch order with the sticky control bar rendered outside all four branches.
- `src/components/reports/range.ts` — `RANGE_PRESETS`, `resolveRange`, `bucketFor` (≤30d day, ≤92d week, else month), `enumerateBuckets`, `formatBucketLabel`, `inclusiveDayCount`.
- `src/lib/format.ts` — `formatCurrency`, `formatCurrencyCompact`, `formatPercentDelta`.
- `src/components/ui/chart.tsx` — shadcn's wrapper, hand-patched in six places, pinned to `recharts@3.10.1` exactly.

**What is missing or newly relevant:**

**No per-category aggregate exists.** PostgREST could express `GROUP BY category_id` on its own, but B3 needs `date_trunc(bucket) × category_id` — a grouping *expression* PostgREST cannot produce, the same constraint that forced S-04 into a SQL function.

**The colour system can collide with itself.** `CATEGORY_COLORS` (`src/types.ts:1-14`) is 12 fixed hexes mirrored by a DB CHECK, with no uniqueness constraint per user. A user with 30 categories necessarily repeats colours. Separately, `DEFAULT_CATEGORY_COLOR` is `#64748b` (Szary) — exactly the neutral grey the research proposes for the `Pozostałe` slice.

**`p_exclude_recurring` is type-blind.** It drops any entry whose category is `is_recurring`, income included. This board reads expenses only, so the asymmetry does not surface here, but the function this slice writes inherits the same semantics deliberately.

**Two S-04 findings carry forward:**

1. **F10** — the inner `join public.categories` is RLS-scoped, so an entry filed under another user's category silently disappears from the aggregate. On Board A that was a slightly-low bucket; here it is a **missing slice**, and the range total would disagree with Board A's `Wydatki` tile. The service-layer `assertCategoryUsable` check is what holds this closed.
2. **F4** — `pad`, `addDays` and `inclusiveDayCount` exist in two copies (`src/lib/services/reports.ts:46-78` and `src/components/reports/range.ts:11-25`), joined only by cross-reference comments. This slice must not create a third.

**`entries.category_id` is unindexed** and S-04's plan explicitly deferred that question to this slice (`context/archive/2026-08-16-date-range-spending-view/plan.md:534`).

**Demo data is thin for this slice.** `20260816120000_seed_demo_account.sql` seeds 10 categories over `2026-05-16 .. 2026-08-16`. Ten categories never exercise the top-N collapse meaningfully and never produce a colour duplicate.

## Desired End State

A signed-in user on `/reports` sees a **Przegląd | Kategorie** switch in the sticky control bar. Selecting **Kategorie** keeps the current range preset and recurring toggle and shows, for expenses in that range:

- a **donut** with the range total in its centre, the largest categories as individually-coloured arcs and the long tail as one `Pozostałe (n)` arc;
- a **ranking** directly beneath it — every visible category as a row with a colour swatch, name, proportional bar, amount and % of total, with `Pozostałe (n)` as the last row, expandable in place to reveal the tail;
- a **stacked bar chart** of the same categories over the range's auto-derived buckets, using the identical category set and colours.

All three URL params are live: `/reports?board=categories&range=ytd&recurring=hidden` restores exactly that view, and the back button steps through board changes as it already does through range changes.

**Verification that the end state is reached:** `npx supabase test db` passes with four test files; `npm run lint`, `npx astro check` and `npm run build` are clean; and on the extended demo account — ~30 categories including deliberate colour duplicates and a long sub-1% tail — the donut renders at most nine arcs, no two visible arcs share a fill, and the ranking is legible on a narrow viewport.

### Key Discoveries:

- **`Cell` is not the current way to colour slices.** Recharts 3.x documents the `shape` prop as "the recommended replacement for Cell", but the cheapest correct route here is a **`fill` field on each datum**: Recharts' legend/colour resolution falls back to `entry.fill`, and shadcn's hand-patched `fillOf(payload)` (`src/components/ui/chart.tsx:24-30`) already reads `item.payload.fill`, so tooltips get the right swatch with no extra wiring.
- **`accessibilityLayer` reaches `PieChart`** — `PieChart` and `BarChart` share the `CategoricalChart` shell, which sets `role="application"` and `tabIndex={0}`. But arrow-key *data* navigation is a cartesian affordance; for the donut the ranking list is the real text-equivalent, not a nicety.
- **`ChartConfig` entries must carry `label` only, never `color`.** Declaring `color: "var(--color-expense)"` makes shadcn's `ChartStyle` emit the self-referential `--color-expense: var(--color-expense)` (documented at `src/styles/global.css:112-126`). Category colours therefore travel on the data, not in the config.
- **Postgres `grouping sets` can produce the range grand total too.** Adding an empty grouping set `()` yields a row with both `bucket_start` and `category_id` null. Without it, the denominator for every percentage would be a JavaScript sum of per-category floats — reintroducing exactly the drift S-02's F4 sent to this work.
- `listEntryDaysForMonth` (`src/lib/services/entries.ts:216`) already hardcodes `.eq("type", "expense")` as a product rule. There is repo precedent for baking expense-only into a query rather than parameterising it.
- Only `button`, `input`, `label`, `checkbox` and `chart` are installed from shadcn. No `tabs` — the board switcher is hand-rolled like `RangePicker`.

## What We're NOT Doing

- **B4 — Zmiana wg kategorii vs poprzedni okres.** `charts_analysis.md:186` marks it Later because no FR backs it. No previous-period data is fetched for this board at all.
- **Board C** — no calendar heatmap, no cumulative net flow, no Sankey.
- **Income distribution.** The board is expense-only. Income categories appear nowhere in it, and no expense/income switch is built.
- **Per-category drill-down.** Clicking a category does not filter the board or navigate to its entries. Only `Pozostałe` is interactive. S-04 already listed drill-down as out of scope and nothing has made it cheaper.
- **An index on `entries.category_id`.** Phase 1 measures rather than assumes; see Performance Considerations.
- **Any change to `Entry`, `Category`, or the `entries_summary` function.** The new aggregate is additive; Board A's data path is untouched.
- **Persisting the board choice** across visits. Like the recurring toggle, it resets to `Przegląd` on every fresh load.
- **A uniqueness constraint on category colour**, and no change to the `/categories` UI. The collision is resolved at render time only.
- **Installing a test framework**, or `shadcn add tabs`.

## Implementation Approach

Bottom-up, mirroring S-04 so each phase is independently verifiable.

The aggregate goes first because it is the only piece whose failure mode is silent, and it is written as a near-copy of `entries_summary` — `stable security invoker`, `set search_path = ''`, no `user_id` predicate, no `deleted_at` filter — so the isolation guarantee rests on the same RLS policies pgTAP has already proven twice, and pgTAP can reach it from raw SQL.

The demo-account extension rides in the same phase because it is the same kind of artifact (a migration verified by `db reset`) and because every later phase's manual verification depends on data that does not exist yet.

Phase 3 deliberately ships a **complete FR-014 answer with no new chart primitives**: the board switcher, the distribution model, and the ranking list — which is the form that actually degrades gracefully to 30 categories. If the donut turns out worse than budgeted, the readability requirement is already satisfied and shippable. This is the same hedge S-04 used by shipping KPI tiles before Recharts.

## Critical Implementation Details

**The distribution model is computed once, over the whole range, and shared by all three charts.** Top-N selection and colour resolution both run against the per-category grand totals, never per bucket. `charts_analysis.md:184` states the consequence directly: compute per bucket and the colours stop meaning the same thing from one bar to the next.

**Colour resolution runs over the full sorted list, not the visible subset.** The chosen rule is "first occurrence keeps its colour, later duplicates shift" — and the ordering that determines *first* must include collapsed categories. Otherwise expanding `Pozostałe` recolours arcs that were already on screen, which is a visible flicker at the exact moment the user is trying to read the tail.

**This slice restructures `ReportsView.tsx`, which is shipped and verified code.** Board A's fetch and render move into their own component so each board owns its own data. That re-exposes every S-04 Phase 4/5 manual criterion to regression, and they are re-listed in Phase 3's verification for that reason.

**Percentages need a guarded denominator.** The range total comes from the `()` grouping-set row and is exact, but it is `0` when the recurring filter removes everything in range — and the board must render the empty state rather than divide.

## Phase 1: Per-category aggregation primitive and demo data

### Overview

Add the second aggregation function, prove it by test, and extend the demo account so the readability requirement is actually observable.

### Changes Required:

#### 1. Category summary function

**File**: `supabase/migrations/20260816150000_add_entries_category_summary_function.sql`

**Intent**: The per-category aggregate serving all three Board B charts in one round trip — bucketed rows for B3, per-category grand totals for B1/B2, and a range grand total so no percentage denominator is ever a JavaScript sum.

**Contract**: `public.entries_category_summary(p_from date, p_to date, p_bucket text, p_exclude_recurring boolean default false)` returning `table (bucket_start date, category_id bigint, category_name text, category_color text, total numeric)`. Declared `language sql`, `stable`, `security invoker`, `set search_path = ''` — copy `entries_summary`'s declaration block verbatim, including its header comment explaining why `security invoker` (RLS must keep applying; a `security definer` variant would need the `user_id` predicate re-established by hand as an unprovable duplicate) and why `deleted_at` is deliberately absent from the join.

Three grouping sets are the non-obvious part, and the empty one is what keeps the denominator exact:

```sql
group by grouping sets (
  ((date_trunc(p_bucket, e.occurred_on::timestamp))::date, c.id, c.name, c.color),
  (c.id, c.name, c.color),
  ()
);
```

Row interpretation: `bucket_start` non-null → a B3 cell; `bucket_start` null with `category_id` non-null → that category's range total; both null → the range grand total.

The `where` clause adds `e.type = 'expense'` to `entries_summary`'s predicates. **Hardcode it and say why in the header comment** — the board is expense-only by decision, and `listEntryDaysForMonth` (`src/lib/services/entries.ts:216`) sets the precedent for a product rule living in the query rather than a parameter.

Grants follow the same explicit form as `entries_summary`: `revoke execute … from public, anon` then `grant execute … to authenticated`.

#### 2. pgTAP coverage

**File**: `supabase/tests/entries_category_summary_test.sql`

**Intent**: Prove the properties raw SQL can reach, following `entries_summary_test.sql`'s envelope, 2027-dated fixtures and impersonation conventions exactly.

**Contract**: `begin; select plan(N); … select * from finish(); rollback;`. Seed fixtures for both seed users as superuser before the first `set local role authenticated`, covering: two categories sharing one colour, one recurring-flagged category, one soft-deleted category with entries, at least one income entry, and entries spanning day/week/month bucket boundaries. Assertions:

- user A's call returns only A's categories; user B's identical call returns only B's
- `anon` cannot execute — assert against the privilege catalog rather than by calling, per `entries_summary_test.sql:225-239`: the local Postgres image segfaults on a function EXECUTE denial raised inside a `set local role` transaction
- the `()` row equals the sum of the per-category grand-total rows, which in turn equal the sum of their bucket rows
- income entries are absent from every row
- `p_exclude_recurring => true` drops exactly the recurring category and nothing else
- an entry under a soft-deleted category is still counted, and still reports that category's name and colour
- week buckets align Monday-first

Scope post-`reset role` assertions by `user_id in ('1111…','2222…')`, per `categories_rls_test.sql:128-134`.

**What pgTAP cannot prove here**, per `context/foundation/lessons.md`: the entire top-N rule, colour resolution, percentage arithmetic, and every UI behaviour. Named again in Testing Strategy as permanent manual-only criteria.

#### 3. Demo account extension

**File**: `supabase/migrations/20260816151000_extend_demo_categories.sql`

**Intent**: Make FR-014's acceptance criterion reproducible. Ten categories never trigger the collapse and never produce a colour duplicate, so the readability guarantee would otherwise be verified only by hand-built data that the next contributor cannot recreate.

**Contract**: Extend `demo@papertrail.app` (`33333333-…`) to roughly 30 expense categories with entries in the existing `2026-05-16 .. 2026-08-16` window, using the same deterministic modular-arithmetic generator as `20260816120000_seed_demo_account.sql` (no `random()`). The distribution must exercise the readability case deliberately:

- a clear head of 5-8 categories well above 2% of total
- a long tail of ~15 categories each below 1% of total
- at least three pairs sharing a `color` value, with at least one pair in the head so the shift rule is visible
- at least two tail categories on `#64748b`, so the grey-versus-`Pozostałe` residual is observable

Guard every insert with `where exists (select 1 from auth.users where id = '3333…')` so the migration is inert if the account is absent, and make it re-runnable (`on conflict do nothing` against the unique name index). **Write no rows to `auth.*`** — that is the difference between this migration and the one S-04 findings F1/F3 flagged, and it keeps the deploy path clear of `supabase_auth_admin`-owned schemas.

Carry a header comment recording that this data is pinned to the same absolute window as the original demo migration, and inherits S-04 finding F5: once real time passes 2026-08-16, every preset except `Cały okres` and `Od początku roku` renders empty for this account.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all ten migrations cleanly
- `npx supabase test db` passes with `Files=4` and the raised plan counts
- `npm run lint` passes

#### Manual Verification:

- In Studio, `select * from public.entries_category_summary('2026-06-01','2026-06-30','week')` as superuser returns rows across all users — confirming the function body does not filter and RLS is what isolates
- The same call through PostgREST while signed in returns only that user's categories
- `explain analyze` on a `Cały okres` day-bucketed call shows the `entries` scan served by `entries_user_id_occurred_on_idx`, with grouping done by hash aggregate — the evidence for the no-index decision in Performance Considerations. Record the plan in the phase commit message
- Signing in as the demo account shows ~30 categories on `/categories`, with visible colour duplicates

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 2: Service, DTOs and the category-summary endpoint

### Overview

Wrap the function and expose it, reusing `reports.ts`'s guards and date helpers rather than starting a third copy.

### Changes Required:

#### 1. Aggregate DTOs

**File**: `src/types.ts`

**Intent**: Add the category-aggregate family alongside the existing `SummaryPoint` / `RangeSummary` / `EntriesSummary` group, keeping the same convention that aggregate shapes are separate from `Entry`.

**Contract**: Add, with the same comment density as the existing block:

```ts
export interface CategoryTotal { categoryId: number; name: string; color: CategoryColor; total: number; }
export interface CategoryBucketPoint { bucketStart: string; totals: Record<string, number>; }
export interface CategorySummary {
  bucket: SummaryBucket; from: string; to: string;
  categories: CategoryTotal[];   // range grand totals, descending
  points: CategoryBucketPoint[]; // only non-empty buckets; zero-filling is the caller's job
  total: number;                 // from the () grouping-set row, not a JS sum
}
```

`totals` is keyed by stringified `categoryId` because that is what a Recharts `dataKey` consumes in Phase 5. Record that reason in a comment — it is the only justification for a string-keyed record over a number-keyed one.

#### 2. Category summary service

**File**: `src/lib/services/reports.ts`

**Intent**: Add `getCategorySummary` to the existing module rather than a new one, so `MAX_BUCKETS`, `RangeTooLargeError`, `bucketCountUpperBound` and the date helpers stay single-copy. Creating `category-reports.ts` would produce the third copy F4 warns about.

**Contract**: `export async function getCategorySummary(supabase, input: SummaryQueryInput): Promise<CategorySummary>`. Reuses `summaryQuerySchema` unchanged — the query surface is identical. One `supabase.rpc("entries_category_summary", …)` call (no previous-period range: B4 is out of scope). Apply the `bucketCountUpperBound > MAX_BUCKETS` check before the query, exactly as `getEntriesSummary` does.

Fold the flat rows by the three-way null test on `bucket_start` / `category_id`. `Number(row.total)` normalises PostgREST's numeric-as-string. Sort `categories` by `total` descending, tie-broken by `name` with `localeCompare` so the order — and therefore the colour assignment — is stable across identical loads. Sort `points` by `bucketStart`.

#### 3. Endpoint

**File**: `src/pages/api/entries/category-summary.ts` (new)

**Intent**: Expose the service, following the existing route preamble exactly.

**Contract**: `export const GET: APIRoute`. Query params `from`, `to`, `bucket`, `recurring`. `createClient` null-check → 500, `getUser()` → 401, **then** zod validation — the deliberate ordering from `src/pages/api/entries/categories.ts:27-28`, so an anonymous caller cannot distinguish a malformed query from a missing session. Then the `from <= to` lexicographic check and the `RangeTooLargeError` → 400 mapping, reusing `summary.ts`'s Polish messages verbatim. Returns 200 with the bare `CategorySummary`. Set no cache headers.

No `middleware.ts` change — `/reports` is already in `PROTECTED_ROUTES` and API routes self-guard.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (`strictTypeChecked` — the RPC result is untyped, so the row cast and the three-way fold must type cleanly)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- `GET /api/entries/category-summary?from=2026-06-01&to=2026-06-30&bucket=week` signed in as the demo account returns ~30 entries in `categories`, a `points` array of week buckets, and a `total` equal to the sum of `categories[].total`
- That `total` equals the `Wydatki` KPI tile on Board A for the same range and toggle state — the two aggregates agreeing is the check that F10 is not biting
- `recurring=hidden` removes the recurring categories entirely from `categories` and lowers `total` accordingly
- An entry filed under a soft-deleted category still appears, under that category's name and colour
- Signed out returns 401; `from` later than `to` returns 400 with the Polish message; `bucket=day` over five years returns 400
- Seed user B sees entirely different categories for the same range

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Board switcher, distribution model and ranking (B2)

### Overview

The structural phase. Split the boards, add the switcher, build the model that decides what is rendered and in what colour, and ship the ranking — a complete FR-014 answer with no new chart primitives.

### Changes Required:

#### 1. Distribution model

**File**: `src/components/reports/distribution.ts` (new)

**Intent**: The single place that decides which categories render individually, which collapse, and what colour each one gets. Co-located with the feature per the `range.ts` / `date-utils.ts` precedent.

**Contract**:

- `TOP_N = 8` and `MIN_SHARE = 0.02` as named consts with the rationale in a comment.
- `resolveDistribution(summary: CategorySummary): Distribution` where `Distribution = { visible: DistributionSlice[]; collapsed: DistributionSlice[]; colorFor: (categoryId: number) => string; total: number }` and `DistributionSlice = CategoryTotal & { fill: string; share: number }`.
- **Selection rule**: over `categories` sorted descending, take set A = the first `TOP_N`, and set B = those whose `total / summary.total > MIN_SHARE`; `visible` is whichever set is *smaller*, `collapsed` is the remainder. Guard `summary.total === 0` — that case never reaches here because the board renders its empty state first, but the function must not divide by zero if it does.
- **Colour rule**: walk the **full sorted list** (visible and collapsed together — see Critical Implementation Details), counting occurrences of each hex. The first category on a given hex keeps it byte-identical; the *k*-th duplicate gets that hex shifted by a fixed lightness step per `k`, alternating lighter/darker and clamped so it never reaches white or black. Deterministic, and stable as long as the ranking is — which is why Phase 2 tie-breaks the sort by name.
- `POZOSTALE_FILL` is `var(--muted-foreground)`, **not** `#64748b` — the theme token keeps it dark-mode-correct and distinguishes it from the Szary palette entry. It is not part of the shift rule (`Pozostałe` is not a category), so a visible Szary category can still read close to it; the count label and the always-last position are what disambiguate. Record that as an accepted residual in a comment.
- `formatCollapsedLabel(count: number): string` → `Pozostałe (7)`.

Hex↔HSL conversion for the shift lives in this module as a private helper. There is no colour library in `package.json` and this slice does not add one.

#### 2. Board switcher

**File**: `src/components/reports/BoardSwitcher.tsx` (new)

**Intent**: The FR-015 "from any view" requirement means both boards share one control bar; the switcher is what makes that possible without duplicating it.

**Contract**: Controlled `{ value: Board; onChange: (board: Board) => void }` where `Board = "overview" | "categories"`, labelled **Przegląd** and **Kategorie**. Hand-rolled `role="radiogroup" aria-label="Widok"` with `role="radio"` buttons, `min-h-11`, selected `border-foreground` — matching `RangePicker.tsx:13-34`. No shadcn `Tabs`; it is not installed and the hand-rolled pattern is established twice over.

#### 3. Split Board A out of `ReportsView`

**File**: `src/components/reports/OverviewBoard.tsx` (new), `src/components/reports/ReportsView.tsx`

**Intent**: Give each board its own fetch so switching boards does not load data the user is not looking at, and so `ReportsView` stays a state-and-controls shell rather than growing into a router with two data paths.

**Contract**: Move `ReportsView`'s summary fetch effect, `zeroFilledPoints`, and the `ReportsBody` branch tree into `OverviewBoard`, which takes `{ preset, recurringHidden }` and renders the KPI tiles, `TrendChart` and `CumulativeChart` unchanged. `ReportsView` retains: `ViewState` (now `{ board, preset, recurringHidden }`), URL read/write, the `popstate` listener, the sticky control bar (switcher + range picker + recurring toggle), and the range caption. Behaviour of Board A must be byte-for-byte identical — this is a move, not a rewrite.

`ViewState` gains `board`, read from `?board=`, defaulting to `"overview"` when absent or unrecognised — the same tolerant parse `isRangePreset` uses. `applyView` writes all three params. Board changes go through `pushState` like range changes, so the back button steps through them.

#### 4. Categories board

**File**: `src/components/reports/CategoriesBoard.tsx` (new)

**Intent**: Board B's orchestrator — the mirror of `OverviewBoard`.

**Contract**: Props `{ preset, recurringHidden }`. Resolves the range with `resolveRange(preset, toLocalDateString(new Date()))` and the bucket with `bucketFor`, exactly as `OverviewBoard` does — "today" is a browser local date and never a server computation (`date-utils.ts:1-3`). Fetches `/api/entries/category-summary` with the `cancelled = { current: false }` closure guard. `summary: CategorySummary | null` is the loading sentinel with `loadError: string | null` alongside; failure copy is `Nie udało się wczytać podsumowania kategorii.`

Same four-branch order: error → loading → empty → content. Empty fires on `summary.categories.length === 0` and reads **`Brak wydatków w tym zakresie.`** — deliberately *wydatków*, not *wpisów*: this board excludes income, and a range with income but no expenses is genuinely empty here while Board A shows data.

Calls `resolveDistribution` once and passes the result down; owns the `Pozostałe` expansion state (`useState<boolean>`), which resets whenever the range or toggle changes.

#### 5. Ranking (B2)

**File**: `src/components/reports/CategoryRanking.tsx` (new)

**Intent**: The form that actually degrades gracefully to any category count — it just gets taller. Always rendered, never behind a toggle, so the readability guarantee never depends on the user finding a control.

**Contract**: Props `{ distribution: Distribution; expanded: boolean; onToggleExpanded: () => void }`. Plain divs, no chart library: per row a colour swatch filled from `slice.fill`, the category name, a proportional bar sized from `share`, the amount via `formatCurrency`, and the share as a percentage. Rows are ordered by the distribution's existing descending sort.

The last row is `Pozostałe (n)` when `collapsed` is non-empty: a real `<button>` with `aria-expanded`, `min-h-11`, whose amount is the collapsed slices' summed total. Expanding renders the collapsed slices as indented rows beneath it — in place, without recolouring anything above.

Names must be truncatable without breaking the row (a category name can be 100 characters per `createCategorySchema`).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (`react-compiler` and `jsx-a11y` both as errors — the hand-rolled radiogroup and the expander button are the exposure)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- `/reports` with no query string still lands on **Przegląd**, Ostatnie 30 dni, toggle off
- Switching to **Kategorie** keeps the range and toggle, updates the URL to include `board=categories`, and the back button returns to Przegląd with the same range
- Reloading `?board=categories&range=ytd&recurring=hidden` restores exactly that view
- On the demo account, the ranking shows at most 9 rows before expansion; the sum of all rows' amounts equals Board A's `Wydatki` tile for the same range and toggle
- No two visible rows share a swatch colour; the head-pair duplicate renders as two distinguishable shades, and the *larger* of the pair matches its dot on `/categories` exactly
- Expanding `Pozostałe` reveals the tail **without changing any colour already on screen**
- Changing range or toggle collapses `Pozostałe` again
- With the recurring filter on, the recurring categories vanish from the ranking entirely and the percentages re-base to the new total
- A range with income but no expenses shows `Brak wydatków w tym zakresie.` while Board A shows data for the same range
- **S-04 regression pass** (the `ReportsView` split touches shipped code): on Przegląd, the four KPI tiles, A1 and A3 all render as before; preset changes still re-bucket; the back button still steps through range changes; the empty state still reads `Brak wpisów w tym zakresie.`
- A 100-character category name does not break the row layout on a narrow viewport

**Implementation Note**: Pause for manual confirmation before proceeding. This is the last point at which the slice is shippable without a new chart primitive — and the readability requirement is already satisfied here.

---

## Phase 4: Donut (B1)

### Overview

The share-of-total reading, on top of the model Phase 3 already built. No new data.

### Changes Required:

#### 1. Donut chart

**File**: `src/components/reports/CategoryDonut.tsx` (new)

**Intent**: Answer "what dominates my spending" at a glance — the question the ranking answers only after reading several rows.

**Contract**: Props `{ distribution: Distribution; expanded: boolean }`. A Recharts `PieChart` inside `ChartContainer` with a `min-h-[…] w-full` class, `accessibilityLayer` on, and `ChartTooltip` + `ChartTooltipContent`.

The `Pie` takes `dataKey="total"`, `nameKey="name"`, and an `innerRadius`/`outerRadius` pair making it a ring rather than a pie. **Per-slice colour travels on the datum as a `fill` field** — not via `Cell`, which Recharts 3.x has superseded, and not via `ChartConfig`, which would trip the `ChartStyle` self-reference documented at `global.css:112-126`. Recharts' colour resolution falls back to `entry.fill`, and shadcn's patched `fillOf(payload)` (`chart.tsx:24-30`) reads the same field for the tooltip swatch.

Data is `visible` plus, when `collapsed` is non-empty, one synthetic slice named `Pozostałe (n)` filled `POZOSTALE_FILL` and totalling the tail. When `expanded` is true the synthetic slice is replaced by the individual tail slices, so the donut and the ranking always agree on what is shown.

The range total sits in the centre as a `<Label position="center">` — `formatCurrency(distribution.total)` — with a small `Wydatki` caption above or below it via a second centred `Label`. The `ChartConfig` carries `label` entries only, built dynamically from the rendered slices and keyed by stringified `categoryId`.

**No `<Legend>`.** The ranking directly beneath is the legend, and duplicating it would double the vertical cost of the board on mobile.

#### 2. Mount it

**File**: `src/components/reports/CategoriesBoard.tsx`

**Intent**: Place the donut above the ranking.

**Contract**: Render inside the existing content branch, above `CategoryRanking`, sharing the same `distribution` and `expanded` values. No separate fetch, no separate loading state — the Phase 3 branches already cover it.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (`react-compiler` as an error; the dynamically-built `ChartConfig` is the least-proven pattern here)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- On the demo account the donut renders at most 9 arcs; the centre reads the range total and matches the ranking's summed amount and Board A's `Wydatki` tile
- Arc order matches ranking order, and every arc's colour matches its ranking swatch
- Hovering an arc shows the Polish category name, a `zł`-formatted amount and a swatch of the right colour
- Expanding `Pozostałe` splits the grey arc into the tail arcs in place, and collapsing restores it
- With one category in range, the ring renders as a full circle with the centre total still legible
- With the recurring filter on, arcs disappear and the remaining ones re-proportion to the new total
- The donut is legible on a narrow viewport and does not overlap its centre label at the smallest supported width
- Keyboard focus reaches the chart and no `jsx-a11y` violation appears in lint; the ranking remains the readable text-equivalent of the same data

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Kategorie w czasie (B3)

### Overview

The category mix drifting over the range's buckets, on the same category set and colours.

### Changes Required:

#### 1. Stacked category chart

**File**: `src/components/reports/CategoryTrendChart.tsx` (new)

**Intent**: Show *when* spending happened per category — the reading that makes the recurring-cost filter's effect visible as a shape change rather than a number change.

**Contract**: Props `{ distribution: Distribution; points: CategoryBucketPoint[]; bucket: SummaryBucket }`. A Recharts `BarChart` inside `ChartContainer`, with one `<Bar>` per visible category sharing a single `stackId`, plus a final `Pozostałe` bar carrying the summed tail. `dataKey` is the stringified `categoryId` — which is why Phase 2's `totals` is a string-keyed record. Each `<Bar>` takes its `fill` from `distribution.colorFor(categoryId)`.

**Stacking is correct here** where it was wrong for A1: these *are* parts of one whole (the bucket's expense total), unlike expense-versus-income.

Zero-fill with `enumerateBuckets(range, bucket)` so empty buckets render as genuine gaps in the stack rather than being dropped, matching `zeroFilledPoints`'s behaviour on Board A. X-axis ticks via `formatBucketLabel`, Y-axis via `formatCurrencyCompact`, tooltip values via `formatCurrency`.

The chart always renders the **collapsed** category set regardless of the `Pozostałe` expansion state — expanding to 30 stacked segments per bar would defeat the readability requirement this slice exists to satisfy. Note that divergence from the donut in a comment; it is deliberate, not an oversight.

#### 2. Mount it

**File**: `src/components/reports/CategoriesBoard.tsx`

**Intent**: Place it below the ranking.

**Contract**: Render inside the content branch beneath `CategoryRanking`, passing `summary.points` and the shared distribution.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` reports 0 errors
- `npm run build` passes, and the reports island remains a single chunk separate from the dashboard's

#### Manual Verification:

- With `Ostatnie 30 dni` the chart renders one stacked bar per day; `Ostatnie 3 miesiące` re-buckets to weeks and `Od początku roku` to months — with no control other than the preset picker
- Weeks start on Monday, matching Board A and the dashboard calendar
- Each bucket's stack height equals that bucket's expense total, and the full range's stacks sum to the donut's centre total
- Segment colours match the donut arcs and the ranking swatches exactly, and the same category keeps the same colour across every bar
- Expanding `Pozostałe` changes the donut and the ranking but deliberately leaves this chart on the collapsed set
- Toggling `Ukryj duże koszty cykliczne` removes the recurring categories' segments, and the monthly step they produced disappears from the stack shape
- A bucket with no expenses renders as a gap, not as a missing bar position
- The chart is legible on a narrow viewport at both a 7-day and a full-year range
- Two seed users signed in side by side see charts derived only from their own categories

**Implementation Note**: After this phase the slice is complete. Confirm before archiving.

---

## Testing Strategy

No test framework is added; coverage matches every prior slice.

### Database tests (pgTAP, `npx supabase test db`, local only — not in CI):

- Cross-user isolation through `entries_category_summary` for both seed users
- `anon` execute denial, asserted against the privilege catalog per the documented segfault workaround
- Three-level grouping-set arithmetic: bucket rows sum to per-category totals, which sum to the `()` range total
- Expense-only filtering
- The `p_exclude_recurring` filter
- Entries under soft-deleted categories still counted, with name and colour intact
- Monday-first week alignment

### Static verification:

`npm run lint`, `npx astro check`, `npm run build` at every phase boundary.

### Explicitly manual-only

Named here as a permanent re-verification requirement for any future change touching these paths, per `context/foundation/lessons.md`:

1. **The top-N selection rule** — pure client code, unreachable from pgTAP.
2. **Colour resolution and the duplicate-shift rule** — including the invariant that expanding `Pozostałe` never recolours a visible slice.
3. **Percentage arithmetic and its denominator guard.**
4. **Query-parameter validation and the bucket-count guard** — application code, as in S-04.
5. **Every UI behaviour** — board switching, URL sync, back-button semantics, empty states, expansion state resetting on range change.
6. **Board A's full S-04 criteria**, re-verified because Phase 3 moves its fetch and render into a new component.

### Manual testing steps:

1. `npx supabase db reset`, sign in as the demo account.
2. On **Przegląd**, walk every preset and toggle state; confirm Board A behaves exactly as S-04 shipped it.
3. Switch to **Kategorie**; confirm range and toggle carried over and the URL gained `board=categories`.
4. Cross-check the donut centre, the ranking sum and Board A's `Wydatki` tile for three different presets — all three must agree.
5. Expand and collapse `Pozostałe`; confirm no visible colour changes and the stacked chart stays collapsed.
6. Toggle the recurring filter on each board; confirm categories vanish and percentages re-base.
7. Change range while expanded; confirm the expansion resets.
8. Use the back button after several board and range changes.
9. Sign in as seed user B; confirm entirely different categories.
10. Sign out; confirm `/reports` redirects.
11. Return to `/dashboard` and log an expense; confirm the ≤4-interaction / ≤10-second path still holds.

## Performance Considerations

Data volume stays trivial: ≤365 buckets × ≤30 categories, and the charts render at most 9 series after collapse.

**No index is added on `entries.category_id`, and Phase 1 is required to produce the evidence.** The reasoning: the `where` clause filters by `user_id` and `occurred_on`, which `entries_user_id_occurred_on_idx` already covers; grouping then runs as a hash aggregate over that already-narrow row set, and the `categories` join is by primary key. An index on `category_id` would only help a query that *starts* from a category, which none of these do. Phase 1's `explain analyze` step exists to falsify that reasoning rather than assume it — if the plan shows a sequential scan on `entries`, the index goes in with a follow-up migration.

One RPC call per board load, versus S-04's two — there is no previous-period range because B4 is out of scope. The ≤400-bucket guard is reused unchanged; note that a 400-bucket × 30-category response is 12,000 rows, well past PostgREST's `max_rows = 1000`. In practice `bucketFor` caps a year-long range at ~12 month buckets, so the product stays small — but this is a sharper edge than Board A's and is worth watching if `bucketFor`'s thresholds ever change.

Colour resolution and top-N selection run once per fetch over ≤30 categories, not per render.

## Migration Notes

Two forward-only migrations. The function is additive and inert until the Worker calls it, so it is backward-compatible with the previous Worker version — which matters because CI applies migrations *between* the build and `wrangler deploy`.

The demo-data migration writes only to `public.categories` and `public.entries`, guarded on the demo user existing. It therefore avoids the `auth.*` write that S-04 finding F3 flagged as capable of aborting a deploy in that same window, and it is inert on any database where the demo account was never created.

Rollback is `drop function public.entries_category_summary(date, date, text, boolean)` plus a delete of the seeded rows; Board A and every other route are unaffected.

## References

- Charts decisions: `context/foundation/charts_recommendations.md` (Board B, §Decisions still needed 2)
- Full analysis of the readability strategy: `context/foundation/charts_analysis.md:164-186`
- Roadmap slice S-05: `context/foundation/roadmap.md:133-144`
- FR-014, FR-015: `context/foundation/prd.md:115-118`
- S-04 plan this one extends: `context/archive/2026-08-16-date-range-spending-view/plan.md`
- S-04 findings carried forward (F4 duplication, F5 demo-date staleness, F6 pgTAP anon workaround, F10 foreign-category drop): `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md`
- Function shape to copy: `supabase/migrations/20260816103000_add_entries_summary_function.sql`
- pgTAP envelope and impersonation: `supabase/tests/entries_summary_test.sql`
- Service and route conventions: `src/lib/services/reports.ts`, `src/pages/api/entries/summary.ts`
- Hand-rolled radiogroup pattern: `src/components/reports/RangePicker.tsx:13-34`
- `ChartStyle` self-reference hazard: `src/styles/global.css:112-126`
- App-layer-invariant testing rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Per-category aggregation primitive and demo data

#### Automated

- [x] 1.1 `npx supabase db reset` applies all ten migrations cleanly — 4537d4b
- [x] 1.2 `npx supabase test db` passes with `Files=4` and the raised plan counts — 4537d4b
- [x] 1.3 `npm run lint` passes — 4537d4b

#### Manual

- [x] 1.4 Superuser call in Studio returns rows across all users, confirming RLS is what isolates — 4537d4b
- [x] 1.5 The same call through PostgREST while signed in returns only that user's categories — 4537d4b
- [x] 1.6 `explain analyze` shows the existing index serving the scan; plan recorded in the commit message — 4537d4b
- [x] 1.7 Demo account shows ~30 categories with visible colour duplicates — 4537d4b

### Phase 2: Service, DTOs and the category-summary endpoint

#### Automated

- [x] 2.1 `npm run lint` passes — 336a4ea
- [x] 2.2 `npx astro check` reports 0 errors — 336a4ea
- [x] 2.3 `npm run build` passes — 336a4ea

#### Manual

- [x] 2.4 Endpoint returns `categories`, `points` and a `total` equal to their sum — 336a4ea
- [x] 2.5 That `total` matches Board A's `Wydatki` tile for the same range and toggle — 336a4ea
- [x] 2.6 `recurring=hidden` removes recurring categories and lowers `total` — 336a4ea
- [x] 2.7 Entries under a soft-deleted category still appear with name and colour — 336a4ea
- [x] 2.8 401 signed out; 400 on `from > to`; 400 on an over-large bucket count — 336a4ea
- [x] 2.9 Seed user B sees entirely different categories — 336a4ea

### Phase 3: Board switcher, distribution model and ranking (B2)

#### Automated

- [x] 3.1 `npm run lint` passes — cf194f4
- [x] 3.2 `npx astro check` reports 0 errors — cf194f4
- [x] 3.3 `npm run build` passes — cf194f4

#### Manual

- [x] 3.4 Default load is still Przegląd / Ostatnie 30 dni / toggle off — cf194f4
- [x] 3.5 Switching boards keeps range and toggle, updates the URL, and the back button reverses it — cf194f4
- [x] 3.6 Reloading `?board=categories&range=ytd&recurring=hidden` restores exactly that view — cf194f4
- [x] 3.7 Ranking shows at most 9 rows before expansion and sums to Board A's `Wydatki` tile — cf194f4
- [x] 3.8 No two visible rows share a swatch; the larger of a duplicate pair matches its `/categories` dot — cf194f4
- [x] 3.9 Expanding `Pozostałe` changes no colour already on screen — cf194f4
- [x] 3.10 Changing range or toggle collapses `Pozostałe` — cf194f4
- [x] 3.11 Recurring filter removes those categories and re-bases the percentages — cf194f4
- [x] 3.12 A range with income but no expenses shows `Brak wydatków w tym zakresie.` — cf194f4
- [x] 3.13 S-04 regression pass: tiles, A1, A3, re-bucketing, back button and empty state all unchanged — cf194f4
- [x] 3.14 A 100-character category name does not break the row on a narrow viewport — cf194f4

### Phase 4: Donut (B1)

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npx astro check` reports 0 errors
- [x] 4.3 `npm run build` passes

#### Manual

- [x] 4.4 At most 9 arcs; centre total matches the ranking sum and Board A's tile
- [x] 4.5 Arc order and colours match the ranking exactly
- [x] 4.6 Tooltip shows the Polish name, a `zł` amount and the correct swatch
- [x] 4.7 Expanding `Pozostałe` splits the grey arc in place; collapsing restores it
- [x] 4.8 A single-category range renders a full ring with a legible centre total
- [x] 4.9 Recurring filter removes arcs and re-proportions the rest
- [x] 4.10 Legible on a narrow viewport with no centre-label overlap
- [x] 4.11 Keyboard focus reaches the chart; no `jsx-a11y` violation in lint

### Phase 5: Kategorie w czasie (B3)

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 `npx astro check` reports 0 errors
- [ ] 5.3 `npm run build` passes with the reports island in its own chunk

#### Manual

- [ ] 5.4 Bucketing shifts day → week → month across presets with no extra control
- [ ] 5.5 Weeks start on Monday, matching Board A and the dashboard calendar
- [ ] 5.6 Stack heights equal each bucket's expense total and sum to the donut centre
- [ ] 5.7 Segment colours match the donut and ranking, and are stable across bars
- [ ] 5.8 Expanding `Pozostałe` deliberately leaves this chart on the collapsed set
- [ ] 5.9 Recurring filter removes those segments and the monthly step disappears
- [ ] 5.10 An empty bucket renders as a gap, not a missing bar position
- [ ] 5.11 Legible on a narrow viewport at both 7-day and full-year ranges
- [ ] 5.12 Two seed users see charts derived only from their own categories
