# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Soft-delete and other app-layer-only invariants aren't provable by pgTAP

**Context**: supabase/tests/categories_rls_test.sql; src/lib/services/categories.ts (deleted_at filtering)

**Problem**: pgTAP drives raw SQL via role/JWT impersonation — it verifies RLS and schema constraints, but cannot reach application code (e.g. the TypeScript service layer's `.is("deleted_at", null)` filtering). A soft-delete's actual effect (row disappears from the owner's own list, name becomes reusable) was only proven by manual browser testing, with no automated regression guard.

**Rule**: When a table's invariant is enforced in application code rather than RLS/schema (soft-delete visibility, computed defaults applied in the service layer, etc.), the plan must explicitly name which parts pgTAP can verify vs. which remain manual-only — and flag that manual step as a permanent re-verification requirement for any future change touching that code path.

**Applies to**: Any table or service that layers app-level filtering (soft-delete, ownership beyond RLS, etc.) on top of what RLS/pgTAP already covers.

## A broken toolchain looks exactly like a broken migration — pin the tool before writing code to accommodate it

**Context**: S-05 Phase 1; `npx supabase db reset` / `npx supabase test db`; CLI pinned to `2.98.2` in `devDependencies`

**Problem**: With no `node_modules` yet, `npx supabase` silently resolved to a cached `2.114.0` instead of the pinned `2.98.2`. That CLI stopped granting `select/insert/update/delete` to `anon`/`authenticated` on new `public` tables, so `db reset` produced a database whose own app role could not read its own tables. All four pgTAP files failed with `permission denied for table …` before a single assertion ran — *including two that had shipped green*. The evidence pointed convincingly at a platform change, and the response was a new grants migration plus an edit to a shipped RLS test, both approved on that diagnosis. `npm ci` then installed the pinned CLI, the grants came back on their own, and both changes had to be reverted. Same Postgres image (`17.6.1.106`) throughout; the divergence was entirely in the CLI's init step.

**Rule**: When previously-green checks fail, establish whether the *toolchain* is the one the repo pins **before** concluding the platform changed under you — and treat "a shipped, unmodified test is now failing" as the tell that it is the environment, not the code. Run the install step (`npm ci`) first, confirm the tool version against the manifest, and only then diagnose. Never write a migration, or edit a shipped test, to accommodate behaviour a mispinned tool produced: those edits are indistinguishable from real fixes once committed, and they encode the broken environment into the repo permanently.

**Applies to**: Any pinned CLI whose behaviour shapes generated state — `supabase`, `wrangler`, `astro`, database/codegen tools. Sharpest where the tool provisions a database, because the damage surfaces as a plausible schema or permissions error rather than as a version complaint.
