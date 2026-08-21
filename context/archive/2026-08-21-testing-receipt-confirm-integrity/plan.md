# Receipt Confirm Integrity — Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md` §3, covering risk #1 —
_confirming a reviewed receipt persists something other than what was on screen:
wrong per-category split, wrong receipt-derived date, wrong amount, or a
duplicate batch on retry_.

The phase makes the confirm path's three boundaries reachable by tests and pins
them: the payload assembly (currently trapped inside a React component), the
batch-write boundary in the service layer, and the route's validation. It ships
one production fix — a shape-valid but impossible printed date currently reaches
Postgres and returns a 500 with a non-JSON body — and one behaviour-preserving
extraction out of the repo's fourth-highest-churn file.

This is a **pinning** phase, not a repair phase. Research established that the
three invariants §2 told it to challenge all already hold. The job is to make
them un-reintroducible in silence.

## Current State Analysis

**The invariants hold, and nothing guards them.** `groups` is derived once
(`ReceiptReview.tsx:157`) and is the single value feeding both the "Zostanie
zapisanych wpisów" preview (`:415-434`) and the POST body (`:212-216`).
`groupByCategory` (`:58-80`) is the only grouping implementation in the repo —
the parser builds a flat item list (`receipts.ts:152-197`) and the server inserts
`input.items` verbatim (`entries.ts:256-267`). The batch write is one statement,
therefore one transaction, keyed on `(user_id, batch_id, batch_seq)`. Every one
of those properties is currently protected by a code comment and nothing else.

**A 201 is not evidence that the submitted rows landed.** `entries.ts:277-297`
discriminates a replay by comparing `insertedRows.length` against
`input.items.length` — a length comparison, not a replay flag. When the counts
differ the response body is _what is stored under that batch id_, not what the
request submitted. This is the finding that inverts the phase's expected shape:
the endpoint answers 201, and 201 means "the batch exists".

**The `astro:*` blocker recorded in §6.1 does not apply to this path.** Two
spikes, written and executed green during research, then deleted:

- `src/lib/services/entries.ts` only ever `import type`s `@/lib/supabase`
  (`entries.ts:2`), erased by `verbatimModuleSyntax`. It imports and runs under
  the current standalone `vitest.config.ts` with no change.
- `src/pages/api/receipts/entries.ts` **is** reachable despite value-importing
  `@/lib/supabase` at `:2`, because `vi.mock("@/lib/supabase", factory)` replaces
  the module before it is ever evaluated, so `astro:env/server` is never
  resolved. All six status branches were asserted directly, in ~400 ms, on the
  default `node` environment — `Request`/`Response` are native in Node 22.

So this phase needs **no `vitest.config.ts` change and no new dependency**, and
§4's "API mocking" row resolves to _none_.

**The payload's most valuable field is the one the user never sees.**
`composeGroupedDescription` (`entry-description.ts:61-96`) is computed only in
the confirm branch and never rendered. It is already pure, exported, and
importable today — its only imports are `@/lib/format` and `@/lib/text`, both
astro-free.

**Everything else lives inside the panel.** Grouping, save-date resolution,
amount evaluation, the confirm gate, row seeding, and the second write path
(`handleConfirmTotal`, `:223-235`) are all component-local and unreachable
without extraction. `src/components/receipts/` carried 14 commits in the 30 days
to 2026-08-21, and `roadmap.md:265-266` records S-12 landing directly on `master`
with no plan or change folder, touching this exact file.

**Five copies of a shape-only date regex.** `/^\d{4}-\d{2}-\d{2}$/` appears in
`services/entries.ts:7` (used twice), `services/receipts.ts:57`,
`services/reports.ts:19`, and `api/entries/index.ts:11`. All five accept
`2026-02-30`.

**The test base is one file.** `src/lib/text.test.ts`, 11 tests, ~290 ms. There
is no shared test helper of any kind, and no ESLint override for test files —
`eslint.config.js:41` applies `strictTypeChecked` to `**/*.{js,jsx,ts,tsx}`
uniformly, so test code is held to the same bar as production code.

## Desired End State

`npm run test` covers the confirm path end to end at three layers, and every
expectation in it was hand-written from an external oracle.

Concretely, after this plan:

- Changing how the panel folds lines into per-category entries, how it resolves
  the save date, or how it turns groups into a POST body turns a test red.
- Changing the row array `createEntriesBatch` hands to PostgREST — the
  `batch_seq` assignment, the `onConflict` options, the hardcoded
  `type: "expense"`, the `occurredOn` shared across every row — turns a test red.
- Replaying a confirm is proven to write nothing the second time and to return
  the stored batch, and the accepted retry-after-edit trade is pinned as a
  characterisation test that names the decision it encodes.
- An impossible printed date (`2026-02-30`) is a 400 with a JSON body, not a 500
  with an Astro error page.
- `test-plan.md` §6.2 tells the next contributor how to write a service
  integration test in this repo, and §6.1's "cannot be unit-tested" limit is
  corrected — `vi.mock` is a third option beside extract and alias-stub.

Verification: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run
build` all green; plus a manual browser pass over both confirm paths after the
Phase 4 extraction.

### Key Discoveries:

- The single-derivation property is explicit and commented at
  `ReceiptReview.tsx:152-156` — "Two reduces would be free to disagree."
- Rounding is applied once, on the sum, via `sumItems` (`:79`, `:150`) — the same
  function behind the panel's `Suma pozycji`. Per-item rounding plus a second
  rounding on the total can drift by a cent.
- `saveDate` is a **lazy initialiser** (`:122-124`), so it runs once per mount,
  i.e. once per parse; `occurredOn` stands in for "today" because the calendar
  cannot select a future day, and `:117-118` explicitly warns against "fixing"
  this into `new Date()`.
- `batchId` is minted once per **parse** (`ReceiptCapture.tsx:182-186`) and
  survives both a failed confirm and any amount of row editing. The idempotency
  window is exactly one parse.
- `z.iso.date()` in the installed zod `4.4.3` performs full calendar validation —
  verified this session: rejects `2026-02-30`, `2026-04-31`, `2026-02-29`;
  accepts `2024-02-29`, `2026-08-21`.
- `formatAmountPlain` emits U+00A0 as a thousands separator, and **only above 4
  digits**: `1234.5 → "1234,50"` (no separator), `1234567.89 → "1 234 567,89"`.
- pgTAP already proves the constraint itself (`entries_batch_key_test.sql`,
  `plan(10)`) — column shape, `col_is_unique` over the exact three columns, a
  plain replay raising `23505`, and a `do nothing` replay leaving the count
  unchanged. Do not duplicate any of it.

## What We're NOT Doing

- **Rendering assertions of any kind.** No React Testing Library, no component
  tests. That is §3 Phase 5. This phase asserts the model behind the preview, not
  the preview.
- **Reopening the retry-after-edit behaviour.** A replay whose item list was
  edited in between returns and reports the previously-stored rows and discards
  the corrections. Recorded and accepted at
  `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135`;
  the reasoning (re-minting the key on edit reopens the double-write that F4
  existed to close) still holds. Changing it is a product change, not a test.
- **F2 — code points vs UTF-16 code units at the description bound.**
  `entry-description.ts:23`/`:82` and the migration's `check` both count code
  points; `entries.ts:13`/`:53`'s zod `.max()` counts UTF-16 code units, verified
  against zod 4.4.3. This makes the S-10 invariant recorded at
  `context/archive/2026-08-18-entry-descriptions-and-receipt-grouping/plan.md:386-392`
  false for non-BMP input. Reachability is low (needs astral characters in
  receipt line names) and the failure is a fail-loud 400, not a silent bad write.
  Carried into `lessons.md` in Phase 5 as a class, not fixed here.
- **F3 — English zod messages in a Polish UI.** `entries.ts:38` forwards
  `issue.message` unmodified, so a missing `batchId` renders
  `"Invalid input: expected string, received undefined"` to the user
  (`ReceiptReview.tsx:453`). Same class: `"Unauthorized"` (`:25`) and
  `"Supabase is not configured"` (`:18`). Copy, not correctness. Recorded here
  only.
- **The other four copies of the shape-only date regex** —
  `services/receipts.ts:57` (parse-side, and its module is not unit-testable as
  it stands), `services/reports.ts:19` and `:22-23` (risk #2, §3 Phase 3's
  territory), `api/entries/index.ts:11` (a GET query-param guard, no write).
  Only `services/entries.ts` is fixed.
- **Extracting `sanitise` from `services/receipts.ts`.** Research bounded it
  (~135 of 296 lines are pure), but it is parse-side; it touches risk #1 only
  through F1's date regex, which is being fixed at the zod bound instead.
- **`DayView.tsx:143-156`'s `prev === null` drop** — whether a confirm resolving
  while the day's GET is in flight can lose a batch from the visible list. Client
  state, §3 Phase 5 / risk #5. Surfaced during research; recorded so it is not
  lost.
- **Any pgTAP work.** The constraint layer is already covered; the app-layer
  invariants this phase pins are precisely the ones pgTAP structurally cannot
  reach (`lessons.md`, first entry).
- **Widening the `db-test` CI trigger to pull requests.** Unrelated cost
  decision, carried in §5.

## Implementation Approach

Four test-bearing phases ordered by production risk, ascending, then a
documentation phase.

Phases 1–2 add tests only — no production file changes at all. Phase 3 makes a
one-line schema change behind a route test written first. Phase 4 performs the
single refactor, with its tests landing in the same commit and a manual browser
pass gating the close. Phase 5 writes down what the phase learned, which is what
makes §6.2 real rather than aspirational.

The ordering means the fake, the `vi.mock` shape, and the oracle discipline are
all established and green before the one commit that touches a hot-spot
component.

## Critical Implementation Details

**ESLint applies `strictTypeChecked` to test files too.** `eslint.config.js:41`
matches `**/*.{js,jsx,ts,tsx}` with no test override, and Phase 1 of the runner
bootstrap deliberately added none. Consequences the spikes hit on first run:
`@typescript-eslint/consistent-type-definitions` rejects `type X = { ... }` in
favour of `interface`, and the `no-unsafe-*` family bites any fake that leans on
`any`. Type the fake's canned responses as `{ data: unknown; error: unknown }`
and let the service's own `as unknown as EntryRow[]` casts do the narrowing — no
`any` anywhere. Bridge the fake to the service's `SupabaseClient` parameter with
a single `as unknown as` at the call site, which the rule family permits.

**`vi.mock` factories are hoisted above the imports.** The factory body must not
close over a binding evaluated later. The working shape from spike 2 is a
module-scope mutable holder, plus `const { POST } = await import("./entries")`
_after_ it, so the factory runs at import time rather than at hoist time.

**A shared helper must not match `src/**/*.test.ts`.** That is
`vitest.config.ts`'s only discovery glob; a helper named `*.test.ts` would be
collected as a suite and fail with "no test found". `__fixtures__/` also keeps it
out of the co-location convention §6.1 defines for real suites.

**The moved comments are load-bearing, not decoration.** `ReceiptReview.tsx`
carries explicit warnings at `:75-78` (single rounding), `:114-121` (why
`occurredOn` stands in for today; do not "fix" it into `new Date()`),
`:104-106` (seed with `toFixed(2)`, never `formatCurrency`) and `:52-57`
(first-appearance order; skip unstorable rows). Each documents a decision that
was reversed at review cost. They move with the code they explain.

## Phase 1: Pure Payload Units

### Overview

Cover the two already-importable pieces of the payload with hand-written
oracles. No production file is touched. This phase delivers the phase's
highest-value single target — the payload field the user never sees — at zero
risk, and establishes the oracle discipline the later phases copy.

### Changes Required:

#### 1. The unrendered payload field

**File**: `src/lib/entry-description.test.ts` (new)

**Intent**: Pin `composeGroupedDescription` — the only part of the confirm
payload never shown to the user before it is written — and `splitDescriptionItems`,
which reads it back apart in the day list.

**Contract**: Suites for both exports. A header comment names the oracles in the
shape `text.test.ts` established: the migration's
`check (char_length(description) <= 200)`
(`20260816140000_add_entry_description.sql:28`), Postgres' code-point
`char_length()` semantics, and `Intl.NumberFormat("pl-PL")`'s verified output.
Cases: empty items → `null`; every name blank → `null`; one named item;
several joined by `DESCRIPTION_ITEM_SEPARATOR`; a `·` inside a product name
collapsed to a space rather than faking a boundary; an over-long group dropping
**whole** items from the tail and recording `+N`; a single item too long on its
own, where only the name is truncated by code point and the amount stays whole;
round-trip through `splitDescriptionItems`. Every expected string is written out
literally, never built by calling the composer.

**Trap**: `formatAmountPlain` uses U+00A0, and only above 4 digits — `12.5 →
"12,50"`, `1234.5 → "1234,50"`, `1234567.89 → "1 234 567,89"`. Assertions must
use the right character and must not assume a separator appears at four digits.
Write the U+00A0 as ` ` in the expectation so it is visible in the diff.

#### 2. The receipt's arithmetic

**File**: `src/components/receipts/receipt-total.test.ts` (new)

**Intent**: Pin the single-rounding property and the "no printed total means no
delta" rule, both of which decide whether the panel accuses the user of a
mismatch.

**Contract**: `sumItems` — empty list is `0`; a non-finite amount contributes
zero rather than poisoning the sum with `NaN`; rounding is applied once to the
sum, so `0.1 + 0.2` is `0.3` exactly. `totalDelta` — `null` printed total → `null`;
non-finite printed total → `null`; a genuine match reads exactly `0`, not
`1e-15`; sign convention for over and under. Oracles: `check (amount > 0)` and
`numeric(10, 2)` from `20260815164539_create_entries_table.sql:12`, plus the
IEEE-754 fact that `0.1 + 0.2 === 0.30000000000000004` — asserted directly in the
test so the reader sees why the rounding matters.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Typecheck passes: `npm run typecheck`
- Lint passes on both new files: `npm run lint`
- No production file appears in `git diff --name-only`

#### Manual Verification:

- Teeth check: change `composeGroupedDescription`'s tail-drop to cut mid-item
  (`candidate.slice(0, 200)`), confirm the over-long-group case fails legibly,
  revert
- Teeth check: remove the `roundToCents` wrapper in `sumItems`, confirm the
  `0.1 + 0.2` case fails, revert
- No expectation in either file was produced by calling the function under test

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: Service Integration and the Shared Fake

### Overview

Build the repo's first shared test helper and use it to assert the exact row
array `createEntriesBatch` hands to PostgREST. Still no production file change.
This is the phase §6.2 will be written from.

### Changes Required:

#### 1. The recording PostgREST fake

**File**: `src/lib/services/__fixtures__/supabase-fake.ts` (new)

**Intent**: Give tests a Supabase client stand-in that records every builder call
in order and resolves to canned results, so a test can assert _the exact payload
handed to PostgREST_ rather than only the value the service returns.

**Contract**: A factory returning `{ client, calls }`. Every builder method
(`from`, `select`, `in`, `is`, `eq`, `order`, `upsert`, `insert`, `update`,
`delete`, `maybeSingle`, `single`) returns the same chainable object and appends
`{ method, args }` to `calls`. The object exposes `then`, making it awaitable,
which resolves the next queued response. Responses are queued in call order as
`{ data: unknown; error: unknown }` — deliberately `unknown`, so the service's own
casts do the narrowing and no `any` enters the file. The file must **not** be
named `*.test.ts`.

Because `createEntriesBatch` makes two or three round trips per call, the queue
is ordered rather than keyed by table: category check first, then the upsert,
then the re-select when the length comparison triggers it. State that ordering in
a header comment — it is the one thing a reader will get wrong.

The three chains this must cover, from research:

```
from(t).select(cols).in(col, ids).is(col, null)        → awaited
from(t).upsert(rows, opts).select(cols)                → awaited
from(t).select(cols).eq(col, v).order(col, {ascending}) → awaited
```

#### 2. The batch-write boundary

**File**: `src/lib/services/entries.test.ts` (new)

**Intent**: Pin what `createEntriesBatch` writes, what it guards, and what it
returns on a replay. Scoped to that one export — the other functions in the
module belong to other risks.

**Contract**: Bridge the fake to the service's `SupabaseClient` parameter with a
single `as unknown as` at the call site. Cases:

- **The exact row array.** A two-group input produces rows carrying `amount`,
  `category_id`, the _same_ `occurred_on` on every row, `type: "expense"`,
  `description` (`?? null`), `batch_id`, and `batch_seq` assigned `0` and `1`
  from the array index. Asserted against the recorded `upsert` argument, written
  out as a literal.
- **The conflict options.** `{ onConflict: "user_id,batch_id,batch_seq",
  ignoreDuplicates: true }`, asserted exactly. The column list is the oracle from
  `20260817190000_add_entry_batch_key.sql:62-64`; a change to either half
  silently breaks idempotency.
- **`batch_seq` is never accepted from the client.** A caller-supplied
  `batch_seq` on an item does not reach the row.
- **The category guard.** Distinct ids are deduped before the `in()` (two items
  in one category ask for one id); fewer rows back than ids asked for →
  `CategoryNotFoundError`; a `kind: "income"` row → `CategoryKindMismatchError`;
  the query carries `.is("deleted_at", null)`, which is this path's third
  invariant and the one that differs from `assertCategoryUsable`.
- **The clean replay.** An upsert returning `[]` against a two-item submit takes
  the re-select branch: `.eq("batch_id", input.batchId)` and
  `.order("batch_seq", { ascending: true })`, returning the stored rows as DTOs.
  This is the branch pgTAP structurally cannot reach — `entries_batch_key_test.sql`
  asserts the resulting row count, never what the statement _returned_.
- **The retry-after-edit characterisation.** A three-item replay against a batch
  already holding five rows returns **five**. The test comment must name
  `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135`
  and say plainly that this pins an accepted trade, not an endorsement — a reader
  who mistakes it for the latter is the failure mode this test creates.
- **Errors from either round trip are rethrown**, not swallowed.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Typecheck passes: `npm run typecheck`
- Lint passes with no `any` and no rule disabled in either new file: `npm run lint`
- `src/lib/services/__fixtures__/supabase-fake.ts` is not collected as a suite —
  the run reports 4 files, not 5
- No production file appears in `git diff --name-only`

#### Manual Verification:

- Teeth check: change `batch_seq: index` to `batch_seq: index + 1`, confirm the
  exact-row-array case fails and names the offending field, revert
- Teeth check: flip `ignoreDuplicates` to `false`, confirm the conflict-options
  case fails, revert
- The characterisation test's comment is unambiguous that the behaviour is
  accepted, not endorsed

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: Route Boundary and the F1 Fix

### Overview

Prove the route's six status branches, then fix the impossible-date defect at the
zod bound — test first, seen red, then green.

### Changes Required:

#### 1. The route's status contract

**File**: `src/pages/api/receipts/entries.test.ts` (new)

**Intent**: Pin the six responses the route can produce, including the two error
mappings that encode a deliberate security distinction.

**Contract**: `vi.mock("@/lib/supabase", factory)` with a module-scope mutable
holder, then `const { POST } = await import("./entries")`. Native `Request` /
`Response` on the default `node` environment; no jsdom. Cases: `500` when
`createClient` returns `null`; `401` when `getUser()` has no user; `201` on the
happy path with the service's rows as the body; `404` `"Nie znaleziono
kategorii"` for `CategoryNotFoundError`; `400` `"Kategoria nie pasuje do typu
wpisu"` for `CategoryKindMismatchError`; `400` for a zod failure carrying
`field`. The 404's Polish text is asserted verbatim, and a comment records _why_
it is deliberately not "not yours" (`entries.ts:47-48` — confirming another
user's category id exists is itself a cross-user leak).

The `500` and `401` branches are scaffold rather than risk #1, and §7 excludes
auth _mechanics_ from testing. They are in scope here because this asserts what
auth **gates**, and because the null-client branch is the optional-by-design trap
`CLAUDE.md` flags three times.

#### 2. Calendar-valid dates at the zod bound

**File**: `src/lib/services/entries.ts`

**Intent**: Stop a shape-valid but impossible printed date (`2026-02-30`)
reaching Postgres, where `occurred_on date not null` rejects it and the resulting
error — neither `CategoryNotFoundError` nor `CategoryKindMismatchError` — is
rethrown at `entries.ts:59` into an Astro error page: a 500 with a non-JSON body
that `parseErrorBody` degrades to the generic "Coś poszło nie tak".

**Contract**: Replace `z.string().regex(DATE_PATTERN)` with `z.iso.date()` in
both `createEntrySchema.occurredOn` (`:18`) and
`createEntriesBatchSchema.occurredOn` (`:42`), and delete the now-unused
`DATE_PATTERN` constant (`:7`). Verified this session against the installed zod
`4.4.3`: `z.iso.date()` rejects `2026-02-30`, `2026-04-31` and `2026-02-29`,
accepts `2024-02-29` and `2026-08-21` — full calendar validation including leap
years, so it accepts exactly the previous set minus the dates Postgres would have
rejected anyway. Strictly narrowing; no client can currently produce an accepted
value it now refuses.

Both schemas change together because leaving two copies of the same defect one
line apart in one file is the drift shape `lessons.md` names. A comment records
that four further copies of the shape-only regex remain (`services/receipts.ts:57`,
`services/reports.ts:19`, `api/entries/index.ts:11`) and why they are out of
scope.

#### 3. The defect's own test

**File**: `src/lib/services/entries.test.ts` (extend), `src/pages/api/receipts/entries.test.ts` (extend)

**Intent**: Prove the fix at both levels — the schema directly, and the route
that turns a schema failure into a 400.

**Contract**: Schema-level cases asserting `createEntriesBatchSchema` rejects
`2026-02-30`, `2026-13-45`, `2026-04-31`, and accepts `2024-02-29` and a normal
date, with the calendar itself as the oracle. A route-level case asserting an
impossible `occurredOn` yields `400`, not a thrown error. One matching case for
`createEntrySchema`, marked as the consistency half.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- `grep -rn "DATE_PATTERN" src/lib/services/entries.ts` returns nothing

#### Manual Verification:

- Teeth check: revert `z.iso.date()` to the old regex, confirm the F1 cases go
  red at both levels, restore
- The six status branches were each observed failing at least once during
  authoring (wrong status asserted first), not only passing
- A manual confirm through the browser still saves normally — the schema change
  is on the live write path

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 4: Panel Model Extraction

### Overview

The one refactor. Move all seven pure pieces out of `ReceiptReview.tsx` into a
sibling module, rewire the panel, and land the tests in the same commit — the
tests are the regression guard the moment the code moves, because no component
test layer exists until §3 Phase 5.

### Changes Required:

#### 1. The extracted model

**File**: `src/components/receipts/review-model.ts` (new)

**Intent**: Make the payload assembly reachable without a DOM. Precedent and
placement follow `receipt-total.ts`, extracted from this same panel for this same
reason (`receipt-total.ts:1-11`).

**Contract**: Seven pure exports plus the types they need — `ReviewRow`,
`CategoryGroup`, `EvaluatedRow`, and `ConfirmItem`:

- `seedReviewRows(items: ParsedReceiptItem[]): ReviewRow[]` — from `:100-110`.
  `key` is the parse index, assigned once and never reused; `amountText` is
  `item.amount.toFixed(2)`, deliberately not `formatCurrency`.
- `evaluateRows(rows: ReviewRow[]): EvaluatedRow[]` — from `:141-148`. Comma
  decimal parse, and the non-blank / finite / `> 0` validity rule that stands in
  front of `check (amount > 0)`.
- `groupByCategory(evaluated: EvaluatedRow[]): CategoryGroup[]` — from `:58-80`,
  unchanged, including its `sumItems` finish.
- `resolveSaveDate(receiptDate: string | null, occurredOn: string): string` and
  `isReceiptDateRejected(receiptDate: string | null, occurredOn: string): boolean` —
  from `:122-124` and `:128`. Lexicographic string compare, no `Date` parsing.
- `toConfirmItems(groups: CategoryGroup[]): ConfirmItem[]` — from `:212-216`,
  including the `composeGroupedDescription` call.
- `wholeReceiptItem(total: number, categoryId: number): ConfirmItem[]` — from
  `:226-233`, including `roundToCents` and the literal `"Paragon"`.
- `evaluateConfirmGate(...)` → `{ hardBlocked, deltaMismatch, canConfirmItems }` —
  from `:159-171`.

The functions are moved, not rewritten. Their comments move with them.

#### 2. The panel, rewired

**File**: `src/components/receipts/ReceiptReview.tsx`

**Intent**: Consume the extracted module. Behaviour-preserving; the rendered
output and the posted body must be identical before and after.

**Contract**: The `useState` lazy initialisers call `seedReviewRows`,
`resolveSaveDate`, and `isReceiptDateRejected`; the render body calls
`evaluateRows`, `groupByCategory`, and `evaluateConfirmGate`; the two confirm
handlers call `toConfirmItems` and `wholeReceiptItem`. `groups` stays derived
**once** (`:157`) and stays the single value behind both the preview and the POST
— that property is the phase's subject and must survive the move visibly.

`ConfirmItem` moves to `review-model.ts`; update its one other importer,
`ReceiptCapture.tsx:7`.

#### 3. The model's tests

**File**: `src/components/receipts/review-model.test.ts` (new)

**Intent**: Pin the per-category split, the save date, and both payload shapes —
the three things risk #1 names.

**Contract**: Cases:

- **Grouping.** First-appearance order preserved (a category reappearing later
  folds into its first position, not a new one); rows with `categoryId === null`
  or an invalid amount are skipped rather than grouped; each group's `items`
  carries every folded line; the group amount is a **single** rounding of the
  sum — three lines of `0.1`, `0.2`, `0.3` give `0.6`, not `0.6000000000000001`.
- **Save date, four exhaustive cases.** `receiptDate === null` → the calendar
  day; printed date in the past → adopted; equal → adopted; in the future →
  rejected, and `isReceiptDateRejected` is `true` only in that case.
- **Amount evaluation.** `"12,50"` → `12.5` valid; `"12.50"` → valid; `""` →
  invalid; `"abc"` → invalid; `"0"` → invalid (the `check (amount > 0)` oracle);
  `"-5"` → invalid.
- **`toConfirmItems`.** One item per group, in group order, each amount paired
  with **its own** `categoryId` — the assertion that catches a wrong loop
  variable, which typechecks clean because both are numbers.
- **`wholeReceiptItem`.** Rounds the total to cents, uses the supplied category,
  and sets `description: "Paragon"`.
- **Seeding.** `amountText` is `"12.50"`, never `"12,50 zł"` — the
  `formatCurrency` mistake `:104-106` warns about, which would make every row
  fail the amount parse.
- **The gate.** Empty rows, a missing category, an invalid amount each hard-block;
  a non-zero delta blocks only until acknowledged; `submitting` blocks
  regardless.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Typecheck passes: `npm run typecheck`
- Lint passes, including react-compiler on the rewired panel: `npm run lint`
- Build passes: `npm run build`
- `git diff --stat src/components/receipts/ReceiptReview.tsx` shows a net
  reduction — logic moved out, nothing added

#### Manual Verification:

- Photograph or upload a receipt, review it, and confirm: the preview's entry
  count, per-category split, and amounts are unchanged from before the extraction
- The save date behaves identically — a past printed date is adopted, a future one
  is refused with the amber notice, and the revert button returns to the calendar
  day
- The second write path still works: "Zapisz jako jeden wpis" saves one entry
  described "Paragon" for the printed total
- A confirm with a missing category and one with a mismatched sum still block and
  unblock as before
- Teeth check: swap `group.categoryId` for a neighbouring group's in
  `toConfirmItems`, confirm the pairing case fails, revert

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 5: Cookbook and Plan Sync

### Overview

Write down what the phase established, so the next contributor does not
re-derive it. Documentation only.

### Changes Required:

#### 1. The service integration pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Fill §6.2 from what Phase 2 actually did, correct §6.1's limit now
that `vi.mock` is proven, resolve §4's open row, and append §6.6 notes.

**Contract**: Four edits.

- **§6.2** replaces its `TBD` with: location (co-located `<module>.test.ts`,
  shared helpers under `__fixtures__/` because that name cannot match the
  discovery glob), the fake's shape and its ordered-queue contract, the reference
  test (`src/lib/services/entries.test.ts`), the run command, and the pattern —
  submitted payload in, asserted row array out, including the repeated-confirm
  case.
- **§6.1's "Limit — `astro:*` does not resolve"** gains a correction: a module
  that value-imports an Astro virtual module has a **third** option beside
  extract and alias-stub — `vi.mock` on the importing module, which replaces it
  before evaluation so the virtual module is never resolved. Proven on
  `src/pages/api/receipts/entries.ts`. The list of "cannot be unit-tested"
  modules is amended to say what remains genuinely unreachable and why.
- **§4's "API mocking" row** resolves from `none yet — see §3 Phase 2` to
  `none — hand-rolled fake + vi.mock`, with `checked: <today>` and a note that
  no MSW, no `getViteConfig`, and no alias stub were needed.
- **§6.6** gains a `Phase 2 — Receipt confirm integrity` block: that the
  `astro:*` blocker did not apply to this path and why; that a 201 from the batch
  endpoint is evidence the batch exists, never that the submitted rows are in it;
  that `z.iso.date()` gives calendar validation for free where a shape regex does
  not; and the U+00A0 formatting trap.

§3's status row is deliberately **not** edited here — the `/10x-test-plan`
orchestrator owns that transition and derives it from artifacts on disk.

#### 2. The recurring class behind F2

**File**: `context/foundation/lessons.md`

**Intent**: Capture the class, not the instance, so the next duplicated bound is
caught before it diverges.

**Contract**: One appended entry in the file's existing four-part shape
(Context / Problem / Rule / Applies to). Subject: **two bounds meant to be the
same number, counted in different units.** Context is the description bound —
`entry-description.ts:23` and the migration's `check` count code points,
`entries.ts:13` counts UTF-16 code units, verified against zod 4.4.3 — which
makes the S-10 invariant at
`context/archive/2026-08-18-entry-descriptions-and-receipt-grouping/plan.md:386-392`
false for non-BMP input. The rule: when a limit is deliberately duplicated rather
than imported (here for bundle-size reasons, stated at
`entry-description.ts:17-23`), the comment must record the **unit** as well as
the number, and any test of the composing side must assert against the strictest
copy. Applies to: any bound restated across the client/server/database boundary —
lengths, decimal places, item caps.

#### 3. Change status

**File**: `context/changes/testing-receipt-confirm-integrity/change.md`

**Intent**: Reflect completion.

**Contract**: `status: implemented`, `updated: <today>`.

### Success Criteria:

#### Automated Verification:

- Prettier passes on the edited markdown: `npm run format`
- No `TBD — see §3 Phase 2` string remains in `test-plan.md`
- Full suite still green: `npm run test`

#### Manual Verification:

- §6.2 is specific enough that a contributor could write a service test from it
  without re-reading this plan
- §6.1's corrected limit does not overstate the fix — `services/receipts.ts`,
  `api/receipts/parse.ts` and `receipt-image.ts` remain genuinely unreachable for
  their own reasons
- The `lessons.md` entry names a class, not this one bug

---

## Testing Strategy

### Unit Tests:

- `composeGroupedDescription` — tail-drop with `+N`, single-item name truncation
  by code point, `·` collapsing, `null` for blank groups, the U+00A0 boundary
- `sumItems` / `totalDelta` — single rounding, non-finite tolerance, null
  printed total
- `review-model` — first-appearance grouping order, skip rules, four save-date
  cases, comma-decimal amount evaluation, both payload shapes, the confirm gate
- `createEntriesBatchSchema` / `createEntrySchema` — calendar-valid dates

### Integration Tests:

- `createEntriesBatch` against the recording fake — the exact row array, the
  conflict options, the three category-guard invariants, the clean replay through
  the re-select branch, and the edited-replay characterisation
- `POST /api/receipts/entries` — all six status branches plus the F1 400

### Manual Testing Steps:

1. Parse a real receipt with several lines sharing a category; confirm the
   preview's count and split match what lands in the day list.
2. Confirm once, then retry the same batch (throttle the network and let the
   response drop) — the day list must not double.
3. Use a receipt with a printed date in the past; confirm the entries land on the
   printed date, not the calendar day.
4. Use "Zapisz jako jeden wpis" and confirm a single "Paragon" entry for the
   printed total.
5. Block the confirm (remove a category, then break a sum) and confirm both
   blocks behave as before the extraction.

## Performance Considerations

The suite must stay fast enough to run on every edit. The two spikes measured
387 ms and 401 ms; the current baseline is ~290 ms for 11 tests. The whole phase
should land well under two seconds, on the `node` environment, with no jsdom and
no Docker. If a later phase needs jsdom for React islands, it is scoped there
(§3 Phase 5), not here.

## Migration Notes

No schema change. The `z.iso.date()` swap is strictly narrowing against what
Postgres already enforces, so no data is affected and no backfill is needed. The
extraction is behaviour-preserving by construction.

## References

- Change brief: `context/changes/testing-receipt-confirm-integrity/change.md`
- Research: `context/changes/testing-receipt-confirm-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` §2 risk #1, §3 Phase 2, §6.1, §6.2
- Prior phase: `context/archive/2026-08-21-testing-runner-bootstrap/plan.md`
- Reference test: `src/lib/text.test.ts`
- Extraction precedent: `src/components/receipts/receipt-total.ts:1-11`
- The accepted retry-after-edit trade:
  `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135`
- The idempotency key:
  `supabase/migrations/20260817190000_add_entry_batch_key.sql:51-64`
- What pgTAP already proves: `supabase/tests/entries_batch_key_test.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pure Payload Units

#### Automated

- [x] 1.1 Unit tests pass: `npm run test` — 3739c38
- [x] 1.2 Typecheck passes: `npm run typecheck` — 3739c38
- [x] 1.3 Lint passes on both new files: `npm run lint` — 3739c38
- [x] 1.4 No production file appears in `git diff --name-only` — 3739c38

#### Manual

- [x] 1.5 Teeth check: mid-item cut in `composeGroupedDescription` turns the over-long-group case red, reverted — 3739c38
- [x] 1.6 Teeth check: removing `roundToCents` from `sumItems` turns the `0.1 + 0.2` case red, reverted — 3739c38
- [x] 1.7 No expectation was produced by calling the function under test — 3739c38

### Phase 2: Service Integration and the Shared Fake

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — dc3de97
- [x] 2.2 Typecheck passes: `npm run typecheck` — dc3de97
- [x] 2.3 Lint passes with no `any` and no rule disabled: `npm run lint` — dc3de97
- [x] 2.4 The fake is not collected as a suite — the run reports 4 files, not 5 — dc3de97
- [x] 2.5 No production file appears in `git diff --name-only` — dc3de97

#### Manual

- [x] 2.6 Teeth check: `batch_seq: index + 1` turns the exact-row-array case red, reverted — dc3de97
- [x] 2.7 Teeth check: `ignoreDuplicates: false` turns the conflict-options case red, reverted — dc3de97
- [x] 2.8 The characterisation test's comment is unambiguous that the behaviour is accepted, not endorsed — dc3de97

### Phase 3: Route Boundary and the F1 Fix

#### Automated

- [x] 3.1 Unit tests pass: `npm run test` — b9601fd
- [x] 3.2 Typecheck passes: `npm run typecheck` — b9601fd
- [x] 3.3 Lint passes: `npm run lint` — b9601fd
- [x] 3.4 Build passes: `npm run build` — b9601fd
- [x] 3.5 `grep -rn "DATE_PATTERN" src/lib/services/entries.ts` returns nothing — b9601fd

#### Manual

- [x] 3.6 Teeth check: reverting `z.iso.date()` turns the F1 cases red at both levels, restored — b9601fd
- [x] 3.7 Each of the six status branches was observed failing at least once during authoring — b9601fd
- [x] 3.8 A manual confirm through the browser still saves normally — b9601fd

### Phase 4: Panel Model Extraction

#### Automated

- [x] 4.1 Unit tests pass: `npm run test` — 114113f
- [x] 4.2 Typecheck passes: `npm run typecheck` — 114113f
- [x] 4.3 Lint passes, including react-compiler on the rewired panel: `npm run lint` — 114113f
- [x] 4.4 Build passes: `npm run build` — 114113f
- [x] 4.5 `ReceiptReview.tsx` shows a net line reduction — 114113f

#### Manual

- [x] 4.6 Preview count, per-category split, and amounts unchanged against a real receipt — 114113f
- [x] 4.7 Save-date behaviour identical: past adopted, future refused with the amber notice, revert works — 114113f
- [x] 4.8 "Zapisz jako jeden wpis" still saves one "Paragon" entry for the printed total — 114113f
- [x] 4.9 Hard block and delta acknowledgement behave as before — 114113f
- [x] 4.10 Teeth check: mis-pairing `categoryId` in `toConfirmItems` turns the pairing case red, reverted — 114113f

### Phase 5: Cookbook and Plan Sync

#### Automated

- [x] 5.1 Prettier passes on the edited markdown: `npm run format` — cd5cca1
- [x] 5.2 No `TBD — see §3 Phase 2` string remains in `test-plan.md` — cd5cca1
- [x] 5.3 Full suite still green: `npm run test` — cd5cca1

#### Manual

- [x] 5.4 §6.2 is specific enough to write a service test from without re-reading this plan — cd5cca1
- [x] 5.5 §6.1's corrected limit does not overstate the fix — cd5cca1
- [x] 5.6 The `lessons.md` entry names a class, not this one bug — cd5cca1
