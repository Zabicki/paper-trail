# Receipt Parsing (S-06) Implementation Plan

## Overview

Photograph a Polish paragon fiskalny on `/dashboard`, get its line items back pre-assigned to your own expense categories, correct anything wrong, and confirm — at which point every item becomes an `entries` row in one atomic write. The image is never stored anywhere: it lives in an in-memory `File` in a React island, goes to the model, and is discarded.

This delivers US-02, FR-010, FR-011 and FR-012, plus the three NFRs the roadmap flags for this slice (retention, parsing timeout, disclosure).

## Current State Analysis

The repo is unusually well-prepared for this slice, and has exactly two real gaps.

**Already in place:**

- `astro.config.mjs:29-37` keeps the Cloudflare Images binding deliberately, with a comment naming receipt downscaling as the reason.
- `context/deployment/deploy-plan.md:134` pre-writes the LLM-key procedure: secret → `env.schema` → `config-status.ts`.
- API-route conventions are uniform and copyable (`src/pages/api/entries/index.ts:35-79`): client-null → `getUser()` → parse body → zod → service in try/catch → rethrow unknown. Error body is `{ error: string, field?: string }`, consumed by `parseErrorBody` (`src/lib/api-error.ts`).
- `listCategoriesForEntryForm(supabase, "expense")` (`src/lib/services/entries.ts:241`) already returns exactly the recency-ordered, live, expense-only category list the prompt needs.
- `CategoryPicker` (`src/components/entries/CategoryPicker.tsx`) is a self-contained controlled chip picker, reusable per review row without modification.
- `DayView` (`src/components/entries/DayView.tsx`) already holds `selectedDate`, `selectedDateRef`, the expense/income category lists, and the `calendarRefreshKey` — everything the receipt flow needs to mount inside it.

**Gap 1 — parsed line-item names have nowhere to go.** `entries` is `id, user_id, category_id, type, amount, occurred_on, created_at` (`supabase/migrations/20260815164539_create_entries_table.sql:7-15`). No description, note or merchant column. Resolved by decision: add a nullable `description text`.

**Gap 2 — there is no multi-row insert path.** `createEntry()` (`src/lib/services/entries.ts:120-138`) inserts exactly one row, and its `assertCategoryUsable()` pre-flight (`:91-118`) is a *per-entry round trip* enforcing two invariants the database does not:

1. **Ownership** — the FK on `entries.category_id` checks row existence only; Postgres FK constraints are not subject to RLS on the referenced table. Only this RLS-scoped `select` stops an entry attaching to another user's category.
2. **`type` ↔ `kind`** — nothing in the schema ties the two columns together.

A naive loop over N line items costs 2N round trips and is not atomic. Resolved by decision: a service-layer batch that replicates both invariants in one round trip.

**Hard constraints inherited from the schema:**

- `amount` is `numeric(10,2) check (amount > 0)` — a zero or negative line **cannot be stored**. This is what forces the `RABAT`/`OPUST` decision.
- `category_id` is `NOT NULL` with no "uncategorised" escape hatch. Every confirmed item must resolve to a real category.
- Categories are soft-deleted; the confirm path must only accept live ones.

## Desired End State

On `/dashboard`, below the manual entry form, a **Paragon** section offers a single button. Tapping it reveals a short disclosure and a file picker. Choosing a photo downscales it in the browser, uploads it, and shows continuous progress for up to 30 seconds.

On success, a review panel lists each parsed item: name, an editable amount, and a category chip pre-filled by the model. A footer compares the sum of the items against the printed `SUMA PLN` and shows the delta. Confirm writes every item to the calendar's currently selected day in one request; the day's list and the calendar marking update immediately.

If the items are unusable, a second button saves the whole receipt as **one** entry at the printed total with a category you pick. If parsing fails or times out, the panel says so plainly and the manual form directly above is untouched.

**Verify by**: photographing a real Biedronka receipt on `/dashboard`, confirming the items, and seeing them appear in "Wpisy tego dnia" with correct amounts — then reloading the page and confirming they persisted.

### Key Discoveries:

- **Cost is not a decision variable.** The whole candidate field spans $0.03–$2.24/month at 75 receipts. Choose on accuracy; the bill is a rounding error (`research.md` §B).
- **The measured weak spot is exactly this feature's hard half.** ReceiptBench puts line-item "Structure" extraction at 0.49–0.58 while header fields (date, total) score 0.87–0.91 (`research.md` §C). This asymmetry is *why* the total-only path exists as a first-class button rather than a fallback plan.
- **Deterministic validation outranks model selection.** Four independent sources converge: models tamper with line values to force the sum to match. Sum in code, show the delta, never auto-correct (`research.md` §C, Architecture Insights).
- **AI Gateway logs request bodies by default** — left alone it persists receipt images in Cloudflare's log store, silently contradicting the store-nothing design. `cf-aig-collect-log-payload: false` on every request (`research.md` §D).
- **`Buffer.from(bytes).toString("base64")` is ~60× faster** than the `btoa` + `String.fromCharCode` idiom every tutorial shows; 71.87 ms vs 1.19 ms on a 12 MB image, against a 10 ms Free-plan CPU budget (`research.md` §D).
- **`Date.now()` and `performance.now()` are frozen inside a Worker** — they return the time of the last I/O. Self-timing is impossible; read CPU and wall figures from Workers Logs.
- **Never put `image/heic` in `<input accept>`** — Safari 17+ inverts the behaviour and converts your JPEG *to* HEIC (`research.md` §E). Keep `accept="image/*"`.
- **`env.IMAGES` is reached via `import { env } from "cloudflare:workers"`**, not `Astro.locals.runtime`, which adapter v13 removed. `.info()` is never billed; `.transform().output()` counts against 5,000 free transforms/month.
- **Recurring impl-review themes to pre-empt** (`research.md` §H): stale async responses landing in the wrong UI state (flagged 3×, escalating), missing `catch` on `fetch` (2×), copy-pasted helpers instead of extraction (S-04 F4's duplicated date arithmetic *caused* a numeric bug), and files changed outside the plan's stated list (2×).

## What We're NOT Doing

- **No image storage** — no Supabase Storage bucket, no signed upload, no retention job. Retention becomes zero by construction, dissolving the retention half of PRD OQ-3.
- **No `/receipts` page.** The flow lives inside `DayView`, so `PROTECTED_ROUTES` is untouched and no new nav link is added to `Topbar.astro`.
- **No spike.** Accuracy is assessed from real use in Phase 4, by decision.
- **`description` is stored but not displayed** in `DayEntriesList` or the edit form. Surfacing it would touch S-02/S-03 UI outside this plan's file list — exactly the scope pattern flagged twice in prior reviews. It is a separate change if wanted.
- **Line-item names are not editable** during review. FR-012 requires category and amount to be correctable; the name is a read-only aid.
- **No income receipts.** Every parsed item is an expense; only expense categories are sent to the model.
- **No OCR pre-stage** (Mistral two-stage), **no provider A/B switcher UI**, **no response caching tuning**, **no multi-receipt queue**, **no receipt history**.
- **No `limits.cpu_ms` block and no Workers plan upgrade** in this change — deferred to the Phase 4 measurement, by decision.

## Implementation Approach

Four phases, ordered so each is independently verifiable and the risky, un-testable part comes last.

Phase 1 builds the **write path** — schema and batch insert — which is fully testable with `curl` and pgTAP before any LLM exists. Phase 2 builds the **read path** — provider plumbing and the parse endpoint — testable by curling a real photo. Phase 3 joins them in the **UI**. Phase 4 is the **measurement** that replaces the spike.

Routing goes through the **Cloudflare AI Gateway REST API with Unified Billing**, starting on a Gemini 3.x Flash model string. This is the high-confidence half of the research: it collapses setup to one Cloudflare token, is paid-by-construction (the Gemini API terms permit only paid services for EEA users), and makes swapping providers a one-string change — which is exactly what an unmeasured accuracy hypothesis needs.

## Critical Implementation Details

**Timing & lifecycle.** Three hazards, all in the review island:

1. The object URL created from the `File` must be revoked in the effect cleanup, or every discarded receipt leaks its full-size bitmap for the life of the page.
2. This slice introduces the repo's **first `AbortController`** — a deliberate departure from the `cancelled = { current: false }` closure guard recorded at `context/archive/2026-08-16-date-range-spending-view/plan.md:24`. Both are needed and they do different jobs: `AbortSignal` tears down the in-flight request, the `cancelled` guard stops the `setState` after it. `AbortSignal.timeout()` rejects with a `DOMException` named `TimeoutError`; a manual `.abort()` gives `AbortError`. The two must be distinguished so a user-initiated cancel is not reported as a provider timeout.
3. The target day is read at the moment of the **confirm click**, not at parse time — the user can move the calendar mid-review. The response is then reconciled against `selectedDateRef` exactly as `handleSaved` does (`src/components/entries/DayView.tsx:102-123`), which is the S-02 F1 regression guard.

**Performance constraints.** Base64 encoding is the only CPU-heavy step and it runs against a 10 ms Free-plan budget already largely consumed by Astro's SSR render. Two independent mitigations, both required: downscale in the browser to 1568 px long edge, and use `Buffer.from(bytes).toString("base64")`. Never `btoa` + `String.fromCharCode`. `env.IMAGES` is a safety net for what the client could not handle, gated on `.info()` (which is free) so it does not burn the 5,000/month transform cap on every upload.

**Debug & observability.** The local `env.IMAGES` mock supports only `width`/`height`/`rotate`/`format` and **does not error on anything else** — a probe passing `blur`, `quality`, `fit` and a bogus option returned HTTP 200 with a valid JPEG every time (`research.md` §E). Any transform parameter beyond width/height/format must be verified with `wrangler dev --remote`, not `astro dev`.

---

## Phase 1: Schema and batch write path

### Overview

Give `entries` somewhere to put a parsed item name, and give the service layer an atomic multi-row insert that replicates both app-layer-only invariants in one round trip. Entirely independent of the LLM — verifiable with `curl` and pgTAP.

### Changes Required:

#### 1. Migration — nullable description column

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_entry_description.sql` (e.g. `20260816140000_add_entry_description.sql`)

**Intent**: Add the column parsed line-item names land in, so a wrong categorisation stays diagnosable after confirmation.

**Contract**: `alter table public.entries add column description text`, nullable with no default, plus a `check` bounding length at 200 characters (a hallucinated name must not become an unbounded string). Must be **additive and backward-compatible** — CI applies migrations between build and deploy (`CLAUDE.md`), so the *previous* Worker version keeps serving against the new schema. Precedent: `supabase/migrations/20260815181500_add_category_kind.sql:6-10`. No RLS change: existing per-operation policies are row-scoped and already cover the new column.

#### 2. Entry DTO gains the field

**File**: `src/types.ts`

**Intent**: Expose `description` on the `Entry` interface so the batch response carries it.

**Contract**: `description: string | null` on `Entry`. Not optional — the column always exists; it is the *value* that may be absent. `Entry.category` stays the three-field `Pick`.

#### 3. Entries service — description plumbing and the batch insert

**File**: `src/lib/services/entries.ts`

**Intent**: Carry `description` through the existing single-row path, and add the receipt-confirm batch path.

**Contract**:

- `SELECT_COLUMNS` (`:58`), `EntryRow` (`:49-56`) and `toDto` (`:60-69`) all gain `description`.
- `createEntrySchema` gains `description: z.string().trim().min(1).max(200).nullish()`; `createEntry` passes it through.
- `updateEntrySchema` must change from `createEntrySchema.omit({ type: true })` to `createEntrySchema.omit({ type: true, description: true })`. Without this the PATCH endpoint silently accepts a field `updateEntry` never writes. Editing an entry leaves its description untouched, which is the intended behaviour.
- New `createEntriesBatchSchema`: `{ occurredOn: <same date regex>, items: z.array(z.object({ amount, categoryId, description })).min(1).max(100) }`. One shared date for the whole receipt; `type` is not a parameter — receipt items are always expenses.
- New `createEntriesBatch(supabase, input): Promise<Entry[]>` in **two** round trips regardless of N:
  1. One RLS-scoped `select("id, kind").in("id", distinctCategoryIds).is("deleted_at", null)`. Fewer rows returned than distinct ids requested → `CategoryNotFoundError`. Any row whose `kind !== "expense"` → `CategoryKindMismatchError`. Note the deliberate difference from `assertCategoryUsable`: soft-deleted categories are **excluded** here, because a receipt confirm is a new entry, not a correction to an existing one.
  2. One `.insert([...]).select(SELECT_COLUMNS)` — a single statement, therefore atomic. No `.single()`.
- The function needs a comment block matching the one at `:79-90`, restating that **both invariants are replicated here** and that neither is provable by pgTAP. Per `context/foundation/lessons.md`, this plan names them as **permanently manual-only** and any future change to either write path must re-verify both by hand.

#### 4. Batch confirm endpoint

**File**: `src/pages/api/receipts/entries.ts`

**Intent**: The route the review panel posts confirmed items to.

**Contract**: `POST` only, following `src/pages/api/entries/index.ts:35-79` exactly — client-null → `getUser()` → `request.json()` in try/catch → `createEntriesBatchSchema.safeParse` → service in try/catch. Returns `201` with `Entry[]`. `CategoryNotFoundError` → `404 { error: "Nie znaleziono kategorii", field: "categoryId" }`; `CategoryKindMismatchError` → `400`. Self-guards rather than joining `PROTECTED_ROUTES`, per the convention comment at `src/middleware.ts:4-5`.

A new route rather than an array branch on `POST /api/entries`: that endpoint's contract is one object in, one object out, and overloading it would make one endpoint two.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all migrations cleanly
- pgTAP suite passes: `npx supabase test db`
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- `curl -X POST /api/receipts/entries` with 3 valid expense items returns `201` and 3 entries carrying their descriptions
- `curl` with a `categoryId` belonging to the other seed user returns `404` and inserts nothing
- `curl` with an income `categoryId` returns `400` and inserts nothing
- `curl` with `items: []` returns `400`

#### Manual Verification:

- `/dashboard` still renders, and existing entries (with `description` null) display unchanged
- Editing an existing entry via `DayEntriesList` still works and does not clear its description

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Provider integration and the parse endpoint

### Overview

Wire Cloudflare AI Gateway, the two new secrets, and the Images binding; build the service that turns a photo plus a category list into validated, sanitised line items. Testable with `curl` and a real receipt photo, no UI required.

### Changes Required:

#### 1. Wrangler — declare the Images binding explicitly

**File**: `wrangler.jsonc`

**Intent**: Make `env.IMAGES` visible to `wrangler types`.

**Contract**: Add `"images": { "binding": "IMAGES" }`. The adapter injects this at build time, so without it `env.IMAGES` is a type error even though the binding works at runtime. The adapter's customizer skips injection when the key is present, so this is idempotent.

#### 2. Env schema — two new secrets

**File**: `astro.config.mjs`

**Intent**: Register the Gateway credentials as optional server secrets, matching the existing Supabase pair.

**Contract**: `CF_AI_TOKEN` and `CF_ACCOUNT_ID`, both `envField.string({ context: "server", access: "secret", optional: true })`. `optional: true` is not laziness — it is what keeps the app booting and building without them, exactly as `SUPABASE_URL`/`SUPABASE_KEY` do. **`npx astro sync` is mandatory afterwards**, or `astro:env/server` imports fail type-check and lint errors out.

#### 3. Config banner entry

**File**: `src/lib/config-status.ts`

**Intent**: A missing key surfaces in the red banner rather than failing at request time.

**Contract**: One more `ConfigStatus` object literal, `configured: Boolean(CF_AI_TOKEN && CF_ACCOUNT_ID)`, Polish message naming receipt parsing as the disabled feature. No `docsUrl`.

#### 4. Receipts service

**File**: `src/lib/services/receipts.ts`

**Intent**: Own the whole model interaction — prompt construction, the Gateway call, and the deterministic sanitisation of whatever comes back.

**Contract**:

- Exported constants: `RECEIPT_PARSE_TIMEOUT_MS = 30_000` and `RECEIPT_MODEL = "google/gemini-3-flash"`. The exact Gateway model string must be **confirmed against the current docs at implementation time** — the naming pattern is documented, the precise tier string is not (`research.md`, Claims that could not be verified). Keeping it a single exported constant is what makes a provider swap a one-string change.
- Endpoint: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1/chat/completions`. Not the `/compat/` path — deprecated for single-model calls.
- Headers: `authorization: Bearer ${CF_AI_TOKEN}`, `content-type: application/json`, and **`cf-aig-collect-log-payload: false`**. That last one is not optional: body logging is on by default and would persist receipt images in Cloudflare's log store. `cf-aig-collect-log: false` is the wrong header — it drops the cost/latency metadata we want to keep.
- Prompt: Polish paragon fiskalny context, the user's expense categories as `id — name` pairs, and explicit instructions to (a) fold each `RABAT`/`OPUST` into the price of the item it discounts and **never** emit a discount as its own item, (b) return one item per printed line with that line's total price, expanding `2 x 3,49` into a single item at `6,98`, (c) normalise comma decimals to dot, (d) assign each item one `categoryId` from the supplied list, (e) never invent an item to make the sum match.
- Request `response_format: { type: "json_schema", ... }` for `{ receiptDate: string | null, total: number | null, items: [{ name, amount, categoryId }] }`. Guaranteed-JSON is not guaranteed-correct, so the response is **still** parsed with a zod schema.
- Timeout via `AbortSignal.timeout(RECEIPT_PARSE_TIMEOUT_MS)` on the `fetch` — not `Promise.race`, which leaks the in-flight request instead of tearing down the connection. On `!res.ok`, call `res.body?.cancel()` before returning, per Cloudflare's guidance.
- Error taxonomy, as a discriminated result rather than thrown strings: `timeout` (DOMException `TimeoutError`), `provider_error` (non-2xx), `network` (any other fetch rejection — the missing-`catch` regression flagged twice in prior reviews), `unparsable` (response body failed the zod schema).
- **Deterministic post-processing, in code, never delegated to the model**: drop items with a non-finite or `<= 0` amount and report the count as `droppedItems`; round every amount to 2 decimals; truncate names to 200 characters; discard any `categoryId` not in the supplied list, replacing it with `null` (an unassigned item is a correction task for the user, not a reason to drop a real purchase); cap the list at 100 items.
- Base64: `Buffer.from(bytes).toString("base64")`. Never the `btoa` + `String.fromCharCode` idiom.
- The sum check is **not** computed here — it must recompute as the user edits amounts, so it belongs client-side. The service returns the model's `total` and the items; the delta is derived in the UI.

#### 5. Image normalisation helper

**File**: `src/lib/services/receipts.ts` (same module) or `src/lib/receipt-image.ts` if it grows past ~40 lines

**Intent**: Catch what the browser could not downscale — HEIC, EXIF rotation, oversized fallbacks — without burning a paid transform on every upload.

**Contract**: `import { env } from "cloudflare:workers"` — **not** `Astro.locals.runtime`, which adapter v13 removed. Call `.info(stream)` first (never billed) and only run `.transform({ width: 1568, fit: "scale-down" }).output({ format: "image/jpeg", quality: 80 })` when the format is not JPEG/PNG/WebP or the width exceeds 2000 px. Stick to `width`/`fit`/`format`/`quality`; anything more exotic cannot be trusted against the local mock (see Critical Implementation Details).

#### 6. Parse endpoint

**File**: `src/pages/api/receipts/parse.ts`

**Intent**: The route the capture control posts a photo to.

**Contract**: `POST` accepting `multipart/form-data` with one `image` field (binary on the wire — not JSON base64, which would inflate the body by a third before it even reaches the Worker). Guards in order: client-null → `getUser()` → `503` with a Polish message if either secret is unset → `413` if the file exceeds 10 MB → `400` if `listCategoriesForEntryForm(supabase, "expense")` returns an empty list (nothing to classify into). Then normalise the image, call the service, and map its error taxonomy to `504` (timeout) / `502` (provider, network, unparsable), each with a distinct Polish `error` message. Success returns `200` with `{ receiptDate, total, items, droppedItems }`. Self-guards; `PROTECTED_ROUTES` is untouched.

#### 7. Shared parse DTO

**File**: `src/types.ts`

**Intent**: One shape for the parse response, shared by route and island.

**Contract**: `ParsedReceiptItem { name: string; amount: number; categoryId: number | null }` and `ParsedReceipt { receiptDate: string | null; total: number | null; items: ParsedReceiptItem[]; droppedItems: number }`. Placed in its own commented section, following the S-04 aggregates precedent at `src/types.ts:46-53`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` regenerates types without error
- Linting passes: `npm run lint`
- Build passes: `npm run build`
- With secrets unset, `curl -X POST /api/receipts/parse` returns `503`
- `curl` with a >10 MB file returns `413`
- `curl -F image=@receipt.jpg` with secrets set returns `200` and a well-formed `ParsedReceipt`
- Unauthenticated `curl` returns `401`

#### Manual Verification:

- The red config banner appears on every page when either secret is missing, and disappears once both are set
- The AI Gateway dashboard shows the request with **no request or response body logged** — this verifies `cf-aig-collect-log-payload: false` actually took effect, and it is the single check that protects the store-nothing design
- A real Biedronka or Lidl paragon returns plausible items, and `RABAT`/`OPUST` lines do **not** appear as products
- A photo of something that is not a receipt returns an empty item list rather than invented items
- Wall-clock latency of a real parse is noted (it is the input to any future timeout retune)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Dashboard capture and review UI

### Overview

The user-facing half: a collapsed **Paragon** section in `DayView`, browser-side downscaling, the review panel with its blocking sum check, the total-only path, and the disclosure copy.

### Changes Required:

#### 1. Client-side downscale helper

**File**: `src/components/receipts/image-downscale.ts`

**Intent**: Fix the *upload* — a 12 MB body over mobile data is bad UX before it is a CPU problem.

**Contract**: `downscaleImage(file: File): Promise<{ blob: Blob; resized: boolean }>`. `createImageBitmap(file, { imageOrientation: "from-image" })` → `OffscreenCanvas` → `convertToBlob({ type: "image/jpeg", quality: 0.8 })`, targeting **1568 px** on the long edge (Anthropic's standard-tier cap, above which providers downscale anyway). Wrapped in try/catch: Chrome decodes HEIC only on macOS 104+ and Android, and not at all on Windows or Firefox, so a failure returns `{ blob: file, resized: false }` and lets `env.IMAGES` normalise it server-side. Never scale *up* a photo already under the target.

#### 2. Sum-check helper

**File**: `src/components/receipts/receipt-total.ts`

**Intent**: One place where the receipt's arithmetic lives.

**Contract**: `sumItems(items): number` and `totalDelta(sum, printedTotal): number | null` (null when the model returned no total). Both round to 2 decimals before comparing, so floating-point noise never renders as a 0.00 mismatch. Extracted rather than inlined specifically because S-04 F4's duplicated date arithmetic *directly caused* a numeric bug.

#### 3. Capture control and parse orchestration

**File**: `src/components/receipts/ReceiptCapture.tsx`

**Intent**: Own the state machine from idle through parsing to review, and the disclosure the PRD requires.

**Contract**: Props `{ expenseCategories: Category[]; occurredOn: string; onBatchSaved: (entries: Entry[]) => void }`. States: `idle → parsing → review → confirming → idle`, plus a terminal-per-attempt `error`.

- Collapsed by default to one button (`Dodaj z paragonu`), so the dashboard's visual weight — and therefore the ≤4-interaction budget for the *manual* path — is unchanged.
- `<input type="file" accept="image/*">`. **Never list `image/heic`** — Safari 17+ inverts the behaviour and converts your JPEG *to* HEIC. Do not set `capture`, which would force the camera and block the photo library.
- Disclosure copy sits above the picker, persistent rather than dismissible: receipt contents **and category names** are sent to Cloudflare and through it to the model provider; they are not used to train models; the provider retains them up to 55 days for abuse monitoring; PaperTrail stores no image. These are the facts `research.md` §G establishes — do not embellish them.
- Parse call uses `FormData`, a client-side `AbortSignal.timeout(35_000)` (deliberately above the server's 30 s so the server's typed error wins in the normal case), and a `cancelled = { current: false }` closure guard around every `setState`, matching `DayView.tsx:37-92`. A `catch` is mandatory — a bare rejection surfacing only as a console-logged unhandled rejection is the S-01 F6 / S-03 F7 regression.
- A `Anuluj` button aborts via `AbortController`, producing `AbortError`, which returns silently to `idle` and must **not** be reported as a timeout.
- Continuous visible progress throughout, per the NFR — never an unexplained pause.

#### 4. Review panel

**File**: `src/components/receipts/ReceiptReview.tsx`

**Intent**: FR-012's correct-then-confirm surface, and the deterministic guard that makes probabilistic parsing safe for financial data.

**Contract**: Props `{ parsed: ParsedReceipt; imageUrl: string; expenseCategories: Category[]; occurredOn: string; onConfirm: (items) => Promise<void>; onDiscard: () => void }`.

- Thumbnail from an object URL created from the `File`. **Revoke it in the effect cleanup** or every discarded receipt leaks its bitmap.
- A line stating the target day (`Wpisy trafią na: <date>`). When `parsed.receiptDate` differs from `occurredOn`, show it as a hint — never auto-change the date. Filing a whole receipt to the wrong day is the one high-cost mistake this placement makes possible, and the model reads dates reliably (0.87–0.91), so the hint is nearly free insurance.
- One row per item: read-only name, editable amount (`inputMode="decimal"`, comma normalised via `Number(text.replace(",", "."))` exactly as `EntryForm.tsx:96`), a category chip, and a remove button. Tapping the chip expands `CategoryPicker` inline beneath that row; only one row is expanded at a time. `CategoryPicker` is reused unmodified — it is already fully controlled.
- Rows whose `categoryId` is `null` are visually marked as needing a choice.
- Footer: `Suma pozycji`, `Na paragonie`, and the delta, formatted with `formatCurrency` from `src/lib/format.ts` — green at zero, red otherwise, with the delta in parentheses.
- **Two structurally different blocks on confirm**, and conflating them would be wrong:
  - Any item with `categoryId === null` → **hard block**. `category_id` is `NOT NULL`; there is nothing to acknowledge.
  - A non-zero sum delta → **soft block**, released by an explicit acknowledgement `Checkbox` (`src/components/ui/checkbox.tsx` is installed). The checkbox is what turns bad data into a deliberate choice rather than an accident, per the no-silent-bad-writes guardrail.
- `Zapisz jako jeden wpis (<total>)` — the total-only path. One entry at the printed total with its own category chip, enabled whenever `parsed.total` is non-null. It is also the exit from a blocked sum check, which is what satisfies the NFR that the user is never left without a way forward.
- `droppedItems > 0` renders a note naming the count (rabaty lub zerowe kwoty), so silently-removed lines are visible rather than mysterious.
- Polish copy throughout, matching `Layout.astro:21` (`lang="pl"`). The U+2026 ellipsis for pending states, per house convention.

#### 5. DayView integration

**File**: `src/components/entries/DayView.tsx`

**Intent**: Mount the section and reconcile a batch response the same way single saves are reconciled.

**Contract**: A new `<h2>Paragon</h2>` section placed **after** the entry-form section and **before** "Wpisy tego dnia", rendered only once `expenseCategories !== null`. A new `handleBatchSaved(entries: Entry[])` mirroring `handleSaved` (`:107-123`): filter to entries whose `occurredOn` matches `selectedDateRef.current`, dedupe by id, splice in one `setEntries`, and bump `calendarRefreshKey` **once** rather than per entry. The receipt section is deliberately **not** keyed on `selectedDate` — unlike `DayEntriesList`, remounting it would throw away a parse the user has already paid multiple seconds for.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Photographing a real paragon on a phone produces a review panel within the timeout, with continuous progress throughout
- Correcting an amount recomputes the delta live; correcting a category updates that row only
- Confirm writes every item to the day selected in the calendar; the day's list and the calendar marking both update without a reload
- Reloading the page shows the entries persisted with their descriptions
- Confirm is blocked while any item lacks a category, and the block cannot be acknowledged away
- Confirm is blocked on a non-zero delta until the acknowledgement is ticked
- The total-only button saves exactly one entry at the printed total
- Changing the calendar day mid-review updates the stated target day, and confirming files to the new day
- Cancelling mid-parse returns to idle silently, with no timeout message
- Killing the network mid-parse shows a network error, not a silent failure, and the manual form above still works
- A deliberately faded or crumpled receipt is tried, and whatever it does is noted for Phase 4
- With the secrets unset, the Paragon section explains it is unavailable rather than throwing

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Live accuracy assessment

### Overview

The phase that replaces the spike, by decision: ship, use the feature on real receipts for a couple of weeks, and measure. This phase produces no product code — its deliverable is evidence, and the decision that evidence supports.

### Changes Required:

#### 1. Assessment log

**File**: `context/changes/receipt-parsing/accuracy-log.md`

**Intent**: Capture the measurement in a shape that supports a go/no-go rather than a general impression.

**Contract**: A table with one row per receipt: shop, item count, condition (clean / crumpled / faded thermal), and then **two figures kept deliberately separate** —

1. **Extraction** — of the true line items on the paper, what fraction came back with the correct name *and* amount?
2. **Categorisation** — *of the correctly-extracted items only*, what fraction landed in the category you would have chosen?

Blurring these into one number hides which half is failing. Categorisation is the PRD's Secondary success criterion (a majority of line items correctly categorised without correction); extraction is what ReceiptBench's 0.49–0.58 bounds. Also record per receipt: did the item sum match the printed `SUMA PLN`, were discount rows emitted as products, were `2 x 3,49` lines expanded correctly, were comma decimals parsed, and the wall-clock latency.

Aim for 20+ receipts including at least 3 faded thermal ones — faded thermal is the dominant failure driver and produces confident hallucinations rather than blanks.

#### 2. Decision record

**File**: `context/changes/receipt-parsing/accuracy-log.md` (closing section)

**Intent**: Turn the log into the next action.

**Contract**: One of three conclusions, written explicitly: **clears the bar** (close the slice); **misses on categorisation** (try `gemini-3.5-flash-lite` or `gpt-5-mini` — a one-constant change — or improve the prompt); **misses on extraction** (the total-only path is already shipped, so the honest move is to lean on it and consider a Mistral OCR pre-stage, +$0.30/month).

### Success Criteria:

#### Automated Verification:

- None. This phase is measurement.

#### Manual Verification:

- At least 20 receipts logged, including at least 3 faded or crumpled
- Extraction and categorisation reported as separate figures
- A written conclusion naming one of the three outcomes above
- The ≤4-interaction / ≤10s budget re-verified for the *manual* entry path on `/dashboard`, confirming the Paragon section did not regress it — every slice since S-02 carries this step
- CPU time per parse request read from Workers Logs (it cannot be self-timed — `Date.now()` is frozen inside a Worker), and the Free-vs-Paid decision settled from it. Free-plan logs retain only 3 days, so check within the first days of real use
- AI Gateway dashboard re-checked after real traffic to confirm no request bodies are being retained

---

## Testing Strategy

There is **no test framework installed** (no vitest/playwright/jest, no test script). The only automated suites are pgTAP (`npx supabase test db`) and ESLint's type-checked rules. That shapes everything below.

### Database tests (pgTAP):

- The existing `supabase/tests/entries_rls_test.sql` must still pass unchanged after the `description` migration.
- A column-level assertion that `description` exists, is nullable, and rejects a 201-character value.

### Explicitly manual-only — permanent re-verification requirement:

Per `context/foundation/lessons.md`, these cannot be proven by pgTAP, because pgTAP drives raw SQL and cannot reach TypeScript:

1. **Batch ownership** — `createEntriesBatch` refusing another user's `categoryId`. The FK does not check ownership; only the RLS-scoped `select` does.
2. **Batch `type` ↔ `kind`** — `createEntriesBatch` refusing an income category. Nothing in the schema ties the columns.
3. **Soft-deleted categories excluded** from the batch path.

Any future change to either write path must re-verify all three by hand.

### Manual testing steps:

1. Sign in, open `/dashboard`, expand **Paragon**, and confirm the disclosure copy is visible before any file picker interaction.
2. Photograph a clean Biedronka receipt. Confirm items appear pre-assigned, the sum matches, and confirming writes them to today.
3. Repeat with a crumpled receipt and with a faded thermal one; record the outcomes for Phase 4.
4. Mid-parse, change the calendar to a past day. Confirm the review panel survives and states the new target day, and that confirming files there.
5. Clear one item's category. Confirm the save is blocked and no acknowledgement can release it.
6. Edit an amount so the sum no longer matches. Confirm the delta turns red, the save is blocked, and ticking the acknowledgement releases it.
7. Use the total-only button on a receipt whose items parsed badly.
8. Cancel mid-parse; then kill the network mid-parse. Neither may produce a timeout message, and both must leave the manual form usable.
9. Upload a HEIC photo from an iPhone and confirm it parses (the `env.IMAGES` path).
10. Unset `CF_AI_TOKEN` in `.dev.vars`, restart, and confirm the red banner appears and the Paragon section degrades rather than throwing.

## Performance Considerations

The LLM wait is free — Cloudflare states verbatim that waiting on `fetch()` does not count toward CPU time. Base64 encoding is not. Against a 10 ms Free-plan budget shared with Astro's SSR render, both mitigations are mandatory and neither is optional: client-side downscale to 1568 px, and `Buffer.from(bytes).toString("base64")` (1.19 ms on a 12 MB image versus 71.87 ms for the `btoa` idiom).

The ~60× `Buffer` figure is measured on Node 22 / V8; workerd's `node:buffer` is a separate implementation that does not use Node's memory pool. Treat the margin as directional and read the real number from Workers Logs in Phase 4 — that measurement, not this plan, settles Free versus Paid.

One outbound `fetch` per parse counts as one subrequest against 50 on Free. There is no wall-clock cap on a Worker as long as the client stays connected, so the 30-second timeout is a product decision, not a platform limit.

## Migration Notes

One migration, additive and nullable, therefore backward-compatible in both directions. This matters because CI applies migrations **between** the build and the deploy (`.github/workflows/ci.yml`): the previous Worker version keeps serving for the window between `supabase db push` and `wrangler deploy`, and it must tolerate the new column — it does, since it never selects it.

No data backfill. Existing entries keep `description = null` and render exactly as before.

Rollback: the column can be dropped, but only after any Worker version selecting it is rolled back first — dropping it under a live new Worker would break every entries read.

## References

- Condensed decisions: `context/changes/receipt-parsing/research-recommendations.md`
- Full research and citations: `context/changes/receipt-parsing/research.md`
- Store-nothing architectural note: `context/foundation/infrastructure.md:147-166`
- LLM-key procedure, pre-written: `context/deployment/deploy-plan.md:134`
- App-layer-only invariants: `src/lib/services/entries.ts:79-118`, `context/foundation/lessons.md`
- Canonical POST handler to clone: `src/pages/api/entries/index.ts:35-79`
- Async closure-guard idiom: `src/components/entries/DayView.tsx:37-92`
- Stale-response reconciliation (S-02 F1 guard): `src/components/entries/DayView.tsx:102-123`
- Submit / pending / error pattern: `src/components/entries/EntryForm.tsx:109-139`
- Backward-compatible additive migration precedent: `supabase/migrations/20260815181500_add_category_kind.sql:6-10`

## Operator setup — must happen before Phase 2

Nothing here can be done by an agent.

| # | Step |
| --- | --- |
| 1 | Create an AI Gateway in the Cloudflare dashboard (or let `default` auto-create on first request) |
| 2 | Purchase Unified Billing credits — 5% fee on purchase, inference passed through at cost |
| 3 | Create an API token scoped **Account → Workers AI → Read**. An AI-Gateway-scoped token returns `401` code `10000` |
| 4 | `npx wrangler secret put CF_AI_TOKEN` and `npx wrangler secret put CF_ACCOUNT_ID`. The existing `CLOUDFLARE_ACCOUNT_ID` GitHub repo variable is build-time only and not readable from the Worker |
| 5 | Copy both into `.env` **and** `.dev.vars` — workerd reads the latter, Node tooling the former. Both are gitignored |

The Gemini free tier is **contractually unavailable**: the Gemini API Additional Terms permit only Paid Services for API clients serving users in the EEA. Unified Billing satisfies this by construction, including for the first test call.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema and batch write path

#### Automated

- [x] 1.1 `npx supabase db reset` applies all migrations cleanly — 0412e51
- [x] 1.2 pgTAP suite passes: `npx supabase test db` — 0412e51
- [x] 1.3 Linting passes: `npm run lint` — 0412e51
- [x] 1.4 Build passes: `npm run build` — 0412e51
- [x] 1.5 `curl -X POST /api/receipts/entries` with 3 valid expense items returns `201` and 3 entries with descriptions — 0412e51
- [x] 1.6 `curl` with another user's `categoryId` returns `404` and inserts nothing — 0412e51
- [x] 1.7 `curl` with an income `categoryId` returns `400` and inserts nothing — 0412e51
- [x] 1.8 `curl` with `items: []` returns `400` — 0412e51

#### Manual

- [x] 1.9 `/dashboard` still renders; existing entries display unchanged — 0412e51
- [x] 1.10 Editing an existing entry still works and does not clear its description — 0412e51

### Phase 2: Provider integration and the parse endpoint

#### Automated

- [x] 2.1 `npx astro sync` regenerates types without error — 3966d6c
- [x] 2.2 Linting passes: `npm run lint` — 3966d6c
- [x] 2.3 Build passes: `npm run build` — 3966d6c
- [x] 2.4 With secrets unset, `POST /api/receipts/parse` returns `503` — 3966d6c
- [x] 2.5 A >10 MB file returns `413` — 3966d6c
- [x] 2.6 `curl -F image=@receipt.jpg` returns `200` and a well-formed `ParsedReceipt` — 3966d6c
- [x] 2.7 Unauthenticated `curl` returns `401` — 3966d6c

#### Manual

- [x] 2.8 Red config banner appears when either secret is missing, disappears once both are set — 3966d6c
- [x] 2.9 AI Gateway dashboard shows the request with **no request or response body logged** — 3966d6c
- [x] 2.10 A real paragon returns plausible items; `RABAT`/`OPUST` lines are not products — 3966d6c
- [x] 2.11 A non-receipt photo returns an empty item list rather than invented items — 3966d6c
- [x] 2.12 Wall-clock latency of a real parse noted — 3966d6c

### Phase 3: Dashboard capture and review UI

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — 086504c
- [x] 3.2 Build passes: `npm run build` — 086504c

#### Manual

- [x] 3.3 Photographing a real paragon produces a review panel within the timeout, with continuous progress — 086504c
- [x] 3.4 Editing an amount recomputes the delta live; editing a category updates that row only — 086504c
- [x] 3.5 Confirm writes every item to the selected day; list and calendar update without reload — 086504c
- [x] 3.6 Reload shows entries persisted with descriptions — 086504c
- [x] 3.7 Confirm is hard-blocked while any item lacks a category — 086504c
- [x] 3.8 Confirm is soft-blocked on a non-zero delta until acknowledged — 086504c
- [x] 3.9 Total-only button saves exactly one entry at the printed total — 086504c
- [x] 3.10 Changing the calendar day mid-review retargets the confirm correctly — 086504c
- [x] 3.11 Cancelling mid-parse returns to idle silently, with no timeout message — 086504c
- [x] 3.12 Network failure mid-parse shows a network error; the manual form still works — 086504c
- [x] 3.13 A faded or crumpled receipt tried and its behaviour noted — 086504c
- [x] 3.14 With secrets unset, the Paragon section explains unavailability rather than throwing — 086504c

### Phase 4: Live accuracy assessment

#### Manual

- [ ] 4.1 At least 20 receipts logged, including at least 3 faded or crumpled
- [ ] 4.2 Extraction and categorisation reported as separate figures
- [ ] 4.3 Written conclusion naming one of the three outcomes
- [ ] 4.4 ≤4-interaction / ≤10s budget re-verified for manual entry on `/dashboard`
- [ ] 4.5 CPU time per parse read from Workers Logs; Free-vs-Paid decision settled
- [ ] 4.6 AI Gateway dashboard re-checked after real traffic — no bodies retained
