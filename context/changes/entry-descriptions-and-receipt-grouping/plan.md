# Entry descriptions, and one entry per category from a receipt — Implementation Plan

## Overview

Two halves of one outcome: make `entries.description` a field the user can write, read and correct, and change a receipt confirm so it writes **one entry per category** — dated from the receipt itself — instead of one entry per printed line.

`entries.description` shipped with S-06 and has been written but never displayed since. This slice is largely the display-and-edit half that was deliberately scoped out then, plus one genuine behaviour change: the receipt fold.

## Current State Analysis

**The column exists and needs no migration.** `20260816140000_add_entry_description.sql` added `description text check (char_length(description) <= 200)` — nullable, no default, no index, no RLS change. Its schema half is already covered by `supabase/tests/entries_description_test.sql` (6 assertions).

**The write path is already open on create.** `createEntrySchema` accepts `description: z.string().trim().min(1).max(200).nullish()` (`src/lib/services/entries.ts:20`) and `createEntry` writes it (`:170`). `EntryForm` simply never sends it (`src/components/entries/EntryForm.tsx:146`). So manual descriptions cost no schema and no service change — only UI and one field in a fetch body.

**The update path is deliberately closed.** `updateEntrySchema = createEntrySchema.omit({ type: true, description: true })` (`entries.ts:31`), with a written rationale at `:26-30`: description *"records where the entry came from, not what it is. Editing an amount or a category must leave it alone."* FR-017 makes it a user-authored field, so this slice reverses that decision and the comment has to be rewritten rather than merely edited around. `updateEntry` (`:318-327`) also does not include `description` in its update object.

**Nothing in the app renders a description.** A grep across `src/` finds only writes: the trimmed parsed line-item name (`ReceiptReview.tsx:141`) and the literal `"Paragon"` on the total-only path (`:156`).

**The receipt date already exists end to end but is never persisted.** Prompt rule 7 asks for it (`receipts.ts:101`), the json_schema requires it (`:114-116`), `sanitise` keeps it only when it matches `DATE_PATTERN` (`:171-172`), and `ParsedReceipt.receiptDate` carries it (`types.ts:300`). Its sole use is an amber hint rendered when it differs from the calendar day (`ReceiptReview.tsx:175-179`), behind an explicit guard comment at `:171-174`: *"A hint, never an automatic date change. Filing a whole receipt to the wrong day is the one high-cost mistake this placement makes possible."* The date actually saved is the calendar's selected day, read at confirm-click time (`ReceiptCapture.tsx:193`).

**The confirm payload is assembled entirely client-side.** `handleConfirmItems` (`ReceiptReview.tsx:131-145`) maps one `ConfirmItem` per review row; `createEntriesBatch` assigns `batch_seq` from the array index (`entries.ts:262`) and upserts on `(user_id, batch_id, batch_seq)` for idempotency. A fold from N rows to M rows before the POST therefore needs **zero** server change and leaves idempotency intact — `batch_seq` becomes the index in the grouped array.

**The day list is a single flex line per row.** `DayEntriesList.tsx:229-270`: category icon + name on the left, amount + two 44px icon-only buttons on the right. S-07 explicitly left this markup untouched (its gate was that `git diff DayEntriesList.tsx` be empty); the icon came from S-09. There is no truncation, grouping, or collapsing anywhere in the entry list today — the `Pokaż więcej` collapse is strictly the category chip picker.

**Known open defect this slice walks into.** `receipts.ts:161` does `name.slice(0, NAME_MAX)`, which slices by UTF-16 code unit. A name longer than 200 characters ending mid-surrogate yields a lone surrogate PostgREST cannot store, and **the whole confirm 500s** — the user loses the entire receipt rather than one line. Filed in the joint S-05⨯S-06 review under "Also noted, not filed as findings" and never fixed. Joining several names into one description makes the 200-character ceiling far easier to reach, so this becomes reachable rather than theoretical.

**Tap budget.** The routine expense path is measured at three interactions against the PRD's ≤4 (`prd.md` NFR 1), i.e. one tap of slack. Every slice since S-02 carries a stopwatch re-verification; adding a field to `EntryForm` is exactly the kind of change that consumes it.

## Desired End State

- Logging an expense or income manually offers an optional **Opis** field as the last input before the submit button. Leaving it untouched costs nothing and stores `NULL`.
- Every entry with a description shows it as a muted second line in "Wpisy tego dnia". A description carrying more than three items shows the first three plus a `+N` affordance; tapping expands that row in place.
- The inline edit form carries an **Opis** field alongside amount, category and date. A correction saves; clearing it stores `NULL`.
- Confirming a parsed receipt writes **one entry per category**, each amount the rounded sum of that category's reviewed lines, each description the group's `name amount` pairs joined with ` · `. Review itself stays one row per printed line, so every line's category and amount remain individually correctable.
- The receipt's own printed date is the **pre-selected** save date when the model read one that is not in the future, shown in an editable field with the calendar day one tap away.
- `accuracy-log.md` carries a dated note recording that the fold happens after review, so its per-line columns still measure the parse and its unfilled baseline stands.

**How to verify**: the Manual Verification blocks per phase, plus the whole-slice manual script in Testing Strategy.

### Key Discoveries

- No migration. `entries.description` already exists with the right shape and bound; `entries_description_test.sql` must keep passing **unchanged** as evidence of that (`src/lib/services/entries.ts:9-13` documents the paired bound).
- `createEntrySchema` already accepts `description` — the manual-entry half is UI-only (`entries.ts:20`, `:170`).
- `batch_seq` is assigned from the array index server-side (`entries.ts:262`), so grouping client-side keeps the idempotency key well-defined with no server change.
- `roundToCents` lives in `src/lib/money.ts` and imports cleanly from both sides (`money.ts:1-13`) — the grouped amount must go through it, not through a bare `reduce`.
- `format.ts` is the repo's single source of number formatting with module-scope `Intl` instances (`format.ts:1-3`); a bare comma-decimal formatter belongs there, not inline in a component.
- `DayView` keys `<DayEntriesList>` on `selectedDate` (`DayView.tsx:262`), so any new per-row UI state resets on day change for free.
- `handleBatchSaved` already filters saved entries against `selectedDateRef` (`DayView.tsx:144`) — a receipt filed to a *different* day correctly does not splice into the visible list. That is right, and it is also why the confirmation message has to name the date.
- The total-only shortcut is the documented exit from a hard-blocked confirm (`ReceiptReview.tsx:311-313`), which the NFR *"never left waiting with no exit"* leans on. It stays exactly as shipped.

## What We're NOT Doing

- **No migration, no new pgTAP file.** The column, its bound and its tests already exist.
- **Not making receipt line-item names editable during review.** FR-012 asks for category and amount; the name stays a read-only aid (`ReceiptReview.tsx:201-204`). The *stored* description becomes editable after the fact instead, which is where the correction belongs.
- **Not retiring or restyling the total-only shortcut.** It keeps its `"Paragon"` description and its always-available placement.
- **Not adding a "group / don't group" toggle.** The fold is unconditional; a per-line save is not offered as an alternative shape.
- **Not persisting `receiptDate` as its own column.** It becomes the default for `occurredOn`, nothing more.
- **Not touching the reports surfaces.** No chart, KPI or ranking consumes `description`, and none should.
- **Not fixing the other open S-06 review residue** — the missing rate limit on `/api/receipts/parse` (F3), receipt text reaching Workers Logs (F8), the `api-error.ts` unvalidated cast, the forwarded part `Content-Type`, or the missing zod on the gateway response. Only the truncation defect is in scope, and only because Phase 4 makes it reachable.
- **Not replacing `window.confirm` / `window.alert`.** Deferred by S-07 and still deferred.
- **Not the `category-color-drop` follow-up.** Still owed, still separate; this slice adds no migration so it imposes no new ordering constraint on it.

## Implementation Approach

Four phases, ordered so that the field is writable before it is rendered, and rendered before anything starts generating it in bulk. There is no cut line — the slice is delivered whole — but the ordering means an interrupted run leaves a coherent state rather than a half-shipped one.

The receipt half is split in two on purpose. The date change alters `occurredOn`; the fold alters `items`. They touch the same panel but are independent, have different risk profiles (one can misfile a whole receipt, the other can only mis-shape it), and separating them means a failed manual test points at one cause.

Two small shared modules absorb the logic that would otherwise be duplicated or inlined:

- `src/lib/entry-description.ts` — the item separator, composition, and splitting. Both the receipt panel (compose) and the day list (split for the three-item clamp) need to agree on the separator, and the repo has a documented history of duplicated arithmetic drifting apart (S-04 F4, S-06 F10).
- `src/lib/text.ts` — code-point-safe truncation, consumed by the composer and by `receipts.ts:161`, which is where the existing lone-surrogate defect lives.

## Critical Implementation Details

**Grouped-description truncation is a correctness concern, not cosmetics.** The 200-character bound is enforced twice — by zod (400) and by a `check` constraint (500 via PostgREST) — and a lone surrogate produced by cutting mid-code-point is rejected at the *database* layer, taking the whole atomic batch with it. The composer must truncate to code points and must produce a value that is valid on its own, not merely short enough.

**Full-replace PATCH semantics make an omitted field destructive.** Once `description` is in `updateEntrySchema`, a caller that omits it would wipe a stored value. Make the field `.nullable()` rather than `.nullish()` so omission is a 400, and have both write sites always send it explicitly.

**The receipt date must not be adoptable into the future.** A misread year is the failure mode that files a receipt somewhere the calendar can never reach casually. Pre-select `parsed.receiptDate` only when it is not after today; otherwise keep the calendar day as the default and let the existing amber hint stand.

---

## Phase 1: Description as a first-class field

### Overview

Open the update path, then wire the field into both write surfaces. Nothing renders a description yet — this phase makes it writable and correctable end to end.

### Changes Required

#### 1. Entry service

**File**: `src/lib/services/entries.ts`

**Intent**: Admit `description` to the update path and write it, and replace the comment that justified excluding it — the rationale is now wrong, not merely stale, and leaving it would tell the next reader the opposite of what the code does.

**Contract**: `updateEntrySchema` drops `description` from its `.omit()` and overrides the field so it is **required but nullable**, i.e. `description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullable()`. `UpdateEntryInput` gains `description: string | null`. `updateEntry`'s update object gains `description: input.description`. `createEntrySchema` is unchanged — create callers may still omit the field.

The `.nullable()` rather than `.nullish()` is the non-obvious part and the reason for a snippet:

```ts
// description is now a user field (FR-017), so PATCH has to carry it — but a
// full-replace body means an OMITTED field would silently wipe a stored value.
// .nullable() (not .nullish()) makes the key mandatory: clearing a description
// is an explicit `null`, and forgetting to send it is a 400.
export const updateEntrySchema = createEntrySchema
  .omit({ type: true })
  .extend({ description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullable() });
```

#### 2. Manual entry form

**File**: `src/components/entries/EntryForm.tsx`

**Intent**: Add the optional "Opis" input as the **last** field, between the category picker and the submit button, so it never sits on the amount→chip→save path. Include it in the POST body, normalised so an untouched or whitespace-only field stores `NULL` rather than failing zod's `.min(1)`.

**Contract**: New `descriptionText` state, an `<Input id="entry-description">` with a `<Label>` reading `Opis` and a `maxLength={200}`, matching the `h-11 min-h-11` tap-target override the amount input already carries. The POST body gains `description: <trimmed> || null`. `handleSubmit`'s success reset clears it alongside `amountText`. The field is not part of `canSubmit` — it is optional in every state.

Placement matters and is a decision, not an accident: below `CategoryPicker`, above the `{error}` / `{justSaved}` messages and the submit button.

#### 3. Inline edit form

**File**: `src/components/entries/DayEntriesList.tsx`

**Intent**: Add an "Opis" field to the inline edit form so a saved description — including a receipt-generated one — is correctable and clearable, which is the whole point of opening the update schema.

**Contract**: `EditFormState` gains `descriptionText: string`. `startEdit` seeds it from `entry.description ?? ""`. `handleSaveEdit`'s PATCH body gains `description: <trimmed> || null` — **always sent**, never conditionally, per the full-replace contract above. The field renders after the date input, follows the same `Label` + `Input` + `h-11 min-h-11` shape as its siblings, and surfaces `editError?.field === "description"`. `editValid` is unchanged: an empty description is valid.

### Success Criteria

#### Automated Verification

- `npx astro sync` succeeds
- Type check passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- The shipped schema test still passes unchanged: `npx supabase test db` (run `npm ci` first — see `context/foundation/lessons.md`)
- No migration was added: `git status --short supabase/migrations/` is empty
- The reversed rationale was rewritten, not left behind: `grep -n "records where the entry came from" src/lib/services/entries.ts` returns nothing

#### Manual Verification

- Logging an expense with a description saves it; the row appears in the day list (description not yet rendered — verify via Supabase Studio)
- Logging an expense with the description field untouched stores `NULL`, not `""`
- Editing an entry and changing only the amount leaves its description intact
- Editing an entry and clearing the description stores `NULL`
- Editing an entry that was filed under a **soft-deleted** category still saves (the standing S-07 re-verification: `assertCategoryUsable` admits the current category even when deleted)
- A 201-character description is rejected as a 400 with a field-scoped message, not a 500
- **Tap-budget re-count**: a routine expense is still 3 interactions and ≤10s with the new field present, on a phone-sized viewport, with the submit button reachable without a scroll that costs an interaction

**Implementation Note**: pause here for confirmation that the manual testing above passed before starting Phase 2. Note that none of the Phase 1 invariants that matter — that `updateEntry` writes description, that clearing yields `NULL`, that an untouched field yields `NULL` — are reachable by pgTAP. It drives raw SQL and cannot reach TypeScript (`context/foundation/lessons.md`), so these are permanently manual-only re-verification steps for any future change to this service.

---

## Phase 2: Descriptions visible in the day list

### Overview

Render the description as a second line per row, clamped to three items with a tap-to-expand, without disturbing the single-instance edit state or the row height of the descriptionless majority.

### Changes Required

#### 1. Description item helpers

**File**: `src/lib/entry-description.ts` (new)

**Intent**: Own the item separator and the split, so the day list's three-item clamp and Phase 4's composer cannot drift apart. In `src/lib/` rather than beside the components because both a receipt component and an entry component consume it.

**Contract**: Exports `DESCRIPTION_ITEM_SEPARATOR = " · "` and `splitDescriptionItems(description: string): string[]` — splits on the separator, trims each part, drops empties. A manual free-text description with no separator yields a single-element array, which is what keeps the clamp inert for manual entries.

Note in the module header that a manual description containing ` · ` verbatim will be read as multiple items. That is an accepted, harmless degradation — it clamps and offers an expand — and calling it out is cheaper than defending against it.

#### 2. Day list row

**File**: `src/components/entries/DayEntriesList.tsx`

**Intent**: Show the description under the category name, clamped to the first three items with a `+N` toggle that expands that one row. Rows without a description are unchanged, so the list S-07 decluttered does not regress for manual entries.

**Contract**: New `expandedIds: Set<number>` state — a set, not a single id, because unlike editing there is no reason two rows cannot be expanded at once, and unlike editing there is no shared error state to land on the wrong row. The description renders inside the existing left-hand `<span>`'s parent, restructured to a two-line column: category icon + name on line one, description on line two in `text-muted-foreground text-xs`. The amount and the two action buttons keep their position on the right, vertically centred against the taller row.

The `+N` toggle renders **only when items are hidden** — with ≤3 items no toggle appears, mirroring the S-07 rule that `Pokaż więcej` must not render when nothing is hidden (`dashboard-category-management/plan.md:268`). It is a `<button type="button">` with a Polish `aria-label` and `aria-expanded`, sized to stay inside the row rather than becoming a third 44px control competing with Edytuj and Usuń.

The description is not rendered while that row is in edit mode — the edit form already carries the field.

### Success Criteria

#### Automated Verification

- Type check passes: `npx tsc --noEmit`
- Linting passes: `npm run lint` (`jsx-a11y` covers the new toggle's accessible name)
- Production build passes: `npm run build`
- The helper is genuinely shared and not re-implemented: `grep -rn '" · "' src/ --include=*.tsx` returns no hits outside `src/lib/entry-description.ts`

#### Manual Verification

- An entry with a one-item description shows it on a second line with no toggle
- An entry with five items shows three plus a `+2` toggle; tapping expands that row in place and collapses again
- Expanding one row does not expand or shift any other row
- An entry with no description renders exactly as it does today — same single-line height
- Navigating to another day and back collapses everything (the `key={selectedDate}` remount)
- Opening the edit form on an expanded row, then cancelling, leaves the row readable
- A long single-item description does not push the amount or the action buttons off-screen at 360px width
- The day's `Wydatki` / `Przychody` totals are unaffected

**Implementation Note**: pause here for manual confirmation before starting Phase 3.

---

## Phase 3: The receipt's own date

### Overview

Turn `parsed.receiptDate` from an amber hint into the pre-selected save date, editable on the panel, with the calendar day one tap away — and make the confirmation message name the day the entries actually landed on.

### Changes Required

#### 1. Review panel date control

**File**: `src/components/receipts/ReceiptReview.tsx`

**Intent**: Replace the read-only *"Wpisy trafią na: <date>"* line and its sibling amber hint with an editable date field whose initial value prefers the receipt's own date. This softens S-06's explicit "never an automatic date change" guard, so the replacement has to keep the date visible at confirm time and the revert cheap.

**Contract**: New `saveDate` state initialised from `parsed.receiptDate` when that value is present **and not after today**, else from the `occurredOn` prop. A `<Label>` + `<Input type="date" className="h-11 min-h-11">` renders it, matching the inline edit form's native-date-input precedent (`DayEntriesList.tsx:194-207`). When `saveDate !== occurredOn`, a one-tap button offers a revert to the calendar day, labelled with that date. Both confirm handlers (`handleConfirmItems`, `handleConfirmTotal`) pass `saveDate` up; `onConfirm`'s signature widens to carry it.

The initialiser is the load-bearing part, so it gets a snippet:

```ts
// Prefer the paragon's own date — the model reads header fields far more
// reliably than line items — but NEVER adopt one in the future. A misread year
// is the failure that files a receipt somewhere the calendar cannot casually
// reach, which is the risk S-06's hint-only guard was protecting against.
const [saveDate, setSaveDate] = useState(() =>
  parsed.receiptDate !== null && parsed.receiptDate <= occurredOn ? parsed.receiptDate : occurredOn,
);
```

The comparison is a lexicographic string compare on `YYYY-MM-DD`, which is correct for this format and needs no date parsing. `occurredOn` stands in for "today" here because the calendar cannot select a future day — state that in the comment so the next reader does not "fix" it into a `new Date()` call, which would reintroduce the timezone question `date-utils.ts` already settled.

The amber hint is retained only for the case the initialiser rejects: a `receiptDate` after `occurredOn`. Reword it so it explains why the date was *not* adopted rather than telling the user to move the calendar.

#### 2. Capture wrapper

**File**: `src/components/receipts/ReceiptCapture.tsx`

**Intent**: Send the panel's chosen date rather than the live `occurredOn` prop, and name that date in the success message — a receipt filed to yesterday deliberately does not appear in today's list, and silence there reads as a failed save.

**Contract**: `handleConfirm` takes the date as a second parameter and puts it in the POST body's `occurredOn`. `savedCount` becomes a `{ count: number; date: string }` shape (or a sibling `savedDate` state) so the message reads e.g. `Zapisano wpisy z paragonu (4) na 2026-08-17.` The comment at `:186-192` explaining why `occurredOn` is read at click time needs updating: it is now read from the panel's field, and the reason it is still not captured at parse time is unchanged.

**Note**: `DayView.handleBatchSaved` needs no change. Its `selectedDateRef` filter (`DayView.tsx:144`) already declines to splice entries belonging to another day, and the calendar refresh key it bumps is what repaints that other day's marking. Verify this rather than assuming it.

### Success Criteria

#### Automated Verification

- Type check passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- The batch endpoint's contract did not change: `git diff src/lib/services/entries.ts src/pages/api/receipts/entries.ts` is empty for this phase

#### Manual Verification

- A receipt whose printed date is in the past pre-selects that date; the field shows it and the revert button offers the calendar day
- Confirming files the entries to the receipt's date — verified in Supabase Studio and by navigating the calendar to that day
- The success message names the date, and the calendar's marking for that day updates
- A receipt whose printed date equals the calendar day shows no revert button and no hint
- A receipt with an unreadable date (`receiptDate: null`) defaults to the calendar day, exactly as today
- A receipt with a printed date **after** today keeps the calendar day and explains why
- Editing the date by hand and then confirming uses the hand-typed value
- Moving the calendar mid-review does not clobber a date the user has already chosen on the panel
- The total-only path files to the same chosen date

**Implementation Note**: pause here for manual confirmation before starting Phase 4. This is the phase that can misfile a whole receipt, so verify the wrong-day cases specifically, not just the happy path.

---

## Phase 4: Per-category fold at confirm

### Overview

Reduce the reviewed rows by category immediately before the POST, compose each group's description from its `name amount` pairs, show the user what will be saved, and record in `accuracy-log.md` why the fold does not invalidate its baseline. Fix the code-point truncation defect that the composer makes reachable.

### Changes Required

#### 1. Code-point-safe truncation

**File**: `src/lib/text.ts` (new)

**Intent**: One truncation used by both the parser and the composer. `String.prototype.slice` cuts by UTF-16 code unit, so a cut landing between surrogates emits a lone surrogate PostgREST cannot store — which fails the whole atomic batch, not one line.

**Contract**: `truncateCodePoints(value: string, maxCodePoints: number): string` — returns `value` unchanged when short enough, otherwise the first `maxCodePoints` code points. `[...value]` iterates by code point, which is what makes this correct; note in the header that this is deliberately not grapheme-cluster-aware (that would need `Intl.Segmenter` and is not what the database bound counts). The `check (char_length(description) <= 200)` constraint counts characters as Postgres does, which for our purposes is code points — so this is the unit that matters.

**File**: `src/lib/services/receipts.ts`

**Intent**: Replace `name.slice(0, NAME_MAX)` at `:161` with the new helper, closing the open review residue.

**Contract**: One-line substitution plus an import. No behaviour change for any name under the bound.

#### 2. Grouped description composer

**File**: `src/lib/entry-description.ts`

**Intent**: Turn a category's reviewed lines into one description that keeps each item's name and its amount, fits the 200-character bound, and is safe to store.

**Contract**: `composeGroupedDescription(items: { name: string; amount: number }[]): string | null`.

- Each item renders as `<name> <amount>`, where the amount uses a new bare comma-decimal formatter (below) and carries no currency symbol — the row already shows one, and `zł` repeated per item is noise.
- Names are stripped of the separator so an item cannot fake a boundary and the split stays lossless.
- Items join with `DESCRIPTION_ITEM_SEPARATOR`.
- Composition drops whole items from the tail until the result fits 200 code points, rather than cutting mid-item; a `+N` marker records how many were dropped so nothing vanishes silently. If even one item cannot fit, that item's name is truncated via `truncateCodePoints`.
- Returns `null` when every name is blank, so a nameless group stores `NULL` rather than a string of bare amounts.

The tail-dropping is the non-obvious rule: cutting mid-item would store `"Mleko 3,4"` and read as a wrong price, which is worse than storing fewer items.

**File**: `src/lib/format.ts`

**Intent**: A bare amount formatter for use inside descriptions. Belongs here because this module is the repo's stated single source of number formatting, with its `Intl` instances at module scope.

**Contract**: `formatAmountPlain(amount: number): string` over a new module-scope `Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` — comma decimal, no currency symbol. Header comment distinguishes it from `formatCurrencyCompact`, which drops precision.

#### 3. The fold

**File**: `src/components/receipts/ReceiptReview.tsx`

**Intent**: Group the reviewed rows by `categoryId` at confirm time and post one item per category. Review stays one row per printed line, which is what keeps FR-012's per-line correction and the accuracy log's per-line columns intact.

**Contract**: `handleConfirmItems` reduces `evaluated` by `categoryId` — preserving first-appearance order so the saved order tracks the receipt — into one `ConfirmItem` per group with `amount: roundToCents(<sum of the group's amounts>)` and `description: composeGroupedDescription(<the group's rows>)`. `createEntriesBatch` then assigns `batch_seq` from the grouped array index, so the idempotency key stays well-defined and a retry still dedupes.

Round **once, on the sum** — not per item then again on the total — so the grouped amounts still add up to the panel's displayed `Suma pozycji`, which is itself `sumItems` over the ungrouped rows. Any other order can drift by a cent and turn a matching sum check into a stored mismatch.

The existing hard blocks (`missingCategory`, `invalidAmount`) and the soft sum-mismatch acknowledgement are unchanged and still evaluated over the ungrouped rows. The 100-item batch cap is unchanged and now strictly slacker, since grouping can only reduce the count.

**Intent (preview)**: Show what will actually be saved, so a 12-line receipt collapsing to 4 entries is a stated outcome rather than a surprise.

**Contract**: A summary block above the confirm buttons listing one line per category group — icon, name, summed amount, item count — rendered from the same grouping the confirm uses so the two cannot disagree. Derive the grouping once in the component body and consume it from both places; do not compute it twice.

#### 4. Accuracy-log note

**File**: `context/archive/2026-08-16-receipt-parsing/accuracy-log.md`

**Intent**: Record that the fold happens **after** review, so every column in the log still measures the parse and the unfilled baseline stands. The roadmap's S-10 risk line assumed grouping in the parse; the note is what retires that risk with a reason instead of leaving it open for whoever finally fills the log.

**Contract**: A short dated paragraph immediately after the "How to fill a row" table, before "## Log". It must state: grouping is a client-side fold at confirm time; the review panel still shows one row per printed line; `Poz.`, `Ekstrakcja` and `Kategoryzacja` are therefore unchanged in meaning and are still filled from the paper against the review screen; and that what changed is only how many `entries` rows a confirm writes. No table is reset and no column is added.

This writes into an archived change folder, which the archive convention otherwise treats as frozen — do it anyway, by decision, because the log is a live instrument that happened to be archived unfilled. Note that in the paragraph so it does not read as an accident.

### Success Criteria

#### Automated Verification

- Type check passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- `npx supabase test db` still green, unchanged (proves no schema drift was needed)
- The truncation defect is closed: `grep -n "slice(0, NAME_MAX)" src/lib/services/receipts.ts` returns nothing
- The grouping is defined once: `grep -c "categoryId" src/components/receipts/ReceiptReview.tsx` shows no second reduce, and the preview and the confirm read the same derived value
- Server contract untouched: `git diff src/lib/services/entries.ts src/pages/api/receipts/entries.ts` is empty for this phase

#### Manual Verification

- A receipt with several lines in one category saves as **one** entry at their summed amount
- That entry's description shows the first three `name amount` pairs plus a `+N`, and expands to the rest (Phase 2's clamp, now with real grouped data)
- A receipt with one line per category saves the same number of entries as lines, with descriptions unchanged in substance from today
- Re-assigning one line to a different category during review moves it to that group in the preview before the confirm
- Removing a line during review removes it from its group; removing the last line in a group removes the group
- The preview's per-group amounts sum to the panel's `Suma pozycji`, to the cent
- A receipt with more than 200 characters' worth of names in one category stores a description ending in a `+N` marker, with no mid-item cut and no 500
- A receipt containing an item name with an emoji or other non-BMP character saves without a 500 (the truncation defect, exercised directly)
- The sum-mismatch acknowledgement still blocks and still unblocks
- The total-only path still saves one entry with `"Paragon"` and is still available while the item confirm is hard-blocked
- **Idempotency, re-verified**: confirm a grouped receipt, then replay the same confirm (throttle the network and retry, or resend the request) — no duplicate entries, and the response reports the same count
- A confirm whose category was soft-deleted between parse and confirm still 404s with a category-scoped message rather than partially writing

**Implementation Note**: the idempotency and soft-delete checks are permanently manual-only for the reason given in `entries.ts:186-204` — pgTAP cannot reach the service layer. Re-run them on any future change to `createEntriesBatch` or to the fold.

---

## Testing Strategy

There is no test framework in this repo (no vitest/playwright/jest, no test script, no test files). Automated verification is therefore `astro sync` → `tsc --noEmit` → `npm run lint` → `npm run build`, plus `npx supabase test db` for the database layer and the grep-based gates named per phase. That is the merge gate, and the S-06 review recorded its known gap: lint and build both passed against a broken intermediate state and only `tsc --noEmit` caught it — which is why the type check is listed explicitly in every phase rather than assumed to be part of the build.

### Database tests

No new pgTAP file and no edit to an existing one. `supabase/tests/entries_description_test.sql` passing **unchanged** is this slice's evidence that the column needed nothing — an edit to it would destroy that evidence, exactly as `entries_rls_test.sql` had to stay untouched across the description migration.

### Permanently manual-only (pgTAP cannot reach these)

Per `context/foundation/lessons.md`, every invariant enforced in TypeScript needs naming as manual-only, and this slice adds three:

1. `updateEntry` writes `description`; an omitted field is a 400, not a silent wipe.
2. `composeGroupedDescription` produces a value that satisfies both the zod bound and the `check` constraint, including for non-BMP input.
3. The fold's grouped amounts equal the reviewed sum to the cent, and `batch_seq` over the grouped array keeps the confirm idempotent.

### Whole-slice manual script

Run after Phase 4, on a phone-sized viewport, against the local stack (`npx supabase start -x vector` after `npm ci`; read the dev port from the `astro dev` banner rather than assuming 4321):

1. Log an expense with no description; log one with a description. Both appear correctly in the day list.
2. Edit the second: change only the amount — the description survives. Clear the description — it disappears.
3. Photograph or upload a receipt with at least two lines sharing a category and a readable printed date in the past.
4. Confirm the pre-selected date is the receipt's, revert it to the calendar day, then set it back.
5. Re-assign one line's category, remove another, check the preview tracks both.
6. Confirm. Check the success message names the date, the calendar marks that day, and navigating there shows one entry per category with grouped descriptions.
7. Expand a grouped description, collapse it, then edit that entry's description by hand and save.
8. Re-verify the ≤4-interaction / ≤10s budget for a routine expense with everything in place.

### Regression surface deliberately re-checked

- The soft-deleted-category edit path (standing S-07 item, and Phase 1 touches the schema that governs it).
- The receipt confirm's idempotency (S-06 F4's fix, and Phase 4 changes what `batch_seq` indexes).
- The day list's non-nulling category refresh — `refreshAfterCategoryMutation` must still not produce a loading flash now that rows are taller (`DayView.tsx:191-194`).

## Performance Considerations

Nothing here changes a query, adds a round trip, or moves a computation across the network boundary. Three notes:

- The fold **reduces** the number of rows a receipt writes, so the batch insert gets strictly cheaper and the 100-item cap gets strictly slacker.
- `composeGroupedDescription` and the preview grouping both run per render in the review panel. Receipts are bounded at 100 items, so this is trivial — but derive the grouping once and share it between the preview and the confirm rather than recomputing, which is a correctness requirement (they must not disagree) that happens to also be the faster shape.
- `formatAmountPlain`'s `Intl.NumberFormat` goes at module scope, per `format.ts:1-3`. Constructing one per item per render is the specific mistake that comment exists to prevent.

## Migration Notes

**No migration.** Nothing in this slice touches the schema, which means:

- No CI ordering constraint. The `deploy` job applies migrations between the build and `wrangler deploy`, so a schema change here would have to be backward-compatible with the previous Worker — moot when there is none.
- No new constraint on the owed `category-color-drop` follow-up. It remains required and remains separate.

**Existing data is unaffected and not backfilled.** Entries already written by S-06 carry one description per printed line; they stay exactly as they are. The day list renders them as one-item descriptions with no toggle, which is correct — they *were* one line each. No attempt is made to retro-group historical receipt entries: `batch_id` would make it technically possible, but rewriting stored financial rows to match a new presentation is not a migration, it is data loss with extra steps.

## References

- Change identity and seeded notes: `context/changes/entry-descriptions-and-receipt-grouping/change.md`
- Roadmap item S-10: `context/foundation/roadmap.md`
- PRD requirements: FR-006, FR-009, FR-012, FR-017 in `context/foundation/prd.md`
- The description column, the total-only shortcut, the accuracy log, and the `batch_id` idempotency fix: `context/archive/2026-08-16-receipt-parsing/`
- The inline-edit decision and the update schema this slice opens up: `context/archive/2026-08-15-income-and-entry-management/`
- The day list's current shape and the `Pokaż więcej` collapse rules this slice's `+N` toggle mirrors: `context/archive/2026-08-17-dashboard-category-management/plan.md:266-272`
- Open review residue, including the truncation defect Phase 4 fixes: `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:232-236`
- Manual-only invariant rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Description as a first-class field

#### Automated

- [x] 1.1 `npx astro sync` succeeds — a9926d7
- [x] 1.2 Type check passes: `npx tsc --noEmit` — a9926d7
- [x] 1.3 Linting passes: `npm run lint` — a9926d7
- [x] 1.4 Production build passes: `npm run build` — a9926d7
- [x] 1.5 `npx supabase test db` passes with `entries_description_test.sql` unchanged — a9926d7
- [x] 1.6 No migration added: `git status --short supabase/migrations/` is empty — a9926d7
- [x] 1.7 Reversed rationale rewritten: `grep -n "records where the entry came from" src/lib/services/entries.ts` returns nothing — a9926d7

#### Manual

- [x] 1.8 Expense with a description saves it — a9926d7
- [x] 1.9 Untouched description field stores `NULL`, not `""` — a9926d7
- [x] 1.10 Amount-only edit leaves the description intact — a9926d7
- [x] 1.11 Cleared description stores `NULL` — a9926d7
- [x] 1.12 Entry under a soft-deleted category still saves — a9926d7
- [x] 1.13 A 201-character description is a 400, not a 500 — a9926d7
- [x] 1.14 Tap-budget re-count: routine expense still 3 interactions and ≤10s — a9926d7

### Phase 2: Descriptions visible in the day list

#### Automated

- [x] 2.1 Type check passes: `npx tsc --noEmit` — 3497d90
- [x] 2.2 Linting passes: `npm run lint` — 3497d90
- [x] 2.3 Production build passes: `npm run build` — 3497d90
- [x] 2.4 Separator not duplicated: `grep -rn '" · "' src/ --include=*.tsx` has no hits outside `src/lib/entry-description.ts` — 3497d90

#### Manual

- [x] 2.5 One-item description renders with no toggle — 3497d90
- [x] 2.6 Five-item description shows three plus `+2`, expands and collapses — 3497d90
- [x] 2.7 Expanding one row does not affect another — 3497d90
- [x] 2.8 Descriptionless rows keep today's single-line height — 3497d90
- [x] 2.9 Day navigation collapses everything — 3497d90
- [x] 2.10 Edit-then-cancel on an expanded row leaves it readable — 3497d90
- [x] 2.11 A long description does not push the amount or actions off-screen at 360px — 3497d90
- [x] 2.12 Day totals unaffected — 3497d90

### Phase 3: The receipt's own date

#### Automated

- [x] 3.1 Type check passes: `npx tsc --noEmit` — dc5698b
- [x] 3.2 Linting passes: `npm run lint` — dc5698b
- [x] 3.3 Production build passes: `npm run build` — dc5698b
- [x] 3.4 Batch contract untouched: `git diff src/lib/services/entries.ts src/pages/api/receipts/entries.ts` is empty — dc5698b

#### Manual

- [x] 3.5 Past printed date is pre-selected, with a revert to the calendar day — dc5698b
- [x] 3.6 Confirm files entries to the chosen date — dc5698b
- [x] 3.7 Success message names the date; calendar marking updates — dc5698b
- [x] 3.8 Printed date equal to the calendar day shows no revert and no hint — dc5698b
- [x] 3.9 Unreadable date defaults to the calendar day — dc5698b
- [x] 3.10 Printed date after today keeps the calendar day and explains why — dc5698b
- [x] 3.11 Hand-typed date is the one used — dc5698b
- [x] 3.12 Moving the calendar mid-review does not clobber a chosen date — dc5698b
- [x] 3.13 Total-only path files to the same chosen date — dc5698b

### Phase 4: Per-category fold at confirm

#### Automated

- [x] 4.1 Type check passes: `npx tsc --noEmit` — 77f0e7a
- [x] 4.2 Linting passes: `npm run lint` — 77f0e7a
- [x] 4.3 Production build passes: `npm run build` — 77f0e7a
- [x] 4.4 `npx supabase test db` still green and unchanged — 77f0e7a
- [x] 4.5 Truncation defect closed: `grep -n "slice(0, NAME_MAX)" src/lib/services/receipts.ts` returns nothing — 77f0e7a
- [x] 4.6 Grouping derived once and shared by the preview and the confirm — 77f0e7a
- [x] 4.7 Server contract untouched: `git diff src/lib/services/entries.ts src/pages/api/receipts/entries.ts` is empty — 77f0e7a

#### Manual

- [x] 4.8 Several lines in one category save as one summed entry — 77f0e7a
- [x] 4.9 Grouped description clamps to three items and expands — 77f0e7a
- [x] 4.10 One line per category saves one entry per line — 77f0e7a
- [x] 4.11 Re-assigning a line moves it between groups in the preview — 77f0e7a
- [x] 4.12 Removing lines updates and can remove a group — 77f0e7a
- [x] 4.13 Preview amounts sum to `Suma pozycji` to the cent — 77f0e7a
- [x] 4.14 Over-long grouped names store a `+N` tail with no mid-item cut and no 500 — 77f0e7a
- [x] 4.15 A non-BMP character in an item name saves without a 500 — 77f0e7a
- [x] 4.16 Sum-mismatch acknowledgement still blocks and unblocks — 77f0e7a
- [x] 4.17 Total-only path unchanged and still available while blocked — 77f0e7a
- [x] 4.18 Replayed confirm writes no duplicates and reports the same count — 77f0e7a
- [x] 4.19 Soft-deleted category between parse and confirm 404s without partial write — 77f0e7a
- [x] 4.20 `accuracy-log.md` carries the dated fold note — 77f0e7a
