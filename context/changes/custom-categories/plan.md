# Custom Categories (S-01) Implementation Plan

## Overview

Users can define, rename, delete, recolor, and flag their own expense categories as a large recurring cost (FR-004, FR-005). F-01 already created a minimal `categories` table (`id, user_id, name, created_at`) with full per-user RLS as its proof table; this plan extends that table with the remaining product fields and builds the first real application code in the repo on top of it: a JSON API, a service layer, and a client-rendered `/categories` page.

## Current State Analysis

- `supabase/migrations/20260815125827_create_categories_table.sql` creates `public.categories` with 4 granular RLS policies (`select`/`insert`/`update`/`delete`, all `to authenticated`, keyed on `(select auth.uid()) = user_id`). This migration is done and should not be edited — F-01 is closed out (see `context/changes/data-foundation-rls/`).
- `supabase/tests/categories_rls_test.sql` is a 9-assertion pgTAP suite proving isolation on the current shape, run via two fixed seed users in `supabase/seed.sql` (`11111111-…` / `22222222-…`).
- Zero application code exists for categories or any other domain entity: no `src/types.ts`, no `src/lib/services/`, no API routes beyond `src/pages/api/auth/*`, no client-side data-fetching pattern anywhere in the repo.
- `zod` is referenced by `CLAUDE.md`/roadmap as "available but unused" but is **not actually a dependency** — `npm install zod` is required in this change.
- The only existing form/API convention (`src/pages/api/auth/{signin,signup,signout}.ts`) is native `FormData` POST + redirect-with-`?error=`, designed so auth works without JS. This plan does **not** follow that convention — see Key Decisions below.
- `src/middleware.ts` gates page routes via `PROTECTED_ROUTES` (currently `["/dashboard"]`, prefix-matched) and sets `Cache-Control: private, no-store` on any request with a signed-in user or a protected path. This already covers new API responses once `context.locals.user` is populated — no middleware change needed beyond adding the new page path.
- `src/components/Topbar.astro` is the only nav surface today (Dashboard / sign out when signed in).
- shadcn is configured (`new-york`, `neutral`, lucide icons) but only `button.tsx` exists under `src/components/ui/`.

## Desired End State

A signed-in user can visit `/categories`, see their own categories (or an empty-state prompt if they have none), add a new category with a name/color/recurring flag, rename or recolor or toggle the recurring flag on any existing category inline, and delete one — all without a full page reload. Deleting is a soft delete (`deleted_at`); a signed-in user can never see or act on another user's categories (still enforced by F-01's RLS, unchanged). Category names are unique per user, case-insensitively, among non-deleted categories.

Verify via: `npx supabase db reset && npx supabase test db` (schema + RLS + constraints), `npm run lint` / `npx astro check` (types), and a manual walkthrough of `/categories` in the browser covering add, rename, recolor, toggle-recurring, delete, empty state, and the duplicate-name error.

### Key Discoveries:

- F-01's plan brief (`context/changes/data-foundation-rls/plan-brief.md`) explicitly reserves `is_recurring` and rename semantics for this change — confirms this is additive schema work, not a new table.
- The roadmap's S-01 Unknown ("does renaming rewrite chart history?") is already resolved: rename in place, no versioning, revisit only if S-05 makes it visible. Not re-litigated here.
- No expenses/income table exists yet (S-02+), so category deletion has no foreign-key dependents to protect today.

## What We're NOT Doing

- Not touching F-01's original migration or its RLS policies — those stay exactly as proven.
- Not adding a `sort_order` column or drag-to-reorder — list is alphabetical.
- Not building a JSON `GET` endpoint solely "for S-02 later" beyond what this slice's own UI needs — S-02 designs its own category-picker data access when it starts.
- Not adding a free-form color picker — colors are a fixed 12-value palette.
- Not seeding default categories for new users — blank slate by design (see Key Decisions).
- Not handling category-in-use-by-entries semantics (FK behavior, entry reassignment) — no entries table exists yet; that's S-02/S-03's problem to define when it arises.
- Not adding a shadcn `Dialog`/toast component — delete confirmation uses a plain `window.confirm`, errors render inline in the form.

## Implementation Approach

Three phases, bottom-up: (1) extend the schema and its verification suite, (2) build the service + JSON API layer with zod validation, (3) build a React island that fetches and mutates through that API with local state updates (no full-list refetch after a mutation — the mutation response is the source of truth for the single changed row).

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Color field | Add now, fixed palette (12 hex values) | User chose to solve S-05's chart-color-consistency problem now rather than later |
| Name uniqueness | Case-insensitive, per user, partial unique index excluding soft-deleted rows | Prevents silent data fragmentation once entries exist; deleted categories don't block name reuse |
| Delete semantics | Soft delete (`deleted_at`) | User chose to future-proof ahead of S-02/S-03 rather than hard-delete now |
| Onboarding | Blank slate, no seeded defaults | Matches the PRD's differentiator: categories are fully user-defined, not an imposed taxonomy |
| UI location | Dedicated `/categories` page | Keeps this slice decoupled from `dashboard.astro`'s still-template content (S-02's concern) |
| List ordering | Alphabetical by name | Simplest option meeting `main_goal: speed`; no schema/UI cost |
| Error UX | Inline, per-field | Consistent surfacing pattern for validation and conflict errors |
| Interaction model | Client-side fetch + JSON API, local state updates, no full-page reload | User explicitly chose this over the existing native-form+redirect convention, despite it being a first-of-its-kind pattern in this repo |
| Color picker mechanism | Fixed palette of 12 preset swatches (raw hex values, not Tailwind dynamic classes) | Avoids Tailwind's JIT scanner missing dynamically-interpolated class names (`bg-${color}-500`); guarantees visually distinct, readable colors for S-05 |
| UI copy language | Polish | User's explicit choice for this feature's user-facing strings |

## Critical Implementation Details

- **Tailwind dynamic classes don't work.** Because the color palette is user-selected data, never build a Tailwind class name from it (e.g. `` `bg-${color}-500` ``) — Tailwind's scanner only picks up literal class strings, so anything constructed at runtime silently renders unstyled. Store and render palette values as raw hex strings applied via inline `style={{ backgroundColor: color }}`.
- **The partial unique index only covers non-deleted rows.** `create unique index ... on categories (user_id, lower(name)) where deleted_at is null` means renaming an active category to match a *soft-deleted* category's old name is allowed by design — the index doesn't see deleted rows. Don't add a stricter constraint "fixing" this; it's intentional.
- **`supabase/tests/categories_rls_test.sql` starts with `select plan(9);`.** Every assertion added to this suite for the new columns/constraint must bump that count to match, or the whole suite fails with a plan-mismatch error that looks unrelated to the actual change.
- **Postgres unique-violation is error code `23505`.** The service layer must catch that specific code from the Supabase Postgres error and translate it into a typed `DuplicateNameError` so the API can return `409` with a field-scoped message — an uncaught `23505` otherwise surfaces as an opaque `500`.

## Phase 1: Schema — recurring flag, color, soft delete, per-user uniqueness

### Overview

Extend `public.categories` additively. F-01's RLS policies are untouched and still correct — none of the new columns change ownership semantics.

### Changes Required:

#### 1. Migration

**File**: new file under `supabase/migrations/`, created via `npx supabase migration new add_category_fields` (let the CLI stamp the timestamp; do not hand-pick one).

**Intent**: Add the three columns S-01 needs and the constraint enforcing per-user name uniqueness, without touching F-01's table definition or policies.

**Contract**:
- `alter table public.categories add column is_recurring boolean not null default false;`
- `alter table public.categories add column color text not null default '#64748b' check (color in ('#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#64748b'));` — the 12 values are the fixed palette; `#64748b` (slate) is the default swatch.
- `alter table public.categories add column deleted_at timestamptz;`
- `create unique index categories_user_id_name_lower_idx on public.categories (user_id, lower(name)) where deleted_at is null;`
- No RLS policy changes — soft-delete filtering and the "don't touch a deleted row" rule are enforced by the service layer's queries (Phase 2), not by RLS.

#### 2. pgTAP suite extension

**File**: `supabase/tests/categories_rls_test.sql`

**Intent**: Prove the new constraint and defaults hold, on top of the existing isolation assertions (which don't need changes — they only ever specified `name`, so the new columns' defaults apply transparently).

**Contract**: Bump `select plan(9);` to the new total. Add assertions (as user A, before the existing "back to superuser" block) for: a second category with a case-insensitively duplicate name for the same user throws `23505`; the same name is allowed for a different user (already implicitly covered by the existing user A/B rows using different names — add one explicit same-name-different-user insert); an out-of-palette `color` value throws a check-constraint violation; `is_recurring` and `color` default correctly on a bare insert.

### Success Criteria:

#### Automated Verification:

- [ ] `npx supabase db reset` applies all migrations cleanly
- [ ] `npx supabase test db` passes with the updated plan count
- [ ] `npx astro check` / `npm run lint` pass (no application code touched yet, but confirms nothing broke)

#### Manual Verification:

- [ ] In Supabase Studio (`http://localhost:54323`), inserting a category without `color`/`is_recurring` shows the expected defaults
- [ ] Attempting a duplicate name (any case) for the same user via SQL fails with a unique-violation error

---

## Phase 2: Service layer + JSON API

### Overview

Add the domain types, a service module wrapping all Supabase queries against `categories`, and JSON API routes that validate input with zod and translate service errors into HTTP responses.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add zod, per `CLAUDE.md`'s API-route convention, which isn't actually installed despite being referenced as available.

**Contract**: `npm install zod`.

#### 2. Shared types

**File**: `src/types.ts` (new)

**Intent**: Define the `Category` DTO and the fixed color palette as a single source of truth shared by the API, service layer, and UI.

**Contract**: Exports `CATEGORY_COLORS` (array of the 12 `{ value: string; label: string }` palette entries, values matching the Phase 1 check constraint exactly), `DEFAULT_CATEGORY_COLOR`, `CategoryColor` (union of `CATEGORY_COLORS[number]["value"]`), and `Category` (`{ id: number; name: string; color: CategoryColor; isRecurring: boolean; createdAt: string }` — camelCase DTO; the service layer maps `is_recurring`/`created_at` to it).

#### 3. Service layer

**File**: `src/lib/services/categories.ts` (new)

**Intent**: Own every Supabase query against `categories` so API routes stay thin. All queries scope to `deleted_at is null` — a soft-deleted category is invisible and unmodifiable through this layer.

**Contract**: Exports `listCategories(supabase)`, `createCategory(supabase, input)`, `updateCategory(supabase, id, input)`, `softDeleteCategory(supabase, id)`, plus the zod schemas `createCategorySchema` / `updateCategorySchema` (`{ name: z.string().trim().min(1).max(100), color: z.enum(paletteValues), isRecurring: z.boolean() }`, defaults for `color`/`isRecurring`). Throws `DuplicateNameError` (mapped from Postgres `23505` — see Critical Implementation Details) and `NotFoundError` (zero rows affected on update/delete, e.g. wrong id, someone else's row, or already soft-deleted) as distinct error classes/types the routes can catch.

#### 4. API routes

**File**: `src/pages/api/categories/index.ts` (new)

**Intent**: List and create. Both check for a signed-in user before touching the service layer.

**Contract**: `GET` → `200` with `Category[]` (alphabetical by name), `401` `{ error }` if no user, `500` `{ error }` if `createClient()` returns `null`. `POST` → reads JSON body, validates with `createCategorySchema`, `201` with the created `Category` on success, `400` `{ error, field }` on validation failure, `409` `{ error, field: "name" }` on `DuplicateNameError`.

**File**: `src/pages/api/categories/[id].ts` (new)

**Intent**: Update and soft-delete a single category by id.

**Contract**: `PATCH` → same validation/response shape as `POST` above, plus `404` `{ error }` on `NotFoundError`. `DELETE` → `204` no body on success, `404` `{ error }` on `NotFoundError`, `401`/`500` as above.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run lint` passes (zod schemas, service, and routes type-check under `strictTypeChecked`)
- [ ] `npx astro check` passes

#### Manual Verification:

- [ ] `curl` (with a valid session cookie) against `GET /api/categories` returns `[]` for a fresh user
- [ ] `curl -X POST` with a valid body creates a category and returns `201`
- [ ] Repeating the same name (any case) returns `409` with `field: "name"`
- [ ] `PATCH`/`DELETE` against another user's category id returns `404`, not another user's data

---

## Phase 3: Category management UI

### Overview

A React island on a dedicated `/categories` page: fetches the list on mount, renders an empty state or the list, and supports add/rename/recolor/toggle-recurring/delete via the Phase 2 API, updating local state directly from each mutation's response (no refetch-the-whole-list round trip). All user-facing copy is in Polish.

### Changes Required:

#### 1. shadcn components

**Intent**: Add the primitives this page needs that don't exist yet.

**Contract**: `npx shadcn@latest add input label checkbox` (name field, accessible labels, recurring toggle). Color swatches are plain styled `<button>` elements using the Phase 2 `CATEGORY_COLORS` list — no new shadcn component needed for that.

#### 2. Category manager component

**File**: `src/components/categories/CategoriesManager.tsx` (new)

**Intent**: Own all client-side state and interaction: initial fetch, loading/error states, the add-category form, and per-row inline edit (name, color, recurring) and delete.

**Contract**: `fetch("/api/categories")` on mount into local `Category[]` state. Add form posts to `POST /api/categories`; on `201`, append the returned category to state; on `400`/`409`, render the `field`-scoped error inline next to that field. Each row's edit controls `PATCH /api/categories/:id`; on success, replace that row in state. Delete asks `window.confirm` first, then `DELETE /api/categories/:id`; on `204`, remove the row from state. Empty state (no categories) shows a prompt to add the first one rather than an empty list.

#### 3. Page

**File**: `src/pages/categories.astro` (new)

**Intent**: Protected page wrapper, consistent with `dashboard.astro`'s structure.

**Contract**: Uses `Layout` + `Topbar`, renders `<CategoriesManager client:load />`. Title in Polish.

#### 4. Route protection + navigation

**File**: `src/middleware.ts`

**Intent**: Gate the new page the same way `/dashboard` is gated.

**Contract**: `PROTECTED_ROUTES` becomes `["/dashboard", "/categories"]`.

**File**: `src/components/Topbar.astro`

**Intent**: Make the new page reachable.

**Contract**: Add a "Kategorie" link next to the existing "Dashboard" link in the signed-in branch.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run lint` passes (React-compiler rules, a11y rules on the new form controls)
- [ ] `npx astro check` passes
- [ ] `npm run build` succeeds

#### Manual Verification:

- [ ] Fresh user visiting `/categories` sees the Polish empty-state prompt, not an empty list
- [ ] Adding a category appears immediately without a full page reload
- [ ] Renaming, recoloring, and toggling recurring on an existing category all persist and reflect immediately
- [ ] Deleting a category removes it from the list and confirms via `window.confirm` first
- [ ] Attempting a duplicate name shows the inline Polish error next to the name field, not a crash or silent failure
- [ ] Visiting `/categories` while signed out redirects to `/auth/signin`
- [ ] A second browser session (or the other seeded pgTAP user, if manually signed in) never sees the first user's categories

---

## Testing Strategy

### Unit Tests:

- No unit-test framework exists in this repo (per `CLAUDE.md`) — validation logic (zod schemas) is exercised indirectly through the manual API/browser checks above, not standalone unit tests.

### Integration Tests:

- pgTAP suite (Phase 1) is the only automated integration coverage — it proves schema constraints and RLS isolation together at the database layer.

### Manual Testing Steps:

1. `npx supabase db reset && npx supabase test db` — confirm schema/constraint/RLS suite passes.
2. Sign in as a fresh user, visit `/categories`, confirm the empty state.
3. Add 2–3 categories with different colors, one flagged recurring.
4. Rename one, recolor another, toggle recurring on a third — confirm each persists after a manual page refresh (since state is fetched fresh on mount).
5. Attempt to add a duplicate name (including a case variant) — confirm the inline error.
6. Delete one category — confirm it disappears and does not reappear on refresh (soft-deleted, not just removed from local state).
7. Sign in as the second seeded user (or a second real account) — confirm zero visibility into the first user's categories.

## Performance Considerations

None specific — data volume per user is small (a personal category list), and the list query is a single indexed lookup on `user_id`.

## Migration Notes

Additive migration only; no backfill needed since F-01's `categories` table currently has no rows outside of test/seed data. Existing columns and RLS policies are untouched.

## References

- F-01 foundation: `context/changes/data-foundation-rls/plan.md`, `context/changes/data-foundation-rls/plan-brief.md`
- Existing RLS pattern to preserve: `supabase/migrations/20260815125827_create_categories_table.sql`
- Existing pgTAP suite to extend: `supabase/tests/categories_rls_test.sql`
- Existing (non-followed) form convention for reference: `src/pages/api/auth/signin.ts`, `src/middleware.ts`
- Roadmap slice: `context/foundation/roadmap.md` — S-01

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — recurring flag, color, soft delete, per-user uniqueness

#### Automated

- [x] 1.1 `npx supabase db reset` applies all migrations cleanly — 83109b2
- [x] 1.2 `npx supabase test db` passes with the updated plan count — 83109b2
- [x] 1.3 `npx astro check` / `npm run lint` pass — 83109b2

#### Manual

- [x] 1.4 Studio insert without color/is_recurring shows expected defaults — 83109b2
- [x] 1.5 Duplicate name (any case) for the same user fails with unique-violation — 83109b2

### Phase 2: Service layer + JSON API

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npx astro check` passes

#### Manual

- [x] 2.3 `GET /api/categories` returns `[]` for a fresh user
- [x] 2.4 `POST` with a valid body creates a category, returns `201`
- [x] 2.5 Duplicate name returns `409` with `field: "name"`
- [x] 2.6 `PATCH`/`DELETE` on another user's id returns `404`

### Phase 3: Category management UI

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npx astro check` passes
- [ ] 3.3 `npm run build` succeeds

#### Manual

- [ ] 3.4 Fresh user sees Polish empty-state prompt
- [ ] 3.5 Adding a category appears without full page reload
- [ ] 3.6 Rename/recolor/toggle-recurring persist and reflect immediately
- [ ] 3.7 Delete removes the category, with `window.confirm` first
- [ ] 3.8 Duplicate name shows inline Polish error next to name field
- [ ] 3.9 Signed-out visit to `/categories` redirects to `/auth/signin`
- [ ] 3.10 Second user never sees first user's categories
