<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Receipt Parsing (S-06)

- **Plan**: `context/changes/receipt-parsing/plan.md`
- **Scope**: Phases 1–3 (Phase 4 is an open measurement phase — 4.1–4.6 legitimately pending). Reviewed jointly with S-05 because both were implemented in parallel and merged back to back.
- **Date**: 2026-08-17
- **Verdict**: REJECTED (joint) — the one critical finding is in S-05, not here. S-06's own findings are all warnings.

## This is a pointer, not a second report

S-05 and S-06 were built in parallel worktrees and merged back to back onto `master` (`2e83cee`, then `df88d63`). Reviewing them separately would have missed the merge itself, so the findings live in one joint report:

**→ `context/changes/category-distribution-view/reviews/impl-review.md`**

Triage there. Do not duplicate decisions across the two files.

## Findings that belong to this change

| ID | Severity | Title |
|---|---|---|
| F3 | ⚠️ WARNING | `/api/receipts/parse` spends third-party money and a hard monthly quota with authentication as its only limit |
| F4 | ⚠️ WARNING | The batch confirm is not idempotent, and its failure copy invites the retry that doubles the receipt |
| F5 | ⚠️ WARNING | The 10 MB upload limit is enforced after the whole body is buffered into the isolate |
| F8 | ⚠️ WARNING | Receipt-derived text reaches Workers Logs, contradicting the store-nothing disclosure shown to the user |
| F10 | ⚠️ WARNING | `roundToCents` is duplicated across exactly the boundary the plan cited S-04 F4 to avoid |

Also shared with S-05: **F2** (the pgTAP suite has never run against the merged twelve-migration set — an explicit automated criterion in both plans, ticked per-branch only).

**Triage outcome (2026-08-17)**, for the findings above: F4, F5 and F10 **fixed**; F2 **run and green**; F3 and F8 **skipped by decision**. F4's fix adds `supabase/migrations/20260817190000_add_entry_batch_key.sql` and `supabase/tests/entries_batch_key_test.sql`, so this change now owns a thirteenth migration and a sixth pgTAP file. Full detail and evidence live in the joint report.

Phases 1–3 otherwise show unusually high fidelity. The two things the plan made load-bearing both hold under attack: `createEntriesBatch`'s ownership and `type`↔`kind` invariants are airtight (no null, non-integer, duplicate or coercion defeats the count comparison; no TOCTOU; genuinely one atomic multi-row INSERT), and `cf-aig-collect-log-payload: false` is on the image-carrying request, so the store-nothing guarantee holds for the image itself. `updateEntrySchema.omit({ type: true, description: true })` — the plan's own flagged trap — is exactly right. Six deviations were reviewed and accepted; see the joint report's "Deviations reviewed and accepted" section.
