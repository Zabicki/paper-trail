---
change_id: income-and-entry-management
title: Log income; review, edit and delete entries
status: archived
created: 2026-08-15
updated: 2026-08-15
archived_at: 2026-08-15T22:14:55Z
---

## Notes

from S-03 from @context/foundation/roadmap.md

- **Roadmap:** S-03 (Stream A, ledger core), status `proposed`, prerequisite S-02 (`done`). Parallel with S-04, S-06.
- **Outcome:** User can log an income, and can review, edit and delete any previously logged entry.
- **PRD refs:** FR-008, FR-009. Backlog issue [#4](https://github.com/Zabicki/paper-trail/issues/4).
- **Open unknown (non-blocking):** hard vs. soft delete — the PRD challenged FR-009 on destroying the audit trail and let it stand without deciding. Owner: user. Note `context/foundation/lessons.md` already carries a soft-delete lesson from S-01 (pgTAP can't verify app-layer-only invariants).
