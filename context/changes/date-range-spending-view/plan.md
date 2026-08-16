# Date-Range Spending View (S-04) Implementation Plan

## Overview

Deliver roadmap slice **S-04**: a `/reports` page where the user picks a quick-select date range (FR-013) and optionally hides large recurring costs (FR-015), seeing four KPI tiles plus two charts over that range. This is Board A — Przegląd from `context/foundation/charts_recommendations.md`.

The slice also lands three cross-cutting pieces the rest of the product needs: the first **SQL aggregation primitive** (closing S-02's forward-flagged `numeric` float-drift finding), the first **charting library**, and the first **shared currency formatter**. S-05 (`category-distribution-view`) is built directly on the aggregation primitive and the control bar introduced here.

## Current State Analysis

**There is no range or aggregate capability anywhere.** `GET /api/entries` (`src/pages/api/entries/index.ts:14-17`) hard-requires `?date=YYYY-MM-DD`. The only range query in the codebase is `listEntryDaysForMonth` (`src/lib/services/entries.ts:216-232`), which returns bare date strings for the calendar's missing-day markers and is deliberately filtered to `type = 'expense'`.

**PostgREST cannot express the aggregate.** Its aggregate-function support groups by *columns*; `date_trunc('week', occurred_on)` is a grouping *expression*, which has no PostgREST syntax. Time bucketing therefore requires either a Postgres function or client-side JavaScript.

**The float-drift flag from S-02 lands here.** `src/components/entries/DayEntriesList.tsx:29-36` carries the review finding verbatim: *"PostgREST hands back numeric(10,2) as a JS number, so these totals inherit binary-float rounding. Acceptable here because the sum is bounded to one day's rows; the real fix (aggregate in SQL, or carry integer minor units) belongs with S-04/S-05's aggregation work."*

**FR-015 is not expressible against the current DTO.** `Entry.category` is `Pick<Category, "id" | "name" | "color">` (`src/types.ts:39`) — `isRecurring` is not carried, so the recurring filter cannot be applied client-side against existing entry data at all.

**Established conventions this plan follows:**

- API routes are `export const VERB: APIRoute = async (context) => {…}`, take the single `context` param, build their own Supabase client via `createClient(context.request.headers, context.cookies)` and null-check it, then re-derive the user via `supabase.auth.getUser()`. There is no `locals.supabase` — `App.Locals` has exactly one member, `user` (`src/env.d.ts`).
- Validation is zod `safeParse`, returning only the **first** issue as `{ error: string, field?: string | number }`. User-facing messages are Polish; developer-facing ones (`"Unauthorized"`, `"Invalid JSON body"`) are English.
- Every island is `client:load` with zero props and fetches its own data. No page fetches domain data in frontmatter.
- The async-effect idiom is a plain `const cancelled = { current: false }` closure guard, not `AbortController` (`src/components/entries/DayView.tsx:37-92`, `MonthCalendar.tsx:35-59`).
- Loading is signalled by `null`, never a separate boolean; the render is a strict three-branch early return (error → `null` → empty → content), per `DayEntriesList.tsx:122-132`.
- Radio-style controls are hand-rolled: `role="radiogroup"` + `role="radio"` on plain `<button>`s, `min-h-11` tap targets, selected = `border-foreground`.

**Two pre-existing defects this slice must work around or fix:**

1. **`.dark` is never applied to `<html>`.** `src/styles/global.css` defines the full dark token set at `:60-72`, but `Layout.astro:14` is `<html lang="en">` with no class. Every page runs the **light** token values while forcing a dark `bg-cosmic` gradient with `text-white`. Recharts pointed at `var(--chart-1)` would render light-mode colours on a near-black background.
2. **No `Intl.NumberFormat` exists anywhere.** `formatAmount` is a private `n.toFixed(2)` in `DayEntriesList.tsx:25-27` — no currency symbol, no thousands separator, no locale.

## Desired End State

A signed-in user visits `/reports` (linked from the Topbar), lands on a "ostatnie 30 dni" view with recurring costs **included**, and can:

- switch range via seven preset chips (7 dni, 30 dni, ten miesiąc, poprzedni miesiąc, 3 miesiące, od początku roku, cały okres);
- toggle **"Ukryj duże koszty cykliczne"**, which re-computes every figure on the page;
- read four KPI tiles — Wydatki, Przychody, Bilans, Średnia dzienna — each with a percentage delta against the immediately preceding equal-length period;
- read a grouped bar chart of expense vs income per auto-derived bucket, and a two-line cumulative-expense chart comparing this period against the previous one.

Both controls live in the URL (`/reports?range=last-30-days&recurring=hidden`), so the view is linkable, reloadable, and back-button-navigable.

**Verification that the end state is reached:** `npx supabase test db` passes with three test files; `npm run lint`, `npx astro check` and `npm run build` are clean; and manually, two seeded users signed in side by side see totals derived only from their own entries.

### Key Discoveries:

- `date_trunc('week', …)` in Postgres is **Monday-first**, which matches `POLISH_WEEKDAY_LABELS` and `firstWeekdayOfMonth` (`src/components/entries/date-utils.ts:27-30`) with no adjustment.
- `src/components/entries/date-utils.ts:1-3` states the binding rule: *"'Today' must come from the browser's local date, never UTC or a server computation."* Workers run UTC, so range resolution must happen client-side.
- `entries_user_id_occurred_on_idx (user_id, occurred_on)` (`20260815164539_create_entries_table.sql:21`) already covers this slice's date filter. The category join is by primary key, so **no new index is needed for Board A** — `entries.category_id` remains unindexed and that question belongs to S-05, which actually groups by it.
- RLS policies on both tables are the four granular per-operation `to authenticated` policies keyed on `(select auth.uid()) = user_id`. **No policy references `deleted_at`** — soft-delete filtering is purely app-layer (`src/lib/services/categories.ts:70`).
- pgTAP impersonation is `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` against the two fixed seed users in `supabase/seed.sql` (`1111…` / `2222…`). `reset role` returns to a superuser session that bypasses RLS entirely.
- Recharts current stable is **3.10.1**. `components.json` is already configured (new-york, neutral, cssVariables, lucide, `@/components/ui`).
- Only four shadcn components are installed: `button`, `input`, `label`, `checkbox`. No card, tabs, select, toggle, or skeleton.

## What We're NOT Doing

- **Board B (S-05)** — no donut, no category ranking, no stacked-by-category chart, and no `entries.category_id` index. This plan builds the primitive S-05 will extend, nothing more.
- **Board C** — no calendar heatmap, no cumulative net-flow line, no Sankey.
- **A4/B4-style comparisons beyond A3** — no diverging per-category change bars.
- **FR-016 custom date range UI.** The `/api/entries/summary` endpoint takes concrete `from`/`to` dates as a consequence of resolving ranges client-side, but no custom-range picker is built.
- **Drill-down from a chart into that period's entries.** Valuable, explicitly `Later` in the research doc.
- **Persisting the recurring toggle** across visits — it defaults off every load, by decision.
- **Widening `Entry.category` with `isRecurring`.** A separate aggregate DTO is introduced instead; the entry DTO is untouched.
- **Installing a test framework.** Verification remains lint + `astro check` + build + pgTAP, as in every prior slice.
- **Netting income against expense anywhere except the `Bilans` tile**, which is deliberately styled apart from the two gross tiles.

## Implementation Approach

Bottom-up, so each phase is independently verifiable and the risky pieces land before anything depends on them.

The aggregation primitive goes first and alone, because it is the only piece whose failure mode is silent (a cross-user leak) and the only one S-05 inherits wholesale. It is a `stable security invoker` SQL function — invoker semantics mean RLS still applies to the caller, so the isolation guarantee comes from the same policies already proven for direct table access, and pgTAP can prove it because the function is reachable from raw SQL.

Summation happens entirely in Postgres `numeric`, including the range grand totals (via `grouping sets`), so no chain of JavaScript float additions exists anywhere in the data path. That is the direct discharge of S-02's F4.

The presentation foundations (formatter, dark-mode token fix, chart library) land as one phase before any chart is written, because all three are prerequisites shared by both charts and by S-05.

Phase 4 deliberately ships a *complete* FR-013/FR-015 outcome — controls plus KPI tiles — before Recharts renders a single pixel. If the shadcn/Recharts typing churn turns out worse than budgeted, there is still a shippable slice.

## Critical Implementation Details

**Soft-deleted categories must not be filtered out of the aggregate.** Every service in the repo appends `.is("deleted_at", null)`, and copying that habit into the summary function would silently drop every entry filed under a category the user has since deleted — entries survive category deletion by design (the FK has no `on delete` clause, which is *why* categories are soft-deleted). The function joins `categories` only to read `is_recurring`, and must not filter on `deleted_at`.

**Range resolution is client-side and `today` is a browser local date.** `date-utils.ts` opens with the rule that "today" never comes from a server computation, and Workers run UTC — a user logging at 23:30 CEST would get yesterday's date from a server-derived `today`. The island resolves preset → `{from, to}` → `bucket` locally and sends concrete dates; the endpoint validates them but never derives them.

**shadcn's `chart.tsx` ships with a `"use client"` directive.** `CLAUDE.md` forbids Next.js directives outright. Strip it as part of installing the component, before the first lint run.

**The `.dark` change in Phase 3 is app-wide, not page-scoped.** It flips every already-shipped page from the light token set to the dark one. This is a fix (the pages already force a dark background), but it must be eyeballed across `/dashboard`, `/categories` and both auth pages before the phase is called done.

## Phase 1: Aggregation primitive (migration + pgTAP)

### Overview

Add the Postgres function that every chart in S-04 and S-05 will read through, and prove by test that it isolates users, denies `anon`, and computes the right numbers.

### Changes Required:

#### 1. Summary function migration

**File**: `supabase/migrations/20260816103000_add_entries_summary_function.sql`

**Intent**: Create the single aggregation primitive: bucketed expense/income sums over a date range, with an optional recurring-cost exclusion, computed entirely in Postgres `numeric` so no JavaScript float summation exists in the data path. Grant execute to `authenticated` only.

**Contract**: `public.entries_summary(p_from date, p_to date, p_bucket text, p_exclude_recurring boolean default false)` returning `table (bucket_start date, entry_type text, total numeric)`. Rows where `bucket_start is null` are the range grand totals for that `entry_type`. Declared `language sql`, `stable`, `security invoker`, `set search_path = ''`.

The `grouping sets` construct is the non-obvious part — it is what makes the grand totals exact rather than a JS re-sum of the bucket rows:

```sql
select
  (date_trunc(p_bucket, e.occurred_on::timestamp))::date as bucket_start,
  e.type as entry_type,
  sum(e.amount) as total
from public.entries e
join public.categories c on c.id = e.category_id
where e.occurred_on between p_from and p_to
  and (not p_exclude_recurring or not c.is_recurring)
group by grouping sets (
  ((date_trunc(p_bucket, e.occurred_on::timestamp))::date, e.type),
  (e.type)
);
```

Note there is **no `deleted_at` filter** on the join — see Critical Implementation Details. `p_bucket` reaches `date_trunc` as a bound parameter, not string concatenation, so there is no injection surface; an out-of-set value raises a Postgres error, and the zod enum at the API edge is the real validation.

Follow the grant convention explicitly rather than relying on the default `public` grant:

```sql
revoke execute on function public.entries_summary(date, date, text, boolean) from public, anon;
grant execute on function public.entries_summary(date, date, text, boolean) to authenticated;
```

Carry a header comment in the style of the existing migrations explaining why `security invoker` is used (RLS must keep applying — a `security definer` function would need the `user_id` predicate re-established by hand) and why `deleted_at` is deliberately absent.

#### 2. pgTAP coverage

**File**: `supabase/tests/entries_summary_test.sql`

**Intent**: Prove the four properties that matter and that raw SQL can actually reach: cross-user isolation through the function, `anon` denial, bucket arithmetic, and the recurring-cost filter. Follow `entries_rls_test.sql`'s envelope and impersonation conventions exactly.

**Contract**: `begin; select plan(N); … select * from finish(); rollback;`. Seed fixture entries and categories for both seed users as superuser before the first `set local role authenticated`, covering: at least one recurring-flagged category, at least one entry filed under a soft-deleted category, and entries spanning enough days to exercise day, week and month buckets. Assertions to include:

- user A's call returns only A's sums; user B's identical call returns only B's — the isolation test
- `anon` executing the function raises `42501` (`throws_ok`)
- day / week / month `bucket_start` values land where expected, with the week case confirming Monday-first alignment
- `p_exclude_recurring => true` drops exactly the recurring-category entries and leaves the rest
- the `bucket_start is null` grand total equals the sum of that type's bucket rows
- an entry whose category is soft-deleted is still counted

Scope the post-`reset role` assertions by `user_id in ('1111…','2222…')` per `categories_rls_test.sql:128-134`, so stray local dev data cannot turn the suite red.

**What pgTAP cannot prove here** (per the `context/foundation/lessons.md` rule): nothing in the service or API layer — query-parameter validation, the bucket-count guard, previous-period derivation, and every UI behaviour remain manual-only. Unlike soft-delete, the aggregation logic itself *is* reachable from raw SQL, which is why it gets real coverage.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all seven migrations cleanly
- `npx supabase test db` passes with `Files=3` and the raised plan counts
- `npm run lint` passes

#### Manual Verification:

- In Studio (`http://localhost:54323`), calling `select * from public.entries_summary('2026-08-01','2026-08-31','day')` as a superuser returns rows across all users — confirming the function itself does not filter, and that RLS (not the function body) is what isolates
- The same call through the PostgREST endpoint while signed in as one user returns only that user's sums

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Service, DTOs and the summary endpoint

### Overview

Wrap the function in a service and expose it as `GET /api/entries/summary`, returning both the requested range and the immediately preceding equal-length range in one response.

### Changes Required:

#### 1. Aggregate DTOs

**File**: `src/types.ts`

**Intent**: Add the aggregate shapes as a family separate from `Entry`, since chart endpoints return sums rather than entries. `Entry.category` stays a three-field `Pick` and is not widened.

**Contract**: Add `type SummaryBucket = "day" | "week" | "month"`, plus:

```ts
export interface SummaryPoint { bucketStart: string; expense: number; income: number; }
export interface RangeSummary { from: string; to: string; points: SummaryPoint[]; totals: { expense: number; income: number }; }
export interface EntriesSummary { bucket: SummaryBucket; current: RangeSummary; previous: RangeSummary; }
```

#### 2. Reports service

**File**: `src/lib/services/reports.ts` (new)

**Intent**: Call `entries_summary` for the requested range and the previous equal-length range in parallel, and fold the flat `(bucket_start, entry_type, total)` rows into the `RangeSummary` shape. Follow `entries.ts`'s module conventions: a locally-derived `SupabaseClient` type alias, a colocated zod schema, a private row interface, and a `toDto`-style mapper.

**Contract**: `export const summaryQuerySchema` validating `from`/`to` against `/^\d{4}-\d{2}-\d{2}$/`, `bucket` as `z.enum(["day","week","month"])`, and `recurring` as `z.enum(["shown","hidden"]).default("shown")`. Then `export async function getEntriesSummary(supabase, input): Promise<EntriesSummary>`.

Two `supabase.rpc("entries_summary", …)` calls issued through `Promise.all`, mirroring the existing pattern in `listCategoriesForEntryForm` (`src/lib/services/entries.ts:242-256`) including its sequential per-result error checks. The previous range ends the day before `from` and has the same inclusive day count. Rows with `bucket_start === null` populate `totals`; the rest populate `points`. Absent types default to `0`, so a range with only expenses still reports `income: 0`.

Export a `RangeTooLargeError` for the bucket-count guard below.

#### 3. Summary endpoint

**File**: `src/pages/api/entries/summary.ts` (new)

**Intent**: Expose the service over HTTP following the exact preamble, validation and error conventions of the existing routes.

**Contract**: `export const GET: APIRoute`. Query params `from`, `to`, `bucket`, `recurring`. Apply the repeated preamble verbatim — `createClient(...)` null-check → 500 `{ error: "Supabase is not configured" }`, then `getUser()` → 401 `{ error: "Unauthorized" }`. Validate *after* the auth guard, following the deliberate ordering in `src/pages/api/entries/categories.ts:27-28` (an anonymous caller must not be able to distinguish a malformed query string from a missing session).

Beyond the zod schema, two semantic checks returning 400 with Polish messages:

- `from` must be `<=` `to` — lexicographic ISO comparison, as `days.ts:51-60` already does
- the implied bucket count must not exceed **400**, otherwise `RangeTooLargeError` → 400. This guards a hand-crafted `bucket=day` over a decade, which would otherwise blow past PostgREST's `max_rows = 1000` and truncate silently rather than error

Returns 200 with the bare `EntriesSummary` object. Do **not** set cache headers — `src/middleware.ts:26-30` already applies `private, no-store` to any signed-in response.

#### 4. Protect the route

**File**: `src/middleware.ts`

**Intent**: Add the reports page to the prefix-matched protected list.

**Contract**: `PROTECTED_ROUTES` becomes `["/dashboard", "/categories", "/reports"]`. Note this does not cover `/api/entries/summary` — API routes self-guard, consistent with every existing endpoint.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (`strictTypeChecked` — the RPC result is untyped, so the row cast and mapper must type cleanly)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- `GET /api/entries/summary?from=2026-08-01&to=2026-08-16&bucket=day` signed in returns `current` and `previous` with `previous` covering the 16 days ending 2026-07-31
- `recurring=hidden` lowers the expense totals by exactly the recurring categories' contribution and leaves income untouched
- Requesting the endpoint signed out returns 401, not 500 or a partial payload
- `from` later than `to` returns 400 with a Polish message
- `bucket=day` over a five-year span returns 400, not a truncated 1000-row result
- Signed in as seed user B, the totals differ from user A's for the same range — the isolation guarantee holding through the RPC path

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Presentation foundations

### Overview

Three prerequisites shared by both charts and by S-05: a real currency formatter, a correct token theme, and the chart library.

### Changes Required:

#### 1. Shared currency formatter

**File**: `src/lib/format.ts` (new)

**Intent**: Introduce the repo's first `Intl.NumberFormat` usage, once, deliberately — rather than a third copy of `toFixed(2)` appearing in S-05.

**Contract**: Three exports built on memoised `Intl.NumberFormat` instances (constructing a formatter per render is the one real cost here):

- `formatCurrency(amount: number): string` — `pl-PL`, `style: "currency"`, `currency: "PLN"`, two fraction digits. Renders `1 234,56 zł`.
- `formatCurrencyCompact(amount: number): string` — `notation: "compact"`, no currency symbol, for axis ticks where a full `zł` string would collide.
- `formatPercentDelta(current: number, previous: number): string | null` — returns `null` when `previous === 0`, because a percentage change from zero is undefined. The tiles render `—` in that case. This is near-certain in the product's first weeks and is a deliberate decision, not an oversight.

#### 2. Migrate the day view onto the shared formatter

**File**: `src/components/entries/DayEntriesList.tsx`

**Intent**: Delete the private `formatAmount` and call `formatCurrency`, so the same amount does not render two different ways on `/dashboard` and `/reports`.

**Contract**: Remove the local `formatAmount` (`:25-27`); import from `@/lib/format`. Leave `sumOf` (`:29-36`) in place — a single day's rows stay bounded — but update its comment to record that the range case it forward-flagged is now handled in SQL by `entries_summary`, so the note doesn't outlive its purpose. This is a visible change to a shipped page (`12.50` becomes `12,50 zł`) and requires re-verification of the north-star entry path.

#### 3. Activate the dark token set

**File**: `src/layouts/Layout.astro`

**Intent**: The app forces a dark `bg-cosmic` gradient with `text-white` while running the *light* token values, which is why `text-muted-foreground` reads as low-contrast mid-grey on near-black throughout the entries components. Applying `.dark` makes the tokens describe the surface they actually render on — a precondition for `var(--chart-1)` meaning anything sensible.

**Contract**: `<html lang="en">` (`:14`) becomes `<html lang="pl" class="dark">`. The `lang` correction rides along because the UI copy in the entries and categories domain is Polish and the attribute is on the same line — it affects screen-reader pronunciation and is not worth a separate change. Both edits are app-wide and need a visual pass over every shipped page.

#### 4. Install the chart primitives

**File**: `src/components/ui/chart.tsx` (generated), `package.json`

**Intent**: Add shadcn's Recharts wrapper, pinned, and make it survive `strictTypeChecked`.

**Contract**: `npx shadcn@latest add chart`, then pin with `npm install --save-exact recharts@3.10.1` so the dependency carries no caret range — shadcn's `chart.tsx` has churned repeatedly against Recharts 3.x typings (`payload` dropped from tooltip props, `NameType`/`ValueType` imports relocating), and a floating range turns that into a build that breaks on an unrelated `npm install`.

Two edits to the generated file are expected:

- **Strip the `"use client"` directive** — `CLAUDE.md` forbids Next.js directives outright.
- **Patch the tooltip payload typings** if `npx astro check` or `npm run lint` reject them. Budget one hand-patch; do not loosen the ESLint config to accommodate it.

Sizing note: since Recharts 3.3 the responsive container is built into the charts, and the `min-h-[…] w-full` class on `ChartContainer` is what actually makes them size correctly — an explicit `ResponsiveContainer` wrapper is both unnecessary and a source of width/height warnings.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with the generated `chart.tsx` in the tree (`strictTypeChecked` + `react-compiler` + `jsx-a11y`, all as errors)
- `npx astro check` reports 0 errors
- `npm run build` passes
- `package.json` records `recharts` at an exact version with no caret

#### Manual Verification:

- `/dashboard` renders amounts as `12,50 zł` and the ≤4-interaction / ≤10-second entry path is unaffected
- `/dashboard`, `/categories`, `/auth/signin` and `/auth/signup` all still read correctly with the dark token set active — in particular, loading and empty-state text is legible where it previously used light-mode `text-muted-foreground` on a near-black background
- The `Duży koszt cykliczny` badge, category colour dots and the emerald income amounts still read correctly against the new token values

**Implementation Note**: Pause for manual confirmation before proceeding. The dark-mode change touches every shipped page and is the single most likely place for an unnoticed visual regression.

---

## Phase 4: `/reports` page — controls and KPI tiles

### Overview

Ship a complete FR-013 + FR-015 outcome: the route, the URL-driven control bar, the four KPI tiles, and the empty state — with no charting library involved.

### Changes Required:

#### 1. Range and bucket helpers

**File**: `src/components/reports/range.ts` (new)

**Intent**: Pure functions turning a preset into concrete local dates, deriving the bucket, and generating the full bucket sequence so gaps render as genuine zeros rather than missing points. Co-located with the feature, following the `src/components/entries/date-utils.ts` precedent rather than `src/lib/`.

**Contract**:

- `RANGE_PRESETS` — an ordered const of `{ value, label }` pairs with Polish labels: `last-7-days` "Ostatnie 7 dni", `last-30-days` "Ostatnie 30 dni", `this-month` "Ten miesiąc", `last-month` "Poprzedni miesiąc", `last-3-months` "Ostatnie 3 miesiące", `ytd` "Od początku roku", `all-time` "Cały okres". `DEFAULT_RANGE_PRESET = "last-30-days"`.
- `resolveRange(preset, today: string): { from: string; to: string }` — built on the existing local-date helpers. `all-time` resolves `from` to a fixed number of years before `today` (20 in the implementation); the aggregate simply returns whatever exists, so no account-creation lookup is needed.

  > **Corrected during implementation review (2026-08-16).** This clause originally read "`all-time` resolves `from` to `1970-01-01`", which contradicts the ≤400-bucket guard specified in Phase 2: 1970 → today is ~680 month buckets, so every "Cały okres" load would have returned 400. A relative floor caps the span (~252 month buckets) and never drifts into the guard as the years pass. S-05 builds on this module — use the corrected clause, not the original.
- `previousRange({ from, to }): { from, to }` — same inclusive day count, ending the day before `from`.
- `bucketFor({ from, to }): SummaryBucket` — `≤ 30` days → `day`, `≤ 92` days → `week`, else `month`. Not a user control, per the research doc: FR-013 stays a single preset picker.
- `enumerateBuckets({ from, to }, bucket): string[]` — the full ordered bucket-start sequence, used to zero-fill.
- `formatBucketLabel(bucketStart, bucket): string` — Polish axis labels; reuse `POLISH_MONTH_NAMES` from `date-utils.ts` for the month case.

#### 2. Reports island

**File**: `src/components/reports/ReportsView.tsx` (new)

**Intent**: The orchestrator: owns URL-derived state, fetches the summary, and renders controls, tiles and (from Phase 5) charts.

**Contract**: No props, mounted `client:load`. State derived from `window.location.search` on mount — `range` (falling back to `DEFAULT_RANGE_PRESET` when absent or unrecognised) and `recurring` (`hidden` enables the filter; anything else, including absence, means shown). Control changes call `history.pushState` so the back button steps back through them, with a `popstate` listener syncing state in the other direction.

Fetch `/api/entries/summary?from&to&bucket&recurring` on mount and on every control change, using the `cancelled = { current: false }` closure-guard idiom from `DayView.tsx:37-92`. `summary: EntriesSummary | null` is the loading sentinel; `loadError: string | null` alongside it. Load-failure copy follows the established form: `Nie udało się wczytać podsumowania.`

Render as the three-branch early return the codebase uses, with the control bar always visible above it so a failed or empty load never traps the user on a dead page. The empty branch fires when the current range has no entries of either type, and reads `Brak wpisów w tym zakresie.` — matching the `Brak …` noun-phrase convention. When any entries exist, empty buckets are zero-filled and rendered as genuine zeros.

#### 3. Range picker

**File**: `src/components/reports/RangePicker.tsx` (new)

**Intent**: The FR-013 control.

**Contract**: Fully controlled — `{ value, onChange }`. Hand-rolled `role="radiogroup" aria-label="Zakres dat"` with `role="radio"` buttons, `min-h-11`, selected state `border-foreground`, matching `CategoryPicker.tsx:37-56`. Do not reach for a shadcn `Select` or `Tabs`; neither is installed and the existing pattern is established.

#### 4. Recurring-cost toggle

**File**: `src/components/reports/RecurringToggle.tsx` (new)

**Intent**: The FR-015 control. The PRD's complaint is that existing tools *bury* this option, so its prominence is a requirement rather than styling.

**Contract**: Controlled `{ checked, onChange }`, built on the installed `src/components/ui/checkbox.tsx` with a `Label` reading **"Ukryj duże koszty cykliczne"**. Off by default. It sits in a `sticky top-0` control bar so it stays visible while scrolling, and its state must be legible at a glance — the failure mode being guarded against is a filter silently in effect.

#### 5. KPI tiles (A2)

**File**: `src/components/reports/KpiTiles.tsx` (new)

**Intent**: Four stat tiles, plain divs, no chart library. The cheapest high-value item on the board — it answers the most common question before any chart is read.

**Contract**: Props `{ summary: EntriesSummary }`. Four tiles:

| Tile | Value | Delta basis |
| --- | --- | --- |
| Wydatki | `current.totals.expense` | previous expense total |
| Przychody | `current.totals.income` | previous income total |
| Bilans | income − expense | previous balance |
| Średnia dzienna | expense ÷ inclusive day count | previous period's average |

Amounts via `formatCurrency`; deltas via `formatPercentDelta`, rendering `—` when it returns `null`.

**Bilans must be visually distinct from the two gross tiles.** `DayEntriesList.tsx:147-153` deliberately never nets income against expense for a day ("Two figures, never netted"); a netted range total is a different claim, and the two conventions must not read as the same kind of number.

#### 6. Page and navigation

**File**: `src/pages/reports.astro` (new), `src/components/Topbar.astro`

**Intent**: Mount the island and make the page reachable.

**Contract**: `reports.astro` mirrors `categories.astro` — same `bg-cosmic min-h-screen p-4` → `mx-auto max-w-2xl` shell (widened as the charts need), the `Topbar`, a gradient `<h1>`, and `<ReportsView client:load />` with no props. Add a **"Raporty"** link to `Topbar.astro` beside "Kategorie". The label is Polish while the path is `/reports`, matching the domain copy convention; the Topbar already mixes languages, and this does not make it worse.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (including `react-compiler` and `jsx-a11y`, both errors — the hand-rolled radiogroup and the sticky toggle are the exposure)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- Signed out, `/reports` redirects to `/auth/signin`
- Landing on `/reports` with no query string shows "Ostatnie 30 dni" with the recurring toggle **off**
- Selecting a preset updates the URL, the tiles, and the browser history; pressing back returns to the previous preset with the tiles following
- Reloading a URL with `?range=ytd&recurring=hidden` restores exactly that view, toggle visibly checked
- Enabling the toggle lowers Wydatki by the recurring categories' contribution and leaves Przychody unchanged
- Bilans reads as income − expense and is visually distinguishable from the two gross tiles
- A range with no entries shows `Brak wpisów w tym zakresie.` with the control bar still usable
- A range whose previous period is empty renders `—` for the deltas rather than a percentage
- The toggle stays visible while scrolling
- On a narrow viewport the preset chips remain tappable at 44px

**Implementation Note**: Pause for manual confirmation before proceeding. This is the last point at which the slice is shippable without the charting library.

---

## Phase 5: Charts A1 and A3

### Overview

The two Recharts islands, both consuming the Phase 2 aggregate — nothing new is fetched.

### Changes Required:

#### 1. Chart series tokens

**File**: `src/styles/global.css`

**Intent**: Give the two series purpose names rather than referring to `--chart-1` by index across several files, while still resolving to the existing theme tokens so dark mode stays free.

**Contract**: Add `--color-expense` and `--color-income` to the `@theme inline` block, mapped onto existing chart tokens. Income should read as the emerald already used for income amounts in `DayEntriesList.tsx:238-241`, so the colour means the same thing on both pages. These are series colours; `CATEGORY_COLORS` remains reserved for per-category fills in S-05.

#### 2. Trend chart (A1)

**File**: `src/components/reports/TrendChart.tsx` (new)

**Intent**: The workhorse — expense and income per bucket, answering "did I earn more than I spent".

**Contract**: Props `{ points: SummaryPoint[]; bucket: SummaryBucket }`. A Recharts `BarChart` inside `ChartContainer` with a `min-h-[…] w-full` class, `accessibilityLayer` on, `ChartTooltip` + `ChartTooltipContent`, and a `ChartConfig` naming the two series **Wydatki** and **Przychody** against `var(--color-expense)` / `var(--color-income)`.

**Bars are grouped, not stacked** — expense and income are not parts of a whole, and stacking would assert a relationship that doesn't exist. X-axis ticks via `formatBucketLabel`; Y-axis ticks via `formatCurrencyCompact`; tooltip values via `formatCurrency`.

#### 3. Cumulative comparison chart (A3)

**File**: `src/components/reports/CumulativeChart.tsx` (new)

**Intent**: Answer "am I ahead of last month's pace?" while the period is still running, rather than after it closes.

**Contract**: Props `{ summary: EntriesSummary }`. A Recharts `LineChart` with two cumulative expense series, both starting at zero and indexed by **position within the period** rather than by date — the two periods cover different calendar days, so they can only be compared bucket-for-bucket. The previous-period line is visually subordinate (muted colour and dashed), so the current period reads as the subject.

Running totals accumulate over the already-exact per-bucket sums from `entries_summary`; there is no re-summation of raw rows. When the previous period has no data, render the current line alone rather than a flat zero line, which would falsely assert "spent nothing last period" when the truth is "wasn't using the app yet".

#### 4. Mount both charts

**File**: `src/components/reports/ReportsView.tsx`

**Intent**: Place the charts below the KPI tiles.

**Contract**: Render inside the existing content branch, so the error, loading and empty branches from Phase 4 already cover them. Both are plain child components — no separate fetch, no separate loading state.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (`react-compiler` runs as an error and Recharts composition is the least-proven pattern in this repo)
- `npx astro check` reports 0 errors
- `npm run build` passes, and the reports island's chunk is separate from the dashboard's

#### Manual Verification:

- With ~30 days of entries, A1 renders one grouped bar pair per day; switching to "Ostatnie 3 miesiące" re-buckets to weeks and "Od początku roku" to months, with no control other than the preset picker
- Weeks start on Monday, matching the calendar on `/dashboard`
- Tooltips show Polish series names and `zł`-formatted values; axis ticks are compact and do not overlap
- Toggling "Ukryj duże koszty cykliczne" visibly changes both charts, not only the tiles — a fixed monthly cost stops producing the step change that otherwise dominates A3's shape
- The A3 previous-period line reads as subordinate to the current one
- A range whose previous period predates the account shows only the current line
- Keyboard arrow keys move between data points (Recharts `accessibilityLayer`), and no `jsx-a11y` violation appears in lint
- Charts render legibly on a narrow viewport and at both a 7-day and a full-year range
- Two seed users signed in side by side see charts derived only from their own entries

**Implementation Note**: After this phase, the slice is complete. Confirm before archiving.

---

## Testing Strategy

There is no test framework in this repo and this slice does not add one. Coverage is:

### Database tests (pgTAP, `npx supabase test db`, local only — not in CI):

- Cross-user isolation through `entries_summary` for both seed users
- `anon` execute denial (`42501`)
- Day / week / month bucket arithmetic, including Monday-first week alignment
- The `p_exclude_recurring` filter
- Grand-total rows equal the sum of their bucket rows
- Entries under soft-deleted categories still counted

### Static verification:

`npm run lint` (`strictTypeChecked` + `stylisticTypeChecked` + `react-compiler` + `jsx-a11y`, all errors), `npx astro check`, `npm run build` — run at every phase boundary.

### Explicitly manual-only

Per the `context/foundation/lessons.md` rule, these are named here as a permanent re-verification requirement for any future change touching these paths:

1. **Query-parameter validation and the bucket-count guard** — application code, unreachable from pgTAP.
2. **Previous-period derivation** — computed in TypeScript from the client-supplied range.
3. **Local-date resolution of presets** — depends on the browser's timezone; a server-side test cannot observe it.
4. **Every UI behaviour** — URL sync, back-button semantics, empty states, toggle prominence, chart rendering.
5. **The north-star entry path on `/dashboard`** — re-verified because Phase 3 changes both amount formatting and the active token theme on a page this slice does not otherwise touch.

### Manual testing steps:

1. Seed a month of entries across several categories, at least one flagged `Duży koszt cykliczny`, mixing expenses and incomes.
2. Visit `/reports`; confirm the default range, the toggle off, and that the tiles match hand-computed sums.
3. Walk every preset; confirm bucketing changes at the 30-day and 3-month boundaries.
4. Toggle the recurring filter on each preset; confirm expenses drop and income does not.
5. Reload a deep link with both params; confirm the view restores exactly.
6. Use the back button after several control changes.
7. Sign in as the second seed user; confirm entirely different numbers.
8. Sign out; confirm `/reports` redirects.
9. Return to `/dashboard` and log an expense; confirm ≤4 interactions and ≤10 seconds still hold and amounts render with `zł`.

## Performance Considerations

Worst-case data volume is trivial: ≤365 daily buckets, two series. Recharts' documented SVG jank threshold (~1,000 points) is never approached, which is the reason the canvas libraries' performance advantage bought nothing in the library comparison.

`entries_user_id_occurred_on_idx` covers the range filter; the `categories` join is by primary key. **No new index is added** — `entries.category_id` stays unindexed because Board A never groups by it. That question belongs to S-05.

The bucket-count guard (≤400) exists to keep responses under PostgREST's `max_rows = 1000`, which would otherwise truncate silently rather than error.

Two RPC calls per page load (current + previous range) rather than one, chosen over a single wider query so the previous-period boundary logic lives in one place. Both are index-covered and issued in parallel.

`Intl.NumberFormat` instances are constructed once at module scope, not per render — the one genuine cost in the formatter.

## Migration Notes

One forward-only migration adding a function; no schema change, no data migration, nothing to backfill. It is backward-compatible with the previous Worker version by construction — an unused function is inert — which matters because CI applies migrations *between* the build and `wrangler deploy`, so the previous Worker briefly runs against the new schema.

Rollback is `drop function public.entries_summary(date, date, text, boolean)` in a follow-up migration; the Worker would 500 on `/api/entries/summary` and every other route would be unaffected.

## References

- Charts decisions: `context/foundation/charts_recommendations.md`
- Full market and library analysis: `context/foundation/charts_analysis.md`
- Roadmap slice S-04: `context/foundation/roadmap.md`
- Requirements FR-013, FR-014, FR-015, FR-016: `context/foundation/prd.md`
- Forward-flagged float-drift finding (F4): `context/archive/2026-08-15-daily-expense-entry/reviews/impl-review.md:59`
- App-layer-invariant testing rule: `context/foundation/lessons.md`
- Service conventions to mirror: `src/lib/services/entries.ts:242-256`
- Route conventions to mirror: `src/pages/api/entries/index.ts`
- Async-effect and three-branch render idioms: `src/components/entries/DayView.tsx:37-92`, `src/components/entries/DayEntriesList.tsx:122-132`
- Hand-rolled radiogroup pattern: `src/components/entries/CategoryPicker.tsx:37-56`
- RLS migration and pgTAP shape: `supabase/migrations/20260815164539_create_entries_table.sql`, `supabase/tests/entries_rls_test.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Aggregation primitive (migration + pgTAP)

#### Automated

- [x] 1.1 `npx supabase db reset` applies all seven migrations cleanly — 97b9b7b
- [x] 1.2 `npx supabase test db` passes with `Files=3` and the raised plan counts — 97b9b7b
- [x] 1.3 `npm run lint` passes — 97b9b7b

#### Manual

- [x] 1.4 Superuser call in Studio returns rows across all users, confirming RLS (not the function body) is what isolates — 97b9b7b
- [x] 1.5 The same call through PostgREST while signed in returns only that user's sums — 97b9b7b

### Phase 2: Service, DTOs and the summary endpoint

#### Automated

- [x] 2.1 `npm run lint` passes — e4ae841
- [x] 2.2 `npx astro check` reports 0 errors — e4ae841
- [x] 2.3 `npm run build` passes — e4ae841

#### Manual

- [x] 2.4 Endpoint returns `current` and `previous` with the correct preceding equal-length range — e4ae841
- [x] 2.5 `recurring=hidden` lowers expense totals only — e4ae841
- [x] 2.6 Signed-out request returns 401 — e4ae841
- [x] 2.7 `from` later than `to` returns 400 with a Polish message — e4ae841
- [x] 2.8 `bucket=day` over five years returns 400, not a truncated result — e4ae841
- [x] 2.9 Second seed user sees different totals for the same range — e4ae841

### Phase 3: Presentation foundations

#### Automated

- [x] 3.1 `npm run lint` passes with the generated `chart.tsx` in the tree — 302bb07
- [x] 3.2 `npx astro check` reports 0 errors — 302bb07
- [x] 3.3 `npm run build` passes — 302bb07
- [x] 3.4 `package.json` records `recharts` at an exact version with no caret — 302bb07

#### Manual

- [x] 3.5 `/dashboard` renders `12,50 zł` and the ≤4-interaction / ≤10-second entry path is unaffected — 302bb07
- [x] 3.6 All four shipped pages read correctly with the dark token set active — 302bb07
- [x] 3.7 Recurring badge, category colour dots and emerald income amounts still read correctly — 302bb07

### Phase 4: `/reports` page — controls and KPI tiles

#### Automated

- [x] 4.1 `npm run lint` passes — f38ac4c
- [x] 4.2 `npx astro check` reports 0 errors — f38ac4c
- [x] 4.3 `npm run build` passes — f38ac4c

#### Manual

- [x] 4.4 Signed out, `/reports` redirects to `/auth/signin` — f38ac4c
- [x] 4.5 Default view is "Ostatnie 30 dni" with the toggle off — f38ac4c
- [x] 4.6 Preset change updates URL, tiles and history; back button reverses it — f38ac4c
- [x] 4.7 Reloading `?range=ytd&recurring=hidden` restores exactly that view — f38ac4c
- [x] 4.8 Toggle lowers Wydatki only — f38ac4c
- [x] 4.9 Bilans is visually distinct from the two gross tiles — f38ac4c
- [x] 4.10 Empty range shows `Brak wpisów w tym zakresie.` with the control bar usable — f38ac4c
- [x] 4.11 Empty previous period renders `—` for deltas — f38ac4c
- [x] 4.12 Toggle stays visible while scrolling — f38ac4c
- [x] 4.13 Preset chips remain 44px-tappable on a narrow viewport — f38ac4c

### Phase 5: Charts A1 and A3

#### Automated

- [x] 5.1 `npm run lint` passes — b4cd30c
- [x] 5.2 `npx astro check` reports 0 errors — b4cd30c
- [x] 5.3 `npm run build` passes with a separate reports island chunk — b4cd30c

#### Manual

- [x] 5.4 Bucketing shifts day → week → month across presets with no extra control — b4cd30c
- [x] 5.5 Weeks start on Monday, matching the dashboard calendar — b4cd30c
- [x] 5.6 Tooltips show Polish series names and `zł` values; axis ticks do not overlap — b4cd30c
- [x] 5.7 The recurring toggle visibly changes both charts, not only the tiles — b4cd30c
- [x] 5.8 A3's previous-period line reads as subordinate — b4cd30c
- [x] 5.9 A range predating the account shows only the current line — b4cd30c
- [x] 5.10 Keyboard arrow keys move between data points; no `jsx-a11y` violation in lint — b4cd30c
- [x] 5.11 Charts render legibly on a narrow viewport at both 7-day and full-year ranges — b4cd30c
- [x] 5.12 Two seed users see charts derived only from their own entries — b4cd30c
