# Entry descriptions, and one entry per category from a receipt — Plan Brief

> Full plan: `context/changes/entry-descriptions-and-receipt-grouping/plan.md`

## What & Why

Make `entries.description` a field the user can write, read and correct, and change a receipt confirm so it writes **one entry per category** — dated from the receipt itself — instead of one entry per printed line. The column has existed since S-06 and has been written on every receipt confirm since, visible nowhere: this slice is the display-and-edit half that was deliberately scoped out then (FR-017, FR-009), plus the one real behaviour change (FR-012).

## Starting Point

`entries.description` is `text check (char_length(description) <= 200)`, nullable, already covered by a passing pgTAP suite. `createEntrySchema` already accepts it and `createEntry` already writes it — `EntryForm` just never sends it. `updateEntrySchema` deliberately excludes it, with a written rationale this slice reverses. Nothing in `src/` renders it. `ParsedReceipt.receiptDate` is already parsed and validated but never persisted — it surfaces only as an amber hint, behind an explicit S-06 guard reading *"a hint, never an automatic date change."* The confirm payload is assembled entirely client-side in `ReceiptReview.handleConfirmItems`, and `batch_seq` comes from the array index server-side.

## Desired End State

Manual entry offers an optional **Opis** field as its last input. Every entry with a description shows it as a muted second line in "Wpisy tego dnia", clamped to three items with a `+N` tap-to-expand, and correctable (or clearable) in the inline edit form. Confirming a receipt writes one entry per category at the summed amount, described by that group's `name amount` pairs, filed to the receipt's own printed date with the calendar day one tap away — while review itself still shows one row per printed line, so every line's category and amount stay individually correctable.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where grouping happens | A client-side fold at confirm time | Keeps FR-012's per-line correction, needs zero server change, and leaves `accuracy-log.md`'s per-line columns measuring the parse | Plan |
| Total-only shortcut | Keep, unchanged | It is the only exit from a hard-blocked confirm, which the "never left without a way forward" NFR depends on | Plan |
| Grouped description content | Item names **with** amounts, ` · `-joined | The group is fully reconstructable from the row alone | Plan |
| Over-long descriptions | Drop whole items from the tail with a `+N` marker | Cutting mid-item would store `"Mleko 3,4"` and read as a wrong price | Plan |
| Receipt date | Pre-selected on the panel, editable, never adopted if in the future | Leans on the model's most reliable field while keeping the misfiling risk S-06 guarded against off the table | Plan |
| Manual description input | Always visible, last field before submit | Costs zero taps when skipped and stays off the amount→chip→save path | Plan |
| Day-list rendering | Second line, clamped to 3 items, tap to expand | Delivers the outcome without regressing the row height S-07 just decluttered | Plan |
| Edit path | A field in the existing inline edit form, clearable | One correction surface per entry; clearing is the only way to remove a wrong generated description | Plan |
| PATCH field semantics | `description` required-but-nullable | An omitted field in a full-replace body would silently wipe a stored value; this makes it a 400 | Plan |
| Accuracy log | A dated note in `accuracy-log.md` itself | The person who finally fills the log reads that file, not this plan | Plan |
| Delivery | All four phases, no cut line | The outcome is delivered whole | Plan |

## Scope

**In scope:** the description field on manual entry; description display with a three-item clamp in the day list; description correction and clearing via the inline edit form; opening `updateEntrySchema`; the per-category fold at confirm; a "what will be saved" preview; the receipt date as the pre-selected save date; the dated note in `accuracy-log.md`; and one open review defect — the code-point-unsafe truncation at `receipts.ts:161` that the composer makes reachable.

**Out of scope:** any migration or new pgTAP file; editable line-item names during review; retiring or restyling the total-only shortcut; a group/don't-group toggle; persisting `receiptDate` as a column; backfilling or retro-grouping existing receipt entries; every other open S-06 review item (rate limiting, receipt text in Workers Logs, the `api-error.ts` cast, the forwarded part `Content-Type`, missing zod on the gateway response); replacing `window.confirm`; the owed `category-color-drop` follow-up.

## Architecture / Approach

No schema change and no new endpoint. The service layer gains one field on its update path; everything else is UI plus two small shared modules — `src/lib/entry-description.ts` (the item separator, the composer, the splitter) and `src/lib/text.ts` (code-point-safe truncation). Both exist because the receipt panel and the day list have to agree on the separator, and because this repo has a documented history of duplicated arithmetic drifting apart and *causing* numeric bugs (S-04 F4, S-06 F10). The grouping is derived once in the review panel and consumed by both the preview and the confirm, so the two cannot disagree.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Description as a field | Writable on create, correctable on update, on both write surfaces | A full-replace PATCH that silently wipes descriptions; the ≤4-interaction budget has one tap of slack |
| 2. Descriptions in the day list | Second line, three-item clamp, tap to expand | Row height regressing the list S-07 just decluttered |
| 3. The receipt's own date | Parsed date pre-selected and editable, named in the success message | The one change that can misfile a whole receipt — softens an explicit S-06 guard |
| 4. Per-category fold | One entry per category, grouped descriptions, preview, log note | A mid-code-point cut fails the whole atomic batch, not one line; `batch_seq` now indexes the grouped array |

**Prerequisites:** S-03 and S-06, both done and archived. Local stack running (`npm ci` **before** any `npx supabase` — an unpinned CLI strips the database's own grants; then `npx supabase start -x vector`). Read the dev port from the `astro dev` banner rather than assuming 4321.

**Estimated effort:** ~2–3 sessions across four phases. Phases 1 and 2 are small and mechanical; 3 and 4 each need a real photographed receipt to verify.

## Open Risks & Assumptions

- **Phase 3 softens a guard S-06 wrote deliberately.** The mitigation is that the date is on screen in an editable field at confirm time and is never adopted from the future — but a user who does not read the field can still file a receipt to a day they did not intend, which is exactly the outcome the hint-only design prevented.
- **The three-item clamp splits on ` · `.** A manual free-text description containing that sequence verbatim will be read as multiple items. Accepted: it clamps and offers an expand, so the degradation is cosmetic.
- **Grouping makes a wrong category more expensive to notice after the fact.** A miscategorised line is now folded into a group's total rather than sitting as its own row, so the description is the only record of what went in — which is precisely why it carries amounts as well as names.
- **`accuracy-log.md` is still unfilled**, so FR-011's Secondary success bar still has no recorded answer. This slice does not measure it; it only records that the fold left the instrument valid.
- **The merge gate cannot catch a broken intermediate state on its own.** S-06's review found lint and build both passing against one; only `tsc --noEmit` caught it, which is why the type check is listed explicitly in all four phases.

## Success Criteria (Summary)

- A user can say what an entry was — typing it themselves, or correcting what a receipt generated — and read it back in the day list.
- A photographed receipt becomes one entry per category, filed to the day printed on the paper, with the individual items still legible in each entry's description.
- The routine manual expense still takes three interactions and under ten seconds.
