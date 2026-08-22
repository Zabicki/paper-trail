---
change_id: testing-reports-aggregation-truth
title: "Reports aggregation truth: prove a displayed figure is correct or absent"
status: implementing
created: 2026-08-21
updated: 2026-08-22
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md`: "Reports aggregation truth".

Risks covered: Risk #2 — a KPI or chart reads plausibly but is wrong: rows
silently dropped, the recurring-cost filter disagreeing with the numbers
displayed, or a range resolving to the wrong window.

Test types planned: unit (distribution model), integration with a fixture sized
past the row ceiling.

Risk response intent: prove a figure is either correct or absent — never a
plausible number derived from a partial result set — and that filter state
always matches the numbers displayed. The real archived failure was truncation,
not an error: a row ceiling that silently dropped rows and left ranking rows
printing 0% beside real amounts. Also prove "all time" resolves to a sane
window and that a percentage and its absolute amount share one total.
