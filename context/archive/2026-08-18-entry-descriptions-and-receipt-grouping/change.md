---
change_id: entry-descriptions-and-receipt-grouping
title: Entry descriptions, and one entry per category from a receipt
status: archived
created: 2026-08-18
updated: 2026-08-18
archived_at: 2026-08-18T10:09:42Z
---

## Notes

Seeded from `context/foundation/roadmap.md` → **S-10: Entries say what they were** (status `proposed`, the last open slice).

- **Outcome:** User can describe an entry in their own words when logging it manually or correcting a receipt, sees those descriptions in "Wpisy tego dnia" — truncated past three items and expandable — and gets one entry per category from a receipt, dated from the receipt itself and correctable when the model misreads it.
- **PRD refs:** FR-006, FR-009, FR-012, FR-017
- **Prerequisites:** S-03 (`income-and-entry-management`), S-06 (`receipt-parsing`) — both done and archived.
- **Parallel with:** S-08, S-09 (both now done).
- **Blockers:** —
- **Unknowns:**
  - Once a receipt collapses to one entry per category, does the existing "save as a single entry at the printed total" shortcut still earn its place? Owner: user. Block: no.
  - How is a grouped description composed and truncated — plain comma-joined item names, or names with amounts? Owner: user. Block: no.
- **Risk:** No migration needed: the entry description column shipped with S-06, deliberately written but never shown, so this slice is largely the display-and-edit half that was scoped out then — though the update schema omits the field on purpose and has to be opened up for post-save correction. The behavioural change is grouping: a receipt stops producing one entry per printed line and starts producing one per category, which silently redefines what S-06's accuracy log is measuring. Its pre-grouping numbers stop being comparable unless the change is recorded there.

Two things landed since the roadmap wrote that entry and both touch this slice's surfaces:

- **S-07 moved category management into the dashboard** and **S-09 replaced per-category colors with icons** — so the day list and the receipt-review screen this slice edits are not the ones S-06 left behind. Read `context/archive/2026-08-17-dashboard-category-management/` and `context/archive/2026-08-17-category-icons/` before planning.
- **`category-color-drop` is an open, REQUIRED follow-up** from S-09 (`categories.color`, its CHECK, `category_color` on `entries_category_summary`, and the `CATEGORY_COLORS` exports all still exist). Not this slice's job, but it constrains migration ordering if this slice ends up wanting one.

Prior art: `context/archive/2026-08-16-receipt-parsing/` (the description column, the accuracy log, the single-entry shortcut) and `context/archive/2026-08-15-income-and-entry-management/` (the update schema this slice has to open up).
