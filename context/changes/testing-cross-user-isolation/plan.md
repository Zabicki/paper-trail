# Isolation Beyond the Database — Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md`. Give risk #3 — "one
user's financial data becomes reachable by another" — the automated regression
guard it has never had.

Four archived slices each verified a cross-user refusal **once, by hand, with
`curl`, at ship time**. None left a test behind. This phase converts all of
them into assertions that run on every pull request, and adds the second,
independent isolation path `CLAUDE.md` names: that no authenticated response is
edge-cacheable.

The test that matters is **A explicitly requesting B's id and being refused** —
not A seeing A's own data.

## Current State Analysis

Grounded in `context/changes/testing-cross-user-isolation/research.md`.

**The database layer is stronger than the phase brief assumed.** Both tables
enable RLS in their creating migration with four granular per-operation
policies keyed on `(select auth.uid()) = user_id`. Both aggregate functions are
`security invoker` with `set search_path = ''`, take no user-id parameter, and
are `revoke`d from `public`/`anon` — so there is no channel through which a
caller can name another user's uuid. No `service_role` key exists anywhere in
the repo. The six pgTAP suites already assert cross-user negatives on select,
insert-spoof, update and delete for both tables, **and through the RPC** for
both aggregates.

**The application layer is RLS-only, one layer deep, by design.** There is not
one `.eq("user_id", …)` anywhere in `src/` — the decision is documented at
`src/lib/services/reports.ts:274-276`. Every route builds its client via
`createClient(context.request.headers, context.cookies)` using the anon key plus
the caller's cookie, so `auth.uid()` is always the caller. The app layer
contributes only _existence checks on RLS-filtered result sets_, which is what
turns "someone else's row" into a 404 rather than a silent success.

**The one invariant RLS does not supply.** `entries.category_id` is a plain FK,
and Postgres FK checks are not subject to RLS on the referenced table
(`supabase/migrations/20260815164539_create_entries_table.sql:10,31-36`). A raw
SQL insert by A naming B's `category_id` is legal and succeeds. The only
prevention is application code, in two independently-maintained copies:
`assertCategoryUsable()` (`src/lib/services/entries.ts:154-181`) and
`createEntriesBatch`'s set-cardinality check (`:241-263`).
`supabase/tests/entries_rls_test.sql:8-17` excludes this case in writing.

**Edge-cacheability rests on one line, and it is path-blind.**
`PROTECTED_ROUTES = ["/dashboard", "/reports"]`. Every `/api/**` route returns
`false` for both entries, so its `Cache-Control: private, no-store` comes
_only_ from the `|| context.locals.user` disjunct at `src/middleware.ts:48-50`.
There is no `_headers` file, no platform cache config, and no `prerender` in
`src/`. That single line is the whole mechanism.

**The harness is ready and the blocker is fixture shape, not config.**
`vitest.config.ts` is standalone (`src/**/*.test.ts`, alias `@` → `./src`,
default `node` environment). 11 files, 254 tests, ~580 ms, green. The proven
route-test pattern is a module-scope mutable holder +
`vi.mock("@/lib/supabase", …)` + `await import("./x")` after it. What is missing
is a route-context helper producing `context.params`, which
`src/pages/api/entries/[id].ts:21` and `src/pages/api/categories/[id].ts:20`
both read — so **every A-requests-B's-id test against those routes needs a
shape no existing helper produces**.

`src/middleware.ts` is unit-testable with **zero config change** — verified
empirically during research with `vi.mock("astro:middleware", () => ({
defineMiddleware: (fn: unknown) => fn }))`; Vitest 4's mock registry intercepts
the specifier before Vite's resolver is consulted. This corrects a false clause
in `test-plan.md` §6.1.

**Where the tests will run.** `.github/workflows/ci.yml`: the `ci` job (lint →
typecheck → **test** → build) runs on pull requests. `db-test` is
`master`-push-only. A new JS test is picked up by the existing glob and earns
pull-request enforcement with no workflow edit.

## Desired End State

Every cross-user refusal that was ever verified by hand is verified by
`npm run test` on every pull request, and the `Cache-Control` mechanism has an
executable statement of what it rests on.

Concretely, when this plan is complete:

- `npm run test` runs a suite that includes six A-requests-B refusal cases
  across both mechanisms (path `id` filtered by RLS; body `categoryId` caught by
  the app layer), each asserting the **response body**, not only the status.
- `src/middleware.test.ts` pins that `/api/**` gets `private, no-store` when
  signed in and **not** when anonymous — so the test goes red the moment the
  `locals.user` disjunct is weakened.
- The anonymous `GET /` auth-varying redirect carries the header, and the
  comment at `src/middleware.ts:31-32` is true again.
- Route tests share one `__fixtures__/` helper for identity and route context;
  four copies of a hand-rolled `auth.getUser` become one.
- `test-plan.md` §6.4 is written, §6.1's virtual-module clause is corrected,
  §6.6 carries Phase 4's notes, and §3's Phase 4 row reads `complete`.

Verify by: `npm run test` green with a materially higher test count than 254;
`npm run lint` and `npm run typecheck` green; and each new assertion
individually confirmed red before it was made green (the teeth rule).

### Key Discoveries:

- **The pgTAP half of this phase is nearly done.** `test-plan.md` §3's test-types
  cell ("pgTAP extension, route integration, response-header assertion") is
  accurate in kind but misleading in weight. Both summary suites already assert
  the cross-user negative through the RPC — the sharpest being
  `supabase/tests/entries_category_summary_test.sql:254-275`, which asserts not
  one of A's category _names_ reaches B across a shared date range.
- **The cheapest useful layer is the JS route test, and it is also the only
  layer with pull-request enforcement.** `.github/workflows/ci.yml:32` guards
  `db-test` to pushes.
- **The 404 body is deliberately identical for "absent" and "not yours."**
  `src/lib/services/entries.ts:90-93`: _"'Not found' has to stay ambiguous —
  saying 'that category is not yours' would confirm another user's id exists."_
  Already asserted verbatim at `src/pages/api/receipts/entries.test.ts:188-196`
  with the note that changing the string _"is a security decision, not a copy
  edit."_ **Asserting the body is therefore a real isolation assertion, not a
  copy test.**
- **There is no silent-success no-op anywhere, and that is a regression target.**
  Every write path that can affect zero rows detects it — `.single()` +
  `PGRST116` (`categories.ts:131-133`), or `.select("id")` +
  `data.length === 0` (`categories.ts:150-152`, `entries.ts:373-376`), or a
  `maybeSingle()` pre-read (`entries.ts:335-337`). The `.select(…)` appended to
  every update/delete is precisely what makes zero-row detection possible;
  removing it turns these into silent 200/204s.
- **Response queue order per surface** (the fake is call-order-keyed, not
  table-keyed — the one thing readers get wrong):

  | Surface                                         | Awaits before the refusal                 | Refusal trigger                       |
  | ----------------------------------------------- | ----------------------------------------- | ------------------------------------- |
  | `PATCH /api/categories/[id]`                    | 1 (`.single()`)                           | `error.code === "PGRST116"`           |
  | `DELETE /api/categories/[id]`                   | 1 (`.select("id")`)                       | `data.length === 0`                   |
  | `PATCH /api/entries/[id]`, foreign entry        | 1 (`.maybeSingle()` pre-read)             | `data === null`                       |
  | `PATCH /api/entries/[id]`, foreign `categoryId` | 2 (pre-read, then `assertCategoryUsable`) | second `data === null`                |
  | `DELETE /api/entries/[id]`                      | 1 (`.select("id")`)                       | `data.length === 0`                   |
  | `POST /api/entries`                             | 1 (`assertCategoryUsable`)                | `data === null`                       |
  | `POST /api/receipts/entries`                    | 1 (set-cardinality check)                 | `usable.length < requestedIds.length` |

- **A documented Postgres segfault** blocks the obvious `anon`-denial pgTAP test
  (`supabase/tests/entries_summary_test.sql:216-249`). Out of scope here, but do
  not "improve" it if you pass by.
- **`vi.mock` on a direct, unresolvable `astro:*` import works with no config
  change** — verified in research. `test-plan.md` §6.1 currently says otherwise.

## What We're NOT Doing

- **No pgTAP is added.** Decided at plan time. The existing six suites cover the
  SQL-expressible half, and anything new would land with no pull-request gate
  anyway. **Consequence, stated plainly: the FK ownership gap ends up proven
  only at the application layer.** Its sole database-side record remains the
  prose at `supabase/migrations/20260815164539_create_entries_table.sql:31-36`
  and `supabase/tests/entries_rls_test.sql:8-17`. This phase does not change
  that, and a green suite must not be read as covering it.
- **F5 is not closed.** The composite FK (`unique (id, user_id, kind)` on
  `categories` plus a three-column FK on `entries`) would move both cross-user
  invariants into the schema and make them pgTAP-provable. It was recommended at
  `context/archive/2026-08-15-income-and-entry-management/reviews/impl-review.md:80-97`,
  declined once, and is declined again here: it is a migration, which brings
  risk #4's deploy-window concern into a testing phase. Testing the existing
  behaviour is the in-scope reading of "Isolation beyond the database."
- **F10 is not fixed.** The aggregate silently dropping entries filed under
  another user's category (both boards identically, via the shared inner join)
  stays accepted. This phase tests the write half — that the row cannot land —
  which is the half the archive left open.
- **F9 is not re-litigated.** An authenticated user POSTing directly to
  `/rest/v1/rpc/entries_summary` bypasses the bucket-count guard. Recorded as
  having _no isolation impact_ ("Only their own data is reachable") and already
  restated in `src/lib/services/reports.test.ts:68-73`.
- **`db-test` is not widened to pull requests.** `test-plan.md` §5 records this
  as a cost decision, not a correctness one. Unchanged.
- **No `vitest.config.ts` change, no new dependency, no Docker, no jsdom.**
  Everything runs on the default `node` environment.
- **No test of auth mechanics.** `test-plan.md` §7 excludes sign-in, token
  refresh and password reset. We test what auth _gates_.
- **No component or viewport work.** That is §3 Phase 5.
- **§1–§5 of `test-plan.md` are not edited.** Two corrections research
  identified — §2's "likely cheapest layer" emphasis and §3's Phase 4
  test-types weighting — are left for `/10x-test-plan --refresh`, which exists
  to change frozen strategy through a change folder. Only §6 (cookbook) and §3's
  Status cell are touched here.
- **`listEntryDaysForMonth` gets no test**, and `.gte`/`.lte` are not added to
  the fake. It is not a risk-#3 path; adding it would be speculative fixture
  completion.

## Implementation Approach

Four phases, each independently verifiable, ordered so the riskiest refactor
lands against known-green tests before anything depends on it.

Phase 1 builds the shared fixture and **retrofits the three existing green route
tests onto it** — proving the helper against suites whose behaviour is already
known before new tests rely on it. Phase 2 writes the six refusal cases. Phase 3
adds a genuinely new capability (mocking `astro:middleware`) and contains the
phase's only product-code change. Phase 4 writes the cookbook.

Two rules carry from `test-plan.md` §6.1 and §6.2 and apply to every test file
here:

- **Oracle rule.** Expectations are hand-written from an external source — the
  route read as a contract, the Polish strings it hand-writes, the migration
  comments — never derived by calling the code under test.
- **Teeth rule.** _A test is not done until it has been seen red._ Each phase
  names its own teeth check.

## Critical Implementation Details

**What the fake structurally cannot express, and must not be made to.** The
Supabase fake has no caller identity and no row store, so it cannot express RLS.
"RLS returned zero rows for a foreign id" is expressed by _queueing what
PostgREST would have returned_. The honest claim a route test can make is:
**given a client that returns nothing for B's id, A gets a 404 whose body does
not confirm B's row exists.** Proving that RLS actually returns nothing is
pgTAP's job and is already done. Every new test file must say this in its header
comment — a reader who mistakes these for proofs of RLS has been misled by the
test, which is worse than having no test.

**Ordering inside Phase 3.** Write the anonymous `GET /` middleware case and
watch it fail _before_ touching `src/middleware.ts`. That ordering is what makes
the one-line fix a verified fix rather than an assertion written to match code
already changed.

**The `vi.mock` factory is hoisted above every import**, so its body must not
close over a binding initialised later. The working shape is a module-scope
mutable holder plus `const { X } = await import("./x")` _after_ the mock. This
already bit once; it is why all three existing route tests are written that way.

## Phase 1: Shared route-test fixtures

### Overview

Remove the concrete blocker (`context.params`) and collapse four copies of a
hand-rolled `auth.getUser` into one identity-parameterised helper, proving it
against three suites that are already green.

### Changes Required:

#### 1. Shared route-test fixture

**File**: `src/lib/services/__fixtures__/route-context.ts` (new)

**Intent**: Give route tests one place to build the two things every one of them
needs — a client carrying an `auth.getUser` surface for a chosen identity, and a
route context that can carry `params`. Today both are hand-rolled identically in
three files, and the `params` half does not exist at all, which is what blocks
every test in Phase 2.

**Contract**: Exports two named identity constants adopted from
`supabase/seed.sql` — user A `11111111-1111-1111-1111-111111111111` and user B
`22222222-2222-2222-2222-222222222222` — so the JS and pgTAP layers name the
same two actors and read together. Exports a factory that wraps
`createSupabaseFake`'s client with `auth: { getUser: … }` for a given identity
(or `null` for anonymous), returning the recorded `calls` alongside; and a route-
context builder accepting a URL, method, optional JSON body, and **optional
`params`**, returning the `{ request, cookies, url, params }` shape the routes
read.

Two constraints carried from the existing files. The `auth.getUser` surface is
**partial on purpose** — the real one also returns `error`, which no route
reads; do not widen it speculatively. And the fake's methods must be carried
across **selectively** per route, as `summary.test.ts:78-85` does: copying the
whole fake drags its `then` along and makes the client itself thenable.

Not named `*.test.ts` — `vitest.config.ts`'s only glob is `src/**/*.test.ts`, so
a helper with that suffix is collected as a suite and fails the run with "No
test found". `__fixtures__/` is the established location (`test-plan.md` §6.2).

**Note on the `as unknown as` bridge**: keep it at the call site, as §6.2
requires. `eslint.config.js:41` applies `strictTypeChecked` to test files with no
override, so the `no-unsafe-*` family bites any fake leaning on `any`.

#### 2. Retrofit the three existing route tests

**File**: `src/pages/api/receipts/entries.test.ts`,
`src/pages/api/entries/summary.test.ts`,
`src/pages/api/entries/category-summary.test.ts`

**Intent**: Migrate each onto the shared helper and onto the seed-uuid
identities, so the helper is proven against known-green behaviour before Phase 2
depends on it.

**Contract**: Behaviour must not change. Same test count, same assertions, same
names. Only the construction of the client and the route context moves. Each
file's existing header comment stays — including
`entries.test.ts:188-196`'s note that the 404 string is a security decision.

Where a file's local helper carries something the shared one should not absorb
(a route-specific method selection, a query-string builder), leave it local.

### Success Criteria:

#### Automated Verification:

- Full suite green with an unchanged test count: `npm run test`
- Lint passes: `npm run lint`
- Typecheck passes: `npx astro sync && npm run typecheck`
- No file named `*.test.ts` was added under `__fixtures__/`

#### Manual Verification:

- Reading the three retrofitted files, the diff is construction-only — no
  assertion text changed
- The seed uuids in the fixture match `supabase/seed.sql` character for
  character

**Teeth check for this phase**: temporarily point the identity constant at a
third uuid and confirm nothing goes red — that is the expected result and it
documents honestly that the fake has no caller identity. Revert. Record the
outcome in the phase notes; it is the evidence for the header comment every
Phase 2 file must carry.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding.

---

## Phase 2: Ownership refusal at all six surfaces

### Overview

The heart of the phase. Six A-requests-B refusal cases across two mechanisms,
each closing an archived `curl`-only verification.

### Changes Required:

#### 1. Category route ownership

**File**: `src/pages/api/categories/[id].test.ts` (new)

**Intent**: Prove that A requesting B's category id is refused, and refused the
same way an absent id is — across both mutation verbs, which fail through two
_different_ mechanisms and so cannot share one test.

**Contract**: `PATCH` with a foreign id queues one response whose `error` is
`{ code: "PGRST116" }` → asserts **404** with body
`{ error: "Nie znaleziono kategorii" }`. `DELETE` with a foreign id queues one
response with `data: []` → asserts **404**, same body, **not a silent 204**.

Assert the body, not only the status: the ambiguous string is the
anti-enumeration property (`src/lib/services/entries.ts:90-93`).

Include a positive control per verb so a refusal is distinguishable from a
broken fixture. Closes
`context/archive/2026-08-15-custom-categories/plan.md:308`.

#### 2. Entry route ownership

**File**: `src/pages/api/entries/[id].test.ts` (new)

**Intent**: Prove refusal on the entry's own id, and — the sharper case — that
an entry A _does_ own cannot be re-pointed at a category B owns. That second
case is the one invariant with no database backstop.

**Contract**: Three cases.

1. `PATCH` with a foreign entry id: one queued response, `data: null` from the
   `maybeSingle()` pre-read → **404**, body `{ error: "Nie znaleziono wpisu" }`.
2. `PATCH` with an owned entry id but a foreign `categoryId` in the body: **two**
   queued responses — the pre-read returning the entry, then
   `assertCategoryUsable`'s `maybeSingle()` returning `data: null` → **404**,
   body `{ error: "Nie znaleziono kategorii", field: "categoryId" }`.
3. `DELETE` with a foreign id: one queued response, `data: []` → **404**,
   `{ error: "Nie znaleziono wpisu" }`, **not a silent 204**.

Case 2 is the phase's sharpest assertion. Its header comment must state that the
FK it guards checks row existence only, cite the migration
(`20260815164539_create_entries_table.sql:31-36`), and say that with no pgTAP
added this test is the invariant's only automated guard.

Closes `context/archive/2026-08-15-income-and-entry-management/plan.md:374`.

#### 3. Entry creation with a foreign category

**File**: `src/pages/api/entries/index.test.ts` (new)

**Intent**: Prove the create path refuses a category the caller does not own,
and — separately — that a category they _do_ own of the wrong kind gets an
honest message. The contrast is the point: one must stay ambiguous, the other
can afford not to.

**Contract**: `POST` with a foreign `categoryId` queues one response with
`data: null` → **404**, `{ error: "Nie znaleziono kategorii", field: "categoryId" }`.
A second case with a queued category of mismatched `kind` → **400**,
`{ error: "Kategoria nie pasuje do typu wpisu", field: "categoryId" }`, proving
the two branches are distinguishable and that the ambiguity is deliberate rather
than incidental.

Closes `context/archive/2026-08-15-daily-expense-entry/plan.md:377`.

#### 4. Batch confirm with a foreign category

**File**: `src/pages/api/receipts/entries.test.ts` (extend)

**Intent**: Prove the batch path's set-cardinality check rejects the **whole
batch atomically** when any item names a category the caller does not own.

**Contract**: Queue a category-check response returning **fewer** rows than the
request named → **404**, `{ error: "Nie znaleziono kategorii", field: "categoryId" }`,
and assert **no `upsert` was recorded** — the atomicity claim is about what did
_not_ reach the database, which the return value cannot show.

Absent, soft-deleted, and someone-else's are indistinguishable here on purpose
(`src/lib/services/entries.ts:255-257`); say so in the comment.

Closes `context/archive/2026-08-16-receipt-parsing/plan.md:493`.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm run test`
- Test count increased by at least 8 over the Phase 1 baseline
- Lint passes: `npm run lint`
- Typecheck passes: `npm run typecheck`
- Every new file carries the "this does not prove RLS" header comment

#### Manual Verification:

- Each of the four archived `curl` verifications maps to a named test case, and
  the mapping is stated in the relevant file's header
- The three ambiguous-404 bodies are byte-identical to the strings in the route
  source, including Polish diacritics
- No test asserts only a status code where a body is available

**Teeth check for this phase**: two independent breaks, each confirmed to turn
exactly one case red, then reverted. (a) Drop `.select("id")` from
`deleteEntry` — the DELETE case must go red as a silent 204. (b) Make
`assertCategoryUsable` return early instead of throwing — the foreign-
`categoryId` cases must go red.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human before
proceeding.

---

## Phase 3: Edge-cacheability

### Overview

The second, independent isolation path. Adds a capability the project does not
have — driving `src/middleware.ts` under Vitest — and contains this phase's only
product-code change.

### Changes Required:

#### 1. Middleware tests

**File**: `src/middleware.test.ts` (new)

**Intent**: Pin what the `Cache-Control` guarantee actually rests on, so
weakening it goes red. The load-bearing case is the **negative** one.

**Contract**: `vi.mock("astro:middleware", () => ({ defineMiddleware: (fn:
unknown) => fn }))` — `defineMiddleware` is a pure identity helper at runtime and
only supplies types; Vitest 4's mock registry intercepts the specifier before
Vite's resolver is consulted, so the unresolvable virtual id is fine. `vi.mock`
`@/lib/supabase` as elsewhere. Drive the real `onRequest` with a hand-built
context and a `next()` returning a plain mutable `Response`.

Five cases:

| Request                           | Expected                                                    |
| --------------------------------- | ----------------------------------------------------------- |
| `/api/entries/summary`, signed in | `Cache-Control: private, no-store`                          |
| `/api/entries/summary`, anonymous | header **absent**                                           |
| `/dashboard`, anonymous           | `302` **and** `private, no-store`                           |
| `/dashboard`, signed in           | `private, no-store`                                         |
| `/`, anonymous                    | `302` **and** `private, no-store` — **red until change #2** |

Row 2 is the executable statement of the risk: it pins that coverage of the
entire `/api/**` surface rests on `locals.user`, never on the path. Its comment
must say so, and must record that `PROTECTED_ROUTES` matches neither
`/api/entries/summary` nor `/api/categories/42`.

Also assert `.set()` semantics are relied on rather than `.append()` — a
duplicated header would be a real regression, and every API response is built as
`new Response(body, { status })` with no `headers` key at all.

#### 2. Cover the anonymous root redirect

**File**: `src/middleware.ts`

**Intent**: `GET /` for an anonymous visitor returns an auth-dependent
`302 → /auth/signin` (`src/pages/index.astro:2-3`) with no `Cache-Control` —
neither disjunct fires. No body and no PII, so it is not a leak, but it is a
cacheable auth-varying response and it contradicts the comment directly above
the code, which claims coverage of "the auth-dependent redirect that gates one."

**Contract**: Extend the header condition so an auth-dependent redirect carries
`private, no-store` regardless of which disjunct produced it. Keep `.set()`, keep
it after `next()`, and do not touch `PROTECTED_ROUTES` — widening that array
would change the redirect behaviour of `/`, which is a different change. Update
the comment so it describes what the code now does.

**Latent hazard to leave alone**: `headers.set()` throws on an immutable headers
guard, which the _static_ `Response.redirect()` produces. There is no
`Response.redirect` in `src/` today — all redirects use `context.redirect` /
`Astro.redirect`, which yield mutable responses. Do not add one.

### Success Criteria:

#### Automated Verification:

- Full suite green: `npm run test`
- `src/middleware.test.ts` contributes 5 passing cases
- Lint passes: `npm run lint`
- Typecheck passes: `npm run typecheck`
- No change to `vitest.config.ts` and no new dependency in `package.json`

#### Manual Verification:

- The `/` case was **observed red before** `src/middleware.ts` was edited, and
  the observation is recorded in the phase notes
- `npm run dev`: signing in and loading `/dashboard`, then `/api/entries/summary`
  via the browser's network panel, both show `Cache-Control: private, no-store`
- Signed out, `GET /` shows the 302 now carrying the header
- The comment at `src/middleware.ts` no longer claims coverage the code does not
  provide

**Teeth check for this phase**: change the header condition to `isProtected`
alone, dropping the `locals.user` disjunct. The signed-in `/api/**` case must go
red. Revert. This is the check that proves row 2 has teeth.

**Implementation Note**: This phase changes product code. After automated
verification passes, pause for manual confirmation from the human before
proceeding.

---

## Phase 4: Cookbook and plan sync

### Overview

Deliver §6.4 — the cookbook entry three prior phases deferred to this one — and
correct the one clause in §6.1 that would send the next reader down an
unnecessary config change.

### Changes Required:

#### 1. Write §6.4

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.4's `TBD — see §3 Phase 4` with the delivered pattern, in
the shape §6.1–§6.3 established.

**Contract**: Cover location and naming (co-located `<route>.test.ts`, including
the bracketed-filename case `[id].test.ts`); the shared fixture and the two
seed-uuid identities; the reference test; the run command; **the ownership
pattern** — request as A for B's resource, assert refusal, assert the body not
just the status; and the limit that matters most: **a route test cannot prove
RLS**, only that a route refuses correctly given a client that returns nothing.
Name `params` as the shape the helper adds and the routes that read it.

State the anti-enumeration rule as a rule, not an anecdote: the 404 body must
stay identical for absent and not-yours, so changing that string is a security
change.

#### 2. Correct §6.1's virtual-module clause

**File**: `context/foundation/test-plan.md`

**Intent**: §6.1's "Directly" bullet claims `vi.mock("astro:env/server", …)`
"needs a specifier Vitest can resolve, i.e. the alias-stub below anyway." That is
false for a direct `astro:*` import with a mock factory supplied, and Phase 3
proves it.

**Contract**: Correct the clause and cite `src/middleware.test.ts` as the
working example, in the same "corrected by §3 Phase N" style §6.1 already uses
for its Phase 2 and Phase 3 corrections. Keep the genuine limit intact —
mocking the module under test still removes the subject, and the extract-or-
alias-stub options still stand for that case. Move `src/middleware.ts` off the
"still genuinely unreachable" list.

#### 3. Append §6.6 Phase 4 notes

**File**: `context/foundation/test-plan.md`

**Intent**: Record what this phase taught, in the two-or-three-line shape §6.6
uses.

**Contract**: At minimum: that the pgTAP half of the phase turned out nearly
done and why (both aggregates `security invoker`, no user parameter, both
summary suites already asserting through the RPC); that the FK ownership gap is
now guarded **only** at the app layer and where its database-side record lives;
that `Cache-Control` coverage is path-blind and rests on one disjunct; and the
Phase 1 teeth result — that changing the fake's identity constant breaks
nothing, which is the honest statement of what these tests do and do not prove.

#### 4. Flip the §3 Phase 4 row

**File**: `context/foundation/test-plan.md`

**Intent**: Mark the rollout phase complete and re-date the freshness ledger.

**Contract**: §3's Phase 4 Status cell → `complete`; Change folder →
`context/archive/2026-08-22-testing-cross-user-isolation/`. Add a §8 ledger line
noting risk #3 now has automated coverage at the route and middleware layers.
Do **not** edit §1–§5 beyond that Status cell and the ledger.

#### 5. Stamp the change

**File**: `context/changes/testing-cross-user-isolation/change.md`

**Contract**: `status: complete`, `updated: 2026-08-22`.

### Success Criteria:

#### Automated Verification:

- Full suite still green: `npm run test`
- Lint and format pass on the edited markdown: `npm run lint` and
  `npm run format`
- No `TBD` remains in §6.4
- §3's Phase 4 Status cell reads `complete`

#### Manual Verification:

- §6.4 read cold answers "how do I add an ownership test for a new route?"
  without needing the plan or research doc
- §6.1 no longer contains the false clause, and `src/middleware.ts` is off the
  unreachable list
- §1–§5 are otherwise byte-identical to their pre-phase state

**Implementation Note**: Final phase. After verification, the change folder is
ready for `/10x-archive`.

---

## Testing Strategy

This phase _is_ tests, so this section states what each layer is claiming rather
than what to add.

### Unit Tests:

- `src/middleware.test.ts` — the five cache-header cases. Pure: no database, no
  network, no jsdom, default `node` environment.

### Integration Tests:

- Six A-requests-B refusal cases at the route boundary, driving the **real**
  service against the recording fake so each mapping proves actual wiring — that
  `CategoryNotFoundError` really does surface as a 404 with that body, not
  merely that the route could build one.
- Two positive controls per new route file, so a refusal is distinguishable from
  a broken fixture.

### What these tests explicitly do not prove:

- **That RLS works.** The fake has no caller identity and no row store. Every
  new file says this in its header. RLS is pgTAP's, and is already proven.
- **That the FK cannot be bypassed.** It can, at the database layer. These tests
  prove the application layer catches it on both write paths.

### Manual Testing Steps:

1. `npm run dev`, sign in as one seed user, note a category id from the
   dashboard.
2. Sign in as the other seed user in a private window.
3. `curl -X PATCH` that category id with the second user's cookie — expect
   **404** and the body `{"error":"Nie znaleziono kategorii"}`.
4. `curl -X POST /api/entries` with the second user's cookie naming the first
   user's `categoryId` — expect **404**, `field: "categoryId"`, and confirm in
   Studio that nothing was inserted.
5. Check the network panel for `Cache-Control: private, no-store` on
   `/dashboard`, on `/api/entries/summary`, and — signed out — on `GET /`.

Steps 3–4 are the same checks the four archived slices ran by hand; running them
once more confirms the tests encode the real behaviour rather than a
misremembered one.

## Performance Considerations

Negligible. The current suite is 254 tests in ~580 ms with no database, no
network and no browser. This phase adds roughly 15–20 cases of the same shape.
The `ci` job gains a second or two.

The Phase 3 product change is one condition in middleware that already runs on
every request; it sets a header that is already set on most responses.

## Migration Notes

None. No schema change, no data change, no configuration change, no new
dependency. The only product-code change is `src/middleware.ts`'s header
condition, which is forward-only and requires no coordination with a deploy
window.

## References

- Research: `context/changes/testing-cross-user-isolation/research.md`
- Change brief: `context/changes/testing-cross-user-isolation/change.md`
- Quality contract: `context/foundation/test-plan.md` §2 risk #3, §3 Phase 4,
  §6.1, §6.2, §6.4, §7
- Lessons: `context/foundation/lessons.md`, first entry (app-layer-only
  invariants route to a JS test, not to "manual forever")
- Reference route test: `src/pages/api/entries/summary.test.ts`
- Reference fixture: `src/lib/services/__fixtures__/supabase-fake.ts`
- The FK caveat, in the migration's own words:
  `supabase/migrations/20260815164539_create_entries_table.sql:31-36`
- The pgTAP exclusion: `supabase/tests/entries_rls_test.sql:8-17`
- The four archived hand-verifications:
  `context/archive/2026-08-15-custom-categories/plan.md:308`,
  `context/archive/2026-08-15-daily-expense-entry/plan.md:377`,
  `context/archive/2026-08-15-income-and-entry-management/plan.md:374`,
  `context/archive/2026-08-16-receipt-parsing/plan.md:493`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared route-test fixtures

#### Automated

- [x] 1.1 Full suite green with an unchanged test count: `npm run test` — 66a1e38
- [x] 1.2 Lint passes: `npm run lint` — 66a1e38
- [x] 1.3 Typecheck passes: `npx astro sync && npm run typecheck` — 66a1e38
- [x] 1.4 No file named `*.test.ts` was added under `__fixtures__/` — 66a1e38

#### Manual

- [x] 1.5 The three retrofitted files show a construction-only diff — 66a1e38
- [x] 1.6 The seed uuids match `supabase/seed.sql` character for character — 66a1e38
- [x] 1.7 Teeth check: changing the identity constant breaks nothing, result recorded — 66a1e38

### Phase 2: Ownership refusal at all six surfaces

#### Automated

- [x] 2.1 Full suite green: `npm run test` — 74e6ed2
- [x] 2.2 Test count increased by at least 8 over the Phase 1 baseline — 74e6ed2
- [x] 2.3 Lint passes: `npm run lint` — 74e6ed2
- [x] 2.4 Typecheck passes: `npm run typecheck` — 74e6ed2
- [x] 2.5 Every new file carries the "this does not prove RLS" header comment — 74e6ed2

#### Manual

- [x] 2.6 Each archived `curl` verification maps to a named test case — 74e6ed2
- [x] 2.7 The three ambiguous-404 bodies are byte-identical to the route source — 74e6ed2
- [x] 2.8 No test asserts only a status where a body is available — 74e6ed2
- [x] 2.9 Teeth check (a): dropping `.select("id")` from `deleteEntry` turns the DELETE case red — 74e6ed2
- [x] 2.10 Teeth check (b): short-circuiting `assertCategoryUsable` turns the foreign-`categoryId` cases red — 74e6ed2

### Phase 3: Edge-cacheability

#### Automated

- [x] 3.1 Full suite green: `npm run test` — 823a74c
- [x] 3.2 `src/middleware.test.ts` contributes 5 passing cases — 823a74c
- [x] 3.3 Lint passes: `npm run lint` — 823a74c
- [x] 3.4 Typecheck passes: `npm run typecheck` — 823a74c
- [x] 3.5 No change to `vitest.config.ts` and no new dependency — 823a74c

#### Manual

- [x] 3.6 The `/` case was observed red before `src/middleware.ts` was edited — 823a74c
- [x] 3.7 `/dashboard` and `/api/entries/summary` show `private, no-store` signed in — 823a74c
- [x] 3.8 Signed out, `GET /` shows the 302 carrying the header — 823a74c
- [x] 3.9 The middleware comment no longer claims coverage the code does not provide — 823a74c
- [x] 3.10 Teeth check: dropping the `locals.user` disjunct turns the signed-in `/api/**` case red — 823a74c

### Phase 4: Cookbook and plan sync

#### Automated

- [x] 4.1 Full suite still green: `npm run test` — f226cc4
- [x] 4.2 Lint and format pass: `npm run lint` and `npm run format` — f226cc4
- [x] 4.3 No `TBD` remains in §6.4 — f226cc4
- [x] 4.4 §3's Phase 4 Status cell reads `complete` — f226cc4

#### Manual

- [x] 4.5 §6.4 read cold answers "how do I add an ownership test for a new route?" — f226cc4
- [x] 4.6 §6.1's false clause is gone and `src/middleware.ts` is off the unreachable list — f226cc4
- [x] 4.7 §1–§5 are otherwise byte-identical to their pre-phase state — f226cc4
