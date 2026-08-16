# Receipt parsing (S-06) — decisions for planning

> Condensed from `research.md` (2026-08-16, commit `8833e5c`). Input for `/10x-plan` on S-06.
> Globals: currency PLN · UI copy Polish, routes/APIs English · receipts are Polish paragony fiskalne.
> Read `research.md` for evidence and citations; this file is the decision surface only.

## The one-line version

Cost is irrelevant ($0.03–$2.24/month across the whole field) — **pick on accuracy**. But nobody has ever
measured any model on Polish receipts, and the one thing that *is* measured is weakest exactly where this
feature lives. **Spike before committing the slice.**

## Decisions made

| Decision | Choice | Why (1 sentence) | Confidence |
| --- | --- | --- | --- |
| Provider routing | **Cloudflare AI Gateway REST API + Unified Billing** | Collapses setup to one Cloudflare token, makes provider swap a one-string change, and is paid-by-construction (see EEA constraint below). | High |
| Model (starting) | **Gemini 3.x Flash** | Best published Structure-Parsing score (0.578 vs GPT-5's 0.489) and the only vendor documenting `pl` for the model family itself. | **Hypothesis — unmeasured for Polish** |
| A/B candidates | `gemini-3.5-flash-lite`, `gpt-5-mini` | Flash-Lite is vendor-marketed for document parsing; gpt-5-mini is a genuine second vendor, not a second SKU. | Medium |
| Image storage | **Store nothing** — in-memory `File` in a React island → model → discarded | Confirms `infrastructure.md`'s proposal; dissolves the retention half of PRD OQ-3 by construction. | High |
| Downscaling | **Client-side to 1568px/JPEG q0.8, `env.IMAGES` as server-side safety net** | Client fixes the upload and the CPU budget; the binding catches HEIC, EXIF rotation, and oversized fallbacks free. | High |
| Base64 encoding | `Buffer.from(bytes).toString("base64")` | ~60× faster than the `btoa` + `String.fromCharCode` idiom every tutorial shows; `nodejs_compat` already on. | High |
| Timeout mechanism | `AbortSignal.timeout()` on `fetch` | Tears down the connection; `Promise.race` leaks the in-flight request. **First `AbortController` in the repo** — a deliberate departure from the `cancelled` closure guard. | High |
| SDK vs raw fetch | Raw `fetch` against the Gateway | One-shot call with a custom timeout; SDK retry/streaming helpers aren't load-bearing. Avoid `@google/genai` on workerd regardless (depends on Node `ws`). | High |
| Validation | **Deterministic sum-check in code**, delta surfaced to user, never auto-corrected | Highest-leverage item in the whole slice — worth more than model choice. | High |
| Rejected | AWS Textract, Google Document AI Expense Parser, Workers AI vision, Veryfi | First three have **no Polish**; Veryfi's $500/mo cliff sits just above our volume and its category isolation is outside the RLS boundary. | High |

## Blocking — needs an owner answer before the plan closes

1. **Does accuracy clear the Secondary bar?** (PRD OQ-4 / roadmap OQ-2) — unresolvable by research. Run the spike.
2. **Parsing timeout value** (PRD OQ-3, surviving half) — set from the spike's measured p95, don't guess.
3. **Do parsed line-item names get stored?** — see Constraint 1. Blocks the schema step, not the spike.
4. **Workers Free or Paid?** — Free's 10 ms CPU is tight; $5/mo is per *account*, amortised across future projects.
5. **Fallback scope acceptable?** — if the spike misses the bar, "one entry per receipt, total only, user picks
   category" is well within measured capability (header fields score 0.87–0.91) but is a **different product promise**.

## Constraints the plan must respect

1. **`entries` has no text column** — `id, user_id, category_id, type, amount, occurred_on, created_at`. Parsed item
   names have nowhere to go. Either review-only-then-discard, or a nullable `description text`; any migration must be
   **additive with a default**, since CI migrates between build and deploy.
2. **No multi-row insert path exists.** `createEntry()` is strictly one row. `assertCategoryUsable()` is a per-entry
   pre-flight round trip enforcing **two invariants the database does not** — ownership (FKs bypass RLS on the
   referenced table) and `type`↔`kind`. A naive loop costs 2N round trips; any batch path must replicate both, and both
   are **app-layer-only, unprovable by pgTAP** (name them in an explicitly-manual-only block).
3. **`amount` is `numeric(10,2) check (amount > 0)`** — a zero or negative line cannot be stored. Decides how
   `RABAT`/`OPUST` rows are handled.
4. **`category_id` is NOT NULL, no "uncategorised" escape hatch.** Every confirmed item resolves to a real category.
5. **`listCategories()` returns both kinds** — the prompt wants expense only. `name` is the only semantic signal;
   there is no description or keywords field to help classification.
6. **`cf-aig-collect-log-payload: false` on every Gateway request.** Body logging is on by default and would persist
   receipt images in Cloudflare's log store, contradicting the store-nothing design.
7. **Never put `image/heic` in `<input accept>`** — Safari 17+ inverts and converts *to* HEIC. Keep `accept="image/*"`.
8. **`env.IMAGES` needs `"images": { "binding": "IMAGES" }` added to `wrangler.jsonc`** — the adapter injects it at
   build time so `wrangler types` can't see it; the adapter skips injection when present, so it's idempotent.
9. **Add the receipt page to `PROTECTED_ROUTES`**; `/api/receipts/*` follows the self-guard pattern instead.
10. **Re-verify the ≤4-interaction / ≤10s budget on `/dashboard`** — every slice since S-02 carries this step.

## Spike protocol — run before committing the slice

- **Corpus**: 30–50 real paragony (Biedronka/Lidl/Żabka), **including ≥5 faded or crumpled** — faded thermal is the
  dominant failure driver and yields confident hallucinations, not blanks.
- **Models**: `gemini-3.7-flash`, `gemini-3.5-flash-lite`, `gpt-5-mini`. Total cost across all three: **under $0.10**.
- **Measure two things separately** — blurring them hides which half fails:
  1. **Extraction** — of the true line items, what fraction came back with correct name *and* amount?
  2. **Categorisation** — **of correctly-extracted items**, what fraction landed in the right category? ← *this is the
     PRD's Secondary criterion*.
- **Also record**: did `sum(items)` equal printed `SUMA PLN`; were `RABAT`/`OPUST` rows emitted as products; were
  `2 x 3,49` lines expanded; were comma decimals parsed; **wall-clock latency** (this sets the timeout constant).
- **Go/no-go**: below "majority correctly categorised", auto-assignment is *slower than typing* — the feature is
  failing, not imperfect. Fallbacks: Mistral OCR pre-stage (+$0.30/mo), total-only scope, or defer S-06.

## Manual setup — operator only

| # | Step |
| --- | --- |
| 1 | Create AI Gateway (or let `default` auto-create) |
| 2 | Purchase Unified Billing credits (5% fee on purchase; inference at cost) |
| 3 | API token scoped **Account → Workers AI → Read** — an AI-Gateway-scoped token returns `401` code `10000` |
| 4 | `npx wrangler secret put CF_AI_TOKEN` and `CF_ACCOUNT_ID` (the GitHub repo variable is build-time only) |
| 5 | Copy both into `.env` **and** `.dev.vars` — workerd reads the latter |
| 6 | Confirm Workers plan (see blocking Q4) |

Then, code-side: add each key to `astro.config.mjs` `env.schema` as `context: "server", access: "secret"` →
**`npx astro sync`** (mandatory, or lint fails) → add a `configStatuses` entry so a missing key hits the red banner
instead of failing at request time.

*Fallback path (direct Google): create an AI Studio account and **enable paid billing before the first call** — the
Gemini API terms permit only paid services for EEA users, so the free tier is unavailable even for testing.*

## Pre-empt these — recurring impl-review findings

| Theme | Flagged in | Why it bites here |
| --- | --- | --- |
| Stale async response lands in wrong UI state | S-02 F1, S-03 F2, S-03 F3 (escalating) | A multi-second parse plus a multi-item review screen is exactly this hazard class. |
| Missing `catch` on `fetch` | S-01 F6, S-03 F7 | Network rejection surfaces only as a console-logged unhandled rejection. |
| Copy-pasted helpers instead of extraction | S-02 F3, S-04 F4 | S-04's duplicated date arithmetic *directly caused* a numeric bug. |
| Files changed outside the plan's stated list | S-01 F4, S-02 F2, S-04 | Remedy both times was an `## Addendum`; state the file list precisely up front. |

## Disclosure copy — facts available

Receipt contents **and category names** leave the product (PRD NFR, non-optional). With the Gateway: sent to
Cloudflare and, through it, to the model provider. Paid-tier Gemini does **not** train on input; retention is up to
**55 days** for abuse monitoring. With `cf-aig-collect-log-payload: false`, Cloudflare retains metadata only.
