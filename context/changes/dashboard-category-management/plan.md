# Dashboard as the Single Capture Surface — Implementation Plan

## Overview

Fold category management into the dashboard itself as a dialog, retire `/categories`, collapse the entry form's chip picker behind `Pokaż więcej`, surface the recurring flag where categories are picked, and fix two dashboard-shell defects (a duplicated sign-out control and a calendar whose day numbers drift off their weekday headers).

This is roadmap **S-07** (`context/foundation/roadmap.md:166-178`), PRD refs FR-004, FR-005, FR-007, FR-009. It touches no schema, adds no dependency, and unblocks S-09 (`category-icons`), which needs a single category editor to add an icon picker to.

## Current State Analysis

**The dashboard is one page with one island.** `src/pages/dashboard.astro` (28 lines) makes zero server-side calls and renders `<DayView client:load />` with no props (`:24`). `DayView` (235 lines) owns all dashboard state: `selectedDate`, `visibleMonth`, `calendarRefreshKey`, `entryType`, both category lists, and the day's entries.

**Category management lives on its own page.** `src/pages/categories.astro` (19 lines) renders `<CategoriesManager client:load />` with no props. `CategoriesManager` (444 lines) is a complete, reviewed CRUD island: add form (name / kind / colour / recurring), two headed sections grouped by kind and sorted alphabetically, inline edit, soft delete. It fetches `GET /api/categories` (both kinds, alphabetical) and patches local state from each mutation response — never refetching the list.

**Two category orderings coexist by design.** The manager is alphabetical (S-01's frozen contract; `GET /api/categories` was explicitly refused a kind or recency parameter). The dashboard picker is recency-first: `listCategoriesForEntryForm` (`src/lib/services/entries.ts:397-455`) returns up to `RECENCY_CHIP_COUNT = 5` recently-used categories, then the remainder alphabetically, scoped by kind via `GET /api/entries/categories?kind=`.

**The picker has no cap today.** `CategoryPicker` (64 lines) renders every category it is given as a chip, with a live text filter as the only narrowing mechanism. It is reused in four places: `EntryForm.tsx:185`, `DayEntriesList.tsx:178`, and twice in `ReceiptReview.tsx` (`:255`, `:336`).

**The tap budget has one tap of headroom.** S-02's measurement rule (`context/archive/2026-08-15-daily-expense-entry/plan.md:54`) counts taps from a rendered today-screen. The common path today is exactly three: amount → chip → Zapisz, against the PRD's ≤4 (`context/foundation/prd.md:126`).

**Two shell defects, both with pinned causes:**

- **Duplicated sign-out.** `Topbar.astro:22-26` renders a POST form labelled "Sign out" (English); `dashboard.astro:13-22` renders a second one labelled "Wyloguj się", and prints the user's email a second time. These are the only two sign-out controls in `src/`.
- **Calendar misalignment.** `MonthCalendar.tsx:99` (weekday header) and `:105` (day numbers) are two independent `grid-cols-7 gap-1` containers. Header cells are bare `<span>`s that stretch the full `1fr` track and centre their glyphs; day cells are fixed `size-11` (44px) buttons with no centering rule on the grid, so each button pins to its track's inline start. Day-number centres sit at `trackStart + 22px` while header glyphs sit at `trackStart + trackWidth/2` — an offset of `(trackWidth − 44)/2`, about 21px on desktop. Below ~332px of content width the 44px buttons *exceed* their track and bleed into the neighbouring column.

**There is no overlay anywhere in the repo.** No `role="dialog"`, no `aria-modal`, no portal, no focus trap, no escape handler. Blocking interactions use `window.confirm` / `window.alert` (`CategoriesManager.tsx:236`, `:246`, `:251`).

### Key Discoveries:

- **No new dependency is needed.** `radix-ui@^1.6.7` (the unified package) is installed and `node_modules/@radix-ui/` already contains `react-dialog`, `react-focus-scope`, `react-focus-guards`, `react-portal`, `react-dismissable-layer`, `react-use-escape-keydown`. The repo's import convention is `import { Checkbox as CheckboxPrimitive } from "radix-ui"` (`src/components/ui/checkbox.tsx:3`) — **not** the per-component `@radix-ui/react-*` packages that `npx shadcn add dialog` would generate and install.
- **A collapse cut at 5 is the server's own cut.** `RECENCY_CHIP_COUNT = 5` (`entries.ts:391`) is already the boundary between the recency-ordered head and the alphabetical tail. Any other N splits the tail mid-alphabet for no reason.
- **A freshly created category sorts into the alphabetical tail.** Recency is computed from `entries`, and a new category has none — so auto-selecting it after creation could select a chip that the collapse has hidden. The collapsed head must be *first 5 ∪ the selected chip*.
- **`EntryForm`'s zero-category branch replaces the whole field block** (`:150-161`), including the `Kategoria` label. A trigger attached only to that label disappears exactly when the user has no categories and most needs it.
- **`kind` immutability is enforced by schema shape alone.** `updateCategorySchema = createCategorySchema.omit({ kind: true })` (`src/lib/services/categories.ts:26`) is the only thing preventing a kind change; S-03's plan calls it "the single most breakable line in the slice" (`context/archive/2026-08-15-income-and-entry-management/plan.md:67`). `CategoriesManager` already honours it: `KindPicker` renders on the add form only (`:295-303`), edit shows static text (`:356-361`), and `handleSaveEdit` spells the PATCH body out field by field (`:213-219`).
- **Name uniqueness is per-user, case-insensitive, across both kinds, and excludes soft-deleted rows** — a partial unique index on `(user_id, lower(name)) where deleted_at is null` (`supabase/migrations/20260815145611_add_category_fields.sql:24`). S-01 explicitly ruled that renaming onto a soft-deleted name is allowed by design.
- **Soft-deleting a category no longer freezes its entries.** `assertCategoryUsable` admits a soft-deleted category when it is the entry's current one (`entries.ts:139-146`), and `updateEntry` passes `existing.category_id` through (`:316`). This landed in `0b8bd2a`, closing S-03's review finding F4. It stays a **manual-verification-only** invariant (`context/foundation/lessons.md:5-13`), and this change puts a delete button one tap above the day list that depends on it.
- **`Entry.category` is an embedded snapshot** (`src/types.ts:42`, `Pick<Category, "id" | "name" | "color">`). Renaming or recolouring a category leaves the day list showing the old name until the day's entries are refetched.
- **Prior art for the collapse is shipped.** `CategoryRanking.tsx:90-125` — a real `<button type="button">` with `aria-expanded`, `min-h-11`, a lucide chevron, a `Pozostałe (n)` label, expanding in place. `context/changes/category-distribution-view/plan.md:85,331` adds the rule that expanding must not move or recolour anything already on screen, and `:302,332` that expansion state resets when the governing toggle changes.
- **Lint is a real gate.** `npm run lint` runs `strictTypeChecked` + `stylisticTypeChecked` + `react-compiler` + `jsx-a11y` as **errors**. Unused variables fail unless `_`-prefixed — which matters when `dashboard.astro` loses its last use of `user`.

## Desired End State

A signed-in user on `/dashboard` can:

- open a dialog from beside the `Kategoria` label (or from the zero-category message) that creates, renames, recolours, flags-as-recurring and deletes categories of **both** kinds, and closes back onto the entry form with a newly created category already selected;
- see at a glance which categories are recurring, from the picker itself;
- see only their five most relevant categories by default, with `Pokaż więcej` revealing the rest in place, and the text filter still searching everything;
- read the day view with exactly one sign-out control, in Polish, and a calendar whose numbers sit under their weekday headers at every viewport width down to 320px.

`/categories` no longer exists as a page; the path redirects to `/dashboard`.

Verified by: `npm run lint` and `npm run build` clean; no `/categories` reference left in `src/` except the middleware redirect; and the manual checklist in each phase, including a re-count of the ≤4-interaction budget.

## What We're NOT Doing

- **No schema change.** No migration, no new column, no RLS change, no pgTAP change. The category CRUD API is used exactly as it ships.
- **Not touching `GET /api/categories`.** It stays "alphabetical, both kinds" — S-01 refused a kind/recency parameter and that refusal stands.
- **Not replacing `window.confirm` / `window.alert`** inside the manager. Chosen deliberately: keeping the manager's shipped logic intact is worth more than a polished confirm, and a native dialog over a Radix modal still functions correctly.
- **Not adding icons to categories.** That is S-09, and it depends on this slice landing first.
- **Not showing `entry.description` in the day list, and not grouping receipt items.** That is S-10.
- **Not collapsing the picker in the day-list edit row or in receipt review.** The collapse is opt-in and the entry form is the only opt-in call site.
- **Not unifying delete semantics.** Entries are hard-deleted, categories soft-deleted; S-03 decided that and it stays.
- **Not translating `Topbar`'s "Dashboard" link,** nor adding an `<h1>` to the dashboard page. Out of the stated scope.
- **No drag-to-reorder, no `sort_order` column, no seeded default categories.** All previously decided against.

## Implementation Approach

Three phases, ordered so each is independently shippable and verifiable:

1. **Shell cleanup** — three small, independent fixes with no shared state. Lands first because it is provable by eye and unblocks nothing else.
2. **Overlay + retirement** — the dialog primitive, the manager rendered inside it, the triggers, the cross-island refresh wiring, then the removal of `/categories` in the same phase (the old page is deleted only once its replacement is proven in the browser).
3. **Collapse + recurring marker** — last, because it is the only part that touches the tap-budgeted path, and the budget must be re-verified against the finished picker.

The overlay reuses `CategoriesManager` essentially as-is, gaining only two optional callback props. This is the decision that neutralises the slice's one real regression risk: the kind selector, duplicate-name handling, colour picker, recurring checkbox and soft-delete flow are already built and reviewed, so income categories cannot become uncreatable.

## Critical Implementation Details

**Refresh, don't patch, after a category mutation.** `DayView`'s two lists come from `listCategoriesForEntryForm`, whose ordering (recency head, alphabetical tail, kind-scoped) is server logic. Reproducing that merge client-side would fork it. Instead, bump a refresh key and let the existing effect refetch both lists — the same pattern `calendarRefreshKey` already uses in this file (`DayView.tsx:17,123`). The one exception is a *created* category: it is appended optimistically to the matching list so its chip can render immediately for auto-selection, before the refetch lands.

**A category mutation must also refresh the day's entries, without a loading flash.** `Entry.category` is a snapshot, so a rename leaves stale names in the list directly below the dialog. The existing entries effect sets `setEntries(null)` on every run (`DayView.tsx:72`), which would replace the list with "Wczytywanie wpisów…" on what should be an invisible refresh. The invariant to hold: a category-driven entries refetch never nulls `entries`; only a date change does.

**The trigger must be `type="button"`.** It sits inside `EntryForm`'s `<form>`; a default-type button would submit the entry instead of opening the dialog.

**Middleware ordering.** The `/categories` → `/dashboard` redirect has to run before the `PROTECTED_ROUTES` check, and `/categories` must leave that array — otherwise an unauthenticated hit is redirected to `/auth/signin` by the guard before the redirect is reached. With the redirect first, an unauthenticated hit chains correctly: `/categories` → `/dashboard` → `/auth/signin`. Use a temporary (302) redirect, not permanent: a 301 is cached by browsers indefinitely and would be unrecoverable if the path is ever reused.

**`max-w-full` is what makes the calendar fix hold on a phone.** Centring alone does not help below ~332px of content width, where a 44px cell is *wider* than its track: at a 375px viewport the dashboard card leaves ~295px, or ~42px per column. Adding `max-w-full` to the cell lets it shrink to the track on narrow screens while keeping the 44px circle everywhere there is room, and keeps the 44px tap height at every width.

## Phase 1: Dashboard shell cleanup

### Overview

Remove the duplicated sign-out control, make `Topbar` fully Polish, and align the calendar's day numbers with their weekday headers at every viewport width.

### Changes Required:

#### 1. Dashboard page — drop the local auth strip

**File**: `src/pages/dashboard.astro`

**Intent**: Delete the page-local user/sign-out strip so `Topbar` is the single auth control. Removing it leaves `user` unused, and unused variables are a lint **error** here, so the `Astro.locals` destructure goes too.

**Contract**: Lines 13-22 (the `mb-4 flex items-center justify-between` strip containing `Zalogowano jako` and the POST form) are removed, along with `const { user } = Astro.locals;` at `:6`. The page keeps its `bg-cosmic` wrapper, `Topbar`, and the glass card holding `<DayView client:load />`. After this change the page renders exactly one sign-out form, from `Topbar`.

#### 2. Topbar — Polish copy, single sign-out

**File**: `src/components/Topbar.astro`

**Intent**: Translate the three English strings so a signed-in Polish user sees no English. This is now the only sign-out control in the app.

**Contract**: `Sign out` → `Wyloguj się` (`:24`), `Not signed in` → `Nie zalogowano` (`:31`), `Sign in` → `Zaloguj się` (`:34`), `Sign up` → `Zarejestruj się` (`:37`). The `Dashboard` link label is deliberately left alone. Markup, classes and the POST target are unchanged.

#### 3. Calendar — align the two grids

**File**: `src/components/entries/MonthCalendar.tsx`

**Intent**: Make each day number sit under its weekday header by centring day cells within their grid track, and stop the fixed-width cells overflowing their track on narrow screens.

**Contract**: The day-number grid (`:105`) gains a centering rule (`place-items-center`) so its cells centre in the same `1fr` tracks the header row (`:99`) centres its glyphs in; both containers keep `grid-cols-7 gap-1` so their column tracks stay identical. The day button (`:118-130`) keeps `size-11` and gains `max-w-full` so it shrinks to the track below ~332px of content width instead of bleeding into the next column. The leading-blank `<span>`s (`:106-108`), the header labels, the `aria-*` attributes and the selected/missing/today styling are unchanged.

### Success Criteria:

#### Automated Verification:

- Types and lint pass: `npx astro sync && npm run lint`
- Build passes: `npm run build`
- No English auth copy remains: `grep -rn "Sign out\|Sign in\|Sign up\|Not signed in" src/` returns nothing
- Exactly one sign-out form renders per page: `grep -rn "api/auth/signout" src/` returns one hit, in `Topbar.astro`

#### Manual Verification:

- `/dashboard` shows one sign-out control and the email once; signing out still works
- `/reports` still shows the Topbar with Polish labels; the signed-out Topbar reads Polish on `/auth/signin`
- Every day number sits centred under its weekday header on desktop
- At a 375px viewport the calendar row does not overflow, cells do not overlap, and the tap target stays comfortable; re-check at 320px
- Selected day, today, and missing-day (red ring) styling all unchanged; month navigation still works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Category overlay, and retirement of `/categories`

### Overview

Add the repo's first dialog primitive, render `CategoriesManager` inside it from the dashboard, wire the dashboard to refresh after category mutations, auto-select a newly created category, then delete the `/categories` page and redirect its path.

### Changes Required:

#### 1. Dialog primitive

**File**: `src/components/ui/dialog.tsx` (new)

**Intent**: Provide a shadcn-shaped dialog giving focus trap, escape-to-close, backdrop click-to-close and `aria-modal` semantics without hand-rolling any of it. Adapt the generated shadcn "new-york" dialog to this repo's import convention rather than taking the per-component Radix package it would otherwise add as a dependency.

**Contract**: Exports `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`. The import is the unified package, matching `checkbox.tsx:3`:

```tsx
import { Dialog as DialogPrimitive } from "radix-ui";
```

so members are reached as `DialogPrimitive.Root`, `DialogPrimitive.Portal`, `DialogPrimitive.Overlay`, `DialogPrimitive.Content`, `DialogPrimitive.Title`, `DialogPrimitive.Description`, `DialogPrimitive.Close`. Do **not** run `npx shadcn add dialog` and keep its `@radix-ui/react-dialog` import — that installs a second copy of a package already present under the umbrella. `DialogContent` must cap its height and scroll internally (`max-h-[90dvh] overflow-y-auto`) because the manager is a tall form, and its close button needs an accessible Polish name (`Zamknij`).

#### 2. Manager — additive mutation callbacks

**File**: `src/components/categories/CategoriesManager.tsx`

**Intent**: Let a parent learn that categories changed, without altering any of the component's shipped behaviour. This is the whole extent of the change to this file: no restructuring, no confirm/alert replacement, no ordering change, no kind-handling change.

**Contract**: The component gains two optional props — `onCreated?: (category: Category) => void`, called with the server-returned row after a successful `POST`; and `onChanged?: () => void`, called after a successful `PATCH` and after a successful `DELETE` (including the 404-treated-as-success path at `:244`). Both default to absent, so the component still renders standalone. Its own local-state updates, alphabetical re-sort, error handling and the `kind`-immutability split between add and edit forms are untouched.

#### 3. Dialog wrapper for the manager

**File**: `src/components/categories/CategoryManagerDialog.tsx` (new)

**Intent**: Wrap the manager in the dialog so the dashboard has one thing to render, and so the manager stays reusable outside a modal.

**Contract**: Props `{ open: boolean; onOpenChange: (open: boolean) => void; onCreated: (category: Category) => void; onChanged: () => void }`. Renders `Dialog` → `DialogContent` with `DialogTitle` `Kategorie` (the heading `categories.astro:12-14` used) and a `DialogDescription` naming what the dialog does, then `<CategoriesManager onCreated={…} onChanged={…} />`. The manager fetches its own list on mount, so opening the dialog is what loads it.

#### 4. Entry form — triggers, dialog ownership, auto-select

**File**: `src/components/entries/EntryForm.tsx`

**Intent**: Give the user a way into category management from where the need arises, and make a category created mid-entry immediately usable. The dialog is owned here, not in `DayView`, because auto-selection writes to this component's `categoryId`.

**Contract**: New props `onCategoryCreated: (category: Category) => void` and `onCategoriesChanged: () => void`, both forwarded to the dialog and used to notify `DayView`. New local `managerOpen` state.

Two triggers, both `type="button"` (a default-type button inside this `<form>` would submit the entry):

- beside the `Kategoria` label (`:184`) — the label becomes a row holding the text and a compact button (`Zarządzaj`), which must not disturb the field's vertical rhythm;
- in the zero-category branch (`:150-161`) — the `<a href="/categories">Dodaj kategorię</a>` anchor at `:157` becomes a button opening the same dialog, keeping the surrounding Polish sentence and its expense/income variants intact.

On create, the handler closes the dialog, and selects the new category **only when `created.kind === type`** — a category of the other kind cannot be the current entry's category. It also clears `filterText` so the new chip is not hidden by a stale filter. On any other mutation it calls `onCategoriesChanged` and leaves the dialog open, matching the manager's existing multi-edit rhythm.

A selection whose category has disappeared from `categories` (deleted in the dialog) must reset to `null`, so the form cannot submit an id the picker no longer shows.

#### 5. Dashboard island — refresh wiring

**File**: `src/components/entries/DayView.tsx`

**Intent**: Refetch both category lists after any category mutation so the picker's server-side ordering stays authoritative, refetch the day's entries so renames and recolours are not left stale in the list below, and make a created category renderable immediately.

**Contract**: A `categoriesRefreshKey` state is added to the dependency array of the existing category effect (`:38-66`), following the `calendarRefreshKey` precedent at `:17`. `onCategoryCreated(category)` appends the row to `expenseCategories` or `incomeCategories` by `category.kind` and bumps that key; `onCategoriesChanged()` bumps it alone. Both are passed to `EntryForm`.

Both also trigger a refetch of the selected day's entries, subject to this invariant: **a category-driven entries refetch must not set `entries` to `null`** — only a date change may, since nulling is what renders "Wczytywanie wpisów…" (`:72`, `DayEntriesList.tsx:125-127`). The existing staleness guards stay as they are: `selectedDateRef` comparisons and the `cancelled` flags are load-bearing (`:103-107`).

#### 6. Retire the page

**Files**: `src/pages/categories.astro` (deleted), `src/middleware.ts`, `src/components/Topbar.astro`, `src/components/reports/distribution.ts`

**Intent**: Remove the second surface now that the dialog covers it, leaving no dead link and no bookmark landing nowhere.

**Contract**:

- `src/pages/categories.astro` is deleted.
- `src/middleware.ts`: `"/categories"` is removed from `PROTECTED_ROUTES` (`:6`) and a redirect to `/dashboard` is added for that path, placed **before** the protected-route check at `:20-27`. A temporary redirect (302), not permanent. `Cache-Control: private, no-store` handling (`:29-31`) is unchanged.
- `src/components/Topbar.astro`: the `Kategorie` nav link (`:16-18`) is removed; `Dashboard` and `Raporty` remain.
- `src/components/reports/distribution.ts`: the three comments citing `/categories` as the colour-dot source of truth (`:40`, `:124`, `:148`) are updated to name the dashboard's category manager instead. Comment-only edits.

### Success Criteria:

#### Automated Verification:

- Types and lint pass: `npx astro sync && npm run lint` — note `jsx-a11y` and `react-compiler` run as errors, and the dialog is the first focus-managed component in the repo
- Build passes: `npm run build`
- The page is gone: `test ! -f src/pages/categories.astro`
- No stale references: `grep -rn '"/categories"\|href="/categories"' src/` returns only the middleware redirect
- No second Radix copy was installed: `git diff --stat package.json package-lock.json` shows no change, and `grep -n "@radix-ui/react-dialog" src/components/ui/dialog.tsx` returns nothing

#### Manual Verification:

- The trigger beside `Kategoria` opens the dialog; Escape closes it; clicking the backdrop closes it; focus is trapped inside while open and returns to the trigger on close
- Tab order inside the dialog reaches the name field, kind selector, colour swatches, recurring checkbox and submit
- Creating an **expense** category while the form is on Wydatek closes the dialog with the new category selected, and saving the entry works
- Creating an **income** category is possible from the dialog (the regression this slice exists to prevent), lands in the income section, and never appears among expense chips
- Creating an income category while the form is on Wydatek closes the dialog and leaves the expense selection untouched
- Renaming a category updates both the picker chip and the name shown in "Wpisy tego dnia", with no "Wczytywanie wpisów…" flash
- Recolouring updates the chip dot and the day-list dot
- Duplicate name (differing only in case) shows the inline `Kategoria o tej nazwie już istnieje` under the name field, not a crash
- A category cannot change kind: edit shows kind as static text with the Polish hint
- **Soft-delete re-verification (permanently manual — `lessons.md:5-13`)**: deleting a category removes it from the picker and the manager; its name becomes reusable; an entry already filed under it still appears in the day list and is still editable — an amount-only correction saves rather than 404ing
- Deleting the currently selected category clears the form's selection instead of leaving a stale one
- With zero categories of the active type, the empty-state message opens the dialog (no dead `/categories` link), for both Wydatek and Przychód
- Visiting `/categories` redirects to `/dashboard`; while signed out it chains to `/auth/signin`
- The Topbar no longer offers `Kategorie`; `Raporty` and `Dashboard` still work
- Receipt capture still works with a category created mid-session
- The dialog is usable at a 375px viewport: content scrolls internally, the page behind does not

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Collapsed picker and the recurring marker

### Overview

Show five chips by default with `Pokaż więcej` revealing the rest in place, mark recurring categories in the chip itself, and re-verify the ≤4-interaction budget against the finished picker.

### Changes Required:

#### 1. Picker — opt-in collapse and the recurring icon

**File**: `src/components/entries/CategoryPicker.tsx`

**Intent**: Keep the chip list short on the tap-budgeted path without hiding anything the user is reaching for, and let a recurring category be recognised where it is picked rather than only where it is managed.

**Contract**: A new optional prop `collapsible?: boolean` (default `false`) leaves all existing call sites — `DayEntriesList.tsx:178` and `ReceiptReview.tsx:255,336` — rendering exactly as they do now.

When `collapsible` is on and `filterText` is empty, the visible set is the **first 5 of the given order, plus the selected chip if it falls outside that head**. The count is a named constant carrying a comment tying it to `RECENCY_CHIP_COUNT` in `entries.ts:391`, which is what makes 5 the non-arbitrary cut. The head may be shorter than 5 (a fresh user has no recency data), and the toggle must not render when nothing is hidden.

The toggle is a real `<button type="button">` with `aria-expanded`, `min-h-11` and a lucide chevron, labelled `Pokaż więcej (n)` / `Pokaż mniej`, mirroring `CategoryRanking.tsx:90-125`. It expands **in place**: no chip already on screen may move or change colour, per `context/changes/category-distribution-view/plan.md:85,331`.

A non-empty `filterText` searches the full list and hides the toggle — the filter stays the one-interaction escape hatch for any chip, expanded or not.

Recurring categories render a lucide repeat glyph inside the chip alongside the existing colour dot. The glyph is decorative (`aria-hidden`); the chip's accessible name must still convey it, so recurring chips take an `aria-label` naming the category and its recurring status in Polish. The empty-filter-result message (`:60`) and the `role="radiogroup"` / `role="radio"` structure are unchanged.

#### 2. Entry form — opt in, and reset on type change

**File**: `src/components/entries/EntryForm.tsx`

**Intent**: Turn the collapse on for the only path it is meant for, and make expansion state follow the Wydatek/Przychód toggle the way the shipped collapse precedent follows its range toggle.

**Contract**: `CategoryPicker` at `:185` receives `collapsible`. Expansion state resets when `type` changes — remounting via `key={type}` is sufficient and keeps the state internal to the picker, matching `category-distribution-view/plan.md:302,332`. `handleTypeChange`'s existing resets of selection, filter and error (`:102-107`) are unchanged.

### Success Criteria:

#### Automated Verification:

- Types and lint pass: `npx astro sync && npm run lint` — `jsx-a11y` will reject an icon-only or unlabelled toggle
- Build passes: `npm run build`
- Other call sites untouched: `git diff src/components/entries/DayEntriesList.tsx src/components/receipts/ReceiptReview.tsx` is empty

#### Manual Verification:

- **Budget re-count (the acceptance constraint on this phase)**: with a recent category, logging an expense is still amount → chip → Zapisz = 3 interactions, ≤10s from a rendered today-screen, per S-02's counting rule
- With ≤5 categories no toggle renders at all
- With more than 5, `Pokaż więcej (n)` reveals the rest below without moving or recolouring the visible chips; `Pokaż mniej` collapses again
- Typing in the filter searches hidden categories too and the toggle disappears; clearing the filter restores the collapsed state
- Selecting a chip from the expanded tail keeps it visible after collapsing — the selected chip is never hidden
- A category created via the dialog is selected **and visible** immediately, despite sorting into the alphabetical tail
- Switching Wydatek ↔ Przychód resets the picker to collapsed
- Recurring categories show the marker in the picker; a screen reader announces the recurring status; non-recurring chips are unchanged
- The day-list edit row and receipt review still show a flat, uncollapsed picker
- Chips remain 44px-comfortable at a 375px viewport

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human.

---

## Testing Strategy

**There is no test framework in this repo** — no vitest, playwright or jest, and no test script (`CLAUDE.md`). Automated verification is therefore limited to `npx astro sync`, `npm run lint`, `npm run build`, and the file/grep assertions listed per phase. This is the same position S-01 through S-06 shipped from (`context/archive/2026-08-15-daily-expense-entry/plan.md:304`).

### What pgTAP covers, and what it cannot:

No migration is written, so `supabase/tests/` needs no change and `npx supabase test db` should stay green untouched — running it once is a cheap regression check that nothing about the schema moved. It proves nothing about this change, because every invariant at stake here lives in application code:

- **soft-delete visibility** — `deleted_at is null` filtering is in the service layer, never in RLS (`lessons.md:5-13`);
- **`kind` immutability** — enforced only by `updateCategorySchema` omitting the field;
- **category ownership and type↔kind agreement** — re-checked in `assertCategoryUsable`, invisible to raw SQL tests.

All three are **permanently manual-verification-only**, and this change touches all three. The soft-delete checklist item in Phase 2 is not optional polish; it is the standing re-verification requirement `lessons.md` imposes on any change to this path.

### Manual Testing Steps:

1. Run `npm ci` before any `npx supabase` command (`lessons.md:15-23` — an unpinned CLI silently strips local grants), then `npx supabase start -x vector` and read the dev port out of the `astro dev` banner rather than assuming 4321.
2. Sign in as a seeded user. Work through Phase 1's checklist at desktop width, then at 375px and 320px.
3. Phase 2: exercise create/rename/recolour/recurring/delete for **both** kinds from the dialog, watching the picker, the day list and the receipt section react. Include the duplicate-name case and the case-only-difference case.
4. Phase 2, the delete path specifically: file an entry under a category, delete that category, then confirm the entry is still listed and an amount-only edit still saves.
5. Phase 2: check the zero-category path by soft-deleting every category of one kind.
6. Phase 3: count the interactions for a routine expense out loud, twice — once with a recent category, once with one in the tail.

## Performance Considerations

Each category mutation now costs three requests from the dashboard (`?kind=expense`, `?kind=income`, and the day's entries) on top of the manager's own. That is acceptable — mutations are rare and human-paced, unlike the picker path. The recency lookback is indexed (`entries_user_id_type_created_at_idx`, added by S-03's review as F6), and `DayView` already fires the two category queries on every dashboard load.

Worth noting rather than acting on: `S-03`'s review flagged that the dashboard issues two recency queries per load; this change adds a third fetch per mutation, not per load. If the manager is ever opened and edited repeatedly in one sitting, debouncing the refresh would be the lever — not needed at this scale.

## Migration Notes

**No migration.** Nothing to sequence against CI's migrate-then-deploy window, and nothing to make backward-compatible with the previous Worker. This is also why the change is safe to deploy in a single step, unlike S-09, which will have to retire the `color` column one deploy behind its code change.

One deployment note that does apply: `/categories` disappearing is a URL contract change. The 302 keeps existing bookmarks working; a 301 would be cached by browsers indefinitely and is deliberately avoided.

## References

- Roadmap slice: `context/foundation/roadmap.md:166-178` (S-07), with S-09's dependency at `:193-199`
- Change identity and carried risks: `context/changes/dashboard-category-management/change.md`
- PRD requirements: `context/foundation/prd.md:87` (FR-004), `:89` (FR-005), `:97` (FR-007), `:101` (FR-009), `:126` (the ≤4/≤10s NFR)
- Standing lessons: `context/foundation/lessons.md:5-13` (app-layer invariants are manual-only), `:15-23` (pin the CLI first)
- Category CRUD decisions: `context/archive/2026-08-15-custom-categories/plan.md:49-62`
- Tap-budget counting rule and the recency algorithm: `context/archive/2026-08-15-daily-expense-entry/plan.md:54-55,146`
- `kind` immutability and kind-scoped recency: `context/archive/2026-08-15-income-and-entry-management/plan.md:47,67,159`, and the fixed F4 finding at `reviews/impl-review.md:66-77` (applied in `0b8bd2a`)
- Collapse pattern precedent: `src/components/reports/CategoryRanking.tsx:90-125`, `context/changes/category-distribution-view/plan.md:85,267,302,331`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dashboard shell cleanup

#### Automated

- [x] 1.1 Types and lint pass: `npx astro sync && npm run lint` — ccb62b5
- [x] 1.2 Build passes: `npm run build` — ccb62b5
- [x] 1.3 No English auth copy remains in `src/` — ccb62b5
- [x] 1.4 Exactly one `api/auth/signout` reference, in `Topbar.astro` — ccb62b5

#### Manual

- [x] 1.5 `/dashboard` shows one sign-out control and the email once; signing out works — ccb62b5
- [x] 1.6 Polish Topbar on `/reports` and on the signed-out `/auth/signin` — ccb62b5
- [x] 1.7 Day numbers centred under their weekday headers on desktop — ccb62b5
- [x] 1.8 No overflow or overlap at 375px and 320px; tap target still comfortable — ccb62b5
- [x] 1.9 Selected / today / missing-day styling and month navigation unchanged — ccb62b5

### Phase 2: Category overlay, and retirement of `/categories`

#### Automated

- [x] 2.1 Types and lint pass: `npx astro sync && npm run lint` — fa9275e
- [x] 2.2 Build passes: `npm run build` — fa9275e
- [x] 2.3 `src/pages/categories.astro` no longer exists — fa9275e
- [x] 2.4 No stale `/categories` references outside the middleware redirect — fa9275e
- [x] 2.5 No new Radix dependency; `dialog.tsx` imports the unified `radix-ui` package — fa9275e

#### Manual

- [x] 2.6 Dialog opens from the trigger; Escape and backdrop close it; focus is trapped and returns to the trigger — fa9275e
- [x] 2.7 Tab order reaches name, kind, colours, recurring checkbox and submit — fa9275e
- [x] 2.8 Creating an expense category closes the dialog with it selected; the entry saves — fa9275e
- [x] 2.9 An income category can be created from the dialog, lands in the income section, and never appears among expense chips — fa9275e
- [x] 2.10 Creating an income category while on Wydatek leaves the expense selection untouched — fa9275e
- [x] 2.11 Rename updates the chip and the day-list name with no loading flash — fa9275e
- [x] 2.12 Recolour updates the chip dot and the day-list dot — fa9275e
- [x] 2.13 Duplicate name (case-insensitive) shows the inline error under the name field — fa9275e
- [x] 2.14 Kind is static text on edit, with the Polish hint — fa9275e
- [x] 2.15 Soft-delete re-verification: removed from picker and manager, name reusable, existing entry still listed and still editable (amount-only correction saves) — fa9275e
- [x] 2.16 Deleting the selected category clears the form's selection — fa9275e
- [x] 2.17 Zero-category empty state opens the dialog, for both Wydatek and Przychód — fa9275e
- [x] 2.18 `/categories` redirects to `/dashboard`; signed out it chains to `/auth/signin` — fa9275e
- [x] 2.19 Topbar no longer offers `Kategorie`; `Dashboard` and `Raporty` work — fa9275e
- [x] 2.20 Receipt capture works with a category created mid-session — fa9275e
- [x] 2.21 Dialog usable at 375px: content scrolls internally, page behind does not — fa9275e

### Phase 3: Collapsed picker and the recurring marker

#### Automated

- [x] 3.1 Types and lint pass: `npx astro sync && npm run lint`
- [x] 3.2 Build passes: `npm run build`
- [x] 3.3 `DayEntriesList.tsx` and `ReceiptReview.tsx` are untouched

#### Manual

- [x] 3.4 Budget re-count: routine expense still 3 interactions, ≤10s
- [x] 3.5 With ≤5 categories no toggle renders
- [x] 3.6 `Pokaż więcej (n)` expands in place without moving or recolouring visible chips; `Pokaż mniej` collapses
- [x] 3.7 The filter searches hidden categories and hides the toggle; clearing restores the collapsed state
- [x] 3.8 A chip selected from the tail stays visible after collapsing
- [x] 3.9 A dialog-created category is selected and visible immediately
- [x] 3.10 Switching Wydatek ↔ Przychód resets the picker to collapsed
- [x] 3.11 Recurring marker visible in the picker and announced by a screen reader
- [x] 3.12 Day-list edit row and receipt review still render a flat picker
- [x] 3.13 Chips remain 44px-comfortable at 375px
