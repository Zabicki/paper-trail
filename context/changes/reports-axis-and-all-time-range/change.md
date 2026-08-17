---
change_id: reports-axis-and-all-time-range
title: Reports readability — unclipped Y-axis labels and a real "Cały okres" range
status: implementing
created: 2026-08-17
updated: 2026-08-17
archived_at: null
---

## Notes

Seeded from `context/foundation/roadmap.md` → **S-08: Reports readability fixes** (status `ready`, independent of S-07).

- **Outcome:** User can read every chart's Y-axis labels without the leading digit clipped, and "Cały okres" plots from their first recorded entry instead of two decades of empty months.
- **PRD refs:** FR-013, FR-014
- **Prerequisites:** S-04 (`date-range-spending-view`), S-05 (`category-distribution-view`) — both done and archived.
- **Parallel with:** S-07, S-09, S-10
- **Blockers:** —
- **Unknowns:** What should "Cały okres" resolve to for a user with no entries at all? Existing precedent is the account-creation floor already used for missing-day clamping. Owner: user. Block: no.
- **Risk:** Two fixes of very different size behind one outcome. The axis half is a width allowance on three charts; the all-time half needs a first-entry lookup that exists nowhere in the codebase today. Note that the twenty-year floor was itself a workaround for the bucket-count guard — a real first-entry date removes the condition that guard was tripping on, so the two halves are the same defect seen from opposite ends.

Prior art to read during planning: `context/archive/2026-08-16-date-range-spending-view/` and `context/archive/2026-08-16-category-distribution-view/`.
