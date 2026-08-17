---
change_id: dashboard-category-management
title: Dashboard as the single capture surface — category management + day-view fixes
status: new
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

### Backlog

No GitHub issue yet (roadmap Backlog Handoff row S-07 shows `—`), marked "Ready for `/10x-plan`".
