---
change_id: dashboard-category-management
title: Dashboard as the single capture surface — category management + day-view fixes
status: implementing
created: 2026-08-17
updated: 2026-08-17
archived_at: null
---

## Notes

Seeded from `context/foundation/roadmap.md` → **S-07: Dashboard as the single capture surface** (status `ready`, Stream D "Daily-use polish", widest of the four post-MVP slices).

**Outcome:** User can create, rename, delete and flag their categories from the dashboard itself — without a separate tab — sees at a glance which are recurring, and reads the day's entries without duplicated sign-out controls or a calendar whose numbers drift off their weekday headers.

**PRD refs:** FR-004, FR-005, FR-007, FR-009
**Prerequisites:** S-01 (`custom-categories`), S-02 (`daily-expense-entry`), S-03 (`income-and-entry-management`) — all done.
**Parallel with:** S-08 (`reports-axis-and-all-time-range`), S-10 (`entry-descriptions-and-receipt-grouping`).
**Blockers:** —
**Unlocks:** S-09 (`category-icons`) depends on this rather than running beside it — the category editor that gains the icon picker is the one this slice moves into the dashboard overlay; otherwise the picker gets built twice.

### Open questions (neither blocks planning)

- Which five categories are "the first five" before `Pokaż więcej`? The picker's list is already recency-ordered by `listCategoriesForEntryForm`; confirm recency is the intended cut rather than alphabetical. Owner: user.
- The overlay needs a modal primitive and none is installed — hand-roll on the already-present `radix-ui`, or generate shadcn's `dialog`. Owner: implementation.

### Risk / constraints carried from the roadmap

- Every item is confined to the dashboard shell; **nothing touches the schema.**
- **The one real regression to guard:** retiring `/categories` also retires the only surface that can create an *income* category, since the dashboard's picker is scoped to the current entry type. The overlay must carry the kind selector, or income categories become uncreatable.
- The ≤4-interaction NFR that governed S-02 is the acceptance constraint on the collapsed list: `Pokaż więcej` must not add a tap to the common path.

### Implementation adaptations

- **Phase 1 widened to translate the whole auth screen set.** Criterion 1.3 (`grep -rn "Sign out\|Sign in\|Sign up\|Not signed in" src/` returns nothing) was written assuming `Topbar.astro` was the only source of those strings; it was not. `src/pages/auth/{signin,signup,confirm-email}.astro`, `SignInForm.tsx`, `SignUpForm.tsx` and `PasswordToggle.tsx` were still the starter's English scaffold — and beyond those four words: headings, `Password` / `Confirm password` labels, placeholders, validation messages, pending text and aria-labels. Rather than narrow the criterion to Topbar, the user chose to translate all of it, so Phase 1 covers more than change #2's four-string contract. The `Supabase is not configured` string in `src/pages/api/auth/{signin,signup}.ts` went with it, matching `config-status.ts`'s existing wording.
- **Still English by necessity:** Supabase's own `error.message` (e.g. `Invalid login credentials`) passes through to `?error=` untranslated. Mapping those to Polish would need an error-code table and is out of this slice's scope.
- The `Dashboard` Topbar link label stays English, as the plan specifies.

### Backlog

No GitHub issue yet (roadmap Backlog Handoff row S-07 shows `—`), marked "Ready for `/10x-plan`".
