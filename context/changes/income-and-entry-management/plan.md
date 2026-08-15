# Income and Entry Management (S-03) Implementation Plan

## Overview

Make the ledger **trustworthy and correctable**. Two PRD requirements ship together because they share one outcome: FR-008 (log an income) and FR-009 (review, edit and delete logged entries). Income arrives as a second `type` on the existing `entries` table, backed by a new immutable `kind` discriminant on `categories` so income sources never pollute the expense picker. Entry management arrives as inline edit/delete on the day list that `/dashboard` already renders read-only.

## Current State Analysis

S-02 deliberately pre-built half of this slice's schema:

- `supabase/migrations/20260815164539_create_entries_table.sql:11` already carries `type text not null default 'expense' check (type in ('expense','income'))`. No migration is needed for income itself.
- The same migration already creates `entries_update_own` and `entries_delete_own` RLS policies (lines 48–57), documented as existing "for schema completeness and RLS-suite symmetry even though no route uses them yet (S-03 exercises them)". `supabase/tests/entries_rls_test.sql` (`plan(15)`) covers select/insert isolation but never exercises those two policies.
- `src/lib/services/entries.ts:70` hardcodes `type: "expense"` on insert; `createEntrySchema` has no `type` field.
- `src/pages/api/entries/index.ts` exposes only `GET` (list-by-day) and `POST` (create). There is no `src/pages/api/entries/[id].ts`.
- `src/components/entries/DayEntriesList.tsx` is a pure read-only render — no edit, no delete, no totals.

What's missing, and the one real design tension:

- `entries.category_id` is `not null` (migration line 10) while categories are defined by FR-004 as *expense* categories. Nothing upstream says what an income points at. **Resolved here**: `categories` gains a `kind` column; income entries reference an income-kind category, so `not null` stands unchanged.
- `src/pages/api/entries/days.ts:62` marks a day "not missing" if *any* entry exists for it, so an income-only day would silently clear the red retention nudge.
- `src/lib/services/entries.ts:114` (`listCategoriesForEntryForm`) builds both the category list and the recency chip order from all entries regardless of type.
- `updateCategorySchema` is a bare alias of `createCategorySchema` (`src/lib/services/categories.ts:19`) — once `kind` joins the create schema, that alias would make `kind` editable by accident.

## Desired End State

On `/dashboard`, a quiet Wydatek/Przychód segmented toggle sits above the entry form, always defaulting to Wydatek so the north-star expense path stays zero-interaction. Switching to Przychód swaps the chip picker to the user's income categories. The day's list below is no longer read-only: every row has Edytuj and Usuń, income rows read `+` in green, and a summary line shows the day's expense total and income total side by side, never netted. Calendar red-marking now tracks expenses only, so a payday never certifies a day's spending as logged.

On `/categories`, adding a category asks whether it's an expense or income category; the choice is shown read-only when editing, and the list is grouped by kind.

Verify by: logging an income against today and against a back-dated day; correcting an entry's amount, category and date (including moving it to a different day); deleting an entry and watching the day's red marking return; and confirming with a second seed user that none of it is cross-visible.

### Key Discoveries:

- `entries.type` and both write-side RLS policies already exist — Phase 1's migration touches only `categories` (`supabase/migrations/20260815164539_create_entries_table.sql:11,48-57`).
- The category-ownership re-check pattern is established at `src/lib/services/entries.ts:50-62`: an RLS-scoped `select` on `categories` before insert, because Postgres FK checks bypass RLS on the referenced table. The new type↔kind check extends that same query rather than adding a round trip.
- PATCH/DELETE route conventions are fully worked out in `src/pages/api/categories/[id].ts` — `parseId`, `PGRST116`→`NotFoundError`→404, `204 No Content` on delete. Copy that shape.
- Inline-edit UI conventions are worked out in `src/components/categories/CategoriesManager.tsx:120-170` — `editingId` state, `startEdit`/`cancelEdit`, `window.confirm` before delete, `deletingId` for the pending state.
- `src/lib/api-error.ts` (`parseErrorBody`, `ApiErrorBody`) is the shared error-body helper, extracted during S-02's review. Use it; don't re-inline it.
- S-02's review finding F1 (`context/archive/2026-08-15-daily-expense-entry/reviews/impl-review.md:31-39`) established the `selectedDateRef` guard against late responses landing in the wrong day's list. Edit and delete callbacks need the same guard.
- `context/foundation/lessons.md` rule: invariants enforced only in application code must be explicitly named as manual-only. Two of them appear in this slice (below).

## What We're NOT Doing

- **No separate `/entries` review page.** Review happens inline on the day list; a cross-day ledger view would duplicate S-04's date-range work.
- **No soft delete, no undo.** Deletes are permanent, guarded by `window.confirm`. Entries are leaves — nothing references them — so the referential reason categories are soft-deleted does not apply.
- **No changing an entry's `type` after creation.** Delete and re-add instead. `type` is not in the update schema.
- **No changing a category's `kind` after creation.** The edit form renders it read-only and the PATCH schema rejects it.
- **No netting.** Income is never subtracted from expenses anywhere — day totals are shown as two separate figures.
- **No date-range or category-distribution views** (S-04/S-05), and no currency symbol (PRD excludes multi-currency).
- **No JS test framework.** `CLAUDE.md` marks that a setup decision to raise separately; the two app-layer invariants below stay manual-only.
- **No index on `categories.kind`.** Per-user category counts are tiny and every query is already `user_id`-scoped by RLS.

## Implementation Approach

Bottom-up, mirroring S-02: schema and its pgTAP proof first, then the service + API write surface, then the two UI surfaces (categories manager before dashboard, because you need an income category to exist before you can log an income).

The migration is additive with a default (`'expense'`), which matters beyond tidiness: per `CLAUDE.md`, CI applies migrations *before* deploying the Worker, so the new column must be harmless to the currently-deployed code. It is — S-01's code never selects or writes `kind`.

## Critical Implementation Details

**Backward-compatible migration ordering.** `.github/workflows/ci.yml` runs `supabase db push` between build and `wrangler deploy`. Between those two steps the *old* Worker runs against the *new* schema. `kind` defaults to `'expense'` and nothing existing references it, so that window is safe. Do not add a NOT NULL column without a default in this or any later slice.

**Two app-layer-only invariants (per `context/foundation/lessons.md`).** pgTAP drives raw SQL and cannot reach the TypeScript service layer, so neither of these is provable by the test suite and both must be re-verified manually by any future change touching `src/lib/services/entries.ts`:
1. *An entry's `type` matches its category's `kind`.* Enforced only by the pre-insert/pre-update check in `createEntry`/`updateEntry`. A raw SQL insert can still pair an income with an expense category.
2. *Category ownership* — S-02's existing invariant, unchanged, and now also load-bearing on the update path.

**Kind immutability is enforced by schema shape, not by a check.** `updateCategorySchema` currently aliases `createCategorySchema`; once `kind` joins the create schema the alias must be replaced with an explicit omission, otherwise a PATCH silently flips kind under existing entries. This is the single most breakable line in the slice.

**Stale-day race on edit/delete.** A `PATCH` that changes `occurredOn` moves the entry off the day being viewed, and a response can land after the user has navigated to another day. Reuse S-02's `selectedDateRef` pattern: apply list mutations only when the response's day still matches the selected day; always bump `calendarRefreshKey` regardless, since the *other* day's red marking may have changed too.

## Phase 1: Schema & RLS verification

### Overview

Add the `kind` discriminant to `categories` and close the pgTAP gap on the entry write policies S-02 created but never exercised.

### Changes Required:

#### 1. Category kind migration

**File**: `supabase/migrations/20260815181500_add_category_kind.sql` (regenerate the timestamp with `date -u +%Y%m%d%H%M%S` if this collides)

**Intent**: Give every category an expense/income kind so income entries have something valid to reference, without relaxing `entries.category_id`'s NOT NULL. Defaulted so existing rows and the currently-deployed Worker are unaffected.

**Contract**: `alter table public.categories add column kind text not null default 'expense' check (kind in ('expense','income'));` — no index, no policy change (kind does not affect ownership semantics, exactly as the S-01 `add_category_fields` migration reasoned about its own columns). Leave `categories_user_id_name_lower_idx` untouched: a name stays unique per user across both kinds, which is simpler than a per-kind unique index and matches how a user thinks about naming.

#### 2. Categories pgTAP: kind constraint

**File**: `supabase/tests/categories_rls_test.sql`

**Intent**: Prove the new column's constraint and default at the database layer.

**Contract**: Two added assertions — a `throws_ok` on inserting `kind = 'transfer'` (check-constraint violation, SQLSTATE `23514`), and an `is(...)` proving a category inserted without `kind` comes back `'expense'`. Bump the `plan(n)` count accordingly.

#### 3. Entries pgTAP: exercise the update/delete policies

**File**: `supabase/tests/entries_rls_test.sql`

**Intent**: The `entries_update_own` and `entries_delete_own` policies have never been tested. This slice is the first to route traffic through them, so prove the cross-user case now.

**Contract**: Added assertions in the existing user-B section — B attempting `update public.entries set amount = 999` and `delete from public.entries` against user A's row must affect **zero rows** (RLS filters the row out; these are not errors, so assert on affected/returned row count rather than `throws_ok`), and A's row must survive unchanged in the closing superuser section. Also assert that a user *can* update and delete their own row. Bump `plan(15)` accordingly.

Extend the header comment block with the type↔kind gap, in the same style the existing block uses for the category-ownership gap.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all five migrations cleanly
- `npx supabase test db` passes with the raised plan counts (`Files=2`)
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- In Studio (`http://localhost:54323`), existing seeded categories all show `kind = 'expense'`
- Attempting `update categories set kind = 'income'` succeeds at the raw SQL layer (confirming immutability is an app-layer rule, not a database one — this is the gap the plan documents rather than closes)

---

## Phase 2: Service layer + API write surface

### Overview

Thread `kind` through the categories service, teach the entries service about income and the type↔kind invariant, and add the missing `PATCH`/`DELETE` endpoints.

### Changes Required:

#### 1. Shared types

**File**: `src/types.ts`

**Intent**: Expose the new discriminant to both the service layer and the React islands.

**Contract**: Add `export type CategoryKind = "expense" | "income";` and a `kind: CategoryKind` field on `Category`. `EntryType` already exists and stays as-is; `Entry.category` keeps its `Pick<Category, "id" | "name" | "color">` shape.

#### 2. Categories service — kind on create, never on update

**File**: `src/lib/services/categories.ts`

**Intent**: Let a category be created as either kind, and make it structurally impossible to change kind afterwards.

**Contract**: `createCategorySchema` gains `kind: z.enum(["expense","income"]).default("expense")`. `updateCategorySchema` stops aliasing it and becomes `createCategorySchema.omit({ kind: true })` — keep the existing comment about PATCH being full-replace and extend it to say kind is deliberately excluded. `SELECT_COLUMNS` gains `kind`, `CategoryRow` and `toDto` map it, `createCategory` writes it, `updateCategory` does not. `listCategories` gains no filter — the manager shows both kinds.

#### 3. Entries service — income, kind matching, update, delete

**File**: `src/lib/services/entries.ts`

**Intent**: Accept income on create, enforce that an entry's type matches its category's kind on both write paths, and add the two missing operations.

**Contract**:
- `createEntrySchema` gains `type: z.enum(["expense","income"]).default("expense")`; `createEntry` writes `input.type` instead of the hardcoded `"expense"` at line 70.
- The existing pre-insert category lookup (lines 50–62) additionally selects `kind`. A kind mismatch throws a new `CategoryKindMismatchError`, distinct from `CategoryNotFoundError` — a mismatch is a real client bug worth its own message, whereas a missing/foreign category must stay ambiguously "not found".
- New `updateEntrySchema = createEntrySchema.omit({ type: true })` — full-replace of `{ amount, categoryId, occurredOn }`, matching the categories PATCH convention.
- New `updateEntry(supabase, id, input)`: read the target entry's `type` first (`.select("type").eq("id", id).maybeSingle()`; absent → `NotFoundError`), run the same ownership + kind check against the incoming `categoryId`, then update and return the full DTO via `SELECT_COLUMNS`.
- New `deleteEntry(supabase, id)`: `.delete().eq("id", id).select("id")`; an empty result array means the row was absent or RLS-filtered → `NotFoundError`. Mirror `softDeleteCategory`'s error shape.
- Reuse a `NotFoundError` for entries — declare it in this module rather than importing the categories one, keeping the two services independent.
- `listEntryDaysForMonth` gains `.eq("type", "expense")` so income never clears a red day. Update the function's doc comment to state this — it is a product rule, not an optimisation.
- `listCategoriesForEntryForm(supabase, kind)` takes the kind, filters `categories` by it, and filters the recency lookback query by the matching entry `type` so income recency never reorders expense chips.

#### 4. Entry item endpoint

**File**: `src/pages/api/entries/[id].ts` (new)

**Intent**: The HTTP surface for correcting and removing an entry.

**Contract**: `PATCH` and `DELETE` exports following `src/pages/api/categories/[id].ts` exactly — local `parseId`, null Supabase client → 500, no user → 401, zod issue → 400 with `{ error, field }`. `PATCH` returns the updated `Entry` at 200; `DELETE` returns 204 with a null body. Error mapping: `NotFoundError` → 404 `"Nie znaleziono wpisu"`, `CategoryNotFoundError` → 404 `"Nie znaleziono kategorii"` with `field: "categoryId"`, `CategoryKindMismatchError` → 400 with `field: "categoryId"` and a message naming the mismatch.

#### 5. Entry-form categories endpoint takes a kind

**File**: `src/pages/api/entries/categories.ts`

**Intent**: Serve the chip picker the right list for the type being logged.

**Contract**: Read `?kind=` from the query string, validate against `expense|income`, default to `expense` when absent (keeps the endpoint backward-compatible mid-deploy), 400 on anything else. Pass it through to `listCategoriesForEntryForm`.

#### 6. Create endpoint passes type through

**File**: `src/pages/api/entries/index.ts`

**Intent**: No structural change — `createEntrySchema` now carries `type`, so `POST` just needs the new error branch.

**Contract**: Add the `CategoryKindMismatchError` → 400 branch alongside the existing `CategoryNotFoundError` → 404 branch. `GET` is unchanged and keeps returning both types for the day.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (`strictTypeChecked` — the new zod schemas and error classes must type cleanly)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- `POST /api/entries` with `type: "income"` and an expense-kind `categoryId` returns 400, not 201 — the app-layer invariant that pgTAP cannot prove
- `PATCH /api/entries/<id>` against another user's entry id returns 404 (RLS-filtered, never "not yours")
- `DELETE /api/entries/<id>` twice returns 204 then 404
- `PATCH /api/categories/<id>` with a `kind` field in the body leaves the stored kind unchanged
- `GET /api/entries/days?month=…` still reports a day as missing when that day has only income on it

---

## Phase 3: Categories manager — kind selection

### Overview

Let the user create income categories and see the two kinds separated.

### Changes Required:

#### 1. Kind on the add form, read-only on edit, grouped list

**File**: `src/components/categories/CategoriesManager.tsx`

**Intent**: Surface the new discriminant without implying it can be changed later.

**Contract**: `FormState` gains `kind: CategoryKind`; `EMPTY_FORM` defaults to `"expense"`. The add form gets a two-option `role="radiogroup"` segment (Wydatki / Przychody) styled like the existing `ColorSwatchPicker` group. The edit form renders the kind as static text, not a control — with a short hint that kind cannot be changed. The list splits into two headed sections (Kategorie wydatków / Kategorie przychodów), each alphabetically sorted via the existing `sortByName`, each with its own empty-state line. `handleAdd` sends `kind`; `handleSaveEdit` does not.

Polish copy throughout, matching the file's existing strings.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- Creating a category with Przychody selected lands it in the income section and it never appears in the expense chip picker
- Editing a category shows its kind as text with no way to change it, and saving preserves both kind and the other fields
- Both sections render their empty state correctly on a fresh account

---

## Phase 4: Dashboard — income entry and an editable day list

### Overview

The tap-sensitive phase. Add the type toggle without costing the expense path a single interaction, and turn the read-only day list into the review/edit/delete surface.

### Changes Required:

#### 1. Both category lists loaded up front

**File**: `src/components/entries/DayView.tsx`

**Intent**: Have the income chip list ready before the toggle is touched, so switching to Przychód is instant rather than triggering a visible fetch.

**Contract**: Fetch `/api/entries/categories?kind=expense` and `?kind=income` in parallel on mount (mirroring the existing single-fetch effect's cancellation guard), holding both in state as `expenseCategories` / `incomeCategories`. Both are passed to `EntryForm` and to `DayEntriesList` (an entry's edit picker must offer the categories of that entry's own kind). Add `handleUpdated` and `handleDeleted` alongside the existing `handleSaved`, all three guarded by `selectedDateRef` per the S-02 F1 pattern and all three bumping `calendarRefreshKey`.

#### 2. Type toggle on the entry form

**File**: `src/components/entries/EntryForm.tsx`

**Intent**: Make income one extra tap and expense zero extra taps.

**Contract**: New `type` state defaulting to `"expense"`, reset to `"expense"` after every successful save (so the next entry in a sitting starts from the default again). A quiet two-button segmented control above the amount field, `role="radiogroup"` with `aria-checked`, labelled Wydatek / Przychód. Selecting a type clears `categoryId` and `filterText` (the chip list underneath it changes). The `categories` prop becomes the two lists; the picker renders the one matching `type`. The submit body gains `type`; the submit button label and the zero-category block state both follow the selected type (the income block state links to `/categories` with income-specific copy). Heading above the form follows the type too — `Dodaj wydatek` / `Dodaj przychód` lives in `DayView`, so lift it or pass the type up.

#### 3. Editable, totalled day list

**File**: `src/components/entries/DayEntriesList.tsx`

**Intent**: Turn the read-only list into the review surface: correct an amount, category or date in place, or delete the row.

**Contract**: Props gain `expenseCategories`, `incomeCategories`, `onUpdated(entry)`, `onDeleted(id)`. Per-row Edytuj / Usuń buttons and inline edit state (`editingId`, `editForm`, `saving`, `deletingId`) following `CategoriesManager.tsx:120-170`. The edit form holds amount (same `inputMode="decimal"` treatment as `EntryForm`, comma accepted), a `CategoryPicker` fed the list matching the entry's kind, and a native `<input type="date">` for the day — a rare path that doesn't justify reusing the month calendar. Save issues `PATCH /api/entries/<id>` with the full `{ amount, categoryId, occurredOn }` triple; delete issues `DELETE` behind `window.confirm("Usunąć ten wpis?")`, matching the categories confirm. Errors surface through `parseErrorBody` from `@/lib/api-error`.

Presentation: income rows carry a `+` prefix and emerald text (expense rows unchanged); a summary line above or below the list shows `Wydatki: <sum>` and `Przychody: <sum>` as two separate figures, each `toFixed(2)`, never netted. When the list is empty both totals are omitted rather than shown as zeros.

**Note on the date change**: when a `PATCH` response comes back with an `occurredOn` different from the day being viewed, the row leaves this list (the parent's `handleUpdated` drops it) — this is expected, and the calendar refresh is what tells the user where it went.

#### 4. Float summation note

**File**: `src/components/entries/DayEntriesList.tsx`

**Intent**: Record why summing here is acceptable, since S-02's review flagged it forward (finding F4).

**Contract**: A short comment stating that PostgREST returns `numeric(10,2)` as a JS `number` and that summing is bounded to one day's rows here; the real fix belongs with S-04/S-05's aggregation work.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (including `react-compiler` rules, which run as errors)
- `npx astro check` reports 0 errors
- `npm run build` passes

#### Manual Verification:

- Logging a same-day **expense** still takes ≤4 taps and ≤10 seconds from a rendered `/dashboard` — the toggle must not have cost a tap
- Logging an income takes exactly one tap more, and the form returns to Wydatek afterwards
- Editing an entry's amount and category updates the row and the day totals in place
- Editing an entry's date moves it off the current day's list and both affected days' calendar markings update
- Deleting the only expense on a past day makes that day red again
- Submitting an edit, then navigating to a different day before the response lands, does not splice the row into the wrong day (S-02 F1 regression check)
- A second seed user sees none of the first user's entries or categories, and cannot edit or delete them by id

---

## Testing Strategy

### Database (pgTAP — `npx supabase test db`):

- `kind` check constraint rejects unknown values; default is `'expense'`
- Cross-user `UPDATE` and `DELETE` on `entries` affect zero rows and leave the owner's row intact
- Owner's own `UPDATE`/`DELETE` succeed
- Existing select/insert isolation assertions continue to pass unchanged

### Manual-only (permanently, per `context/foundation/lessons.md`):

- **Entry `type` matches its category's `kind`** — enforced only in `createEntry`/`updateEntry`; a raw SQL insert can still violate it. Any future change to `src/lib/services/entries.ts` must re-verify this by hand.
- **Category ownership on the update path** — S-02's existing app-layer invariant, now load-bearing on `updateEntry` too.
- **Category `kind` immutability** — enforced only by `updateCategorySchema` omitting the field; the database will happily accept a raw `update`.
- **The ≤4-tap / ≤10s expense budget** — a human stopwatch judgment, as in S-02.

### Manual Testing Steps:

1. Create one income category and one expense category on `/categories`; confirm the grouped sections and the read-only kind on edit.
2. On `/dashboard`, log a same-day expense while counting taps and timing the run.
3. Toggle to Przychód, confirm the chip list changed, log an income; confirm the form resets to Wydatek.
4. Confirm the day's summary shows both totals separately and the income row reads `+` in green.
5. Edit the expense: change its amount, then its category, then its date to another day. Confirm the list, the totals, and both days' calendar markings.
6. Delete an entry; confirm the confirm-dialog, the row's removal, and the red marking returning if it was the day's only expense.
7. Back-date an income to a day with no expenses; confirm that day stays red.
8. Sign in as the second seed user; confirm total isolation and that a hand-crafted `PATCH`/`DELETE` against the first user's entry id returns 404.

## Performance Considerations

`updateEntry` costs two round trips (read the entry's type, then the category check + update). At this data volume that's irrelevant, and collapsing it into a single statement would push the invariant into SQL where the service layer can no longer own it. The extra `?kind=` category fetch on mount is one additional small query against an already `user_id`-indexed table.

## Migration Notes

One additive migration with a default value — no backfill, no data movement, and safe in the window where CI has pushed the schema but not yet deployed the Worker. Rollback is `alter table public.categories drop column kind;`, which is only safe before any income entry exists.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD: `context/foundation/prd.md` (FR-008, FR-009)
- Prior slice this builds on: `context/archive/2026-08-15-daily-expense-entry/plan.md`, and its review findings F1/F4 at `context/archive/2026-08-15-daily-expense-entry/reviews/impl-review.md:31,60`
- Lessons: `context/foundation/lessons.md` (app-layer-only invariants)
- PATCH/DELETE route pattern: `src/pages/api/categories/[id].ts`
- Inline-edit UI pattern: `src/components/categories/CategoriesManager.tsx:120-170`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RLS verification

#### Automated

- [x] 1.1 `npx supabase db reset` applies all five migrations cleanly — 4e3107c
- [x] 1.2 `npx supabase test db` passes with the raised plan counts (`Files=2`) — 4e3107c
- [x] 1.3 `npm run lint` passes — 4e3107c
- [x] 1.4 `npm run build` passes — 4e3107c

#### Manual

- [x] 1.5 Existing seeded categories all show `kind = 'expense'` in Studio — 4e3107c
- [x] 1.6 Raw SQL can still change `kind`, confirming immutability is an app-layer rule — 4e3107c

### Phase 2: Service layer + API write surface

#### Automated

- [x] 2.1 `npm run lint` passes — a20c35b
- [x] 2.2 `npx astro check` reports 0 errors — a20c35b
- [x] 2.3 `npm run build` passes — a20c35b

#### Manual

- [x] 2.4 `POST /api/entries` with mismatched type/category kind returns 400 — a20c35b
- [x] 2.5 `PATCH /api/entries/<id>` against another user's entry returns 404 — a20c35b
- [x] 2.6 `DELETE /api/entries/<id>` twice returns 204 then 404 — a20c35b
- [x] 2.7 `PATCH /api/categories/<id>` cannot change `kind` — a20c35b
- [x] 2.8 An income-only day is still reported as missing by `/api/entries/days` — a20c35b

### Phase 3: Categories manager — kind selection

#### Automated

- [x] 3.1 `npm run lint` passes — 93392da
- [x] 3.2 `npx astro check` reports 0 errors — 93392da
- [x] 3.3 `npm run build` passes — 93392da

#### Manual

- [x] 3.4 An income category lands in the income section and never appears in the expense picker — 93392da
- [x] 3.5 Editing shows kind as read-only text and preserves it on save — 93392da
- [x] 3.6 Both sections render their empty state on a fresh account — 93392da

### Phase 4: Dashboard — income entry and an editable day list

#### Automated

- [x] 4.1 `npm run lint` passes — 246dfce
- [x] 4.2 `npx astro check` reports 0 errors — 246dfce
- [x] 4.3 `npm run build` passes — 246dfce

#### Manual

- [x] 4.4 Same-day expense still takes ≤4 taps and ≤10 seconds — 246dfce
- [x] 4.5 Income takes exactly one extra tap; form resets to Wydatek after save — 246dfce
- [x] 4.6 Editing amount and category updates the row and the day totals — 246dfce
- [x] 4.7 Editing a date moves the entry and updates both days' calendar markings — 246dfce
- [x] 4.8 Deleting the only expense on a past day makes that day red again — 246dfce
- [x] 4.9 Editing mid-navigation does not splice a row into the wrong day (S-02 F1 regression) — 246dfce
- [x] 4.10 A second user sees, edits and deletes none of the first user's data — 246dfce
