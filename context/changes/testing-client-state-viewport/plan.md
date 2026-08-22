# Client state + viewport regressions — Implementation Plan

## Overview

Rollout **Phase 5** of `context/foundation/test-plan.md` §3 — the last one. It
stands up the two capabilities the rollout deferred to the end (React component
tests, a headless narrow-viewport overflow check), uses them to cover risks
**#5** and **#6**, brings the live overflow surfaces into conformance so the new
gate can actually be required, flips the two §5 gates marked "required after §3
Phase 5", writes cookbook **§6.5**, and closes the rollout.

Two things distinguish this phase from Phases 1–4. First, **both capabilities
are from zero** — every tooling feasibility question is an inherited unknown,
because research was deliberately scoped read-only. Second, **risk #5's own risk
statement is wrong about the mechanism**, and the honest deliverable is sharper
than the statement: characterisation of three live, individually-deletable
guards that three separate impl-reviews installed and that have zero regression
cover today.

## Current State Analysis

### Risk #5 — the day list

`/dashboard` mounts `<DayView client:load />` with **no props** and no SSR data
(`src/pages/dashboard.astro:12`). `DayView` owns everything; the entry array is
one hook (`DayView.tsx:31`) whose `null` means "loading".

**Nothing is optimistic.** All four write paths — create, inline edit, delete,
receipt batch — are **server-echo**: the list is patched only after
`await response.json()`, using the DTO the server returned. There is nothing to
roll back on failure because nothing was ever applied ahead of the server. The
only optimistic patch in the island is on the _category_ lists
(`DayView.tsx:196-206`), and it matters solely because it bumps
`entriesRefreshKey` (`:191-194`) — making a category mutation the one thing that
refetches the day's entries **without** a day change.

Three archived incidents left three guards standing today, each one deletable
line, each with **no automated cover**:

| Incident                                                                                    | Fix                                                | Guard today                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| (a) stale-day race at save (`daily-expense-entry` impl-review F1, commit `a754080`)         | `selectedDateRef`                                  | `DayView.tsx:34-37` + `:122`, `:144`, `:159` |
| (b) duplicate row from optimistic save (`income-and-entry-management` F2, commit `0b8bd2a`) | id dedupe + `prev === null` early-return           | `DayView.tsx:133`, `:150-151`, `:127-129`    |
| (c) shared inline-edit state across rows and days (same review, F3, `0b8bd2a`)              | `key={selectedDate}` remount + `disabled={saving}` | `DayView.tsx:262`, `DayEntriesList.tsx:372`  |

All edit state is **seven hooks in the parent list** (`DayEntriesList.tsx:101-116`).
`editingId` is keyed by `entry.id` (a number, never an index), but the `editForm`
draft is **one flat object shared by every row** — only `editingId` says which row
it belongs to. `startEdit` (`:128-140`) re-seeds all four fields plus `editingId`
in one call, so opening row B while row A held a draft silently discards A's.
The cross-row guard is **asymmetric**: `Edytuj` is `disabled={saving}` on every
row (`:372`), `Usuń` is disabled only by its own `deletingId === entry.id`
(`:387`).

Two live defects the risk statement does not name, both failing in the
**losing** direction rather than the duplicating one:

- **Gap 1, the inverse race.** A same-day GET fired by `entriesRefreshKey` that
  resolves _after_ a POST response has appended wholesale-replaces the array at
  `DayView.tsx:94` with a pre-insert snapshot. The just-saved row silently
  disappears. `cancelled` guards effect supersession only; nothing correlates a
  GET with a mutation on the same day.
- **Gap 2, the `prev === null` drop.** A save or batch confirm resolving while
  the day's GET is in flight discards the entry outright
  (`DayView.tsx:127-129`, `:147-149`), deliberately. Phase 2's research handed
  this forward explicitly
  (`context/archive/2026-08-21-testing-receipt-confirm-integrity/research.md:582-585`).

**One correction to research §1.6, found while grounding this plan.** Research
states `setEntries(null)` runs synchronously at the top of every day-GET effect.
It does not: the actual code guards it with `loadedDateRef`
(`DayView.tsx:81-84`), so a **same-day** refetch (the `entriesRefreshKey` path)
leaves the current list rendered while the GET is in flight. This sharpens both
gaps rather than softening them — Gap 1 becomes the _reachable_ one via the
category-mutation lever, and Gap 2 is reachable only during the initial load,
not on a same-day refresh. The characterisation tests must be written to that
distinction.

### Risk #6 — document-level horizontal overflow

`PROTECTED_ROUTES = ["/dashboard", "/reports"]` (`src/middleware.ts:6`), and
**both shipped instances of the bug live behind it**: `Topbar` (S-11) is
imported only by `dashboard.astro:3` and `reports.astro:3`; `ReceiptReview`
(S-12) mounts only on `/dashboard`. A headless browser with no session reaches
three anonymous pages that are **one shell** with exactly one user-supplied
string — `Astro.url.searchParams.get("error")` → `ServerError.tsx:11-13`.

`astro build` emits **zero static HTML** (`output: "server"`, no `prerender`
anywhere) but does emit the whole stylesheet as one standalone content-hashed
file, `dist/client/_astro/Layout.<hash>.css` (~49 KB), containing every Tailwind
utility, the `bg-cosmic` gradient, and Layout's global rule.

**Nothing masks the symptom**: `overflow-x` appears nowhere in the built CSS, and
`Layout.astro:50-55`'s `html,body{margin:0;width:100%;height:100%}` does not
clip, so `clientWidth` stays the viewport width while `scrollWidth` grows.

**The real subject is a primitive, not a page.** `src/components/ui/button.tsx:8`
is `inline-flex … whitespace-nowrap … shrink-0` with **no `max-w-full`** — lesson
4's exact recipe, in every button in the app, with the bound restored at only two
call sites (`ReceiptReview.tsx:192`, `MonthCalendar.tsx:125`).
`roadmap.md:245` already states the binding rule; the primitive predates it.

### Harness

The expensive question — the `astro:*` / `cloudflare:workers` direct-vs-transitive
fork that cost Phases 2–4 their thinking — **does not bind here**. Not one island
in `src/components/entries/` reaches such a specifier, directly or transitively.
What blocks component tests is: no DOM environment, no React renderer, and
`vitest.config.ts:22`'s `include: ["src/**/*.test.ts"]`, a literal `.ts` suffix
that will **silently** not collect a `.test.tsx` — no error, just a suite that
does not exist.

`jsdom`, `happy-dom`, `@testing-library/*` and every browser driver are absent
from `package-lock.json` entirely. `@vitejs/plugin-react@5.2.0` is present but
**transitive** (a hoisted optional dependency of `@astrojs/react`), not declared.

`eslint.config.js` has **no test-file override**, so a `.tsx` test file gets
`react-compiler`, all 34 `astro/jsx-a11y/*` rules (the spread at `:90` has no
`files` key), `react-hooks` v7, and `eslint-plugin-react` recommended — all at
**error**.

## Desired End State

- `npm run test` collects both `.test.ts` and `.test.tsx`, runs the existing 15
  suites unchanged on the `node` environment, and additionally runs React
  component suites on `jsdom`.
- The three archived incidents (a), (b), (c) each have at least one test that
  goes red if its guard is deleted.
- The two subtractive defects (Gap 1, Gap 2) are pinned by **characterisation**
  tests whose header comments name them as defects, not as desired behaviour.
- `npm run test:viewport` builds nothing itself but asserts, against
  `dist/client/_astro/Layout.*.css`, that at 320/360/390 CSS px no fixture page
  gives the **document** horizontal scroll, and that no fixture block overflows
  its own container.
- That check is **green**, because the mechanism-A and mechanism-B surfaces it
  finds have been brought into conformance with `roadmap.md:245`'s rule.
- `.github/workflows/ci.yml`'s `ci` job runs the viewport check after
  `npm run build`, on pushes **and** pull requests.
- `test-plan.md`: §3 Phase 5 `complete`; §4's `component (React islands)` and
  `narrow-viewport overflow` rows carry real versions and dates; §5's two gates
  read `required — wired`; §6.5 is written; §6.6 carries Phase 5 notes; the four
  §2 corrections research produced are recorded.

**How to verify**: `npm run lint && npm run typecheck && npm run test && npm run build && npm run test:viewport` all pass from a clean `npm ci`, and each new
test has been individually seen red by breaking the thing it guards.

### Key Discoveries

- `DayView.tsx:81-84` — the `loadedDateRef` guard, which research missed; it is
  what makes Gap 1 reachable and Gap 2 initial-load-only.
- `DayView.tsx:5` imports `ReceiptCapture`, which drags `useSyncExternalStore`,
  Canvas and `createImageBitmap` into any `DayView` render. Mocking that one
  child removes three unverified environment questions at once.
- `DayEntriesList.tsx:183`, `:198` use `window.confirm` and `window.alert`.
  jsdom does not implement either — they throw "Not implemented". The delete
  path is untestable without stubbing both.
- `src/lib/format.ts:5-10` emits **U+00A0** (both as thousands separator and
  before `zł`), expense amounts use **U+2212 MINUS SIGN**, and loading text uses
  **U+2026**. A naive `getByText` fails silently on all three.
- `aria-label` overrides visible text on the two icon buttons
  (`aria-label="Edytuj"` / `"Usuń"`) and on the description expander — query by
  role and accessible name, not by visible text.
- The built CSS filename is **content-hashed** and changes on every CSS edit —
  the fixture must resolve it by glob, never by literal.
- `src/components/ui/dialog.tsx:57` is `position: fixed` with
  `max-w-[calc(100%-2rem)]`. Whether a fixed box wider than the viewport
  contributes to `documentElement.scrollWidth` is **unverified** — the per-block
  containment assertion is what makes the answer not matter.
- `src/components/entries/date-utils.ts` constructs **local** `Date`s at `:23`,
  `:29`, `:34` — tests must pin `TZ`.
- `ci` runs on `push` **and** `pull_request` with no trigger guard, and is the
  only job that builds on a PR. §5's "CI on PR" is satisfied by putting the
  viewport step there and changing no trigger.

## What We're NOT Doing

- **Not fixing Gap 1 or Gap 2.** They are pinned as characterisation tests and
  recorded as findings. A behaviour change to the repo's top-churn island, inside
  a testing phase, with no product plan and no impl-review scoped for it, is how
  three prior reviews each got one of these guards wrong. Follows Phase 2's F2
  precedent exactly.
- **Not testing `ReceiptCapture`, `image-downscale.ts`, recharts, or radix
  Dialog under jsdom.** `ReceiptCapture` is mocked; the report islands are not in
  this phase's scope. Research open questions 3, 4 and 5 are therefore not
  answered by this phase and stay open.
- **Not visiting real URLs.** `astro build` emits no static HTML, so any
  URL-visiting variant means `astro preview` (wrangler under this adapter,
  against `CLAUDE.md`'s guidance) or a signed-in local Supabase stack in the `ci`
  job. Both were considered and declined.
- **Not adding an e2e layer** (§7), not adding pixel or snapshot tests (§7,
  and §2's stated anti-pattern for risk #6), not adding coverage reporting (§7).
- **Not configuring hooks.** §5's "post-edit hook — recommended after §3 Phase 5"
  stays recommended and unconfigured; hook configuration is a different lesson's
  scope. The `npm run` scripts this phase adds are what a future hook would call.
- **Not touching `db-test` or `deploy`.** Playwright's browser binary installs in
  a separate step, so `npm ci` stays the same size on both.
- **Not re-spiking `getViteConfig`.** Already answered and recorded
  (`test-plan.md` §6.1, and `testing-runner-bootstrap/research.md:578-587`).
- **Not restyling anything.** Phase 3's fixes are conformance to
  `roadmap.md:245`'s already-accepted rule — adding a bound, never changing a
  layout, a colour, or a label.

## Implementation Approach

Four phases, ordered so that each one's risk is retired before the next depends
on it.

**Phase 1** proves the runner extension against the _cheapest_ island in the
repo. `DayEntriesList` imports radix only through `ui/label` and has no fetch on
mount, so if jsdom + RTL work anywhere they work there — and if they don't, the
failure is unambiguously the harness, not the subject. It carries the
`date-utils` unit test as a warm-up because that needs none of the new machinery
and gives the day-navigation arithmetic an independently tested oracle.

**Phase 2** takes the harness up to `DayView` with `ReceiptCapture` mocked,
covering the two race guards and the remount, then adds the two characterisation
tests. It comes second because it depends on Phase 1's harness being proven and
on `date-utils` being trustworthy.

**Phase 3** is the whole of risk #6 in one phase: build the instrument, read it,
and act on the reading. Splitting the instrument from the fixes would leave a
red check sitting in the repo between phases for no benefit — the check is not
wired to CI until Phase 4, so there is no gate to protect in the interim.

**Phase 4** wires the gates and writes the documents. It comes last because §5's
rows can only honestly flip to "required — wired" once both checks are green and
in CI.

The two capabilities are kept in **separate runners on purpose**, and the reason
is structural, not stylistic: `src/styles/global.css` is imported exactly once,
from `Layout.astro:2`, never from a `.tsx`. Under Vitest there is no Tailwind
plugin, so a rendered island has zero computed styles and every `className` is an
inert string. Overflow is a property of built CSS that exists only after
`astro build`. Component tests answer risk #5 and **cannot** answer risk #6.

## Critical Implementation Details

**jsdom's unimplemented dialogs.** `window.confirm` and `window.alert` throw
"Not implemented" in jsdom. `DayEntriesList.tsx:183` gates the entire delete path
behind `window.confirm`, and `:196`/`:199` report delete failures through
`window.alert`. Both must be stubbed per-suite (`vi.stubGlobal`, restored in
`afterEach`), and the alert calls are worth **asserting** — they are the only
user-visible signal a failed delete has.

**Ordering in CI is load-bearing.** The viewport check reads
`dist/client/_astro/Layout.*.css`. `npm run test` currently runs _before_
`npm run build` in the `ci` job, deliberately (a logic failure should surface
without paying for a build). The viewport step must therefore be a **separate
step after `build`**, never folded into `npm run test`.

**The fixture's drift risk is managed by comment, not by machinery.** Every
fixture block must carry a comment naming the source `file:line` it reproduces
and the class list it copies. That comment is the only thing standing between
this check and silently testing markup that no longer exists. The same applies in
reverse for the 320px chart box: `ui/chart.tsx:10`'s `INITIAL_DIMENSION` and the
fixture must each carry a comment pointing at the other.

**`Layout.astro:50-55` is load-bearing for the gate.** `html,body{width:100%}`
does not clip. Anyone "tidying" it into `max-width:100vw` + `overflow-x:hidden`
would silently disable the entire check while making every page look fixed. It
needs a comment pointing at the check.

## Phase 1: Runner extension + first island suite

### Overview

Add the DOM environment, the React renderer and the query library; make the
discovery glob see `.tsx`; restate `resolve.dedupe`; give test files an ESLint
override. Prove it all against `DayEntriesList`, covering archived incident **(c)**.
Carry the `date-utils` unit test alongside, on the existing `node` environment.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the component-test toolchain as declared devDependencies. Pin
exactly, matching the precedent set by `vitest` and `supabase`.

**Contract**: New `devDependencies`: `jsdom`, `@testing-library/react`,
`@testing-library/dom`, `@testing-library/user-event`,
`@testing-library/jest-dom`. Resolve each against current releases at
implementation time and record the versions in §4's `component (React islands)`
row in Phase 4.

`@vitejs/plugin-react` is deliberately **not** added yet — try Vitest's own
esbuild transform under `jsx: "react-jsx"` first (research open question 2). Add
it as a declared dependency only if rendering fails without it; relying on the
hoisted transitive copy from `@astrojs/react` is not acceptable either way.

#### 2. Discovery glob and React resolution

**File**: `vitest.config.ts`

**Intent**: Make the runner collect `.test.tsx`, and restate the one
`astro.config.mjs` Vite setting a React test needs — the standalone config
inherits nothing.

**Contract**: `include` becomes `["src/**/*.test.{ts,tsx}"]`. Add
`resolve.dedupe: ["react", "react-dom"]`. No `environment` is set at config level
— the default stays `node` so the 15 existing suites keep native
`Request`/`Response` and their current runtime.

The `dedupe` line needs a comment stating what it prevents (two `react-dom`
instances, each with its own `ReactSharedInternals`, throwing
`Cannot read properties of null (reading 'useHostTransitionStatus')`) and
pointing at `astro.config.mjs:18-27`. Add the reciprocal pointer in
`astro.config.mjs` — this is now a second copy that can drift.

#### 3. ESLint override for test files

**File**: `eslint.config.js`

**Intent**: Stop the production React ruleset from failing test files for things
that are correct in a test. Predicted by
`testing-runner-bootstrap/research.md:289-292`.

**Contract**: A new flat-config block, appended **after** the `jsx-a11y` spread
so it wins, scoped `files: ["**/*.test.{ts,tsx}"]`. Turn off, at minimum:
`react-compiler/react-compiler`, `react/display-name`, and
`react-hooks/static-components` — inline JSX harness components written as arrow
functions inside a `describe` violate all three and are the standard shape.

Do **not** relax `strictTypeChecked` or the `no-unsafe-*` family: §6.2's caveat
records that keeping them is what forces fakes to be honestly typed. Keep the
override as narrow as the failures observed; every rule disabled needs a
one-line reason.

#### 4. `date-utils` unit test

**File**: `src/components/entries/date-utils.test.ts`

**Intent**: Cover the day/month arithmetic the entries island navigates by — the
third instance of "`src/components/` is not the component layer." Ordinary §6.1
target: `node` environment, no mocking, no new machinery.

**Contract**: Cover `toLocalDateString`, `toLocalMonthString`, `monthOf`,
`daysInMonth`, `firstWeekdayOfMonth`, `addMonths`, `formatMonthLabel`.

Oracles must be **external and hand-written**, per §6.1: the Gregorian calendar
for leap years (`daysInMonth("2024-02") === 29`, `"2100-02" === 28`), ISO-8601
for the string shape, and the Polish weekday convention for the Monday-first
index — never computed by calling another helper in the same module.

The module builds **local** `Date`s (`:23`, `:29`, `:34`), so the suite must pin
`TZ`. Pin it in the file rather than depending on the runner's ambient zone, and
state in a comment why (CI's `ubuntu-latest` is UTC; a contributor in
`Europe/Warsaw` is not). Include the year-boundary cases `addMonths("2026-01", -1)`
and `addMonths("2026-12", 1)`, and a DST-transition month for the local-`Date`
construction.

#### 5. `DayEntriesList` component suite

**File**: `src/components/entries/DayEntriesList.test.tsx`

**Intent**: Cover archived incident **(c)** — shared inline-edit state leaking
across rows — and prove the harness on the cheapest island in the repo.

**Contract**: `// @vitest-environment jsdom` docblock at the top. Render the
component directly with a hand-built `entries` array and stub `onUpdated` /
`onDeleted`; the component takes `entries` as a read-only prop and never fetches
on mount, so no network fake is needed for the render cases. `fetch` is stubbed
per-case for the edit and delete paths.

Cases:

1. **The draft is shared, and opening a second row discards the first.** Open
   edit on row A, type into the amount field, open edit on row B — assert row B's
   form is seeded from **B's** values, not A's typed text. This pins `startEdit`'s
   re-seed (`:128-140`) as deliberate.
2. **`Edytuj` is disabled on every row while a PATCH is in flight** (`:372`) —
   the guard incident (c) installed. Deleting `disabled={saving}` must turn this
   red.
3. **`Usuń` is not** (`:387`). Assert the asymmetry explicitly, with a comment
   naming it as _characterised current behaviour_, not endorsed behaviour — a
   delete can be started on any row while a PATCH is in flight.
4. **A failed PATCH keeps the row in edit mode with the draft intact** and
   renders the error against the right row (`:166-169`). This is the "failed
   request leaves the list in a truthful state" case §2 demands.
5. **DELETE treats 404 as success** (`:189-192`) — the row is removed and no
   alert fires. Characterisation: it encodes "deleted in another tab".
6. **A failed DELETE alerts and keeps the row.**

Query by **role and accessible name** (`aria-label="Edytuj"` / `"Usuń"`), never
by visible text. Amount expectations must be written with the literal U+2212 and
U+00A0 characters so they are visible in a diff — §6.6's Phase 2 note records
this trap class.

Header comment must name its oracles (the component source read as a contract;
`income-and-entry-management/reviews/impl-review.md:47-64` for what incident (c)
was) and state what the layer cannot claim: **no CSS is applied under Vitest, so
nothing here says anything about layout or overflow.**

### Success Criteria:

#### Automated Verification:

- `npm run test` collects the two new files and the existing 15 suites all pass: `npm run test`
- Lint passes on the new `.tsx` test file: `npm run lint`
- Typecheck passes: `npx astro sync && npm run typecheck`
- The existing 15 suites still run on the `node` environment (no `environment` set at config level)

#### Manual Verification:

- Each of the six `DayEntriesList` cases has been **seen red** by breaking the thing it guards — in particular, deleting `disabled={saving}` from `:372` turns case 2 red and nothing else
- Deleting `resolve.dedupe` from `vitest.config.ts` reproduces (or does not reproduce) the hydration crash — record which, because it decides whether the restated line is load-bearing or precautionary
- Whole-suite wall-clock recorded before and after, since §5's post-edit-hook recommendation rests on it and research open question 8 says the ~460ms figure is stale

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: `DayView` state truth

### Overview

Take the harness up to the parent island with `ReceiptCapture` mocked. Cover
incidents **(a)** and **(b)** and the `key={selectedDate}` remount, plus failure
paths and rapid day navigation. Close with the two characterisation tests for
the subtractive defects.

### Changes Required:

#### 1. `DayView` component suite

**File**: `src/components/entries/DayView.test.tsx`

**Intent**: Pin the three guards that three impl-reviews installed and that
nothing currently protects.

**Contract**: `// @vitest-environment jsdom` docblock. `vi.mock` on
`@/components/receipts/ReceiptCapture`, replaced with a stub exposing a button
that calls `onBatchSaved` with a caller-supplied array — that keeps the batch
path drivable while removing `useSyncExternalStore`, Canvas and
`createImageBitmap` from the render entirely. State in the header comment that
the batch path is therefore driven by the test rather than by the real child.

`DayView.tsx:15` reads the clock (`toLocalDateString(new Date())`), so the suite
must fix time with `vi.setSystemTime`. Contrast this in a comment with
`src/components/reports/range.ts`, which §6.1 praises for taking `today` as a
required parameter — the design choice, not the layer, decides the cost.

`fetch` is stubbed at the global level with a per-test router keyed on URL:
`/api/entries/categories?kind=…`, `/api/entries?date=…`,
`/api/entries/month?…`. Responses must be **deferrable** — the race cases need to
control resolution order, not just content, so the stub returns promises the test
resolves by hand.

Cases:

1. **(a) The day guard.** Start a save for day A, navigate to day B, resolve the
   POST — assert day B's list does **not** gain the row. Deleting the
   `entry.occurredOn === selectedDateRef.current` check at `:122` must turn this
   red. This is the S-02 F1 regression, which today exists only as a manual
   checkbox at `income-and-entry-management/plan.md:408`.
2. **(b) The id dedupe.** POST in flight for day A; navigate B then back to A so
   a fresh GET returns _including_ the new row; then resolve the POST — assert
   the row appears **once** and `Wydatki:` counts it once. Deleting the
   `prev.some(…)` test at `:133` must turn this red.
3. **(b), batch variant.** Same shape through the mocked `onBatchSaved` with N
   rows, against the `Set` dedupe at `:150-151`.
4. **(c) The remount.** Open an inline edit, change day, come back — assert the
   row renders as a **fresh row**, not in edit mode with a stale `occurredOn`.
   Removing `key={selectedDate}` at `:262` must turn this red. Comment must
   record the **unresolved tradeoff** the review itself logged at `:56`/`:58`:
   the remount also drops edit state on a legitimate same-day refresh, and
   nobody has decided whether a future feature wants it to survive. Per §6.2 this
   is a characterisation test naming its decision record, not desired behaviour.
5. **Rapid day navigation.** Three day changes with responses resolving out of
   order — assert only the **final** day's response reaches the list, via the
   per-effect `cancelled` flag (`:79`, `:93`, `:104`). §2's anti-pattern column
   names "no rapid-navigation case" explicitly.
6. **`handleUpdated`'s upsert-or-evict** (`:158-176`): an edit that moves an
   entry off the viewed day removes it; one that moves an entry onto it adds it.
7. **A failed GET renders the load error and does not blank the list into a
   false empty state** (`:96-98` → `DayEntriesList.tsx:205-207`).

Assert **what a user would see rendered** — row text, the `Wydatki:` /
`Przychody:` totals, the three non-row states — never `entries.length` or any
hook value. That is §2's stated anti-pattern for this risk.

#### 2. Characterisation tests for the two live defects

**File**: `src/components/entries/DayView.test.tsx` (a separate `describe` block)

**Intent**: Pin Gap 1 and Gap 2 as they behave **today**, labelled as defects.
Neither is fixed in this phase.

**Contract**: A `describe("known defects — characterised, not endorsed", …)`
block whose leading comment states plainly: these tests encode behaviour the team
has **not** accepted as correct; they exist so a change to it is visible; the
desired behaviour is stated inline; fixing either one should turn these red and
the fix should flip them.

- **Gap 1 — the inverse race.** Save an entry on day A (POST resolves, row
  appended), then create a category so `refreshAfterCategoryMutation` (`:191-194`)
  bumps `entriesRefreshKey`, then resolve that same-day GET with a **pre-insert**
  snapshot. Assert the just-saved row **disappears**. Cite `DayView.tsx:94` and
  note that `loadedDateRef` (`:81-84`) is what keeps the list rendered
  meanwhile — this is the reachable one.
- **Gap 2 — the `prev === null` drop.** Resolve a save while the day's **initial**
  GET is still in flight and assert the entry is discarded from the view. Cite
  `DayView.tsx:127-129` and `:147-149`, and
  `testing-receipt-confirm-integrity/research.md:582-585` as the handoff. Note
  that because of `loadedDateRef` this is reachable on **initial load only**, not
  on a same-day refresh — which corrects research §1.6.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes with the new suite: `npm run test`
- Lint and typecheck pass: `npm run lint && npm run typecheck`
- No test in this file depends on real timers or on wall-clock date

#### Manual Verification:

- Each of the three guards has been **individually deleted** and confirmed to turn exactly the expected case red, then reverted — `:122`, `:133`, `:262`
- The two characterisation tests read unambiguously as defect records: a reader who sees them green does not conclude the behaviour is correct
- Mocking `ReceiptCapture` is confirmed to be what makes the suite runnable — i.e. an unmocked render was attempted once and its failure mode recorded, so the mock is a decision rather than an assumption

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Narrow-viewport overflow check and conformance

### Overview

Build the instrument, read it, act on the reading. Playwright chromium against
hand-written fixture pages linking the built stylesheet, at 320/360/390 CSS px,
with two assertion modes. Then bring the surfaces it finds into conformance with
`roadmap.md:245`'s already-accepted rule so the check lands green.

### Changes Required:

#### 1. Driver dependency and script

**File**: `package.json`

**Intent**: Add the browser driver without enlarging `npm ci` on the two jobs
that have no use for it.

**Contract**: `playwright` as a devDependency (not `@playwright/test` — the check
is a plain script, not a second test framework). Pin exactly. New script
`"test:viewport"`. The browser binary is installed by a **separate**
`npx playwright install --with-deps chromium` step, which is what keeps `npm ci`
the same size in `db-test` and `deploy`.

#### 2. The check

**File**: `src/../tests/viewport/check-overflow.ts` (final location chosen at
implementation time; it must sit **outside** `src/**` so `vitest.config.ts`'s
glob and `tsconfig`'s project treat it correctly — name it in §6.5)

**Intent**: Assert at three phone widths that no fixture page gives the document
horizontal scroll, and that no fixture block overflows its own container.

**Contract**: Widths `[320, 360, 390]`, `deviceScaleFactor: 1`. Resolve the
stylesheet by **glob** over `dist/client/_astro/Layout.*.css` — the filename is
content-hashed and changes on every CSS edit; a literal would rot within one
commit. Fail loudly and legibly if the glob matches zero or more than one file
(that means `npm run build` was not run, or was run twice into a dirty `dist`).

Two assertion modes:

- **Document-level**: `document.documentElement.scrollWidth > clientWidth`. This
  is the S-11 measurement reproduced — `roadmap.md:233` records the original as
  `422/360 → 360/360`, and the failure output should be in that same
  `actual/expected` shape so a reader recognises it.
- **Per-block containment**: for each fixture block, `el.scrollWidth <= el.clientWidth`
  against a container sized like the block's real parent. This is what makes
  `position: fixed` **not matter**: `CategoriesManager.tsx:470-483`'s unfixed
  mechanism-A instance is measured inside a container carrying the dialog's real
  `max-w-[calc(100%-2rem)]`, rather than depending on an unverified answer about
  whether fixed boxes contribute to document scroll.

Failure output must name the fixture block, the width, both numbers, and the
source `file:line` the block reproduces. An overflow reported as "page is 422px
at 360px" with no element is exactly the report `lessons.md`'s third entry says
sends people to the wrong component.

Header comment must state what the check **cannot** claim, following §6.4's
precedent: it tests transcribed markup, not the live page; it does not exercise
the real components; it cannot see anything that only appears on hover (recharts
tooltips) or after interaction; and a green run is not evidence any real route
renders correctly.

#### 3. The fixtures

**File**: `tests/viewport/fixtures/*.html`

**Intent**: Reproduce the markup that mixes user strings with controls, at
worst-case content, with no auth and no database.

**Contract**: Static HTML pages linking the resolved stylesheet, each block
carrying a comment naming the source `file:line` and the class list it copies.
Blocks required, from research §2.6's inventory:

- **The two shells** — `bg-cosmic flex min-h-screen … p-4` with `max-w-sm`
  (auth), `max-w-2xl` (dashboard), `max-w-4xl` (reports).
- **Topbar** (`Topbar.astro:35,69`) with a long email — the S-11 regression
  guard. `roadmap.md:233`'s 422px measurement is the oracle.
- **Receipt review** (`ReceiptReview.tsx:192`, `:376`, `:400`) — the S-12
  regression guard, plus the two longest hardcoded labels in the repo.
- **Category chip** (`CategoryPicker.tsx:95-104`) with a long category name —
  rendered in three places, research's highest-risk mechanism-A surface.
- **Day entry row** (`DayEntriesList.tsx:331-396`) with a long category name, a
  long description, and `−99 999 999,99 zł` (the `numeric(10,2)` maximum, with
  literal U+2212 and U+00A0) beside two `size-11` buttons in a `shrink-0` block.
- **`CategoriesManager` row** (`:470-483`) inside a dialog-sized container.
- **`ServerError`** (`ServerError.tsx:11-13`) with a long `?error=` string — the
  only mechanism-A surface reachable anonymously in the real app.
- **`MonthCalendar` grid** (`:125`) — pins the `max-w-full` arithmetic
  (7 × 44px + 6 × 4px = 332px against ~240px at 320px).
- **The pre-settle chart box** — a 320px-wide container inside the `max-w-4xl`
  wrapper, reproducing `ui/chart.tsx:10`'s `INITIAL_DIMENSION` before
  `ResizeObserver` fires. Reciprocal comments in both files.

Worst-case strings are a shared, commented constant set: a long email, a long
category name, a 200-code-point description (the client cap at
`EntryForm.tsx:279`), and the `numeric(10,2)` maximum amount.

#### 4. Conformance fixes

**Files**: `src/components/ui/button.tsx`, `src/components/entries/CategoryPicker.tsx`,
`src/components/entries/DayEntriesList.tsx`, `src/components/receipts/ReceiptReview.tsx`,
and any other surface the check reports

**Intent**: Bring the failing surfaces into conformance with the rule
`roadmap.md:245` already states, so the gate can be required. Each is a bound
added, never a layout, colour or label changed.

**Contract**: Mechanism B — add `max-w-full` to `buttonVariants`' base
(`button.tsx:8`), which is where lesson 4's recipe actually lives; and to
`CategoryPicker.tsx:120`, the one remaining unpaired `self-start` in the repo.
Mechanism A — `min-w-0` plus a break rule on each failing user-string surface,
copying the shape `Topbar.astro:35` (`min-w-0 break-all`) and
`DayEntriesList.tsx:71` (`break-words`) already use.

**Fix only what the check reports red.** The AT-RISK inventory is research's
prediction, not a verdict — record which predictions held and which did not, and
carry that into §6.6. `ReceiptReview.tsx:192` and `MonthCalendar.tsx:125` already
carry the bound and must stay green throughout; if either goes red, the fixture
is wrong, not the component.

`button.tsx` is in `src/components/ui/`, which §7 excludes from testing as
vendored generated code. Adding `max-w-full` makes it **hand-modified**, which
§7's own bullet says triggers re-evaluation — record that in the §7 note in
Phase 4.

#### 5. Protect the global rule

**File**: `src/layouts/Layout.astro`

**Intent**: Stop a future tidy-up from silently disabling the whole check.

**Contract**: A comment on the `html,body{margin:0;width:100%;height:100%}` rule
(`:50-55`) stating that `width:100%` deliberately does not clip, that changing it
to `max-width:100vw` + `overflow-x:hidden` would make every page _look_ fixed
while disabling the overflow gate entirely, and naming the check file.

### Success Criteria:

#### Automated Verification:

- `npm run build && npm run test:viewport` exits 0 — every fixture page clean at 320, 360 and 390
- `npm run lint && npm run typecheck` pass after the conformance fixes
- `npm run test` still passes — the component suites must not be disturbed by the class changes
- The check fails loudly with a legible message when `dist/` is absent

#### Manual Verification:

- The check has been **seen red**: reverting `Topbar.astro:35`'s `min-w-0 break-all` reproduces the S-11 failure at 360px in the ~422/360 shape `roadmap.md:233` records, and reverting `ReceiptReview.tsx:192`'s `max-w-full` reproduces S-12
- Every conformance fix was made because the check reported it, not because research predicted it — and the divergences between prediction and verdict are written down
- The `position: fixed` question was actually tested in chromium and the answer recorded, even though the per-block assertion makes it non-blocking
- `npm run build` on a clean tree emits exactly one `Layout.*.css`, and the glob resolves it
- The app has been looked at on a real narrow viewport after the `button.tsx` change — a bound added to every button in the app deserves one human glance

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Gates, CI, and rollout close-out

### Overview

Wire the viewport check into CI, flip §5's two gates, write §6.5, and close the
rollout with the corrections research produced.

### Changes Required:

#### 1. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Make the overflow check a merge gate on pull requests.

**Contract**: In the `ci` job only, **after** the existing `npm run build` step:
`npx playwright install --with-deps chromium`, then `npm run test:viewport`.
`ci` has no trigger guard, so this runs on pushes and PRs with no trigger change
— which is what satisfies §5's "CI on PR" row.

Do not touch `db-test` or `deploy`. Add a comment stating why the step sits after
`build` (it needs the emitted stylesheet) and why the browser install is a
separate step (so `npm ci` stays the same size in the other two jobs).

Follow `db-test`'s precedent for opaque failures: an `if: failure()` step
surfacing the check's diagnostic output, because a headless-browser failure has
the same illegibility class that motivated the `docker logs` dump at `:66-67`.

#### 2. Cookbook §6.5

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` with the canonical answer to "how do I add a
component test or a viewport check in this project?" — this is what `/10x-tdd`
reads.

**Contract**: Rewrite §6.5 in the shape §6.1–§6.4 established. It must carry:
location and naming (`<Component>.test.tsx`, co-located; the viewport check's
path); the `// @vitest-environment jsdom` docblock convention and **why** it is
per-file rather than config-level; the widened glob and the fact that a
`.test.tsx` under the old glob was collected **silently not at all**; the
restated `resolve.dedupe` and its drift risk against `astro.config.mjs`; the
ESLint override and which rules it disables; reference tests
(`DayEntriesList.test.tsx` for the simple island shape, `DayView.test.tsx` for
the mocked-child + deferred-fetch + fake-clock shape); the jsdom
`window.confirm` / `window.alert` stubbing requirement; the Unicode trap list
(U+2212, U+00A0, U+2026, `aria-label` overriding visible text); the run commands;
the same oracle and teeth rules §6.1–§6.4 all carry; and — most importantly —
**the limit**: no Tailwind plugin runs under Vitest, so a rendered island has no
computed styles and a component test can say nothing about layout or overflow.

For the viewport half: the glob-resolved content-hashed stylesheet, the two
assertion modes and why the per-block one exists, the fixture-drift comment
convention, and the limit that it tests transcribed markup rather than the live
page.

#### 3. §6.6 Phase 5 notes

**File**: `context/foundation/test-plan.md`

**Intent**: Record what the phase actually taught, per §6.6's convention.

**Contract**: At minimum — that risk #5's statement named the wrong mechanism
(everything is server-echo; the live failures are subtractive, not duplicating);
that `loadedDateRef` corrects research §1.6 and changes which gap is reachable
how; the two characterised defects and where they are; which of research's
AT-RISK predictions held; the answer to the `position: fixed` question; whether
`resolve.dedupe` proved load-bearing or precautionary; whether
`@vitejs/plugin-react` was needed; the measured whole-suite runtime before and
after (research open question 8); and that `button.tsx` is now hand-modified,
which §7's `src/components/ui/` bullet says triggers re-evaluation.

#### 4. §3, §4, §5, §7 and §8 updates

**File**: `context/foundation/test-plan.md`

**Intent**: Close the rollout honestly.

**Contract**:

- §3 — Phase 5 Status → `complete`, change folder → the archived path.
- §4 — `component (React islands)` and `narrow-viewport overflow` rows get real
  tool names, resolved versions and `checked: <date>`, replacing "none yet — see
  §3 Phase 5".
- §5 — `component tests` and `narrow-viewport overflow check` → `required — wired`.
  `post-edit hook` stays **recommended** and unconfigured, with a note that the
  `npm run` scripts it would call now exist.
- §7 — add a note under the `src/components/ui/` bullet that `button.tsx` has
  been hand-modified. Add the two characterised defects as visible accepted risk
  with their re-evaluation trigger. Note that research open questions 3, 4 and 5
  (recharts, radix, `ReceiptCapture` under a DOM shim) remain **open** — the
  report islands have no component cover and this phase did not give them any.
- §8 — Freshness Ledger entry for Phase 5, and the four §2 corrections research
  produced: the "optimistic update" challenge has no subject; the live gaps are
  subtractive; `lessons.md:33`'s "no sign-in needed" is strategy-specific; and
  the churn claim overstates ("`entries/` holds the single most-churned file and
  3 of the top 5" is the defensible restatement).

#### 5. Change close-out

**File**: `context/changes/testing-client-state-viewport/change.md`

**Contract**: `status: complete`, `updated: <date>`.

### Success Criteria:

#### Automated Verification:

- Full local gate passes from a clean install: `npm ci && npx astro sync && npm run lint && npm run typecheck && npm run test && npm run build && npm run test:viewport`
- The `ci` job passes on a pull request, including the new viewport step
- Prettier is clean on the edited markdown: `npm run format`

#### Manual Verification:

- §6.5 has been read by someone who did not write it, and answers "how do I add a component test here?" without them opening another file
- §5's two gate rows and §3's Phase 5 row are consistent with what CI actually runs — no row claims a gate that is not wired
- The §7 additions state the open questions as open, rather than implying this phase closed them
- CI wall-clock before and after the new step is recorded, since it now sits on the merge path for every PR

---

## Testing Strategy

This phase _is_ tests, so the strategy section is about what proves the tests
themselves.

### Unit tests

`date-utils.test.ts` — leap years, month lengths, Monday-first weekday index,
year boundaries in `addMonths`, and a DST-transition month. Oracles are the
Gregorian calendar and ISO-8601, never another function in the module. `TZ`
pinned in-file.

### Component tests

`DayEntriesList.test.tsx` (six cases, incident (c)) and `DayView.test.tsx`
(seven cases across incidents (a), (b), (c), plus rapid navigation and failure
paths, plus two characterisation cases). All assertions are on **rendered
output** — row text, totals, the three non-row states — never on hook values.

### Viewport check

Nine-plus fixture blocks × three widths × two assertion modes, against built
CSS. Regression guards for both shipped fixes (S-11, S-12) are mandatory: they
are what prove the check would have caught the bugs it exists for.

### The teeth rule (§6.1, non-negotiable)

**A test is not done until it has been seen red.** Concretely, this phase's
teeth checks are:

| Break this                                   | Expected to turn red              |
| -------------------------------------------- | --------------------------------- |
| `DayEntriesList.tsx:372` `disabled={saving}` | Phase 1 case 2 only               |
| `DayView.tsx:122` day guard                  | Phase 2 case 1 only               |
| `DayView.tsx:133` id dedupe                  | Phase 2 case 2 only               |
| `DayView.tsx:262` `key={selectedDate}`       | Phase 2 case 4 only               |
| `Topbar.astro:35` `min-w-0 break-all`        | Topbar fixture at 360px, ~422/360 |
| `ReceiptReview.tsx:192` `max-w-full`         | Receipt-review fixture            |

Each is reverted after. A break that turns _more_ than the named case red means
the tests are coupled and want splitting.

### Manual testing steps

1. `npm ci && npx astro sync` from clean, then the full gate chain.
2. Delete each guard in the table above in turn; confirm exactly the named case
   goes red; revert.
3. Load `/dashboard` at 320px in a real browser after the `button.tsx` change —
   one human glance at a bound added to every button in the app.
4. Confirm the two characterisation tests read as defect records, not as
   endorsements, to a reader who has not read this plan.

## Performance Considerations

The whole suite was ~460 ms at Phase 2 (`test-plan.md:316`) and that figure is
**stale** — there are now 15 files and 223 `it(` calls. jsdom boots slower than
the `node` environment, which is precisely why the environment is opted into
per-file rather than set globally: the 15 existing suites pay nothing.

Measure and record the before/after runtime in §6.6. It matters beyond curiosity:
§5's post-edit-hook recommendation rests on the suite being fast enough to run at
edit time, and that recommendation currently rests on an unmeasured number.

The CI cost is a browser install on the merge path for every push and PR.
Playwright's separate-install shape keeps `npm ci` unchanged on all three jobs;
the install step's wall-clock is the real cost and should be recorded in Phase 4.
If it proves large, caching the browser binary is the follow-up — not moving the
gate off PRs, which would forfeit what §5 asks for.

## References

- Research: `context/changes/testing-client-state-viewport/research.md`
- Change brief: `context/changes/testing-client-state-viewport/change.md`
- Quality contract: `context/foundation/test-plan.md` §2 (risks #5, #6), §3
  (Phase 5), §4, §5, §6.1–§6.4 (the cookbook shape §6.5 must copy), §7
- `context/foundation/lessons.md` — entries 3 and 4 (the two overflow
  mechanisms), entry 1 (which layer can claim what)
- `context/archive/2026-08-15-daily-expense-entry/reviews/impl-review.md:31-39` —
  incident (a)
- `context/archive/2026-08-15-income-and-entry-management/reviews/impl-review.md:37-45`,
  `:47-64` — incidents (b) and (c); `:56`, `:58` record (c)'s unresolved tradeoff
- `context/archive/2026-08-21-testing-receipt-confirm-integrity/research.md:582-585` —
  the Gap 2 handoff
- `context/archive/2026-08-21-testing-runner-bootstrap/research.md:578-587` — the
  `resolve.dedupe` handoff; `:289-292` predicts the ESLint override
- `context/foundation/roadmap.md:233` — the S-11 measurement this check
  reproduces; `:245` — the `max-w-full` binding rule
- Reference tests to copy in shape: `src/pages/api/entries/[id].test.ts` (header
  comment naming oracles and limits), `src/components/reports/range.test.ts`
  (pure-module unit shape)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner extension + first island suite

#### Automated

- [ ] 1.1 `npm run test` collects the two new files and the existing 15 suites all pass
- [ ] 1.2 Lint passes on the new `.tsx` test file
- [ ] 1.3 Typecheck passes (`npx astro sync && npm run typecheck`)
- [ ] 1.4 The existing 15 suites still run on the `node` environment

#### Manual

- [ ] 1.5 Each of the six `DayEntriesList` cases seen red by breaking its guard
- [ ] 1.6 `resolve.dedupe` removal tested; load-bearing vs precautionary recorded
- [ ] 1.7 Whole-suite wall-clock recorded before and after

### Phase 2: `DayView` state truth

#### Automated

- [ ] 2.1 `npm run test` passes with the new suite
- [ ] 2.2 Lint and typecheck pass
- [ ] 2.3 No test depends on real timers or wall-clock date

#### Manual

- [ ] 2.4 Guards at `:122`, `:133`, `:262` each individually deleted and confirmed to turn exactly the expected case red
- [ ] 2.5 The two characterisation tests read unambiguously as defect records
- [ ] 2.6 Unmocked `ReceiptCapture` render attempted once and its failure mode recorded

### Phase 3: Narrow-viewport overflow check and conformance

#### Automated

- [ ] 3.1 `npm run build && npm run test:viewport` exits 0 at 320, 360 and 390
- [ ] 3.2 Lint and typecheck pass after the conformance fixes
- [ ] 3.3 `npm run test` still passes after the class changes
- [ ] 3.4 The check fails loudly and legibly when `dist/` is absent

#### Manual

- [ ] 3.5 Check seen red: reverting `Topbar.astro:35` reproduces S-11 in the ~422/360 shape; reverting `ReceiptReview.tsx:192` reproduces S-12
- [ ] 3.6 Divergences between research's AT-RISK prediction and the check's verdict written down
- [ ] 3.7 The `position: fixed` question tested in chromium and the answer recorded
- [ ] 3.8 Clean build emits exactly one `Layout.*.css` and the glob resolves it
- [ ] 3.9 Real narrow viewport looked at after the `button.tsx` change

### Phase 4: Gates, CI, and rollout close-out

#### Automated

- [ ] 4.1 Full local gate passes from a clean `npm ci`
- [ ] 4.2 The `ci` job passes on a pull request, including the new viewport step
- [ ] 4.3 Prettier clean on the edited markdown

#### Manual

- [ ] 4.4 §6.5 read by someone who did not write it and answers the question unaided
- [ ] 4.5 §5's gate rows and §3's Phase 5 row consistent with what CI actually runs
- [ ] 4.6 §7 additions state the open questions as open
- [ ] 4.7 CI wall-clock before and after the new step recorded
