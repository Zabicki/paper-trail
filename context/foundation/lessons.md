# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Soft-delete and other app-layer-only invariants aren't provable by pgTAP

**Context**: supabase/tests/categories_rls_test.sql; src/lib/services/categories.ts (deleted_at filtering)

**Problem**: pgTAP drives raw SQL via role/JWT impersonation — it verifies RLS and schema constraints, but cannot reach application code (e.g. the TypeScript service layer's `.is("deleted_at", null)` filtering). A soft-delete's actual effect (row disappears from the owner's own list, name becomes reusable) was only proven by manual browser testing, with no automated regression guard.

**Rule**: When a table's invariant is enforced in application code rather than RLS/schema (soft-delete visibility, computed defaults applied in the service layer, etc.), the plan must explicitly name which parts pgTAP can verify vs. which remain manual-only — and flag that manual step as a permanent re-verification requirement for any future change touching that code path.

**Applies to**: Any table or service that layers app-level filtering (soft-delete, ownership beyond RLS, etc.) on top of what RLS/pgTAP already covers.
