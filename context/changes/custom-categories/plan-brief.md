# Custom Categories (S-01) — Plan Brief

> Full plan: `context/changes/custom-categories/plan.md`

## What & Why

Users can define, rename, delete, recolor, and flag their own expense categories as a large recurring cost (FR-004, FR-005). This is the roadmap's first slice (S-01) — every later slice references a category, and user-defined categories (not an imposed taxonomy) are one of PaperTrail's three core product insights.

## Starting Point

F-01 already created a minimal `categories` table (`id, user_id, name, created_at`) with full per-user RLS as its proof-of-pattern table, explicitly reserving `is_recurring` and rename semantics for this slice. No other application code exists yet for any domain entity — no `src/types.ts`, no service layer, no API routes beyond auth, and `zod` is referenced as "available" but isn't actually installed.

## Desired End State

A signed-in user visits `/categories`, sees their own categories (or a prompt to add their first one), and can add, rename, recolor, toggle-recurring, or delete a category — all reflected immediately without a full page reload. Category names are unique per user, case-insensitively. RLS isolation from F-01 is untouched and still guarantees no cross-user visibility.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Color field | Add now, fixed 12-value hex palette | User chose to solve S-05's chart-color-consistency problem now rather than defer it |
| Name uniqueness | Case-insensitive, per user, excludes soft-deleted rows | Prevents silent data fragmentation once entries exist |
| Delete semantics | Soft delete (`deleted_at`) | User chose to future-proof ahead of S-02/S-03 rather than hard-delete |
| Onboarding | Blank slate, no seeded defaults | Matches the PRD's "fully user-defined categories" differentiator |
| UI location | Dedicated `/categories` page | Decouples from `dashboard.astro`'s still-template content |
| List ordering | Alphabetical | Simplest option meeting `main_goal: speed` |
| Interaction model | Client-side fetch + JSON API, local state updates | User explicitly chose this over the existing native-form+redirect convention used by auth |
| Color picker mechanism | Fixed palette, raw hex values with inline styles | Avoids Tailwind's JIT scanner missing dynamically-built class names |
| UI copy language | Polish | User's explicit choice |

## Scope

**In scope:**
- Migration adding `is_recurring`, `color`, `deleted_at` to `categories`, plus a per-user case-insensitive unique index on name
- Extended pgTAP suite covering the new constraint and defaults
- `zod` added as a dependency; service layer + JSON API (`GET`/`POST /api/categories`, `PATCH`/`DELETE /api/categories/[id]`)
- React island (`CategoriesManager`) + `/categories` page, wired into `middleware.ts` and `Topbar.astro`

**Out of scope:**
- F-01's original migration/RLS policies (untouched)
- Category ordering/drag-to-reorder, free-form color picker, seeded default categories
- Any handling of categories-in-use-by-entries (no entries table exists yet)
- Toast/Dialog components — delete uses `window.confirm`, errors render inline

## Architecture / Approach

Three phases, bottom-up: schema first (additive, RLS untouched), then a service layer + JSON API with zod validation and typed errors (`DuplicateNameError`, `NotFoundError`) mapped to HTTP status codes, then a React island that fetches once on mount and updates its local state directly from each mutation's response — no full-list refetch per action.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema | `is_recurring`/`color`/`deleted_at` columns, per-user unique index, extended pgTAP suite | Forgetting to bump the pgTAP `plan()` count when adding assertions |
| 2. Service + JSON API | Types, service layer, validated CRUD API | Missing the Postgres `23505` → `409` translation, which otherwise surfaces as an opaque 500 |
| 3. UI | `/categories` page, React island, empty state, nav/middleware wiring | First client-fetch pattern in this repo — no existing convention to lean on |

**Prerequisites:** F-01 complete (it is — see `context/changes/data-foundation-rls/`). Local Docker running for `supabase db reset`/`test db`.
**Estimated effort:** Single session, 3 phases.

## Open Risks & Assumptions

- This is the first client-side-fetch UI in the repo; there's no established loading/error-state convention to copy, so Phase 3 is inventing that pattern rather than following one.
- Soft delete has no consumer yet (no entries table exists) — its value is entirely forward-looking, validated only when S-02/S-03 defines category-in-use semantics.

## Success Criteria (Summary)

- A user can fully manage their own categories (add/rename/recolor/flag-recurring/delete) from `/categories` without a page reload.
- No user can ever see or modify another user's categories — proven by the extended pgTAP suite, not assumed.
- Category names are unique per user; duplicate attempts surface a clear inline error rather than a silent conflict or crash.
