# Receipt Confirm Integrity — Plan Brief

> Full plan: `context/changes/testing-receipt-confirm-integrity/plan.md`
> Research: `context/changes/testing-receipt-confirm-integrity/research.md`

## What & Why

Rollout Phase 2 of the test plan, covering its top risk: _confirming a reviewed
receipt persists something other than what was on screen — wrong per-category
split, wrong receipt-derived date, wrong amount, or a duplicate batch on retry_.
The PRD's guarantee is "no silent bad writes"; today that guarantee is protected
by code comments and one impl-review that caught a non-idempotent confirm by
hand.

## Starting Point

The invariants already hold. `groups` is derived once and feeds both the preview
and the POST body; `groupByCategory` is the only grouping implementation; the
batch write is one statement keyed on `(user_id, batch_id, batch_seq)`. Nothing
guards any of it. Research also overturned the blocker §6.1 predicted: the
service layer only `import type`s the Supabase client, and the route is reachable
via `vi.mock` — so **no runner config change and no new dependency**. The test
base is one file, 11 tests.

## Desired End State

Changing the fold from lines to per-category entries, the save-date rule, the row
array handed to PostgREST, or the `batch_seq` assignment turns a test red. A
replay is proven to write nothing the second time. An impossible printed date is
a 400 with a JSON body instead of a 500 with an Astro error page. `§6.2` of the
test plan tells the next contributor how to write a service test here.

## Key Decisions Made

| Decision                       | Choice                                                                     | Why (1 sentence)                                                                                            | Source   |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| Runner config                  | No change; `vi.mock` + a hand-rolled fake                                  | Two spikes proved both the service and the route reachable as-is, so §4's API-mocking row resolves to _none_. | Research |
| Panel extraction scope         | All 7 audit candidates → `review-model.ts`                                 | One touch of a 14-commits/30d hot-spot file instead of two, and it covers both write paths.                  | Plan     |
| Defect fixes                   | F1 only (impossible date), at the zod bound                                | It is squarely risk #1 and `z.iso.date()` makes it one line; F2 and F3 are fail-loud and low-reach.          | Plan     |
| Refactor safety                | Tests land in the same commit as the extraction, plus a manual browser pass | No component-test layer exists until Phase 5, so the unit tests are the only regression guard.               | Plan     |
| Shared fake                    | Recording chainable thenable at `services/__fixtures__/supabase-fake.ts`   | Lets a test assert the literal row array handed to PostgREST; `__fixtures__` cannot match the test glob.     | Plan     |
| Route depth                    | All six status branches                                                    | ~400 ms for all of them, and the 404's not-found-never-not-yours wording is a security decision worth pinning. | Plan     |
| Retry-after-edit               | Characterisation test, pinned as-is                                        | Accepted by decision at impl-review; re-minting the key on edit would reopen the double-write it closed.      | Research |
| F2 / F3 / DayView carry-over   | Plan out-of-scope + one `lessons.md` entry for F2's class                  | `lessons.md` is re-read by every skill, so the duplicated-bound class gets caught next time.                 | Plan     |

## Scope

**In scope:** unit tests for `composeGroupedDescription` and the receipt
arithmetic; the shared PostgREST fake; service tests for `createEntriesBatch`
(row array, conflict options, category guards, clean replay, edited-replay
characterisation); route tests for all six status branches; the `z.iso.date()`
fix in `services/entries.ts`; extraction of seven pure functions out of
`ReceiptReview.tsx` and their tests; `test-plan.md` §6.1/§6.2/§4/§6.6 and one
`lessons.md` entry.

**Out of scope:** any rendering assertion or React Testing Library (Phase 5);
reopening the accepted retry-after-edit behaviour; F2 (code points vs UTF-16 at
the zod bound) and F3 (English validation copy); the four other copies of the
shape-only date regex; extracting `sanitise` from the parser; `DayView`'s
`prev === null` drop; any pgTAP work.

## Architecture / Approach

Three boundaries, three layers:

```
ReceiptReview panel  →  review-model.ts        (new; pure, unit-tested)
        │                    groups → ConfirmItem[]
        ▼
POST /api/receipts/entries  →  entries.test.ts (vi.mock on @/lib/supabase)
        │                    zod, six status branches
        ▼
createEntriesBatch          →  supabase-fake   (recording thenable)
                             asserts the exact row array PostgREST receives
```

Phases run in ascending order of production risk: two purely additive phases
establish the fake, the `vi.mock` shape and the oracle discipline; then a
one-line schema fix behind a test written first; then the single refactor; then
the docs.

## Phases at a Glance

| Phase                            | What it delivers                                                    | Key risk                                                                     |
| -------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Pure payload units            | Tests for the unrendered description field and the receipt sum      | Expectations quietly derived from the implementation instead of an oracle    |
| 2. Service integration + fake    | The shared fake and the batch-write boundary pinned                 | A fake that drifts from supabase-js verifies our calls, not PostgREST's       |
| 3. Route boundary + F1 fix       | Six status branches; impossible dates 400 instead of 500            | The schema change is on the live write path                                  |
| 4. Panel model extraction        | Seven functions moved out of a hot-spot file, with their tests      | A behaviour-preserving move with no component test layer to catch a slip     |
| 5. Cookbook and plan sync        | §6.2 written, §6.1 corrected, §4 resolved, one `lessons.md` entry   | §6.1's correction overstating what `vi.mock` unblocks                        |

**Prerequisites:** Phase 1 of the rollout is complete (Vitest `4.1.11`, `npm run
test`, CI test step). Node 22 via `nvm use`. A local Supabase stack and a real
receipt photo for the Phase 4 manual pass.
**Estimated effort:** ~2 sessions across 5 phases; Phases 1–3 are mechanical,
Phase 4 carries the review weight.

## Open Risks & Assumptions

- The hand-rolled fake asserts _our_ calls, not that PostgREST accepts them. The
  constraint half is already covered by `entries_batch_key_test.sql`; the seam
  between them is not tested by either.
- The Phase 4 extraction is behaviour-preserving by construction, but "by
  construction" is exactly what was believed about the duplicated arithmetic that
  caused S-04 F4 and S-06 F10. The manual pass is not optional.
- `z.iso.date()`'s calendar validation was verified against the installed zod
  `4.4.3` this session; a zod major bump should re-verify it.
- F2 leaves a documented S-10 invariant false rather than fixing it. That is a
  deliberate trade recorded in `lessons.md`, not an oversight.

## Success Criteria (Summary)

- A change to the per-category fold, the save-date rule, or the row array handed
  to PostgREST cannot ship green.
- A confirm replayed after a lost response is proven not to double the receipt.
- A user can no longer reach a generic "Coś poszło nie tak" by way of a misread
  printed date.
