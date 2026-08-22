# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Soft-delete and other app-layer-only invariants aren't provable by pgTAP

**Context**: supabase/tests/categories_rls_test.sql; src/lib/services/categories.ts (deleted_at filtering)

**Problem**: pgTAP drives raw SQL via role/JWT impersonation — it verifies RLS and schema constraints, but cannot reach application code (e.g. the TypeScript service layer's `.is("deleted_at", null)` filtering). A soft-delete's actual effect (row disappears from the owner's own list, name becomes reusable) was only proven by manual browser testing, with no automated regression guard.

**Rule**: When a table's invariant is enforced in application code rather than RLS/schema (soft-delete visibility, computed defaults applied in the service layer, etc.), the plan must explicitly name which parts pgTAP can verify vs. which parts it structurally cannot. pgTAP's reach has not changed — it still cannot see the service layer — but "therefore manual forever" no longer follows: **since `testing-runner-bootstrap` (2026-08-21) a JS runner exists**, so app-layer-only invariants route to a unit or service test (`context/foundation/test-plan.md` §6.1) rather than to a permanent manual-verification note. Reserve the manual flag for what neither layer reaches, and say which layer you are sending each invariant to.

**Applies to**: Any table or service that layers app-level filtering (soft-delete, ownership beyond RLS, etc.) on top of what RLS/pgTAP already covers.

## A broken toolchain looks exactly like a broken migration — pin the tool before writing code to accommodate it

**Context**: S-05 Phase 1; `npx supabase db reset` / `npx supabase test db`; CLI pinned to `2.98.2` in `devDependencies` — _aspirational when this was written: `package.json` actually carried `^2.23.4` and only `package-lock.json` held `2.98.2`. `testing-runner-bootstrap` (2026-08-21) made the pin exact, and put the same trap in CI's reach by adding a `db-test` job that provisions a database_

**Problem**: With no `node_modules` yet, `npx supabase` silently resolved to a cached `2.114.0` instead of the pinned `2.98.2`. That CLI stopped granting `select/insert/update/delete` to `anon`/`authenticated` on new `public` tables, so `db reset` produced a database whose own app role could not read its own tables. All four pgTAP files failed with `permission denied for table …` before a single assertion ran — _including two that had shipped green_. The evidence pointed convincingly at a platform change, and the response was a new grants migration plus an edit to a shipped RLS test, both approved on that diagnosis. `npm ci` then installed the pinned CLI, the grants came back on their own, and both changes had to be reverted. Same Postgres image (`17.6.1.106`) throughout; the divergence was entirely in the CLI's init step.

**Rule**: When previously-green checks fail, establish whether the _toolchain_ is the one the repo pins **before** concluding the platform changed under you — and treat "a shipped, unmodified test is now failing" as the tell that it is the environment, not the code. Run the install step (`npm ci`) first, confirm the tool version against the manifest, and only then diagnose. Never write a migration, or edit a shipped test, to accommodate behaviour a mispinned tool produced: those edits are indistinguishable from real fixes once committed, and they encode the broken environment into the repo permanently.

**Applies to**: Any pinned CLI whose behaviour shapes generated state — `supabase`, `wrangler`, `astro`, database/codegen tools. Sharpest where the tool provisions a database, because the damage surfaces as a plausible schema or permissions error rather than as a version complaint.

## One unshrinkable string in a flex row shifts the _whole page_ sideways

**Context**: S-11 `mobile-layout-fixes`; `src/components/Topbar.astro` — the signed-in user's email as a plain child of a `flex justify-between` bar

**Problem**: An email address contains no spaces, so its min-content width is the entire string; a flex item cannot shrink below min-content without `min-w-0` plus a wrap or truncate rule. At a 360px viewport the top bar's min-content came to 422px, so the overflow escaped the bar, escaped the page container, and gave the _document_ a horizontal scrollbar. That surfaced as two separate-looking bug reports: "Wyloguj się falls out of the top bar" and "the whole page is shifted left with a black bar on the right". The second is not a top-bar bug at all — it is the horizontal scroll made visible, because `bg-cosmic` paints exactly one viewport-width while `body`'s near-black `bg-background` propagates to the canvas beyond it. Every page has that gradient wrapper, so _any_ overflow anywhere renders as the same black gutter and looks like a global layout fault.

**Rule**: Treat "the page is shifted / there's a gutter on the right" as a report of horizontal overflow somewhere, not as a report about the element the user happened to name — measure `document.documentElement.scrollWidth` against `clientWidth` at 320/360/390 before theorising. Any user-supplied string with no break opportunity (email, URL, category name, filename) needs `min-w-0` and a break rule when it sits in a flex row; the truncate/min-w-0 comments already scattered through `DayEntriesList` and `ReceiptReview` are the same lesson learned one component at a time. Where a bar must restack on narrow screens, `flex-wrap-reverse` gets the last line on top without reordering the DOM — so identity still precedes navigation for a screen reader.

**Applies to**: Any flex or grid row mixing user data with controls, on every page — the shared `bg-cosmic` wrapper means one component's overflow is indistinguishable from a whole-app layout break. Verifiable cheaply in headless Chromium against the built CSS; no dev server or sign-in needed.

## `self-start` opts an element out of stretch — and back into max-content width

**Context**: S-12 `topbar-tabs-and-receipt-date-button`; `src/components/receipts/ReceiptReview.tsx` — the revert-to-calendar-day button under the save-date field, beside the 96px receipt thumbnail

**Problem**: A block-level child of a flex column is stretched to the container width by default, so its own intrinsic width never matters. Adding `self-start` (to stop a full-width button) silently switches it to `fit-content`, i.e. **max-content** for a nowrap control like shadcn's `Button` — and the label was `Wróć do dnia z kalendarza (2026-08-14)`. Beside the thumbnail that exceeded a 360px viewport and produced the identical symptom as the S-11 email: document-level horizontal scroll, page shifted left of a black gutter. Same failure, entirely different mechanism — nothing here is a user-supplied string, and `min-w-0` on the ancestor (already present) does not help, because the overflowing item is not the one being asked to shrink.

**Rule**: Whenever `self-start` / `self-end` / `w-fit` / `inline-flex` is used to stop an element filling its row, pair it with `max-w-full`. Those utilities trade "too wide by stretch" for "too wide by content", which is the worse of the two because it escapes the container instead of filling it. Prefer a short label over a clipped one: text that only fits by truncation is a second bug. And when a control's label restates something already on screen (the date is in the field directly above it), delete it from the label rather than engineering room for it.

**Applies to**: Every intrinsically-sized control in a narrow column — receipt review, day-entry forms, the category overlay. The S-11 lesson above is the same _symptom_ from the other end; check both mechanisms when a gutter appears.

## Two bounds meant to be the same number, counted in different units

**Context**: `testing-receipt-confirm-integrity` (rollout Phase 2), finding F2; the entry-description length bound, deliberately duplicated across three layers — `src/lib/entry-description.ts:23` (`DESCRIPTION_MAX_CODE_POINTS = 200`), the `check (char_length(description) <= 200)` in `20260816140000_add_entry_description.sql`, and zod's `.max(200)` in `src/lib/services/entries.ts`

**Problem**: All three read `200`, so the duplication looks safe and the comment at `entry-description.ts:17-23` — which states the reason for it, a bundle-size one — reads as sufficient. They do not measure the same thing. `countCodePoints` and Postgres' `char_length()` both count **code points**; zod's `.max()` counts **UTF-16 code units**, verified against the installed zod `4.4.3`. For any astral character (emoji, rare CJK) one string is two units and one point, so the composer can produce a description it believes is at the bound and zod refuses. That makes the S-10 invariant recorded at `context/archive/2026-08-18-entry-descriptions-and-receipt-grouping/plan.md:386-392` — "all three agree" — false for non-BMP input. It was not fixed at the time it was found: reachability is low (it needs astral characters in receipt line names) and the failure is a fail-loud 400, not a silent bad write. The class is what matters, because the next duplicated bound may not fail loudly.

**Rule**: When a limit is deliberately duplicated rather than imported, the comment at every copy must record the **unit** as well as the number — code points, UTF-16 code units, bytes, decimal places, rows. "200" is not a specification. And any test of the composing side must assert against the **strictest** copy, not the one nearest to hand, so the copies are proven to agree at the boundary rather than assumed to. Where the copies genuinely cannot be unified, say in the comment which one is authoritative and what happens when they disagree.

**Applies to**: Any bound restated across the client / server / database boundary — description and name lengths, `numeric(p, s)` decimal places, item and row caps, upload size limits. Sharpest wherever one side counts characters and another counts storage, which is every string bound in a Unicode-aware schema.
