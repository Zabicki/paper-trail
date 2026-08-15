# Daily Expense Entry (S-02, North Star) Implementation Plan

## Overview

Replaces `/dashboard`'s placeholder template with PaperTrail's north-star screen: a day-contextualized expense entry form (amount + category, defaulting to today with zero date interaction) paired with a custom month calendar that marks missing days in red and makes back-dating a first-class navigation, not an afterthought. Backed by a new `entries` table designed from day one to also carry S-03's income as a same-table "sign flip" (FR-006, FR-007, US-01).

## Current State Analysis

- `categories` (S-01) is the only domain table: `id, user_id, name, is_recurring, color, deleted_at, created_at`, 4 granular RLS policies scoped `to authenticated` on `(select auth.uid()) = user_id`, proven by pgTAP. No `entries`/`expenses` table exists.
- The established application pattern (S-01, `context/archive/2026-08-15-custom-categories/plan.md`): additive migration with RLS in the same file → service layer (`src/lib/services/`) wrapping every Supabase query, zod schemas, typed errors (`DuplicateNameError`, `NotFoundError`-style classes) mapped to HTTP status in the API routes → JSON API routes under `src/pages/api/` → a React island that fetches once and updates local state per-mutation (no full-list refetch) → shadcn `new-york` primitives, Polish UI copy.
- `src/middleware.ts` already protects `/dashboard` and sets `Cache-Control: private, no-store`; no middleware change is needed since this plan repurposes `/dashboard` rather than adding a new route.
- `src/components/Topbar.astro` already links to `/dashboard`; no nav change needed.
- `context.locals.user` is a Supabase `User` (`src/env.d.ts`), which carries `created_at` — usable directly as the floor for "missing day" marking without an extra query.
- No date library (`date-fns`, `react-day-picker`) is installed; this plan does not add one (see Key Decisions — custom month grid).
- `zod` is already a dependency (added in S-01); no new dependency for schema validation.

## Desired End State

A signed-in user visiting `/dashboard` sees today's day-view by default: an amount field, a searchable category-chip picker, a save action, and (if any exist) a read-only list of what they've already logged today — reachable and completable in ≤4 taps once the screen is rendered. A month calendar lets them navigate to any day; days between their account-creation date and yesterday with zero entries are marked red, making missed days visible rather than invisible. Selecting a past day back-dates new entries to it with the same form, and shows that day's own read-only list. A user with no categories defined yet sees a block-and-redirect prompt to `/categories` instead of a picker. RLS from F-01/S-01 continues to guarantee no cross-user visibility, now also proven over `entries`.

Verify via: `npx supabase db reset && npx supabase test db` (schema + RLS + constraints), `npm run lint` / `npx astro check` (types), `npm run build`, and a manual walkthrough of `/dashboard` covering same-day entry, back-dating via calendar, the missing-day red marking, the category search-filter, the zero-category block state, and cross-user isolation.

### Key Discoveries:

- The roadmap's own S-03 risk note calls income "the entry form with a sign flip" on the same concept as this slice's expense entry — confirming a unified table now avoids a migration + service-layer rewrite when S-03 lands.
- Postgres foreign-key constraint checks are **not** subject to RLS on the referenced table. A raw FK reference from `entries.category_id` to `categories(id)` would let user A's insert succeed even if `category_id` belongs to user B, because the FK only checks row existence, not ownership. Category ownership must therefore be re-verified in the service layer via a `select ... .eq("id", categoryId)` query (which **is** RLS-scoped) before insert — the FK alone is not sufficient. This mirrors the soft-delete lesson in `context/foundation/lessons.md`: an invariant enforced only in the app layer, not provable by pgTAP against the raw schema.
- `GET /api/categories` (S-01's contract) returns categories alphabetically; this slice needs a different ordering (recency-first) for the entry form's picker, so it gets its own route rather than overloading or changing the existing one.

## What We're NOT Doing

- Not implementing income entry, or a `type` selector in the UI — the `entries` table's `type` column exists and defaults to `'expense'`, but nothing in this slice ever writes or reads `'income'`. That is S-03's job.
- Not building edit or delete of a logged entry — the day's list is read-only. FR-009 (review/edit/delete) is S-03's scope.
- Not adding an index on `entries.category_id` — nothing in this slice queries by category; S-05 adds whatever index its per-category aggregation needs when it exists.
- Not adding a date-picker library (`react-day-picker`/`date-fns`) — the month grid is hand-built.
- Not persisting an in-progress (unsaved) form draft across refresh/crash — only a *failed save* preserves the form's contents for retry. This is a deliberate reading of the durability guardrail that stops short of the offline-queue machinery the PRD calls a non-goal.
- Not bounding calendar month-navigation itself — a user can page arbitrarily far back or forward; only the *red missing-day marking* is bounded to `[account creation, yesterday]` (see Key Decisions).
- Not adding currency symbols/formatting beyond a plain 2-decimal number — no currency is defined anywhere in the PRD (multi-currency is an explicit non-goal), so none is invented here.
- Not touching `src/pages/api/categories/*` or its established alphabetical contract — the new recency-ordered listing is a separate route.

## Implementation Approach

Four phases, bottom-up: (1) schema + RLS + pgTAP for the new `entries` table, (2) service layer + JSON API (including the two read-shapes the UI needs: day list, month "which days have entries" aggregate, and recency-ordered categories), (3) the calendar/day-navigation shell, (4) the entry form, day-detail list, and edge-case handling wired into `/dashboard`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Screen architecture | Combined day view (calendar + form + day's list on one screen) | Matches "day-contextualized entry" directly; fewest taps/screens from app-open |
| Route placement | Replace `/dashboard`'s template content | Already the first screen post-signin and already protected/in-nav — zero new taps |
| Calendar implementation | Custom lightweight month grid, no new dependency | Full control over per-day red-marking; keeps the dependency-free footprint CLAUDE.md favors |
| Entry data model | Unified `entries` table with a `type` discriminant (`'expense' | 'income'`), amount always stored positive | Matches the roadmap's own framing of S-03 as a sign-flip on the same concept; avoids a migration/rewrite later |
| Calendar/back-date range | Navigation is unrestricted; the red "missing" marking is bounded to `[account creation, yesterday]` | User chose unrestricted navigation; the floor/ceiling still apply only to which days get flagged, so paging into pre-signup months doesn't render everything red (see Critical Implementation Details) |
| Missing-day computation | Dedicated per-month aggregate endpoint (`GET /api/entries/days`) | Client never fetches more than one month of raw rows; single indexed query, reusable by S-04 later |
| Interaction-budget unit | Count taps/selections only, from a rendered today-screen; app-open/initial render don't count | Directly measurable by a stopwatch walkthrough; matches the NFR's own "app open to saved entry" as the time window |
| Category picker | Tappable color-chip grid, most-recently-used-first, with a live text filter that narrows the chips as you type | One tap to select; typing "czy" narrows the grid to matches like "czynsz" instead of requiring a scroll — chosen over a native dropdown (two interactions: open + pick) and over literal scroll-to-highlight (filtering is simpler and strictly narrows the visible set) |
| Day-with-existing-entries display | Read-only list beside the add-form | Confirms no double-logging; makes the calendar's red/non-red marking self-explanatory |
| Amount input | `inputmode="decimal"` text field + ≥44×44px touch targets | Triggers the numeric keypad on mobile with no new dependency |
| Durability guardrail | Form survives a failed save (no retyping on retry); no cross-refresh/crash persistence of unsaved input | Satisfies the guardrail for the failure mode that matters (belief of success without actual success) without building offline machinery the PRD excludes |
| Post-save behavior | Clear and stay, with a brief inline confirmation; day's list updates in place | Supports logging several expenses in one sitting with zero navigation between entries |
| Zero-category edge case | Block entry, show a message + link to `/categories` | Keeps "amount, category, date" a hard invariant per FR-006; no synthetic "Uncategorized" bucket to pollute S-05's distribution view |
| UI copy language | Polish | Follows S-01's established precedent for this same product surface |

## Critical Implementation Details

- **Category ownership must be re-checked in the service layer, not left to the FK.** Postgres FK constraints bypass RLS on the referenced table. Before inserting an entry, `createEntry` must run a `select id from categories where id = :categoryId` through the RLS-scoped Supabase client and treat zero rows as `CategoryNotFoundError` (→ `404`) — this is what actually prevents a request from attaching an entry to another user's category id. Document this in the pgTAP suite as an app-layer-only invariant (mirrors the existing soft-delete lesson in `context/foundation/lessons.md`), and confirm it manually since pgTAP driving raw SQL bypasses the service layer entirely.
- **"Today" must be computed from the browser's local date, not a Postgres column default.** `occurred_on` has no `default current_date` — the client computes today's date in the visitor's local timezone and sends it explicitly on every create (including the zero-interaction same-day case). A server-side/DB default would resolve in the Workers runtime's or Postgres session's timezone, which can disagree with the user's actual "today" near midnight.
- **The missing-day floor uses `context.locals.user.created_at`, not a stored per-user setting.** The `GET /api/entries/days` handler clamps the marked range to `[max(monthStart, accountCreatedDate), min(monthEnd, yesterday)]` before returning which days in that window have no entries — days outside the window (pre-signup, today, future) are never included in the "missing" set the client renders in red, even though month navigation itself has no such limit.
- **`GET /api/categories` is untouched.** The entry form's recency-ordered category list is a new route (`GET /api/entries/categories`), not a parameter added to the existing alphabetical endpoint — S-01's contract and its consumer (`CategoriesManager.tsx`) keep working unmodified.

## Phase 1: Schema — `entries` table

### Overview

Add `public.entries` with full per-user RLS in the same migration, following F-01/S-01's proven shape exactly.

### Changes Required:

#### 1. Migration

**File**: new file under `supabase/migrations/`, created via `npx supabase migration new create_entries_table` (let the CLI stamp the timestamp).

**Intent**: Create the table this entire slice is built on, with the constraints that make it safe to build on top of (positive amounts only, a bounded `type` value, a per-day-queryable date column) and RLS enabled from the same statement per `CLAUDE.md`'s hard rule.

**Contract**:
- `id bigint generated always as identity primary key`
- `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade`
- `category_id bigint not null references public.categories (id)`
- `type text not null default 'expense' check (type in ('expense', 'income'))` — only `'expense'` is ever written by this slice; the column exists so S-03 doesn't need a migration to add income.
- `amount numeric(10, 2) not null check (amount > 0)` — always stored positive regardless of `type`; sign semantics for income are S-03's concern at the aggregation layer, not this column.
- `occurred_on date not null` — no column default (see Critical Implementation Details: the client always sends this explicitly).
- `created_at timestamptz not null default now()`
- `create index entries_user_id_occurred_on_idx on public.entries (user_id, occurred_on);` — covers both the FK-index requirement and the two query shapes this slice needs (by-day, by-month-range).
- Four RLS policies (`entries_select_own`, `entries_insert_own`, `entries_update_own`, `entries_delete_own`), `to authenticated`, each keyed on `(select auth.uid()) = user_id` — identical shape to `categories`' policies. (`update`/`delete` policies are created now for schema completeness and RLS-suite symmetry even though no route uses them yet; S-03 is what exercises them.)

#### 2. pgTAP suite

**File**: `supabase/tests/entries_rls_test.sql` (new)

**Intent**: Prove isolation and the new constraints, following `categories_rls_test.sql`'s two-seed-user pattern.

**Contract**: `select plan(N);` (implementer sets N to match the assertions actually written) covering: user A can insert an entry against their own category; user A cannot see user B's entries; user A cannot update/delete user B's entries (0 rows affected, not an error); `amount <= 0` fails the check constraint; an invalid `type` value fails the check constraint; unauthenticated (`anon`) role gets zero rows and cannot insert. Explicitly **not** covered (and commented as such in the test file, pointing at the Critical Implementation Details note above): that `category_id` belongs to the same user — pgTAP driving raw SQL bypasses the service layer's ownership re-check entirely, so this remains a manual/code-review-verified invariant, same category as the soft-delete lesson in `context/foundation/lessons.md`.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all migrations cleanly
- `npx supabase test db` passes with the stated plan count
- `npx astro check` / `npm run lint` pass

#### Manual Verification:

- In Supabase Studio, inserting an entry with `amount <= 0` fails with a check-constraint violation
- Inserting an entry with `type` outside `('expense','income')` fails with a check-constraint violation
- A raw SQL insert (as superuser, bypassing RLS) confirms `category_id` referencing another user's category is accepted by the FK alone — documenting why the service-layer check in Phase 2 is load-bearing, not redundant

---

## Phase 2: Service layer + JSON API

### Overview

A service module owning every Supabase query against `entries` (plus the categories-recency query, which joins `entries`), and the JSON API routes the UI needs: day list, create, month "which days have entries" aggregate, recency-ordered categories.

### Changes Required:

#### 1. Shared types

**File**: `src/types.ts`

**Intent**: Add the `Entry` DTO alongside the existing `Category` types.

**Contract**: Exports `EntryType = "expense" | "income"` and `Entry` (`{ id: number; amount: number; occurredOn: string; type: EntryType; category: Pick<Category, "id" | "name" | "color">; createdAt: string }` — camelCase DTO; `occurredOn` is a `YYYY-MM-DD` string).

#### 2. Service layer

**File**: `src/lib/services/entries.ts` (new)

**Intent**: Own every Supabase query against `entries`, including the ownership re-check described in Critical Implementation Details.

**Contract**: Exports:
- `createEntrySchema` (zod): `{ amount: z.number().positive().max(999999.99), categoryId: z.number().int().positive(), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }`.
- `createEntry(supabase, input)`: re-checks `categoryId` ownership via an RLS-scoped `select` against `categories` (throws `CategoryNotFoundError` on zero rows), then inserts with `type: "expense"` fixed, returns the `Entry` DTO joined with its category's `name`/`color`.
- `listEntriesForDay(supabase, occurredOn)`: entries for one user+date, joined with category `name`/`color`, ordered by `created_at`.
- `listEntryDaysForMonth(supabase, monthStart, monthEnd)`: returns the distinct `occurred_on` values with ≥1 entry in `[monthStart, monthEnd]` for the signed-in user — the clamping to `[account creation, yesterday]` happens in the API route (Change 4 below), not here, since this function doesn't know "today".
- `listCategoriesForEntryForm(supabase)`: fetches active categories (reuses the existing `listCategories`-style query) plus, separately, the last 50 `entries` rows' `category_id` ordered by `created_at desc`; dedupes to the first 5 distinct ids preserving recency, and returns categories reordered with those 5 first (original alphabetical order for the rest) — two plain queries, no database function/RPC, consistent with the rest of the codebase.
- `CategoryNotFoundError` (new error class, same shape as `categories.ts`'s `NotFoundError`).

#### 3. API routes

**File**: `src/pages/api/entries/index.ts` (new)

**Intent**: List a day's entries and create a new one.

**Contract**: `GET ?date=YYYY-MM-DD` → `200` `Entry[]`, `400` `{ error }` on a missing/malformed `date`, `401`/`500` as established. `POST` → validates with `createEntrySchema`, `201` `Entry` on success, `400` `{ error, field }` on validation failure, `404` `{ error }` on `CategoryNotFoundError` (message framed as "category not found," not "not yours," to avoid confirming another user's category id exists).

**File**: `src/pages/api/entries/days.ts` (new)

**Intent**: Power the calendar's missing-day marking for one visible month.

**Contract**: `GET ?month=YYYY-MM` → `200` `{ dates: string[] }`, containing every date in `[max(monthStart, user.created_at's date), min(monthEnd, yesterday)]` that has **no** entry (i.e., this endpoint returns the *missing* set directly, computed by taking the clamped range and subtracting `listEntryDaysForMonth`'s result — the route does the clamping, the service returns raw presence data). `400` on a malformed `month`, `401`/`500` as established.

**File**: `src/pages/api/entries/categories.ts` (new)

**Intent**: Serve the entry form's recency-ordered category list without touching `/api/categories`.

**Contract**: `GET` → `200` `Category[]`, ordered per `listCategoriesForEntryForm`. `401`/`500` as established.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (zod schemas, service, and routes type-check under `strictTypeChecked`)
- `npx astro check` passes

#### Manual Verification:

- `curl` `GET /api/entries?date=<today>` returns `[]` for a fresh user
- `curl -X POST` with a valid body creates an entry and returns `201`
- Posting a `categoryId` that belongs to the other seeded pgTAP user returns `404`, not a leaked cross-user write
- `GET /api/entries/days?month=<current>` returns dates correctly excluding today/future and anything before the test user's `created_at`
- `GET /api/entries/categories` returns categories with recently-used ones first after a few entries are created

---

## Phase 3: Calendar & day navigation UI

### Overview

The custom month-grid component and the day-selection state that the rest of the screen (Phase 4) hangs off of.

### Changes Required:

#### 1. Month calendar component

**File**: `src/components/entries/MonthCalendar.tsx` (new)

**Intent**: Render a month grid of day buttons; fetch and apply the missing-day (red) marking for the visible month; let the parent own which date is currently selected.

**Contract**: Props: `visibleMonth: string` (`YYYY-MM`), `selectedDate: string` (`YYYY-MM-DD`), `onSelectDate(date: string)`, `onMonthChange(month: string)`. On mount and whenever `visibleMonth` changes, fetches `GET /api/entries/days?month=visibleMonth` and renders each in-month day as a button; days present in the response's `dates` get a red marker; the selected day gets a distinct highlight; `aria-current="date"` on today. Month navigation (prev/next arrows) calls `onMonthChange` with no range restriction, per Key Decisions.

#### 2. Day-view container

**File**: `src/components/entries/DayView.tsx` (new)

**Intent**: Own `selectedDate` (default: today, computed client-side in local time) and `visibleMonth` state; render `MonthCalendar` plus a placeholder for Phase 4's form/list (wired in that phase).

**Contract**: `selectedDate` changes when `MonthCalendar` reports a selection; changing `selectedDate` to a date in a different month also updates `visibleMonth`. No data-fetching for the form/list happens here yet — Phase 4 adds that inside the same component.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (React-compiler rules)
- `npx astro check` passes

#### Manual Verification:

- Visiting `/dashboard` (still rendering `Welcome`/placeholder content below the calendar until Phase 4) shows the current month with today highlighted
- Days with logged entries (seed a couple manually via `curl` from Phase 2) are not marked red; days without are, within the account-creation-to-yesterday window
- Paging to a month before account creation shows no red marking (not "all red")
- Clicking a day updates the selection and, if it crosses a month boundary, updates the visible month

---

## Phase 4: Entry form, day detail, and edge cases

### Overview

Wires the actual "log an expense" flow onto the Phase 3 calendar: amount + searchable category picker, the selected day's read-only entry list, the zero-category block state, durability-on-failed-save, and post-save clear-and-stay — then replaces `/dashboard`'s placeholder content entirely.

### Changes Required:

#### 1. shadcn components

**Intent**: Reuse what S-01 already added (`input`, `label`, `checkbox`, `button`) — no new shadcn primitives needed; the category chip grid and calendar cells are plain styled buttons, consistent with S-01's `ColorSwatchPicker` precedent.

#### 2. Category picker

**File**: `src/components/entries/CategoryPicker.tsx` (new)

**Intent**: A text filter above a chip grid (reusing `CATEGORY_COLORS`-style rendering from `CategoriesManager.tsx`'s `ColorSwatchPicker`), recency-ordered via Phase 2's endpoint, narrowing to substring matches (case-insensitive, `"pl"` locale, matching `CategoriesManager.tsx`'s existing `sortByName` convention) as the user types.

**Contract**: Props: `categories: Category[]`, `value: number | null` (selected category id), `onChange(id: number)`, `filterText`/`onFilterTextChange` (controlled by the parent so Phase 4's form can reset it after save). Renders one chip per filtered category (color dot + name); a single tap selects.

#### 3. Entry form + day list

**File**: `src/components/entries/EntryForm.tsx` (new)

**Intent**: Amount input, `CategoryPicker`, submit button; on failed save keeps all field values so the user can just retap save (Critical Implementation Details); on success clears the form and shows a brief inline confirmation.

**Contract**: Amount `<input inputmode="decimal" ...>`, client-side coerced to a number before `POST /api/entries` with `{ amount, categoryId, occurredOn: selectedDate }`. `400`/`404` responses render inline (field-scoped where applicable). On `201`, calls the parent's `onSaved(entry)` (Phase 4 change 5 appends it to the day's list) and resets the form.

**File**: `src/components/entries/DayEntriesList.tsx` (new)

**Intent**: Read-only list of the selected day's entries (fetched via `GET /api/entries?date=...`), refetched whenever `selectedDate` changes and updated locally (append) on each successful save — no full refetch after a save.

**Contract**: Renders each entry's category color/name and amount; empty state ("no entries yet for this day") distinct from the loading state.

#### 4. Zero-category block state

**Intent**: If `GET /api/entries/categories` (or the existing categories check) returns an empty array, `EntryForm` renders a message + link to `/categories` instead of the amount/category inputs.

**Contract**: No `POST /api/entries` call is possible from this state — the form's submit control isn't rendered at all when there are zero categories.

#### 5. Wire into `DayView` and `/dashboard`

**File**: `src/components/entries/DayView.tsx`

**Intent**: Complete the container from Phase 3 — fetch categories-for-entry-form and the selected day's entries, render `EntryForm` and `DayEntriesList` beneath `MonthCalendar`, and pass the `onSaved` callback that appends the new entry to local state and refreshes the visible month's missing-day marking (the day just saved to should no longer render red).

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the current welcome/sign-out template content with `<DayView client:load />`.

**Contract**: Keeps `Layout` + `Topbar` + the sign-out form (still needed — no other page currently offers sign-out); everything below that is `DayView`. Polish copy throughout.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (React-compiler rules, a11y rules on the new form controls)
- `npx astro check` passes
- `npm run build` succeeds

#### Manual Verification:

- Fresh user (zero categories) visiting `/dashboard` sees the block-and-redirect prompt, not a broken form
- After adding a category via `/categories`, returning to `/dashboard` shows a working entry form defaulted to today
- Logging a same-day expense (amount + tap a category chip + save) takes ≤4 taps once the screen is rendered and completes in ≤10s
- Typing a partial category name (e.g. "czy") narrows the chip grid to matches (e.g. "czynsz") without scrolling
- Selecting a past (red) day back-dates a new entry to it; that day's own read-only list shows it immediately after save, and its red marking clears
- Form fields survive a simulated failed save (e.g. offline toggle in devtools) so retrying doesn't require retyping
- After a successful save, the form clears and a brief confirmation shows, ready for the next entry — no navigation occurred
- Signed-out visit to `/dashboard` redirects to `/auth/signin`
- A second signed-in user never sees the first user's entries or their category ids in any response

---

## Testing Strategy

### Unit Tests:

- No unit-test framework exists in this repo (per `CLAUDE.md`) — zod schemas and the recency-ordering logic are exercised via the manual API/browser checks above.

### Integration Tests:

- `entries_rls_test.sql` (Phase 1) is the only automated integration coverage — proves schema constraints and RLS isolation at the database layer. The category-ownership re-check (Critical Implementation Details) is explicitly out of pgTAP's reach and is a permanent manual/code-review-verified invariant, per the existing lesson in `context/foundation/lessons.md`.

### Manual Testing Steps:

1. `npx supabase db reset && npx supabase test db` — confirm schema/constraint/RLS suite passes.
2. Sign in as a fresh user with zero categories; confirm the block-and-redirect prompt on `/dashboard`.
3. Add one category via `/categories`; return to `/dashboard`; confirm the entry form now renders, defaulted to today.
4. Log 2-3 same-day expenses across different categories; confirm each appears in the day's list without a page reload, and count the taps to confirm ≤4.
5. Type a partial category name into the picker; confirm the chip grid narrows correctly.
6. Navigate the calendar back a few days/months; confirm missing days (no entries, within the account-creation-to-yesterday window) are red, and today/future/pre-signup days are not.
7. Select a red day, log an expense against it; confirm it becomes non-red and the day's list shows the new entry.
8. Simulate a failed save (devtools offline); confirm the form's contents survive and a retry succeeds without retyping.
9. Sign in as the second seeded user (or a second real account); confirm zero visibility into the first user's entries, and that submitting the first user's category id (if guessed) returns `404`, not a successful cross-user write.

## Performance Considerations

None specific at this data volume — the month-aggregate query is a single indexed range scan on `(user_id, occurred_on)`, and the day query is a single indexed point lookup on the same index.

## Migration Notes

Additive-only new table; no backfill needed since no entries exist yet anywhere.

## References

- S-01 precedent (schema → service → API → UI shape, zod/typed-error pattern, client-fetch React island convention): `context/archive/2026-08-15-custom-categories/plan.md`
- F-01 RLS pattern to copy exactly: `supabase/migrations/20260815125827_create_categories_table.sql`
- Existing pgTAP suite to mirror: `supabase/tests/categories_rls_test.sql`
- App-layer-only invariant lesson (soft-delete, now also category-ownership): `context/foundation/lessons.md`
- Roadmap slice: `context/foundation/roadmap.md` — S-02

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — `entries` table

#### Automated

- [x] 1.1 `npx supabase db reset` applies all migrations cleanly — fef8f20
- [x] 1.2 `npx supabase test db` passes with the stated plan count — fef8f20
- [x] 1.3 `npx astro check` / `npm run lint` pass — fef8f20

#### Manual

- [x] 1.4 `amount <= 0` fails the check constraint — fef8f20
- [x] 1.5 Invalid `type` value fails the check constraint — fef8f20
- [x] 1.6 Raw-SQL cross-user `category_id` insert confirms the FK alone accepts it (documents why Phase 2's service-layer check is load-bearing) — fef8f20

### Phase 2: Service layer + JSON API

#### Automated

- [x] 2.1 `npm run lint` passes — 489453b
- [x] 2.2 `npx astro check` passes — 489453b

#### Manual

- [x] 2.3 `GET /api/entries?date=<today>` returns `[]` for a fresh user — 489453b
- [x] 2.4 `POST` with a valid body creates an entry, returns `201` — 489453b
- [x] 2.5 Posting another user's `categoryId` returns `404` — 489453b
- [x] 2.6 `GET /api/entries/days?month=<current>` correctly excludes today/future/pre-signup dates — 489453b
- [x] 2.7 `GET /api/entries/categories` returns recently-used categories first — 489453b

### Phase 3: Calendar & day navigation UI

#### Automated

- [x] 3.1 `npm run lint` passes — bdcf535
- [x] 3.2 `npx astro check` passes — bdcf535

#### Manual

- [x] 3.3 Current month renders with today highlighted — bdcf535
- [x] 3.4 Days with entries are not red; days without (within the account-creation-to-yesterday window) are — bdcf535
- [x] 3.5 Paging before account creation shows no red marking — bdcf535
- [x] 3.6 Clicking a day updates selection and visible month correctly across month boundaries — bdcf535

### Phase 4: Entry form, day detail, and edge cases

#### Automated

- [x] 4.1 `npm run lint` passes
- [x] 4.2 `npx astro check` passes
- [x] 4.3 `npm run build` succeeds

#### Manual

- [x] 4.4 Fresh (zero-category) user sees the block-and-redirect prompt
- [x] 4.5 Entry form works after adding a category, defaulted to today
- [x] 4.6 Same-day entry completes in ≤4 taps / ≤10s
- [x] 4.7 Category filter-as-you-type narrows the chip grid correctly
- [x] 4.8 Back-dating via a red day works; that day's list and red marking update immediately
- [x] 4.9 Form survives a simulated failed save without losing entered values
- [x] 4.10 Post-save clears the form with an inline confirmation, no navigation
- [x] 4.11 Signed-out visit to `/dashboard` redirects to `/auth/signin`
- [x] 4.12 Second user has zero visibility into the first user's entries/category ids
