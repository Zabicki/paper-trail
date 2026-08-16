---
date: 2026-08-16T13:47:17+02:00
researcher: Krzysztof Zabicki
git_commit: 8833e5c82c254e98175612c6b5889429e52ce1b1
branch: master
repository: Zabicki/paper-trail
topic: "AI receipt parsing — LLM provider, model, integration path, and manual setup steps"
tags: [research, codebase, receipt-parsing, llm, vision, cloudflare-workers, s-06]
status: complete
last_updated: 2026-08-16
last_updated_by: Krzysztof Zabicki
---

# Research: AI receipt parsing — provider, model, and setup path

**Date**: 2026-08-16T13:47:17+02:00
**Researcher**: Krzysztof Zabicki
**Git Commit**: `8833e5c`
**Branch**: `master`
**Repository**: [Zabicki/paper-trail](https://github.com/Zabicki/paper-trail)

## Research Question

From `change.md`:

> During plan, run some research using exa.ai and context7 if useful to figure out what is the best way to connect with a 3rd party LLM for receipt parsing, what steps to do to set up the project and environment that I have to manually do, which model is the cheapest and will provide satisfactory accuracy for receipt parsing.

Scope confirmed with the operator before research began: **Polish receipts** (paragony fiskalne), **broad provider comparison** including routing layers, **50–100 receipts/month**, and a **full document plus a setup runbook**.

## Summary

Six findings, in descending order of how much they should change the plan.

1. **Cost is not a decision variable and should be struck from the brief.** At 75 receipts/month the entire candidate field spans **$0.03 to $2.24 per month** — the cheapest small model and a frontier model differ by roughly the price of one coffee per year. The question "which model is cheapest" has an answer, but acting on it would be optimising the wrong variable. Choose on Polish-receipt accuracy and treat the bill as a rounding error.

2. **Nobody has measured what this feature depends on.** There is no public benchmark, dataset, or study of vision-LLM accuracy on Polish receipts. The best receipt benchmark that exists (ReceiptBench, May 2026, 10,656 receipts) is **98.0% English and contains zero Polish samples**. All Polish benchmark effort (KLEJ, LEPISZCZE, PIRB, PolEval) is text-only; no Polish group works on document-image extraction. Every ranking available is an English proxy. **This gap cannot be closed by more desk research** — see the spike protocol below.

3. **The measured weak spot is exactly PaperTrail's hard half.** On ReceiptBench, frontier models score 0.87–0.91 on header fields (store, date, total) but only **0.49–0.58 on "Structure" — the line-item table**. Semantic reasoning scores ~0.87, which suggests *categorising* an item is the easy half and *reading it off the paragon* is the risk. FR-011's floor is a majority of line items landing correctly; the published evidence puts extraction alone near that floor before categorisation errors are added.

4. **Models tamper with data to make arithmetic work.** ReceiptBench documents models altering a line-item price or hallucinating a "Tax" row so the sum matches the printed total. Independent field reports over ~100 real receipts conclude that *"reliability improved far more from deterministic validation than from simply using larger models"* and that **larger models sometimes hallucinated more aggressively than smaller ones**. A deterministic sum-check is worth more than the provider choice.

5. **Two hard constraints nobody had recorded.** (a) Google's Gemini API terms permit **only Paid Services** for API clients serving users in the EEA — the free tier is contractually unavailable to PaperTrail, including for a "quick test" with real receipts. (b) Cloudflare AI Gateway **logs full request bodies by default**, which would persist receipt images in Cloudflare's log store and silently contradict `infrastructure.md`'s store-nothing design.

6. **The Free-plan CPU limit, not the LLM call, is the runtime risk.** Awaiting the LLM costs ~0 ms CPU (I/O is excluded). Base64-encoding the image is pure CPU: a 12 MB photo encoded the way every blog post shows takes ~72 ms against a **10 ms** Free-plan budget, on top of Astro's SSR render. Two mitigations, both cheap, detailed in §D.

**Recommendation**: route through **Cloudflare AI Gateway's REST API with Unified Billing**, starting on a **Gemini 3.x Flash** model string, with `gemini-3.5-flash-lite` and `gpt-5-mini` as A/B candidates. Then **run the spike in §I before committing the slice**. The routing choice is high-confidence; the model choice is a hypothesis until measured.

---

## Detailed Findings

### A. Provider and model selection

#### Disqualified on Polish, not on price

| Candidate | Why it is out |
|---|---|
| **AWS Textract** `AnalyzeExpense` | No Polish at all. The [quota page](https://docs.aws.amazon.com/textract/latest/dg/limits-document.html) lists English, French, German, Italian, Portuguese, Spanish, and its detectable-character set contains none of `ą ć ę ł ń ś ź ż`. Polish product names corrupt at character level. |
| **Google Document AI** Expense Parser | Six languages (de, en, es, fr, ja, nl). Polish absent. Polish *is* supported for Google's raw Enterprise Document OCR — a per-processor trap worth naming so nobody "verifies" the wrong product. |
| **Veryfi** | The only vendor with native user-supplied categories (`categories[]` per request, tags `line_item.category`) — genuinely tempting. Ruled out on two counts: free tier caps at **exactly 100 docs/month** with a **$500/month cliff** immediately above PaperTrail's expected volume, and per-end-user category isolation is a "contact us" matter, putting a cross-user leak vector outside the RLS boundary. That is incompatible with the §Success Criteria isolation guardrail. |
| **Cloudflare Workers AI** (`@cf/meta/llama-3.2-11b-vision-instruct`) | Free and already on the platform, so it was investigated seriously. Disqualified by Meta's own model card: *"Note for image+text applications, English is the only language supported."* Text-only mode covers 8 languages; **vision does not.** |
| **`gpt-4o-mini`** | Older generation, and a cost trap — see §B. |

Also checked and rejected as a primary parser: Azure `prebuilt-receipt` (does document `pl` in its thermal-receipt language table — the *strongest* explicit Polish signal found anywhere — but returns a fixed schema and cannot classify into an arbitrary user taxonomy), Mindee (V2 publishes no language list), and Cloudflare's `env.AI.toMarkdown()` (**not OCR** — for images it runs object detection then captions the result; it describes a photo rather than reading text off it).

#### The live field

| Model | In $/1M | Out $/1M | Image billing | Guaranteed JSON | Polish documented | Trains on input |
|---|---|---|---|---|---|---|
| `gemini-3.7-flash` | 0.75¹ | 3.75¹ | flat 1120 tok | yes (syntax) | **yes, `pl`** | no (paid) |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | flat 1120 tok | yes | **yes, `pl`** | no (paid) |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | flat 1120 tok | yes | **yes, `pl`** | no (paid) |
| `gemini-2.5-flash-lite` | 0.10 | 0.40 | ~2048 tok default | yes | **yes, `pl`** | no (paid) |
| `gpt-5-mini` | 0.25 | 2.00 | patches × 1.62 | yes (`strict`) | not model-specific | no |
| `gpt-5-nano` | 0.05 | 0.40 | patches × 2.46 | yes | not model-specific | no |
| `claude-haiku-4-5` | 1.00 | 5.00 | ⌈w/28⌉×⌈h/28⌉ | yes (constrained decoding) | not model-specific | no |
| `claude-sonnet-5` | 2.00 | 10.00 | same, hi-res tier | yes | not model-specific | no |
| `mistral-ocr-latest` | $4 / 1k pages | — | per page | yes | "Eastern European" group only | unverified |

¹ Promotional through 2026-12-31; **doubles to $1.50 / $7.50 on 2027-01-01**. Worth a calendar note.

**Google is the only vendor that documents Polish for the model family itself.** OpenAI's vision docs caveat only non-Latin alphabets (implicitly favourable for Polish, but silent on `ą ć ę ł ń ó ś ź ż`); Anthropic's multilingual page lists 14 languages, Polish not among them, and is **text MMLU rather than vision** so it says nothing about OCR either way. No vendor publishes a per-language accuracy figure for text-in-image extraction. Not one.

### B. Cost arithmetic

Assumptions: receipt downscaled to 768×1024, ~800 prompt tokens (category list + instructions), ~600 output tokens, reasoning forced to minimum, **75 receipts/month**.

| Rank | Model | $/receipt | **$/month @ 75** |
|---|---|---|---|
| 1 | `gpt-5-nano` | 0.000374 | **$0.028** |
| 2 | `gemini-2.5-flash-lite` | 0.000525 | **$0.039** |
| 3 | `gemini-3.1-flash-lite` | 0.001380 | **$0.104** |
| 4 | `gpt-5-mini` | 0.001711 | **$0.128** |
| 5 | `gemini-3.5-flash-lite` | 0.002076 | **$0.156** |
| 6 | `gemini-3.7-flash` | 0.003690 | **$0.277** |
| 7 | `mistral-ocr` (OCR stage only) | 0.004000 | **$0.300** |
| 8 | `gpt-4o-mini` | 0.004305 | **$0.323** |
| 9 | `claude-haiku-4-5` | 0.004836 | **$0.363** |
| — | *ceiling check:* `claude-opus-5` | 0.029880 | **$2.24** |

**The `gpt-4o-mini` trap, worth internalising:** its headline input price ($0.15/1M) is 40% below `gpt-5-mini`'s ($0.25/1M), yet it costs **2.5× more per receipt**. OpenAI's older tile scheme bills a 768×1024 image at `2833 + 4×5667 = 25,501` tokens where the patch scheme bills 1,244. **Never select a vision model on headline token price** — the image-billing formula dominates at this payload shape.

**Conclusion: the brief's "cheapest" criterion is satisfied by every candidate.** The spread between best and worst realistic option is under $0.35/month. Optimise for accuracy.

### C. Accuracy evidence — and the hole in it

#### What is measured

**ReceiptBench** ([arXiv 2605.22413](https://arxiv.org/html/2605.22413v1), 2026-05-21) — 10,656 real receipts, 19 fields, 98.7% annotation accuracy. The only serious receipt-specific benchmark.

| Model | Overall | Perception | Normalization | Reasoning | **Structure** |
|---|---|---|---|---|---|
| Gemini-3-Pro | 0.7373 | 0.7360 | 0.9086 | 0.8714 | **0.5781** |
| Qwen3-VL-Plus | 0.7210 | 0.7306 | 0.9000 | 0.8787 | 0.5484 |
| GPT-5 | 0.7076 | 0.7304 | 0.8743 | 0.8706 | **0.4893** |

Two things matter enormously:

- **Structure — extracting the line-item list — is by far the weakest task for every model.** Header fields run 0.87–0.91. Semantic Reasoning runs ~0.87, which is mildly encouraging for the *categorisation* half. Gemini leads structure by ~9 points over GPT-5, which is the single strongest published reason to prefer Gemini here.
- **Language mix is 98.0% English.** The non-English tail is 213 samples: French 60, Spanish 51, German 31, Indonesian 31, Portuguese 18, Romanian 10, others 11. **Polish appears zero times**, and Romanian is the only Central-European language present. On that tail the authors' own best model drops 0.795 → 0.719 overall while **structure collapses 0.637 → 0.381**.

**KIE-HVQA** ([arXiv 2506.20168](https://arxiv.org/html/2506.20168v2), NeurIPS 2025) — key-information extraction with simulated blur/low contrast. Hallucination-free accuracy: **GPT-4o 30.21% overall** (36.13% clear, 31.74% degraded). The authors attribute failure to *"overreliance on linguistic priors… rather than anchoring decisions to observable visual evidence"* and *"lack of uncertainty recognition."* Languages unspecified.

**IDP Leaderboard** ([idp-leaderboard.org](https://www.idp-leaderboard.org/), v1.5 March 2026) — Nanonets OCR-3 85.9, GPT-5.4 83.5, Gemini-3-Pro 82.8, **Gemini-3-Flash 82.0** (highest OmniDoc sub-score of any general model at 90.1), Claude Sonnet 4.6 80.7. No multilingual dimension. ⚠️ NanoNets sells IDP and its own model tops its own leaderboard.

**Dead — do not cite.** The OmniAI OCR benchmark, which most 2026 blog posts still reference, is **offline**: getomni.ai now redirects to monumint.com and the benchmark pages 404; the company pivoted to voice AI. Its HuggingFace dataset still labels results "Feb 2025". Any 2026 article citing "the OmniAI benchmark" is citing a defunct artifact.

**Obsolete.** CORD and SROIE are 2019-era and under 2,000 images — per ReceiptBench, *"too small for data-hungry MLLMs."* Nobody runs frontier VLMs on them.

#### What is *not* measured

Explicitly searched for and **not found**:

- Any benchmark, paper, or evaluation of vision-LLM accuracy on Polish receipts or invoices.
- Any public Polish receipt dataset, labelled or otherwise.
- Any Polish research group working on document-image extraction.
- A per-language accuracy figure from any model vendor, for any model.
- Any study isolating `N x unit_price` lines or weight-priced items as a measured failure category.

The only Polish OCR leaderboard found ([CodeSOTA](https://www.codesota.com/polish-ocr)) lists **zero models with Polish results** as of March 2026 — only a Tesseract baseline at 26.3% CER overall, and notably 5.2% CER on Wikipedia prose versus **40.6% on synthetic random characters**. That ~8× real-vs-synthetic gap is direct evidence that Polish "OCR accuracy" is largely language-model priors doing the work rather than vision — which is precisely the hallucination surface for cryptic paragon product names like `ML.SW 2% 1L`.

#### Polish practitioner evidence

The most useful single data point is a live conference demo (Dariusz Ciba, BRAVE Summer Tour, [2026-06-29](https://pl.linkedin.com/posts/dariusz-ciba_bravesummertour-ai-llm-activity-7477465902976913408-ivP4)) running Bielik-11B, Gemma-4-31B and three Qwen3-VL sizes against a **lightly faded** — not badly crumpled — Polish receipt:

- One run returned **"chleb, ser, masło"** for a receipt containing **shoes and no dairy**.
- Another read a **card-terminal confirmation as "Sąd Rejonowy"**.
- The same image produced two contradictory, self-confident answers from different models.
- One model spent **over 10 minutes** self-evaluating a single receipt.

His conclusion: the model will not say "I don't know" — it will say something wrong, confidently; validate in code (do the line items sum to the total?), don't trust the model.

Corroborating:

- **Automaize** (Polish vendor, Polish *invoices*, GPT-4o + Gemini 2.0 Flash): **100% header accuracy, 74% line-item accuracy**, ~8 PLN/invoice. The 100% is marketing; the **74% line-item figure is the credible half** and independently matches ReceiptBench's structure gap.
- **[JaskierBard/receipt_cut](https://github.com/JaskierBard/receipt_cut)** — a near-identical Polish product. Its verification step is exactly the guard-rail needed: a green/red indicator when line items sum to the printed total, with the delta shown in parentheses. Correct UX, no published metrics.
- **[michalkukla.pl/projects/e-paragon](https://michalkukla.pl/projects/e-paragon)** — PoC abandoned; names PaperTrail's exact product problem, that receipt lines are cryptic manufacturer codes users cannot themselves recognise.
- **[wbiegala/receipt-analyzer](https://github.com/wbiegala/receipt-analyzer)** — Azure + ML.NET on Polish fiscal receipts, abandoned; author reports the line-item model *"recognised receipt elements very poorly."*
- **[AIzi.pl tutorial](https://aizi.pl/blog/ocr-paragonow-ai-make)** (2026-05-05) — Mistral OCR → `gpt-5.4-nano`, claims coverage of Biedronka/Lidl/Stokrotka layouts. **Evidence value: exactly one test receipt.**

#### Documented failure modes, by evidence strength

| Failure mode | Evidence | Note for the plan |
|---|---|---|
| **Hallucinated totals / value tampering** | Strong (measured) | ReceiptBench: models alter a line-item price or invent a "Tax" row to force the sum to match. Gemini logged 516 hallucination cases vs Qwen's 248; Qwen instead fails by omission. Also: *"Gemini frequently hallucinates specific cities based on currency cues"* — the same prior-over-evidence mechanism that would guess a chain from "PLN". |
| **Faded thermal print** | Strong | The dominant driver, ahead of blur and angle, and it yields **hallucinations rather than blanks**. Field reports: ~97% on clean photos, 85–90% crumpled, **below 70% thermal-faded**. Thermal receipts lose 40–60% of print contrast within 6 months. |
| **Discount / `RABAT` / `OPUST` rows** | Practical | Emitted as standalone purchasable products; `OPUST`/`RABAT` prints *immediately after* the discounted item on Polish receipts. Needs explicit prompt + post-processing handling. |
| **Comma-vs-dot decimals** | Documented, thin | ReceiptBench names `1.000,00` vs `1,000.00` as a normalization failure. Every Polish tutorial defensively forces dot-decimal in the schema. |
| **`2 x 3,49` quantity × unit price** | Weakest coverage | No study isolates it; ReceiptBench's structure sub-score *is* this capability. Practitioners solve it with **explicit regex**, not the model. |
| **Weight-priced items (`0,342 kg`)** | One source | Reported as "sometimes merged incorrectly". Nothing quantitative. |

### D. Integration path on workerd

#### The real runtime risk is CPU, not the LLM call

Awaiting the LLM is free — Cloudflare states verbatim that *"waiting on network requests (such as `fetch()` calls…) does not count toward CPU time."* Base64-encoding the image is not free. Measured locally (Node 22 / V8; workerd will differ):

| Image | `btoa` + chunked `String.fromCharCode` | `Buffer.from(bytes).toString("base64")` |
|---|---|---|
| 1 MB | 5.44 ms | 0.11 ms |
| 4 MB | 23.31 ms | 0.43 ms |
| 12 MB | **71.87 ms** | **1.19 ms** |

Against a **10 ms** Free-plan CPU budget shared with Astro's SSR render — and Cloudflare's own guidance says *"heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms"*, i.e. SSR alone is already at the ceiling. Two independent mitigations, both cheap, and the plan should take **both**:

1. **Use `Buffer.from(bytes).toString("base64")`** — native, ~60× faster than the `String.fromCharCode.apply` chunk loop that every tutorial shows. `nodejs_compat` is already enabled (`wrangler.jsonc`).
2. **Downscale before encoding** (§E), keeping the payload at a few hundred KB.

Upgrading to Workers Paid ($5/month, 30 s default CPU) removes the ceiling entirely and is independently justified — `infrastructure.md` already lists "a second real application" and "users who are not the developer" as upgrade triggers.

#### Verified runtime limits

| Limit | Free | Paid |
|---|---|---|
| Request body size | 100 MB (set by the **Cloudflare account** plan, not the Workers plan) | 200 MB+ |
| Subrequests per invocation | 50 | **10,000** (raised Feb 2026, not 1,000) |
| CPU per request | **10 ms** | 30 s default, 5 min max |
| Isolate memory | 128 MB | 128 MB |
| Worker size (gzip) | 3 MB | 10 MB |

- An outbound `fetch()` counts as one subrequest. One LLM call against 50 is a non-issue.
- **No wall-clock cap**: *"As long as the client remains connected, the Worker can continue processing."* A docs issue in May 2026 suggesting a 30 s termination was resolved as a **wording clarification, not a behaviour change**. The 524 error does not apply to Workers (that is the proxy-to-origin hop).
- **No default outbound `fetch` timeout in workerd** — you must impose your own.
- `AbortController` / `AbortSignal` are supported; the old uncatchable-`AbortSignal.timeout` bug ([workerd#1020](https://github.com/cloudflare/workerd/issues/1020)) is closed and was local-`wrangler`-only.
- **`Date.now()` and `performance.now()` are frozen during execution** — they return the time of the last I/O. You cannot self-time or self-profile inside a Worker; read CPU and wall figures from Workers Logs (`observability.enabled` is already `true`).

#### SDK vs raw fetch

| Package | Version | Workers supported? | Bundle (gzip) |
|---|---|---|---|
| `@anthropic-ai/sdk` | 0.117.1 | **Yes** — named in the Requirements table | ~44.5 KB |
| `openai` | 7.4.0 | **Yes** — same table, zero runtime deps | ~36.7 KB |
| `@google/genai` | 2.17.1 | **Not documented** — Node 20+ and browser only | ~64 KB |

- **`@google/genai` is the risky one.** Runtime deps include **`ws`** (Node's WebSocket client); workerd provides its own native WebSocket rather than Node's `net`/`tls` stack, which is the classic breakage point. Do not discover this at deploy time.
- **`@google/generative-ai` is dead** — repo renamed to `deprecated-generative-ai-js`, EOL 2025-11-30 (already passed). Most tutorials still reference it.
- **Bundle size is a non-issue.** The current server bundle is ~390 KiB against a 3 MB Free limit; 37–64 KB is noise. Do not choose raw fetch to save bytes.

#### Cloudflare AI Gateway — recommended, with one mandatory header

AI Gateway is free on all plans (core features), and the notable 2026 change is a **REST API** that removes provider signup entirely:

```
POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions
```

Per the docs: *"No provider SDKs or API keys are needed. Authentication and billing are handled through your Cloudflare account."* Model naming is `google/gemini-3-flash`, `openai/gpt-5-mini`, `anthropic/claude-haiku-4-5` — so **switching providers is a one-string change**, which is exactly what an unmeasured accuracy hypothesis needs. Unified Billing applies a **5% fee on purchased credits** with provider inference passed through at no markup.

Why this fits PaperTrail specifically:

- It collapses the manual setup from "create a Google Cloud account, enable billing, generate and rotate a key" to "one Cloudflare token" — the operator already has a Cloudflare account.
- It sidesteps the EEA free-tier problem (§G) by construction: Unified Billing is paid usage.
- Free cost/token analytics you would otherwise build.
- Response caching makes re-parsing an identical receipt free.

**One mandatory header.** Logging is **on by default and includes request and response bodies** — the dashboard shows the prompt and the model response. Left alone, this **persists receipt images in Cloudflare's log store**, silently contradicting `infrastructure.md`'s store-nothing design and the PRD's retention NFR. Send on every request:

```
cf-aig-collect-log-payload: false
```

This keeps tokens/cost/latency metadata and drops the bodies. (`cf-aig-collect-log: false` drops the entire entry, including the metadata you want.) Log retention is also count-capped at 100,000 entries total on Workers Free.

Two smaller traps: the REST API needs a token scoped **Account → Workers AI → Read** (an AI-Gateway-scoped token returns `401` code `10000`), and the older `/compat/chat/completions` path is now **deprecated for single-model calls**, though still required for `dynamic/{route}`.

### E. Image handling without `sharp`

**`env.IMAGES` was verified working in this repo.** A throwaway route under `npm run dev` (workerd via the Cloudflare Vite plugin) returned:

```json
{ "envKeys": ["SUPABASE_URL","SUPABASE_KEY","ASSETS","SESSION","IMAGES"],
  "hasIMAGES": true, "transformOk": true, "contentType": "image/jpeg" }
```

Current confirmed signature — note the binding is reached via `import { env } from "cloudflare:workers"`, **not** `Astro.locals.runtime`:

```ts
import { env } from "cloudflare:workers";
const out = await env.IMAGES
  .input(stream)                                  // ReadableStream or Uint8Array, ≤20 MB
  .transform({ width: 1568, fit: "scale-down" })
  .output({ format: "image/jpeg", quality: 80 });
return out.response();                            // the only terminal call
```

`.info(stream)` returns `{format, fileSize, width, height}` and is **never billed**. There is no `.image()` method in current docs.

Two properties that matter more than the downscaling itself:

- **HEIC is a supported input format** for the binding (PNG, JPEG, GIF, WebP, SVG, HEIC). **No LLM provider accepts HEIC** — Anthropic takes JPEG/PNG/GIF/WebP only. The binding is the HEIC escape hatch.
- **EXIF rotation is applied automatically**, *"even if the metadata is discarded"* — which is precisely the client-side canvas footgun.

Pricing: 5,000 unique transformations/month free, where a "unique transformation" is one distinct (source, params) pair per calendar month. **Error 9422** means that cap was reached. Related codes: 9413 (>100 megapixels), 9520 (unsupported input), 9402 (too large).

**A dev-fidelity trap found empirically:** the local mock supports only `width`/`height`/`rotate`/`format` but **does not error on anything else**. A probe passing `blur: 20`, `quality: 60`, `fit`, a bogus `notARealOption: 5`, and even `.output({})` with no `format` returned **HTTP 200 with a valid JPEG every time**. Typos and unsupported params fail silently locally and surface only in production. Validate anything beyond width/height/format with `wrangler dev --remote`.

**Client-side resize** is still the primary defence, because it fixes the *upload* — a 12 MB body over mobile data is bad UX before it is a CPU problem. Pattern: `createImageBitmap(file, { imageOrientation: "from-image" })` → `OffscreenCanvas` → `convertToBlob({ type: "image/jpeg", quality: 0.8 })`. Target **1568 px long edge**, which is not arbitrary: it is exactly Anthropic's standard-tier cap, above which they downscale anyway.

Two caveats:

- **Never put `image/heic` in the `<input accept>` list.** iOS Safari normally converts HEIC→JPEG when picking from Photos with `accept="image/*"`, but per [Apple's own forum](https://developer.apple.com/forums/thread/743049), Safari 17+ **inverts this** and converts your JPEG/PNG *to* HEIC if `image/heic` is explicitly listed. Keep `accept="image/*"`.
- Chrome decodes HEIC natively only on macOS 104+ and Android — **not on Chrome/Windows or Firefox**. Wrap `createImageBitmap` in try/catch and fall back to uploading the original for `env.IMAGES` to normalise.

WASM alternatives (`@cf-wasm/photon` at ~620 KB gzipped, `@jsquash/resize`, `wasm-image-optimization`) are all unnecessary — the binding does this free with zero bundle cost.

### F. Timeout and failure UX

The PRD requires parsing to *"either return a result within a stated time or fail visibly, always leaving the user able to complete the entry manually."* The idiomatic path is **`AbortSignal.timeout()`** passed to `fetch` — not `Promise.race`, which leaks the in-flight request rather than tearing down the connection.

```ts
const PARSE_TIMEOUT_MS = 25_000; // ← value still needs an owner decision, see Open Questions

try {
  const res = await fetch(gatewayUrl, {
    method: "POST",
    signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${CF_AI_TOKEN}`,
      "content-type": "application/json",
      "cf-aig-collect-log-payload": "false",
    },
    body: JSON.stringify({ /* … */ }),
  });
  if (!res.ok) {
    res.body?.cancel();               // Cloudflare recommends this to free memory
    return json({ error: "provider_error" }, 502);
  }
  // …
} catch (err) {
  const timedOut = err instanceof DOMException && err.name === "TimeoutError";
  return json({ error: timedOut ? "timeout" : "network" }, timedOut ? 504 : 502);
}
```

`AbortSignal.timeout()` rejects with a `DOMException` named **`TimeoutError`**, distinct from a manual `AbortController.abort()` which gives `AbortError` — the plan should distinguish them so a user-initiated cancel is not reported as a provider timeout.

**This would be the repo's first `AbortController`.** The established async idiom is a plain `const cancelled = { current: false }` closure guard (`src/components/entries/DayView.tsx:37-92`), and `date-range-spending-view/plan.md:24` records that choice explicitly. Introducing `AbortSignal` is a deliberate departure worth naming in the plan rather than smuggling in.

### G. Privacy, disclosure, and one legal constraint

| Provider | Trains on API input | Retention |
|---|---|---|
| **Gemini paid** | **No** — *"Google doesn't use your prompts… or responses to improve our products"* | 55 days for abuse monitoring; ZDR available on request |
| **Gemini free** | **YES** — *"Google uses the content you submit… to provide, improve, and develop Google products"*, and *"human reviewers may read, annotate, and process your API input and output"* | — |
| OpenAI | No | 30-day abuse logs; ZDR on approval |
| Anthropic | No — and images are *"ephemeral and not stored beyond the duration of the API request"* | Not retained by default; 30-day cap otherwise |

**The decisive legal finding.** The [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) state:

> "You may use **only Paid Services** when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."

PaperTrail serves Polish users, so **the Gemini free tier is contractually unavailable — including for a "quick test" with real receipts during the spike.** This is not a cost problem ($0.28/month), but it must be the paid tier from the very first call. Routing through AI Gateway Unified Billing satisfies this by construction.

**Effect on the PRD's disclosure NFR.** The requirement — users are told that receipt contents *and their category names* leave the product — is unchanged in substance but gains a second processor if AI Gateway is used. The disclosure text moves from "sent to \<provider\>" to "sent to Cloudflare and, through it, to \<provider\>". Since PaperTrail is already hosted on Cloudflare, the incremental exposure is metadata only **provided `cf-aig-collect-log-payload: false` is set**. The concrete facts available to write honest copy: not used for training, retained up to 55 days for abuse monitoring (Gemini paid).

### H. Codebase integration surface

The repo is unusually well-prepared for this slice — and has two real gaps.

**Already in place:**

- `astro.config.mjs:29-38` keeps the `IMAGES` binding deliberately, with a comment naming it *"the workerd-native way to downscale receipt photos before the LLM call."*
- `context/deployment/deploy-plan.md:134` pre-writes the LLM-key procedure (secret → `env.schema` → `config-status.ts`).
- `CLAUDE.md` hard rules already cover the two predicted failure modes (`sharp`, `Astro.locals.runtime`).
- API-route conventions are uniform and copyable: client-null → auth → parse body → zod → service in try/catch → rethrow unknown. Error body is `{ error: string, field?: string }`.

**Gap 1 — parsed line-item names have nowhere to go.** The `entries` table is:

```sql
id, user_id, category_id, type, amount, occurred_on, created_at
```

There is **no description, note, merchant, or receipt-reference column**. A parsed item is `{ name: "CHLEB ŻYTNI 500G", amount: 4.99 }` and only the amount is storable. Two options, and the plan must choose explicitly:

- **(a)** Names are review-only — shown during confirmation to help the user verify and correct, then discarded on save. Zero migration. Loses the audit trail that would make a wrong categorisation diagnosable later.
- **(b)** Add a nullable `description text` column. Must be **additive with a default or nullable** — CI applies migrations *between* build and deploy, so the running Worker must tolerate the new schema (`CLAUDE.md`; precedent at `20260815181500_add_category_kind.sql:6-10`).

**Gap 2 — there is no multi-row insert path.** `createEntry()` inserts exactly one row and returns one DTO; `.single()` would throw `PGRST116` on a multi-row result. Worse, `assertCategoryUsable()` (`src/lib/services/entries.ts:91-118`) is a **per-entry pre-flight round trip** enforcing two invariants the database does not:

1. **Ownership** — the FK on `entries.category_id` checks row existence only; Postgres FK constraints are not subject to RLS on the referenced table. Only this RLS-scoped `select` stops an entry attaching to another user's category.
2. **`type` ↔ `kind`** — nothing in the schema ties them together.

So a naive loop over N line items costs **2N round trips**, and any batch path must replicate both invariants explicitly. Per `context/foundation/lessons.md`, both are app-layer-only and **unprovable by pgTAP** — the plan must name them in an "explicitly manual-only" block.

**Other constraints inherited from prior slices:**

- Categories are **soft-deleted**; `listCategories()` filters `deleted_at is null`. It returns **both** kinds — the LLM prompt wants expense categories only.
- `Category` exposes `id, name, color, isRecurring, kind, createdAt`. **`name` is the only semantic signal** — no description or keywords field to help classification.
- `amount` is `numeric(10,2) check (amount > 0)` — **a zero or negative line item cannot be stored**, which directly affects how `RABAT` rows are handled.
- `category_id` is `NOT NULL` with no "uncategorised" escape hatch. Every confirmed line item must resolve to a real category.
- **UI copy is Polish** (`Layout.astro:17`, `lang="pl"`), recorded across S-01 through S-04. Routes and APIs stay English. *(Note: `CLAUDE.md:76` still says to confirm language with the user — that line is stale and should be corrected.)*
- The demo account will soon have **~30 categories** (S-05's pending migration), which is a realistic prompt-payload fixture.
- `PROTECTED_ROUTES` is `["/dashboard", "/categories", "/reports"]`, prefix-matched. A receipt *page* must be added; an `/api/receipts/*` route follows the self-guard pattern instead.
- Every authenticated `/api/*` request already calls `supabase.auth.getUser()` **twice** (middleware + handler).

**Recurring impl-review themes this slice should pre-empt** (from five archived reviews):

1. **Stale async responses landing in the wrong UI state** — flagged three times, escalating (S-02 F1, S-03 F2, S-03 F3). A long parse plus a multi-item review screen is exactly this hazard class.
2. **Missing `catch` on `fetch`** — flagged twice across three components; a network rejection surfaced only as a console-logged unhandled rejection.
3. **Copy-pasted helpers instead of extraction** — S-04 F4's duplicated date arithmetic *directly caused* a numeric bug.
4. **Scope discipline** — files changed outside the plan's stated list, twice remedied by an `## Addendum`.

### I. The spike — what to measure before committing S-06

This is the highest-value item in the document. The roadmap already flags it (*"worth a spike against real receipts before committing the slice"*), and the research confirms it cannot be replaced by desk work: **no measurement of any model on Polish receipts exists publicly.** Running one would, as far as this research can tell, produce the first such measurement.

**Corpus**: 30–50 real paragony from the operator's own shopping — Biedronka, Lidl, Żabka, plus at least 5 deliberately faded or crumpled, since faded thermal is the dominant failure driver. This is a realistic ask; the operator generates them daily by definition of the product.

**Candidates**: `gemini-3.7-flash` and `gemini-3.5-flash-lite` (the two Gemini tiers), plus `gpt-5-mini` as the second-vendor control. Total cost across all three over 50 receipts: **well under $0.10.**

**Two metrics, kept separate** — this distinction matters and is easy to blur:

1. **Extraction accuracy** — of the true line items on the receipt, what fraction were extracted with the correct name and correct amount? This is what ReceiptBench's 0.49–0.58 "Structure" score bounds, and it is the *upstream* risk.
2. **Categorisation accuracy** — **of the correctly-extracted items**, what fraction landed in the category the user would have chosen? **This is the PRD's Secondary success criterion**, and nothing in the literature bounds it for Polish.

Reporting only a combined figure would hide which half is failing and mislead the go/no-go.

**Also record**, because each maps to a documented failure mode:

- Did `sum(line_items)` equal the printed `SUMA PLN`? Any mismatch is a candidate value-tampering event.
- Were `RABAT` / `OPUST` rows emitted as purchasable products?
- Were `2 x 3,49` lines expanded correctly?
- Were comma decimals parsed correctly?
- Wall-clock latency per parse — this is what sets the timeout constant that PRD Open Question 3 still needs.

**Go / no-go**: FR-011's floor is *a majority of line items correctly categorised without correction*. Below it, per the PRD's own reasoning, auto-assignment is **slower than typing** and the feature is failing rather than imperfect. If the spike lands below the bar, the honest options are a two-stage pipeline (Mistral OCR pre-stage feeding a text-only classifier, +$0.30/month), a narrower scope (extract the total only, one entry per receipt — which the header-field scores of 0.87–0.91 strongly support), or deferring S-06.

That last fallback deserves emphasis: **header extraction is the reliable part.** A "photograph a receipt → get one correctly-dated, correctly-totalled expense entry, pick the category yourself" feature is well within measured capability today, and would still serve the friction thesis. It is a materially different product promise from FR-011, so it is the operator's call, not an implementation detail.

---

## Manual setup steps

Everything the operator must do by hand, in order. Nothing here can be done by an agent.

### Path A — Cloudflare AI Gateway (recommended)

| # | Step | Where |
|---|---|---|
| 1 | Create an AI Gateway (or rely on auto-creation of `default` on first request) | Cloudflare dashboard → AI → AI Gateway |
| 2 | Purchase Unified Billing credits (5% fee on purchase; inference passed through at cost) | Cloudflare dashboard |
| 3 | Create an API token scoped **Account → Workers AI → Read**. An AI-Gateway-scoped token returns `401` code `10000` | Cloudflare dashboard → My Profile → API Tokens |
| 4 | `npx wrangler secret put CF_AI_TOKEN` | terminal |
| 5 | `npx wrangler secret put CF_ACCOUNT_ID` (the Worker needs it at runtime; the existing GitHub repo *variable* is build-time only and not readable from the Worker) | terminal |
| 6 | Add both to `.env` **and** `.dev.vars` — workerd reads the latter, Node tooling the former | local, both gitignored |
| 7 | Confirm the Workers plan. Free's 10 ms CPU is tight even with downscaling; **$5/month Paid is the safe call** and is per-account, amortised across future projects | Cloudflare dashboard |

### Path B — direct to Google (fallback if AI Gateway is rejected)

Create a Google AI Studio account, **enable paid billing before the first call** (the EEA restriction in §G is not optional), generate an API key, then `npx wrangler secret put GEMINI_API_KEY` and steps 6–7 above.

### Code-side registration (agent-doable, but sequenced here because it gates the build)

| # | Step | File |
|---|---|---|
| 8 | Add each new key to `env.schema` as `envField.string({ context: "server", access: "secret", optional: true })` | `astro.config.mjs` |
| 9 | **`npx astro sync`** — mandatory, or `astro:env/server` imports fail type-check and lint errors out | — |
| 10 | Add a `configStatuses` entry so a missing key surfaces in the red banner instead of failing at request time | `src/lib/config-status.ts` |
| 11 | Add `"images": { "binding": "IMAGES" }` explicitly. The adapter injects it at build time, so `npx wrangler types` **does not see it** and `env.IMAGES` is a type error. The adapter's customizer skips injection when the key is present, so this is idempotent | `wrangler.jsonc` |
| 12 | Declare `cfContext` on `App.Locals` if `waitUntil` is needed — `Astro.locals.runtime` is gone, and its pieces split four ways: `env` → `cloudflare:workers`, `cf` → `Astro.request.cf`, `caches` → global, **`ctx` → `Astro.locals.cfContext`** | `src/env.d.ts` |
| 13 | Add the receipt page path to `PROTECTED_ROUTES` | `src/middleware.ts` |

### Decisions only the operator can make

- **Parsing timeout value** (PRD Open Question 3) — still unowned. The spike's measured latency should set it.
- **Line-item names: store or discard** (§H Gap 1).
- **Scope fallback** if the spike misses the bar (§I).

---

## Code References

- `astro.config.mjs:39-44` — `env.schema`, the two existing secret entries and their exact shape
- `astro.config.mjs:29-38` — `IMAGES` binding kept deliberately, with the receipt-downscaling rationale
- `src/lib/supabase.ts:1-9` — the `astro:env/server` import + early-`null` pattern every new integration copies
- `src/lib/config-status.ts` — `configStatuses` / `missingConfigs`; one object literal per integration
- `src/layouts/Layout.astro:17,29-44` — `lang="pl"` decision record; the red config banner
- `src/pages/api/entries/index.ts:35-79` — the canonical `POST` handler to clone
- `src/pages/api/entries/summary.ts:14-15` — why no route sets cache headers
- `src/lib/services/entries.ts:82-118` — `assertCategoryUsable`, the two app-layer-only invariants
- `src/lib/services/entries.ts:120-138` — `createEntry`, the single-row insert with no batch path
- `src/lib/services/categories.ts:67-78` — `listCategories`, returns both kinds
- `src/components/entries/EntryForm.tsx:109-139` — submit / pending / error-surfacing pattern
- `src/components/entries/DayView.tsx:37-92` — the `cancelled` closure-guard async idiom
- `src/middleware.ts:4-6,20-31` — `PROTECTED_ROUTES`, prefix match, `Cache-Control: private, no-store`
- `src/types.ts` — DTO conventions; command types live in service files as `z.infer` exports
- `supabase/migrations/20260815164539_create_entries_table.sql:7-15` — the entries column set (no text field)
- `supabase/migrations/20260815181500_add_category_kind.sql:6-10` — precedent for a backward-compatible additive migration
- `wrangler.jsonc` — bindings, `compatibility_flags: ["nodejs_compat"]`, no `limits` block

## Architecture Insights

- **The store-nothing receipt flow survives contact with the research.** `infrastructure.md`'s proposal — image held in an in-memory `File` in a React island, sent to the model, discarded — is compatible with every candidate. It dissolves the retention half of PRD Open Question 3 by construction. The one new threat to it is AI Gateway's default body logging, neutralised by one header.
- **Deterministic validation outranks model selection.** This is the most consistent finding across independent sources: ReceiptBench's value-tampering documentation, iunera's ~100-receipt field reports, Ciba's demo, and `receipt_cut`'s green/red UX all converge on the same guard — sum the line items in code, compare to the printed total, surface the delta, never auto-correct. It is also cheap, testable, and provider-independent.
- **A routing layer is the right hedge against an unmeasured hypothesis.** Because no evidence exists for the exact model tier PaperTrail would use, the ability to change providers with a one-string edit is worth more than picking "correctly" up front.
- **Extraction and categorisation are separable risks with different evidence.** Categorisation rides on ReceiptBench's Semantic Reasoning (~0.87); extraction rides on Structure (0.49–0.58). If the spike shows the split falls the same way, the fallback of "parse the total only, user picks the category" becomes attractive rather than defeatist.
- **The CPU ceiling is a design input, not a deployment detail.** It shapes the image pipeline (downscale client-side, `Buffer` not `btoa`) and argues for the Paid plan before the slice ships rather than after the first 1102.

## Historical Context (from prior changes)

- `context/deployment/deploy-plan.md:134` — the LLM key was **deliberately deferred** to this change, with the exact three-step registration procedure pre-written. `:385` lists provider choice and the receipt-storage decision as out of scope for deployment.
- `context/deployment/deploy-plan.md:87,190` — the Images binding was recorded as **chosen, not inherited**, explicitly for receipt downscaling, with a reversal recipe.
- `context/foundation/infrastructure.md:93` — the pre-mortem predicts this slice consumes the schedule via the Node recipe (`sharp`, storage bucket, signed upload, retention job). §D and §E of this document are the direct answer to that prediction.
- `context/foundation/infrastructure.md:147-166` — the store-nothing architectural note, flagged as *"a proposal to confirm during implementation, not a settled decision."* This research confirms it.
- `context/changes/bootstrap-verification/verification.md:43` — flags that *"the edge runtime constrains long-running work — which is the shape of the receipt-parsing call."* Resolved: there is no wall-clock cap, and I/O does not consume CPU.
- `context/archive/2026-08-15-custom-categories/plan.md:57` — the Polish UI-copy decision, re-affirmed in S-02 and S-04.
- `context/archive/2026-08-15-daily-expense-entry/plan.md:54` — the ≤4-interaction measurement unit; every slice since re-verifies it as an explicit acceptance step, and this one should too.
- `context/foundation/lessons.md` — app-layer-only invariants are unprovable by pgTAP; the plan must name which parts are manual-only.

## Related Research

- **`research-recommendations.md`** (same folder) — the condensed decision surface distilled from this document: decisions table, blocking questions, constraints, spike protocol, and the manual setup checklist. **That is the file `/10x-plan` should consume**; this one is the evidence and citation record behind it.
- `context/foundation/charts_analysis.md` + `charts_recommendations.md` — the house precedent for a long analysis paired with a condensed decisions document, which the pairing above follows. This is the first `research.md` in the repo.

## Open Questions

1. **Does accuracy clear the Secondary bar on Polish paragony?** Owner: user. **Blocks S-06.** Unresolvable by research — §I is the protocol. This is PRD Open Question 4 and roadmap OQ-2, still open and now sharpened: the literature says extraction is the risk, not categorisation.
2. **Parsing timeout value.** Owner: user. **Blocks S-06.** PRD Open Question 3's surviving half. Should be set from the spike's measured p95 latency plus headroom, not guessed.
3. **Do parsed line-item names get stored?** Owner: user. Does not block the spike, but blocks the schema step of the plan. §H Gap 1.
4. **AI Gateway or direct provider?** Owner: user. Recommendation is Gateway; the counter-argument is that it adds Cloudflare as a second processor in the disclosure and a 5% credit fee.
5. **Workers Free or Paid before this ships?** Owner: user. §D argues Paid; it is $5/month per *account*, not per app.
6. **Does the fallback scope (total-only, user picks category) remain acceptable** if the spike misses the bar? Owner: user. Materially changes the FR-011 product promise.

## Sources

Live-fetched 2026-08-16 unless noted. Vendor-published figures are marked where they were used.

**Benchmarks**: [ReceiptBench arXiv 2605.22413](https://arxiv.org/html/2605.22413v1) · [KIE-HVQA arXiv 2506.20168](https://arxiv.org/html/2506.20168v2) · [IDP Leaderboard](https://www.idp-leaderboard.org/) · [OmniDocBench arXiv 2412.07626](https://arxiv.org/abs/2412.07626) · [CodeSOTA Polish OCR](https://www.codesota.com/polish-ocr) · [PolEval 2021 OCR correction](https://github.com/poleval/2021-ocr-correction)

**Pricing / model docs**: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini media resolution](https://ai.google.dev/gemini-api/docs/media-resolution) · [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding) · [OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [OpenAI images & vision](https://developers.openai.com/api/docs/guides/images-vision) · [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision) · [Claude multilingual](https://platform.claude.com/docs/en/build-with-claude/multilingual-support) · [Mistral OCR 4](https://mistral.ai/news/ocr-4/)

**Terms / privacy**: [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) (EEA paid-only) · [Gemini usage policies](https://ai.google.dev/gemini-api/docs/usage-policies) · [Gemini ZDR](https://ai.google.dev/gemini-api/docs/zdr)

**Cloudflare**: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [AI Gateway](https://developers.cloudflare.com/ai-gateway/) · [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/) · [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/) · [AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/) · [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) · [Images binding](https://developers.cloudflare.com/images/optimization/binding/) · [Workers AI markdown conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/) · [subrequest limit change, Feb 2026](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)

**Excluded (Polish)**: [AWS Textract limits](https://docs.aws.amazon.com/textract/latest/dg/limits-document.html) · [Google Document AI processors](https://docs.cloud.google.com/document-ai/docs/processors-list) · [Llama 3.2 Vision model card](https://huggingface.co/meta-llama/Llama-3.2-11B-Vision-Instruct) · [Veryfi languages](https://faq.veryfi.com/en/articles/5415075-languages-supported-by-veryfi-ocr-api) · [Azure prebuilt language support](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/prebuilt?view=doc-intel-4.0.0)

**SDKs**: [anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript) · [openai-node](https://github.com/openai/openai-node) · [deprecated-generative-ai-js](https://github.com/google-gemini/deprecated-generative-ai-js) · [workerd#1020 (closed)](https://github.com/cloudflare/workerd/issues/1020)

**Polish practitioner**: [Ciba BRAVE demo](https://pl.linkedin.com/posts/dariusz-ciba_bravesummertour-ai-llm-activity-7477465902976913408-ivP4) · [JaskierBard/receipt_cut](https://github.com/JaskierBard/receipt_cut) · [wbiegala/receipt-analyzer](https://github.com/wbiegala/receipt-analyzer) · [michalkukla e-paragon](https://michalkukla.pl/projects/e-paragon) · [AIzi.pl OCR paragonów](https://aizi.pl/blog/ocr-paragonow-ai-make) · Automaize *(vendor)* · iunera validation-layer field reports *(vendor, but the ~100-receipt failure catalogue is the most specific available)*

**Apple / browser**: [Safari HEIC accept-list inversion](https://developer.apple.com/forums/thread/743049)

### Claims that could not be verified

- **`Buffer` base64 performance on workerd specifically** — the ~60× figure is Node 22 / V8. workerd's `node:buffer` is a separate implementation that explicitly does not use Node's memory pool. Measure via Workers Logs before relying on the margin.
- **AI Gateway added latency** — no Cloudflare-authored figure exists; third-party estimates cluster at 10–60 ms, negligible against multi-second inference.
- **`gpt-5.6-luna`'s image-token multiplier** — absent from OpenAI's table; its cost line was inferred and is an estimate.
- **Mistral's Polish support in official docs** — "170 languages… Eastern Europe" names no list; Polish is confirmed only by one practitioner blog. Mistral's operative API training/retention terms were unreachable.
- **Azure's and Veryfi's training/retention posture** — not researched; both were excluded on other grounds.
- **Taggun and Klippa DocHorizon** — no data gathered. Treat as unresearched, not as negative findings.
- **Exact AI Gateway model strings** (`google/gemini-3-flash` etc.) — the naming pattern is documented; the exact current string for the chosen tier must be confirmed at implementation.
- **HEIC specifically through `env.IMAGES.input()`** — HEIC is listed as a product-level input format with no binding-specific restatement.
- **Any measured accuracy figure on real Polish paragony, for any model or vendor.** This is the central evidence gap. It cannot be closed by desk research.
