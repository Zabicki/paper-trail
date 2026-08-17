# Receipt Parsing (S-06) — Plan Brief

> Full plan: `context/changes/receipt-parsing/plan.md`
> Research: `context/changes/receipt-parsing/research.md` · decisions surface: `research-recommendations.md`

## What & Why

Photograph a Polish paragon fiskalny and get its line items back pre-assigned to *your own* categories, correct anything wrong, then confirm. This is the product differentiator — the PRD's Business Logic section names it as "the decision that distinguishes this product" — and the only must-have slice still unbuilt. It delivers US-02, FR-010, FR-011 and FR-012.

## Starting Point

Five slices are done; the ledger, categories and both charts exist. The repo was deliberately prepared for this one: the Cloudflare Images binding is already provisioned for receipt downscaling, and `deploy-plan.md` pre-wrote the LLM-key procedure. Two real gaps remain — `entries` has no text column for a parsed item name, and `createEntry()` inserts exactly one row behind a per-entry validation round trip. No LLM provider is contracted and no key is held.

## Desired End State

On `/dashboard`, below the manual entry form, a collapsed **Paragon** section opens to a disclosure and a file picker. A photo is downscaled in the browser, parsed in under 30 seconds with visible progress, and returned as a review panel: each item with a read-only name, an editable amount, and a category chip. A footer compares the item sum against the printed `SUMA PLN`. Confirm writes every item to the calendar's selected day in one atomic request. A second button collapses the whole receipt into one entry at the printed total. No image is ever stored.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Provider routing | Cloudflare AI Gateway REST + Unified Billing | One Cloudflare token, provider swap is a one-string change, and paid-by-construction (Gemini's terms bar the free tier for EEA users). | Research |
| Model | Gemini 3.x Flash, single exported constant | Best published line-item score and the only vendor documenting `pl` — but an explicit hypothesis, not a measurement. | Research |
| Image storage | Store nothing | In-memory `File` → model → discarded; dissolves the retention NFR by construction. | Research |
| Accuracy gate | **No spike — ship and self-assess** | Operator will judge accuracy from real use over the first weeks and return with findings. | Plan |
| Line-item names | Add nullable `description text` | Keeps a wrong categorisation diagnosable; additive migration is CI-safe. Not displayed anywhere yet. | Plan |
| Total-only path | **Built from day one**, not held as a fallback | Header fields score 0.87–0.91 while line items score 0.49–0.58, so the reliable half deserves its own button — and it doubles as the exit from a blocked sum check. | Plan |
| Batch write | Service-layer batch, 2 round trips | Keeps both app-layer-only invariants where `lessons.md` says they must be re-verified by hand; one insert statement, therefore atomic. | Plan |
| Discounts | Prompt folds `RABAT`/`OPUST` into the item price; non-positive items dropped with a visible count | `amount > 0` means a discount row is literally unstorable. | Plan |
| Sum mismatch | **Blocks confirm** until reconciled or explicitly acknowledged | Makes bad data a deliberate choice, per the no-silent-bad-writes guardrail. Never auto-corrected. | Plan |
| Placement | Inside `DayView` on `/dashboard`; entries file to the selected calendar day | No new page, so `PROTECTED_ROUTES` is untouched; back-dating reuses the existing calendar. | Plan |
| Timeout | 30s via `AbortSignal.timeout()` | No wall-clock cap on Workers, so this is a product choice; retune from Phase 4's measured latency. | Plan |
| Workers plan | Stay Free; decide after watching Workers Logs | Client downscale + `Buffer` base64 should hold the 10 ms budget; measure before spending. | Plan |

## Scope

**In scope:** nullable `description` migration · `createEntriesBatch()` + `POST /api/receipts/entries` · AI Gateway integration, secrets, config banner, Images binding · `POST /api/receipts/parse` · browser downscale · review UI with blocking sum check · total-only path · disclosure copy · a live accuracy assessment log.

**Out of scope:** image storage of any kind · a `/receipts` page · showing `description` in existing list/edit UI · editable item names · income receipts · OCR pre-stage · provider A/B switcher · Workers plan upgrade · receipt history.

## Architecture / Approach

```
Browser (React island in DayView)
  File → createImageBitmap → OffscreenCanvas → JPEG q0.8 @1568px
    └─ multipart POST /api/receipts/parse
         Worker: env.IMAGES safety net (gated on free .info())
                 → Buffer base64 → AI Gateway (cf-aig-collect-log-payload: false)
                 → zod validate → drop non-positive, clamp, null unknown categoryId
    ←─ ParsedReceipt { receiptDate, total, items[], droppedItems }
  Review panel: edit amounts + categories, sum check computed client-side
    └─ POST /api/receipts/entries → one RLS-scoped category select + one multi-row insert
```

The image never touches disk, a database, or a log store. The sum check lives client-side precisely so it recomputes as the user edits.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema and batch write path | `description` column, `createEntriesBatch()`, confirm endpoint | Batch path must replicate two invariants pgTAP cannot prove |
| 2. Provider integration | Secrets, Images binding, receipts service, parse endpoint | Body logging is on by default — one header stands between this and stored receipt images |
| 3. Capture and review UI | Upload, downscale, review panel, sum check, total-only | Multi-second parse + multi-item review is the exact stale-async class flagged 3× in prior reviews |
| 4. Live accuracy assessment | Measurement log and a written go/no-go | The central risk of the whole slice, deliberately measured after shipping rather than before |

**Prerequisites:** Operator setup before Phase 2 — create the AI Gateway, buy Unified Billing credits, mint a token scoped **Account → Workers AI → Read** (an AI-Gateway-scoped token returns `401`), then `wrangler secret put` both keys and copy them into `.env` *and* `.dev.vars`.
**Estimated effort:** ~3–4 sessions across Phases 1–3, then a couple of weeks of real use for Phase 4.

## Open Risks & Assumptions

- **Accuracy on Polish paragony is unmeasured — by anyone.** No benchmark, dataset or study exists; the best receipt benchmark is 98% English with zero Polish samples. Shipping first means the risk is carried into production rather than retired up front. Phase 4 is the mitigation, and the total-only button is the hedge.
- **Faded thermal print is the dominant failure driver** and yields confident hallucinations, not blanks — the sum check is the only thing that catches it.
- **The exact Gateway model string is unverified.** The naming pattern is documented; the precise tier string must be confirmed at implementation.
- **The `Buffer` base64 margin is a Node measurement**, not a workerd one. Read the real CPU figure from Workers Logs before trusting it.
- **Filing to the wrong day** is the one high-cost mistake dashboard placement enables; mitigated by a hint when the receipt's printed date differs from the selected day, never by auto-changing it.

## Success Criteria (Summary)

- A photographed receipt becomes correctly-categorised entries on the right day, faster than typing them.
- Nothing is ever persisted without explicit confirmation, and a receipt whose numbers do not add up cannot be saved by accident.
- Parsing either returns within 30 seconds or fails visibly, always leaving manual entry available.
