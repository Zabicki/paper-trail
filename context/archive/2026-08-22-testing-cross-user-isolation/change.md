---
change_id: testing-cross-user-isolation
title: Prove one user's financial data is unreachable by another, on every path
status: archived
created: 2026-08-22
updated: 2026-08-22
archived_at: 2026-08-22T10:46:09Z
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md`: "Isolation beyond the database".

Risks covered: **#3** — one user's financial data becomes reachable by another
(Impact High, Likelihood Medium). This is the abuse-lens row in §2:
authorization / ownership, not merely authentication.

Test types planned: pgTAP extension, route-boundary integration,
response-header assertion.

Risk response intent: prove that a request authenticated as user A cannot read,
aggregate, or mutate any row owned by user B — including through an aggregation
path or a reference to B's category — and that no authenticated response is
edge-cacheable. The test that matters is **A explicitly requesting B's id and
being refused**, not A seeing A's own data.

Must challenge (from §2 Risk Response Guidance):

- that "logged in" implies "owns this resource";
- that RLS on base tables covers aggregate and RPC paths;
- that a green pgTAP suite covers app-layer ownership filtering (it provably cannot).
