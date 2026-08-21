---
date: 2026-08-21T16:38:03+02:00
researcher: Krzysztof
git_commit: 5e373e5b31f068a576451676d6cf9c6853038ce5
branch: master
repository: paper-trail
topic: "Receipt confirm integrity — grounding risk #1 (confirming persists something other than what was on screen)"
tags: [research, codebase, receipts, idempotency, vitest, batch-key, test-plan-phase-2]
status: complete
last_updated: 2026-08-21
last_updated_by: Krzysztof
---

# Research: Receipt confirm integrity

**Date**: 2026-08-21T16:38:03+02:00
**Researcher**: Krzysztof
**Git Commit**: `5e373e5b31f068a576451676d6cf9c6853038ce5`
**Branch**: `master` — **not pushed** (`master...origin/master [ahead 4]`), so no
GitHub permalinks in this document; all references are local `path:line`.
**Repository**: `paper-trail`

## Research Question

Rollout Phase 2 of `context/foundation/test-plan.md` §3: *"Prove that what the user
confirms is what persists, exactly once."* Risk #1 — confirming a reviewed receipt
persists something other than what was on screen (wrong per-category split, wrong
receipt-derived date, wrong amount, or a duplicate batch on retry).

The plan's §2 Risk Response row names four things research must ground:

1. Where the confirm payload is assembled versus where it is rendered.
2. The batch-write boundary and its idempotency mechanism.
3. What the save date resolves to when the printed date is absent or reverted.
4. Behaviour on partial write.

Scope agreed at the start of this session: service + route + a panel-purity audit
(rendering assertions stay Phase 5's job), and an investigate-and-recommend answer
to the `astro:*` unit-testability blocker recorded in §6.1.

## Summary

**The headline is good news for the plan and it inverts the expected cost.** The
three things §2 told this phase to *challenge* were all already true, and the one
thing §6.1 warned would block it turned out not to block it at all:

| §2 "must challenge" | Verdict |
| --- | --- |
| That the rendered review and the submitted payload are the same object | **Already true, by construction.** `groups` is derived once at `ReceiptReview.tsx:157` and is the single value feeding both the "Zostanie zapisanych wpisów" preview (`:415-434`) and the POST body (`:212-216`). There is no second reduce to drift. |
| That grouping is decided in exactly one place | **Already true.** Exactly one implementation — `groupByCategory`, `ReceiptReview.tsx:58-80`. The parse path does not group (`receipts.ts:152-197` builds a flat item list); the server does not re-group (`entries.ts:256-267` inserts `input.items` verbatim). |
| That a 200 means the right rows landed | **False, and this is the real finding.** The endpoint answers **201**, and on a replay its body is *what is stored under the batch id*, not what this request submitted (`entries.ts:277-297`). A 201 is evidence that the batch exists — never that the submitted rows are the ones in it. |

**The blocker is not a blocker.** §6.1 lists `src/pages/api/receipts/parse.ts` and
friends as unreachable because they value-import `astro:env/server`. Two spikes run
during this session (written, executed green, then deleted — the repo is back at its
11-test baseline) establish that Phase 2 needs **no change to `vitest.config.ts` and
no new dependency**:

- **Spike 1** — `src/lib/services/entries.ts` imports and runs cleanly under the
  current standalone config. It only ever `import type`s `@/lib/supabase`
  (`entries.ts:2`), so nothing astro-shaped is reachable at runtime. A ~50-line
  hand-rolled thenable fake of the PostgREST builder drives `createEntriesBatch`
  end-to-end and lets the test assert *the exact row array handed to PostgREST*.
  4 tests, 387 ms.
- **Spike 2** — `src/pages/api/receipts/entries.ts` **is** reachable, despite
  value-importing `@/lib/supabase` at `:2`. `vi.mock("@/lib/supabase", factory)`
  replaces the module before it is ever evaluated, so `astro:env/server` is never
  resolved. All six status codes the route can produce were asserted directly.
  6 tests, 401 ms.

So the §4 "API mocking" row resolves to **none — hand-rolled fake plus `vi.mock`**.
No MSW, no `getViteConfig`, no alias stub.

**The one behaviour most worth pinning is already accepted by decision, not a bug.**
A retry after a lost response, with the item list *edited in between*, silently
returns and reports the previously-stored rows and discards the corrections. This
was recorded and accepted in the S-06 fix note
(`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135`).
It is currently pinned by nothing. That makes it a **characterisation test**, not a
fix — the point being that a future edit to `createEntriesBatch` cannot change it
silently.

**Three findings are new and unrecorded anywhere.** A shape-valid but impossible
printed date reaching Postgres as a 500; a code-point/code-unit mismatch that makes
a *documented* S-10 invariant false at the zod bound; and English validation text
surfacing in the Polish UI. Details in §Findings F1–F3.

## Detailed Findings

### The confirm path, end to end

```
POST /api/receipts/parse ──► ParsedReceipt {receiptDate, total, items[], droppedItems}
                                    │   (flat: one item per printed line, NOT grouped)
                                    ▼
ReceiptCapture.tsx:185  batchId = crypto.randomUUID()   ← minted once per PARSE
                                    ▼
ReceiptReview.tsx  rows (one per line, editable)
        :141-148   evaluated   = comma-decimal parse + validity
        :150       sum         = sumItems(valid)
        :157       groups      = groupByCategory(evaluated)  ◄── ONE value
                                    ├──► :415-434  the preview the user reads
                                    └──► :212-216  the ConfirmItem[] posted
                                    ▼
ReceiptCapture.tsx:243-257  POST {occurredOn: saveDate, batchId, items}
                                    ▼
src/pages/api/receipts/entries.ts   auth → zod → service → 201 / 400 / 404 / 500
                                    ▼
entries.ts:222-298  createEntriesBatch
        :225-244   RLS-scoped category check (ownership, kind, soft-delete)
        :253-270   ONE upsert, on conflict (user_id,batch_id,batch_seq) do nothing
        :277-297   if returned rows ≠ submitted count → re-select the whole batch
                                    ▼
DayView.tsx:143-156  handleBatchSaved — id-keyed dedupe, filtered to the visible day
```

### Q1 — Where the payload is assembled versus rendered

Assembled and rendered from the **same object**. `ReceiptReview.tsx:157`:

```ts
const groups = groupByCategory(evaluated);
```

with the intent stated at `:152-156` ("Derived ONCE and consumed by both the preview
and handleConfirmItems. Two reduces would be free to disagree"). The preview renders
`groups.length`, each group's category, each group's `items.length`, and each group's
`amount` (`:415-434`). `handleConfirmItems` maps the same array (`:212-216`):

```ts
const items: ConfirmItem[] = groups.map((group) => ({
  amount: group.amount,
  categoryId: group.categoryId,
  description: composeGroupedDescription(group.items),
}));
```

The one asymmetry: `description` is computed **only** in the confirm branch, never
rendered. `composeGroupedDescription` (`src/lib/entry-description.ts:61-96`) is the
only part of the payload the user never sees before it is written — which makes it
the highest-value unit target in the phase, and it is already pure, exported, and
importable today (its only imports are `@/lib/format` and `@/lib/text`, both
astro-free).

Rounding is applied once, on the sum, not per item: `groupByCategory` finishes with
`sumItems(group.items)` (`:79`), the same function that produces the panel's
`Suma pozycji` (`:150`). The rationale is spelled out at `:75-78`.

Second write path, easy to forget: `handleConfirmTotal` (`:223-235`) posts a single
item `{amount: roundToCents(parsed.total), categoryId: totalCategoryId,
description: "Paragon"}` and bypasses `groups` entirely. It is reachable whenever
`parsed.total !== null`, including from a hard-blocked state — deliberately, as the
exit from a blocked confirm (`:459-461`).

### Q2 — The batch-write boundary and its idempotency mechanism

**The key.** `supabase/migrations/20260817190000_add_entry_batch_key.sql:62-64`:

```sql
alter table public.entries
  add constraint entries_batch_item_key
  unique (user_id, batch_id, batch_seq);
```

A plain table constraint, **not partial** — deliberately, because PostgREST cannot
emit an `index_predicate` and a partial index would make every confirm fail outright
(`:22-31`). Companion check at `:58-60`:
`check ((batch_id is null) = (batch_seq is null))`. Both columns are nullable with no
default (`:51-53`), and Postgres' default NULLS DISTINCT is what exempts every
manually-created entry — `createEntry` (`entries.ts:167-177`) sets neither column.

**The mechanism.** `entries.ts:253-270` — one `upsert` with
`{ onConflict: "user_id,batch_id,batch_seq", ignoreDuplicates: true }`, i.e.
`ON CONFLICT ... DO NOTHING`. `batch_seq` is assigned server-side from the array
index (`:266`) and never accepted from the client. `user_id` is absent from the
payload and filled by the column default `auth.uid()`; a conflict-target column need
not appear in the INSERT list, so inference still resolves.

**The consequence that shapes the tests.** `DO NOTHING` means `RETURNING` yields only
rows actually inserted, so a full replay returns `[]`. The service compensates
(`:277-297`):

```ts
if (insertedRows.length === input.items.length) {
  return insertedRows.map(toDto);
}
// A replay. Return what is stored under this batch ...
const { data: existing } = await supabase.from("entries").select(SELECT_COLUMNS)
  .eq("batch_id", input.batchId).order("batch_seq", { ascending: true });
```

The discriminator is a **length comparison**, not a replay flag. That is what makes
the 201 body "the stored batch" rather than "what you sent" whenever the counts
differ.

**batchId lifecycle** — minted at `ReceiptCapture.tsx:182-186`, immediately after a
successful parse; held in parent state (`:84`); cleared only in `toIdle()` (`:130`).
The two writes in the whole file are those. Behaviour per scenario:

| Scenario | batchId | Evidence |
| --- | --- | --- |
| Failed confirm → confirm again | **survives** | failure path is `:269-274` — `setStatus("review")` then `throw`; no `toIdle()` |
| User edits items between attempts | **survives** | all row edits are panel-local state (`ReceiptReview.tsx:188-200`); nothing calls `setBatchId` |
| Component remount | lost — but `parsed` is lost too, so there is nothing to retry. `DayView.tsx:243-252` deliberately does **not** key `ReceiptCapture` on `selectedDate`, so calendar navigation does not remount it |
| Re-parse of the same photo | new key (`:213` clears the input value, `:185` re-mints) |
| Parse of a different photo | new key (`:185`) |

The feared shape — re-minting per confirm attempt — is **not** present. The
idempotency window is exactly one parse: discard-and-rephotograph after a lost
response writes the receipt twice, by design.

**Double-submit guard** — `ReceiptReview.tsx:137` `submitting`, folded into
`canConfirmItems` (`:171`), enforced both as an early return (`:203`) and as
`disabled` (`:456`). It survives a rejected promise (`:182-185` sets it back to
false in the catch only). There is **no** `AbortController` and **no** client-side
timeout on the confirm, unlike the parse (`ReceiptCapture.tsx:164`).

### Q3 — What the save date resolves to

One expression, `ReceiptReview.tsx:122-124`:

```ts
const [saveDate, setSaveDate] = useState(() =>
  parsed.receiptDate !== null && parsed.receiptDate <= occurredOn ? parsed.receiptDate : occurredOn,
);
```

Four properties, all deliberate and all documented at `:114-121`:

- **Lazy initialiser** — runs once per mount, i.e. once per parse, so moving the
  calendar mid-review cannot clobber a date already chosen.
- **Lexicographic string compare**, correct for `YYYY-MM-DD`, no `Date` parsing —
  which is what keeps the timezone question `date-utils.ts` settled from reopening.
- **`occurredOn` stands in for "today"**, because the calendar cannot select a future
  day. This is the non-obvious one, and the in-code comment explicitly warns against
  "fixing" it into `new Date()`.
- **Never adopt a future printed date.** `receiptDateRejected` (`:128`) is likewise
  frozen at mount, so it cannot start claiming rejection because the user later moved
  the calendar backwards.

After initialisation the field is freely editable (`:264-273`), the revert button
targets `occurredOn` (`:279-281`), and the posted value is `saveDate`, never the live
prop (`:179`). Absent printed date (`receiptDate: null`) → the calendar day.

Upstream, `sanitise` keeps `receiptDate` only when it matches
`/^\d{4}-\d{2}-\d{2}$/` (`receipts.ts:57`, `:184-185`); anything else becomes `null`
silently and is *not* counted in `droppedItems`. **The regex is shape-only** — see F1.

### Q4 — Behaviour on partial write

**Within one request there is no partial write.** The insert is a single statement
and therefore a single transaction (`entries.ts:246-247`), which is the stated reason
the batch path exists rather than a loop over `createEntry` (`:185-189`). Either every
line lands or none does.

The category check at `:225-244` is a *separate* round trip before it, so there is a
TOCTOU window: a category soft-deleted between the check and the insert still gets
written, because the FK checks existence only. Low impact, no prior record.

**Across requests, "partial" is real and is accepted by decision.** From the S-06 fix
note, `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135`:

> **Known edge case, accepted**: if a user *edits* the item list and retries after a
> lost response, seqs already stored conflict and only genuinely new positions are
> appended; the re-select then returns everything under the batch id, which is
> accurate to what is stored. Not corrupting, and re-minting the key on edit would
> reopen the double-write.

Spike 1 confirmed the concrete shape: a **3-item** replay against a batch that already
holds 5 rows returns **5** rows, and the client's banner counts the response
(`ReceiptCapture.tsx:277`), so it reports 5. Symmetrically, an edit that *adds* a
group appends only the new tail positions and returns a mix of pre-edit and post-edit
rows — the all-or-nothing property holds within a request but not across a retry with
changed content.

The archive contains **no** discussion of a partial-write recovery path beyond the
atomicity claim; the test plan's fourth question has no prior answer.

### F1 — [defect candidate, unrecorded] A shape-valid impossible date reaches Postgres

`sanitise` validates the printed date with a **shape-only regex** (`receipts.ts:57`,
`:184-185`). `2026-02-30` and `2026-13-45` both pass. The server's
`createEntriesBatchSchema.occurredOn` uses the same shape-only pattern
(`entries.ts:7`, `:42`). So an impossible date:

1. survives `sanitise` and reaches the client as `parsed.receiptDate`;
2. is **adopted** as `saveDate`, because `"2026-02-30" <= "2026-08-21"` is true;
3. survives the route's zod validation;
4. reaches Postgres, where `occurred_on` is `date not null`
   (`20260815164539_create_entries_table.sql:12`) and the value is rejected;
5. the resulting error is neither `CategoryNotFoundError` nor
   `CategoryKindMismatchError`, so `entries.ts:59` rethrows it into an Astro error
   page — a **500 with a non-JSON body**, which `parseErrorBody` degrades to the
   generic "Coś poszło nie tak" (`src/lib/api-error.ts:9-11`).

The `<input type="date">` will refuse to display it, which is the only reason this is
not routinely visible. Not recorded in any archived plan or review.

### F2 — [defect candidate, unrecorded] Code points vs UTF-16 code units at the description bound

Three bounds are meant to be the same number 200, and one of them is counting a
different unit:

| Layer | Rule | Unit |
| --- | --- | --- |
| `entry-description.ts:23`, `:82` | `countCodePoints(candidate) <= 200` | **code points** |
| `entries.ts:13`, `:53` | zod `.max(DESCRIPTION_MAX)` | **UTF-16 code units** |
| `20260816140000_add_entry_description.sql:28` | `check (char_length(description) <= 200)` | **code points** |

Verified empirically against the installed zod (4.4.3): a 150-code-point / 300-unit
string is rejected by `z.string().trim().min(1).max(200)` with
`"Too big: expected string to have <=200 characters"`. So the client can compose a
description that the database would accept and the route will 400.

This makes a *documented* invariant false. S-10 recorded as permanently manual-only
(`context/archive/2026-08-18-entry-descriptions-and-receipt-grouping/plan.md:386-392`):

> 2. `composeGroupedDescription` produces a value that satisfies both the zod bound
>    and the `check` constraint, including for non-BMP input.

It satisfies the `check` constraint. At the zod bound it does not, for non-BMP input.
Reachability is low — it needs model-emitted astral characters in receipt line names,
and `NAME_MAX` truncation is itself code-point-based (`receipts.ts:174`) — but the
failure is unfixable by the user, because item names are read-only in review
(`ReceiptReview.tsx:324-327`). This is a *fail-loud* mismatch, not a silent one.

### F3 — [defect candidate, unrecorded] English validation text in a Polish UI

Confirmed by spike 2, verbatim body for a missing `batchId`:

```json
{"error":"Invalid input: expected string, received undefined","field":"batchId"}
```

The route forwards `issue.message` unmodified (`entries.ts:38`). Same class:
`"Unauthorized"` (`:25`) and `"Supabase is not configured"` (`:18`). The two errors
the route *does* translate — 404 `"Nie znaleziono kategorii"` and 400
`"Kategoria nie pasuje do typu wpisu"` — are the ones with hand-written Polish. The
client renders whichever string arrives directly to the user
(`ReceiptReview.tsx:453`).

### Testability — what the runner reaches today

Both results below are empirical, from spikes written, run, and deleted in this
session. Baseline before and after: `npm run test` → 1 file, 11 tests, ~290 ms.

**Service layer — reachable, no config change.** `src/lib/services/entries.ts:2` is
`import type { createClient } from "@/lib/supabase"`, erased by
`verbatimModuleSyntax`. The module's only value imports are `zod` and its own types.
The client surface `createEntriesBatch` actually touches is small enough to fake by
hand:

- `from(t).select(cols).in(col, ids).is(col, null)` → awaited
- `from(t).upsert(rows, opts).select(cols)` → awaited
- `from(t).select(cols).eq(col, v).order(col, {ascending})` → awaited

A recording proxy whose every chain method returns itself and which exposes a `then`
covers all three, and — the point — lets a test assert **the exact array handed to
PostgREST**, including `batch_seq` assignment and the `onConflict` options object.

**Route layer — reachable, no config change and no alias stub.**
`src/pages/api/receipts/entries.ts:2` value-imports `@/lib/supabase`, which
value-imports `astro:env/server` (`supabase.ts:3`). `vi.mock("@/lib/supabase",
factory)` replaces the module *before evaluation*, so the virtual module is never
resolved. All six branches were asserted: 500 (null client), 401 (no user), 201
(happy path), 404 (`CategoryNotFoundError`), 400 (`CategoryKindMismatchError`), 400
(zod). `Request`/`Response` are native in Node 22, so the default `node` environment
suffices — no jsdom.

Two mechanical notes for whoever writes these:

- The `vi.mock` factory is hoisted above the imports, so it must not close over a
  binding evaluated later. The working shape is a module-scope mutable holder plus
  `const { POST } = await import("./entries")` *after* it, so the factory body runs
  at import time, not at hoist time.
- ESLint `strictTypeChecked` bites immediately: `@typescript-eslint/consistent-type-definitions`
  rejects `type X = { ... }` in favour of `interface`. The spike hit this on its first
  run.

**Still unreachable, and out of scope for this phase**: `src/lib/services/receipts.ts`
(`:3` value-imports `astro:env/server`), `src/pages/api/receipts/parse.ts` (three
independent blockers), `src/lib/receipt-image.ts` (`:11` `cloudflare:workers`), and
`src/components/receipts/image-downscale.ts` (needs `createImageBitmap` /
`OffscreenCanvas`). None sits on the *confirm* path — they are all parse-side.

If the plan wants `sanitise` covered anyway, the extraction is well-bounded:
`receipts.ts:49-197` (~135 of 296 lines — `sanitise`, `modelResponseSchema`,
`buildPrompt`, `RESPONSE_FORMAT`, the three constants) is pure, with only `zod`,
`@/lib/money`, `@/lib/text` and type imports. Only `parseReceipt` (`:207-295`) reads
`CF_AI_TOKEN` / `CF_ACCOUNT_ID`. That belongs to risk #1 only insofar as F1's date
regex lives there.

### Panel-purity audit — extraction candidates

All hook-free, DOM-free, fetch-free. Precedent for the move is
`src/components/receipts/receipt-total.ts`, extracted from this very panel for this
very reason (`receipt-total.ts:1-11`).

| Candidate | Location | ~lines | In → Out | Why it matters to risk #1 |
| --- | --- | --- | --- | --- |
| `groupByCategory` | `ReceiptReview.tsx:58-80` | 23 | rows → `CategoryGroup[]` | The per-category split itself. Encodes first-appearance ordering, the skip rule for uncategorised/invalid rows, and single-rounding-via-`sumItems`. Needs `ReviewRow`/`CategoryGroup` exported. |
| Save-date resolution + rejection flag | `ReceiptReview.tsx:122-124`, `:128` | 2 exprs | `(receiptDate, occurredOn)` → `string`, `boolean` | The receipt-derived date. Four cases cover it exhaustively: null, past, equal, future. |
| Amount evaluation | `ReceiptReview.tsx:141-148` | 8 | `amountText` → `{amount, amountValid}` | Pins the comma-decimal parse and the non-blank / finite / `> 0` rule that stands in front of `check (amount > 0)`. |
| `groups` → `ConfirmItem[]` | `ReceiptReview.tsx:212-216` (+ `:219`) | 5 | `CategoryGroup[]` → `ConfirmItem[]` | Companion to the above; together they make the exact POST body assertable with no DOM. |
| Confirm gate | `ReceiptReview.tsx:159-171` | 8 | state → `{hardBlocked, deltaMismatch, canConfirmItems}` | What stops a body the DB constraints or `.min(1)` would reject. |
| Initial-row seeding | `ReceiptReview.tsx:100-110` | 11 | `ParsedReceipt["items"]` → `ReviewRow[]` | Pins `key = parse index` and `amountText = toFixed(2)` (the "never seed with `formatCurrency`" rule). |
| Whole-receipt item literal | `ReceiptReview.tsx:226-233` | 5 | `(total, categoryId)` → `ConfirmItem[]` | The second write path, currently untestable. |

Already pure and importable with **zero** extraction cost:
`composeGroupedDescription` / `splitDescriptionItems` (`src/lib/entry-description.ts`),
`sumItems` / `totalDelta` (`receipt-total.ts`), `roundToCents` (`money.ts`).

### External oracles available for hand-written expectations

§6.1's rule is that expectations come from an external source, never from calling the
code under test. The confirm path is unusually rich in them:

| Oracle | Source | Value |
| --- | --- | --- |
| `check (amount > 0)` | `20260815164539_create_entries_table.sql:12` | 0 and negatives unstorable → `23514` |
| `numeric(10, 2)` | same, `:12` | >2 decimals are **silently rounded** by Postgres, not rejected — and zod does not constrain decimals |
| `check (type in ('expense','income'))` | same, `:11` | confirm path hardcodes `expense` (`entries.ts:260`) |
| `check (char_length(description) <= 200)` | `20260816140000_add_entry_description.sql:28` | code points — see F2 |
| `occurred_on date not null` | `20260815164539:13` | the F1 oracle |
| `unique (user_id, batch_id, batch_seq)`, non-partial | `20260817190000:62-64` | replay → `23505`; with `do nothing` → no-op |
| `check ((batch_id is null) = (batch_seq is null))` | `20260817190000:58-60` | half-set key → `23514` |
| Postgres NULLS DISTINCT | documented default | manual entries exempt from the key |
| zod `.max()` counts UTF-16 units | verified against zod 4.4.3 this session | F2 |
| `Intl.NumberFormat("pl-PL")` output | verified this session | see trap below |

### Traps for the test author

1. **`formatAmountPlain` emits U+00A0, and only above 4 digits.** Verified:
   `12.5 → "12,50"`, `1234.5 → "1234,50"` (**no** separator), `1234567.89 →
   "1 234 567,89"` with U+00A0. A hand-written expectation for
   `composeGroupedDescription` must use the right character, and must not assume a
   thousands separator appears at four digits.
2. **Do not scope superuser-session pgTAP counts globally.** Migration
   `20260816120000_seed_demo_account.sql` seeds a third user
   (`33333333-…`) with ~30 categories and three months of entries that are *not*
   rolled back; `supabase/tests/entries_rls_test.sql:203-213` records unscoped counts
   going red because of it. `seed.sql` itself seeds no categories and no entries.
3. **The seed users are `11111111-…` and `22222222-…`** (`seed.sql:22-49`), password
   `rls-test-password`; every pgTAP suite creates its own fixtures inside the
   transaction.
4. **`batch_seq` is `smallint`**, and its type is the one column property
   `entries_batch_key_test.sql` does *not* assert (it asserts `batch_id`'s `uuid` at
   `:23` but has no `col_type_is` for `batch_seq`).
5. **Any test file must be `src/**/*.test.ts`** to be discovered
   (`vitest.config.ts`); a shared fake helper must therefore *not* carry that suffix.

### What pgTAP already proves — do not duplicate it

`supabase/tests/entries_batch_key_test.sql`, `plan(10)`: column existence and
nullability (`:20-23`), `col_is_unique` over the exact three columns (`:29-32`), a
two-line batch writing two rows (`:48-51`), a plain replay raising `23505` (`:54-61`),
an `on conflict ... do nothing` replay leaving the count at 2 (`:65-73` — which also
implicitly proves the conflict target is inferable, since a partial index would have
errored here), NULL-key coexistence (`:78-86`), and the both-or-neither check
(`:89-96`).

**Not proved, and structurally unreachable by pgTAP** (it drives raw SQL, never
TypeScript): the empty-`RETURNING`-on-replay behaviour — assertion 8 checks the
resulting row count, never what the statement *returned* — and therefore the entire
length-mismatch / re-select branch; server-side `batch_seq` assignment from the array
index; the client resending the same key; the three app-layer-only invariants
(ownership, type↔kind, soft-delete exclusion); and all of zod.

The re-select's safety is worth stating because a test could get it wrong: `entries.ts:288-292`
runs `.eq("batch_id", …)` with **no** `user_id` filter, and is safe purely because
`entries_select_own` (`20260815164539:38-41`) appends `user_id = auth.uid()`. Two
users legitimately *can* hold the same `batch_id` — that is why `user_id` is in the
key. This holds only for a request-scoped authenticated client; a service-role client
would return other users' rows here.

## Code References

- `src/lib/services/entries.ts:222-298` — `createEntriesBatch`, the batch-write boundary
- `src/lib/services/entries.ts:253-270` — the upsert and its `onConflict` options
- `src/lib/services/entries.ts:277-297` — the length-mismatch discriminator and re-select
- `src/lib/services/entries.ts:41-58` — `createEntriesBatchSchema`, required `batchId`, 100-item cap
- `src/pages/api/receipts/entries.ts:15-61` — the route: auth, zod, error→status mapping
- `src/components/receipts/ReceiptReview.tsx:58-80` — `groupByCategory`, the only grouping implementation
- `src/components/receipts/ReceiptReview.tsx:122-128` — save-date resolution and the rejection flag
- `src/components/receipts/ReceiptReview.tsx:157` — `groups`, the single object behind preview and payload
- `src/components/receipts/ReceiptReview.tsx:202-235` — both confirm paths
- `src/components/receipts/ReceiptCapture.tsx:182-186` — batchId minted once per parse
- `src/components/receipts/ReceiptCapture.tsx:243-274` — the POST and its failure handling
- `src/components/entries/DayView.tsx:143-156` — `handleBatchSaved`, the id-keyed dedupe
- `src/lib/entry-description.ts:61-96` — `composeGroupedDescription`, the unrendered payload field
- `src/components/receipts/receipt-total.ts:22-39` — `sumItems`, `totalDelta`
- `src/lib/services/receipts.ts:152-197` — `sanitise`; `:184-185` the shape-only date regex
- `supabase/migrations/20260817190000_add_entry_batch_key.sql:51-64` — columns, check, unique constraint
- `supabase/tests/entries_batch_key_test.sql` — the 10 assertions listed above
- `vitest.config.ts` — the standalone config; `@/*` alias, `src/**/*.test.ts` glob
- `src/lib/text.test.ts` — the §6.1 reference test and its oracle header comment

## Architecture Insights

- **The design already took the "same object" lesson.** S-04 F4 (duplicated date
  arithmetic) and S-06 F10 (duplicated `roundToCents`) both produced real numeric
  bugs, and the response shows up structurally: `groups` derived once, `sumItems`
  shared between panel and fold, `roundToCents` centralised in `money.ts` (verified —
  `grep -rn "Math\.round(.*100" src/` returns exactly one hit). The phase's job is
  therefore to *pin* an invariant that currently holds, not to discover a violation.
- **The idempotency key is content-independent and the dedupe is positional.** That
  pairing is what makes the retry-after-edit case behave the way it does. It is the
  right trade — the alternative, re-minting on edit, reopens the double-write F4
  existed to close — but it means "same batch id" is a claim about *the parse*, never
  about *the payload*.
- **Two bounds meant to be one number are counted in different units** (F2). The
  repo's own comment at `entry-description.ts:17-23` explains why the constant is
  deliberately duplicated rather than imported (bundle size); what it does not say is
  that the two copies are also measured differently.
- **The service layer carries invariants the schema cannot.** `createEntriesBatch`
  re-implements ownership and type↔kind, and adds soft-delete exclusion, all in
  TypeScript (`:190-208`). `lessons.md`'s first entry is exactly this, and its 2026-08-21
  update — app-layer invariants now route to a JS test rather than to a permanent
  manual note — is what this phase acts on.

## Historical Context (from prior changes)

- `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:111-136`
  — **F4**, the original non-idempotent confirm, and its four-part fix. Caught at
  implementation review, not by a test; there was no test framework at the time
  (`2026-08-16-receipt-parsing/plan.md:407`). The failure scenario recorded there —
  a 24-line receipt confirmed on mobile, response lost, 48 entries land — is the
  canonical statement of risk #1. `:135` records the retry-after-edit case as
  **accepted**.
- `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:214-226`
  — **F10**, duplicated `roundToCents`, the reason `money.ts` exists.
- `context/archive/2026-08-18-entry-descriptions-and-receipt-grouping/plan.md:34`,
  `:327-331` — the **grouping redefinition**: one entry per printed line → one entry
  per category, amounts summed, folded client-side at confirm time to keep FR-012's
  per-line correction. `plan.md:428` records the deliberate decision not to backfill.
- `.../plan.md:386-392` and `:361-372` — the **manual-only debt this phase pays down**:
  grouped amounts equal the reviewed sum to the cent; `batch_seq` over the grouped
  array keeps the confirm idempotent; `composeGroupedDescription` satisfies both
  bounds including non-BMP; idempotency re-verified with no duplicates and the same
  reported count; a category soft-deleted between parse and confirm 404s rather than
  partially writing.
- `context/archive/2026-08-16-receipt-parsing/plan.md:312` — S-06's original
  conservative rule: *"show it as a hint — never auto-change the date"*.
  `2026-08-18-.../plan-brief.md:25`, `:58` record S-10 **softening** that guard and
  accepting the residual risk that a user who does not read the field can misfile.
- `context/foundation/roadmap.md:301` — S-10 **archived without an impl-review**,
  carrying four off-plan changes; `roadmap.md:303`, `:265-266` — S-11 and S-12 landed
  **directly on `master` with no plan or change folder**, S-12 touching
  `ReceiptReview.tsx`. This is the §2 likelihood evidence, confirmed.
- `context/foundation/prd.md:47`, `:64-72`, `:106-112` — the guarantee under test:
  *"No silent bad writes: parsed receipt data is never persisted without explicit user
  confirmation"*, FR-010/011/012, and US-02's acceptance criteria.
- Still open against the parse half of this flow, skipped by decision: **F3** (no rate
  limit on the paid parse endpoint) and **F8** (receipt text reaching Workers Logs) —
  carried in `test-plan.md` §7 as accepted risk.

## Related Research

- `context/archive/2026-08-21-testing-runner-bootstrap/research.md` — Phase 1;
  its *Addendum: OQ6 spike result* is the empirical `getViteConfig` finding that
  produced the standalone `vitest.config.ts` this phase builds on.

## Open Questions

1. **Should the retry-after-edit behaviour be pinned as-is, or revisited?** It is
   accepted by decision and the decision's reasoning still holds. Recommendation: pin
   it as a characterisation test with a comment naming the impl-review line, and do
   **not** reopen it in this phase — changing it is a product change, not a test.
2. **How far should F1 (impossible date → 500) be taken here?** The test is cheap and
   belongs to risk #1 squarely. The *fix* — a calendar-validity check, and where it
   belongs (`sanitise`, the zod schema, or both) — is arguably a separate change.
   Worth a decision at plan time rather than drifting into scope.
3. **Is F2 worth a code change or only a test?** Reachability is genuinely low. The
   options are aligning zod to code points, or amending the S-10 invariant to say what
   is actually true. Either way the current text is wrong.
4. **Does the phase cover `handleConfirmTotal`?** It is a second write path with its
   own payload shape and no preview at all. Cheap to include once the extraction is
   done; easy to forget because `groups` dominates the reading.
5. **Where does the shared Supabase fake live?** It must not match `src/**/*.test.ts`.
   `src/lib/services/__fixtures__/supabase-fake.ts` or similar — a §6.2 decision, and
   the first shared test helper this repo will have.
6. **Not investigated**: whether the `prev === null` drop in `DayView.tsx:147-149` (a
   confirm resolving while the day's GET is in flight) can lose a batch from the
   visible list. It is client-state behaviour and belongs to §3 Phase 5 / risk #5, but
   it surfaced here and should not be lost.
