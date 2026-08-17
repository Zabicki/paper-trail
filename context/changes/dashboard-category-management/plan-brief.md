# Dashboard as the Single Capture Surface — Plan Brief

> Full plan: `context/changes/dashboard-category-management/plan.md`

## What & Why

Category management currently lives on its own page, so adding a category mid-entry means leaving the dashboard and coming back. This slice folds that CRUD into a dialog opened from the entry form itself, retires `/categories`, and cleans up two defects that make the dashboard read as unfinished: a duplicated sign-out control and a calendar whose day numbers sit ~21px left of their weekday headers. It is roadmap **S-07** (FR-004, FR-005, FR-007, FR-009), and S-09 (`category-icons`) is blocked on it — the editor that will gain an icon picker is the one this slice moves.

## Starting Point

`/dashboard` is one page with one island: `DayView` owns the calendar, the entry form, receipt capture and the day list, plus both category lists fetched from `GET /api/entries/categories?kind=`. `/categories` is a separate page rendering `CategoriesManager` — a complete, reviewed 444-line CRUD island. The chip picker has no cap today: it renders every category it is given, with a text filter as the only narrowing. No overlay of any kind exists in the repo — no `role="dialog"`, no focus trap, no escape handler.

## Desired End State

A user logging an expense who finds the category missing opens a dialog beside the `Kategoria` label, creates it (either kind), and lands back on the form with it already selected. The picker shows five chips with `Pokaż więcej` for the rest, marks recurring categories inline, and the filter still searches everything. `/categories` is gone; the path redirects. The calendar aligns at every width down to 320px, and there is one sign-out control, in Polish.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Retiring `/categories` | Delete the page, 302 the path to `/dashboard` | One capture surface with no dead bookmarks, and a 301 would be cached by browsers forever. | Plan |
| Overlay contents | Move `CategoriesManager` in as-is | Its kind selector, duplicate-name handling and soft-delete flow are already shipped, so income categories cannot become uncreatable. | Plan |
| Trigger placement | Beside the `Kategoria` label | Sits where the need arises and stays off the tap-budgeted path. | Plan |
| Collapse cut | First 5, expand in place, filter bypasses | `RECENCY_CHIP_COUNT = 5` is already the server's boundary between recency head and alphabetical tail. | Research |
| Selected chip visibility | Head is *first 5 ∪ selected* | A newly created category has no entries, so it sorts into the tail — auto-select would otherwise select a hidden chip. | Plan |
| Recurring marker | Small lucide glyph in the chip | Compact enough for a chip row, reads without a legend, and sets up S-09. | Plan |
| Post-create behaviour | Auto-select and close | Turns the "category is missing" detour into a net-zero-tap path; selects only when the kind matches the form's type. | Plan |
| Calendar fix | `place-items-center` + `max-w-full`, keep 44px | Centring alone still overflows below ~332px of content width, where a 44px cell is wider than its track. | Research |
| Collapse scope | Entry form only, via opt-in prop | Receipt review needs every category visible while filing many items at once. | Plan |
| Shell cleanup depth | Drop the page strip, translate `Topbar` | `Topbar`'s "Sign out" is the last English copy a signed-in Polish user sees. | Plan |
| Refresh strategy | Bump a refresh key, refetch | The picker's ordering is server logic; patching locally would fork it. | Research |

## Scope

**In scope:** dialog primitive (`ui/dialog.tsx`); `CategoriesManager` gains two optional callbacks; triggers in the entry form and its zero-category branch; `DayView` refresh wiring for both category lists *and* the day's entries; auto-select on create; deletion of `categories.astro` plus middleware redirect, nav link and stale comments; collapsed picker with `Pokaż więcej`; recurring marker; duplicate sign-out removed; `Topbar` translated; calendar alignment fixed.

**Out of scope:** any schema change or migration; changing `GET /api/categories`; replacing `window.confirm`/`window.alert` in the manager; category icons (S-09); entry descriptions and receipt grouping (S-10); collapsing the picker in the day-list edit row or receipt review; unifying entry vs category delete semantics.

## Architecture / Approach

`EntryForm` owns the dialog's open state, because auto-selection writes to its `categoryId`. It renders `CategoryManagerDialog` → `CategoriesManager`, which keeps fetching `GET /api/categories` (alphabetical, both kinds) on mount. Mutations bubble up as two callbacks: `onCategoryCreated(category)` and `onCategoriesChanged()`. `DayView` handles both by bumping a `categoriesRefreshKey` — the same pattern `calendarRefreshKey` already uses — so its existing effect refetches both kind-scoped lists rather than reproducing the server's recency-then-alphabetical merge. A created category is also appended optimistically so its chip renders in time to be selected. Because `Entry.category` is an embedded snapshot, a category mutation additionally refetches the day's entries — without nulling them, or the list flashes "Wczytywanie wpisów…".

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dashboard shell cleanup | One Polish sign-out control; calendar numbers aligned at every width | `max-w-full` is what makes it hold on a phone — 44px cells cannot fit 375px otherwise |
| 2. Overlay + retirement | Category CRUD from the dashboard; `/categories` deleted and redirected | Soft-delete now sits one tap above the day list; its app-layer-only invariant is manual-verification-only |
| 3. Collapse + recurring marker | Five chips with `Pokaż więcej`; recurring visible in the picker | Only phase touching the tap-budgeted path — the ≤4 budget must be re-counted |

**Prerequisites:** S-01, S-02, S-03 (all done and archived). No new dependency: `radix-ui@^1.6.7` unified is installed and already contains `react-dialog` / `react-focus-scope`. No Supabase or CI change. Note the working tree currently carries uncommitted S-05/S-06 work in `src/components/reports/` and `src/components/receipts/` — no overlap with this slice's files, but land or stash it before starting.

**Estimated effort:** ~3 sessions, one per phase, each ending in a manual browser pass.

## Open Risks & Assumptions

- **The dialog is the repo's first focus-managed component**, and lint runs `jsx-a11y` + `react-compiler` as errors. Radix supplies the trap, escape and `aria-modal`; the risk is the adaptation, since `npx shadcn add dialog` generates `@radix-ui/react-dialog` imports that must be rewritten to the unified package the repo actually uses.
- **`window.confirm` layered over a Radix dialog is accepted as-is.** It functions correctly but jars visually; polishing it was explicitly deferred to keep the manager's shipped logic intact.
- **`kind` immutability rests on one line** (`updateCategorySchema.omit({ kind: true })`). The manager already honours it; a future refactor of the dialog's form is where it would break.
- **Three invariants at stake are unprovable by pgTAP** — soft-delete visibility, `kind` immutability, and category ownership / type↔kind agreement. All are permanently manual-only per `lessons.md`, and this change touches all three.
- **No test framework exists**, so automated verification is lint, build, and grep assertions only.

## Success Criteria (Summary)

- A user can create, rename, recolour, flag and delete categories of **both** kinds without leaving `/dashboard`, and a category created mid-entry is selected and visible immediately.
- Logging a routine expense still costs 3 interactions and ≤10s, unchanged by the collapse.
- The day view reads clean: one Polish sign-out control, recurring categories recognisable in the picker, and calendar numbers under their headers at 375px and 320px.
