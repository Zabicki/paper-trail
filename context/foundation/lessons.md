# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Soft-delete and other app-layer-only invariants aren't provable by pgTAP

**Context**: supabase/tests/categories_rls_test.sql; src/lib/services/categories.ts (deleted_at filtering)

**Problem**: pgTAP drives raw SQL via role/JWT impersonation — it verifies RLS and schema constraints, but cannot reach application code (e.g. the TypeScript service layer's `.is("deleted_at", null)` filtering). A soft-delete's actual effect (row disappears from the owner's own list, name becomes reusable) was only proven by manual browser testing, with no automated regression guard.

**Rule**: When a table's invariant is enforced in application code rather than RLS/schema (soft-delete visibility, computed defaults applied in the service layer, etc.), the plan must explicitly name which parts pgTAP can verify vs. which remain manual-only — and flag that manual step as a permanent re-verification requirement for any future change touching that code path.

**Applies to**: Any table or service that layers app-level filtering (soft-delete, ownership beyond RLS, etc.) on top of what RLS/pgTAP already covers.

## A broken toolchain looks exactly like a broken migration — pin the tool before writing code to accommodate it

**Context**: S-05 Phase 1; `npx supabase db reset` / `npx supabase test db`; CLI pinned to `2.98.2` in `devDependencies`

**Problem**: With no `node_modules` yet, `npx supabase` silently resolved to a cached `2.114.0` instead of the pinned `2.98.2`. That CLI stopped granting `select/insert/update/delete` to `anon`/`authenticated` on new `public` tables, so `db reset` produced a database whose own app role could not read its own tables. All four pgTAP files failed with `permission denied for table …` before a single assertion ran — _including two that had shipped green_. The evidence pointed convincingly at a platform change, and the response was a new grants migration plus an edit to a shipped RLS test, both approved on that diagnosis. `npm ci` then installed the pinned CLI, the grants came back on their own, and both changes had to be reverted. Same Postgres image (`17.6.1.106`) throughout; the divergence was entirely in the CLI's init step.

**Rule**: When previously-green checks fail, establish whether the _toolchain_ is the one the repo pins **before** concluding the platform changed under you — and treat "a shipped, unmodified test is now failing" as the tell that it is the environment, not the code. Run the install step (`npm ci`) first, confirm the tool version against the manifest, and only then diagnose. Never write a migration, or edit a shipped test, to accommodate behaviour a mispinned tool produced: those edits are indistinguishable from real fixes once committed, and they encode the broken environment into the repo permanently.

**Applies to**: Any pinned CLI whose behaviour shapes generated state — `supabase`, `wrangler`, `astro`, database/codegen tools. Sharpest where the tool provisions a database, because the damage surfaces as a plausible schema or permissions error rather than as a version complaint.

## One unshrinkable string in a flex row shifts the _whole page_ sideways

**Context**: S-11 `mobile-layout-fixes`; `src/components/Topbar.astro` — the signed-in user's email as a plain child of a `flex justify-between` bar

**Problem**: An email address contains no spaces, so its min-content width is the entire string; a flex item cannot shrink below min-content without `min-w-0` plus a wrap or truncate rule. At a 360px viewport the top bar's min-content came to 422px, so the overflow escaped the bar, escaped the page container, and gave the _document_ a horizontal scrollbar. That surfaced as two separate-looking bug reports: "Wyloguj się falls out of the top bar" and "the whole page is shifted left with a black bar on the right". The second is not a top-bar bug at all — it is the horizontal scroll made visible, because `bg-cosmic` paints exactly one viewport-width while `body`'s near-black `bg-background` propagates to the canvas beyond it. Every page has that gradient wrapper, so _any_ overflow anywhere renders as the same black gutter and looks like a global layout fault.

**Rule**: Treat "the page is shifted / there's a gutter on the right" as a report of horizontal overflow somewhere, not as a report about the element the user happened to name — measure `document.documentElement.scrollWidth` against `clientWidth` at 320/360/390 before theorising. Any user-supplied string with no break opportunity (email, URL, category name, filename) needs `min-w-0` and a break rule when it sits in a flex row; the truncate/min-w-0 comments already scattered through `DayEntriesList` and `ReceiptReview` are the same lesson learned one component at a time. Where a bar must restack on narrow screens, `flex-wrap-reverse` gets the last line on top without reordering the DOM — so identity still precedes navigation for a screen reader.

**Applies to**: Any flex or grid row mixing user data with controls, on every page — the shared `bg-cosmic` wrapper means one component's overflow is indistinguishable from a whole-app layout break. Verifiable cheaply in headless Chromium against the built CSS; no dev server or sign-in needed.
