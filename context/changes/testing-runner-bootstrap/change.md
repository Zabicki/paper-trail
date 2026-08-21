---
change_id: testing-runner-bootstrap
title: Runner bootstrap + CI test floor (test-plan §3 Phase 1)
status: implemented
created: 2026-08-21
updated: 2026-08-21
archived_at: null
---

## Notes

Rollout phase 1 of `context/foundation/test-plan.md` §3. Covers risk #4 (a schema
migration reaching the hosted database ahead of the Worker that matches it).

Scope confirmed with the user at research time:

- **All four gates** that §5 marks "required after §3 Phase 1" land in CI —
  typecheck, unit+integration, pgTAP on the merged migration set, and
  from-scratch migration apply. The last two need Docker in the runner.
- The unit layer gets **one real pure-module target** with an external oracle,
  not a smoke test.

See `research.md` for the oracle and the trap list.
