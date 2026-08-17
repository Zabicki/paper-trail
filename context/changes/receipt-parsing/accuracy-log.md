# Receipt parsing — live accuracy assessment (S-06 Phase 4)

This file replaces the pre-build spike, by decision: ship the feature, use it on
real receipts for a couple of weeks, and measure. Its deliverable is evidence
and the decision that evidence supports — no product code.

**Model under test**: `google/gemini-3-flash` via Cloudflare AI Gateway
(`RECEIPT_MODEL` in `src/lib/services/receipts.ts`). Record the value here if it
changes mid-log, and start a fresh table below the change — mixing two models in
one set of figures makes both meaningless.

**Target**: 20+ receipts, including at least 3 faded thermal or crumpled ones.
Faded thermal is the dominant failure driver and it produces *confident
hallucinations* rather than blanks, so a log without them flatters the model.

## How to fill a row

Fill it from the paper, not from the screen. The comparison is against what is
actually printed on the paragon.

| Column | What it means |
| --- | --- |
| **Sklep** | Biedronka / Lidl / Żabka / … |
| **Poz.** | True number of line items on the paper (not what came back) |
| **Stan** | `czysty` / `zgnieciony` / `wyblakły` |
| **Ekstrakcja** | Of the true line items, the fraction returned with the correct name **and** amount. `7/9` |
| **Kategoryzacja** | **Of the correctly-extracted items only**, the fraction landing in the category you would have chosen. `6/7` |
| **Suma** | Did the item sum match the printed `SUMA PLN`? `tak` / `nie (+3,20)` |
| **Rabaty** | Were `RABAT`/`OPUST` lines emitted as products? `nie` is the pass |
| **Mnożniki** | Was a `2 x 3,49` line expanded to one item at `6,98`? `tak` / `nie` / `brak` |
| **Przecinki** | Were comma decimals parsed correctly? `tak` / `nie` |
| **Czas** | Wall-clock seconds from tapping the file picker to the review panel |

The two fractions are kept deliberately separate and must **never** be blended
into one number. Categorisation is the PRD's Secondary success criterion (a
majority of line items correctly categorised without correction); extraction is
what ReceiptBench bounds at 0.49–0.58. A single blended figure hides which half
is failing — and they have completely different fixes.

Note that categorisation is scored *over correctly-extracted items only*. An
item the model never read cannot be miscategorised, and counting it against
categorisation would double-charge one extraction failure.

## Log

| # | Data | Sklep | Poz. | Stan | Ekstrakcja | Kategoryzacja | Suma | Rabaty | Mnożniki | Przecinki | Czas | Uwagi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |

## Rollup

Fill in once the log has 20+ rows.

- Receipts logged: **—** (of which faded/crumpled: **—**)
- Extraction, pooled: **—** (correctly extracted items ÷ true items, summed across receipts — not an average of the per-receipt fractions, which over-weights short receipts)
- Categorisation, pooled: **—** (correct categories ÷ correctly-extracted items)
- Receipts where the sum matched exactly: **—**
- Receipts where a discount line came back as a product: **—**
- Median wall-clock latency: **—** s (worst: **—** s)

Split the two figures by condition as well — if clean receipts clear the bar and
faded ones drag the pooled number under it, the answer is guidance about photo
quality, not a different model.

## Other Phase 4 checks

These are not per-receipt; do each once against real traffic.

- [ ] **Manual-path budget re-verified.** The ≤4-interaction / ≤10s budget for
      *manual* entry on `/dashboard` still holds with the Paragon section
      present. Every slice since S-02 carries this step, and this is the first
      one to add a whole new section above "Wpisy tego dnia".
- [ ] **CPU time per parse read from Workers Logs.** It cannot be self-timed —
      `Date.now()` and `performance.now()` are frozen inside a Worker and return
      the time of the last I/O. Free-plan logs retain only **3 days**, so check
      within the first days of real use or the data is gone. This measurement,
      not the plan's estimate, settles Free vs Paid and whether a `limits.cpu_ms`
      block is needed.
      - Observed CPU ms per request: **—**
      - Verdict: **—**
- [ ] **AI Gateway dashboard re-checked after real traffic.** Confirm no request
      or response bodies are retained — i.e. `cf-aig-collect-log-payload: false`
      is still taking effect. This is the single check protecting the
      store-nothing design, and it has to be re-run against real volume rather
      than the one test call from Phase 2.

## Decision record

Write **one** of these three conclusions explicitly once the log is complete.
Not an impression — the figures above have to support whichever is chosen.

1. **Clears the bar.** Categorisation meets the PRD's Secondary criterion and
   extraction is good enough that the item path is the one people actually use.
   → Close the slice, archive the change.
2. **Misses on categorisation.** Extraction is fine; items land in the wrong
   category too often. → Cheapest fixes first, in order: sharpen the prompt's
   category instructions, then swap `RECEIPT_MODEL` (`gemini-3.5-flash-lite`,
   `gpt-5-mini`) — a one-constant change, which is exactly why it is a constant.
3. **Misses on extraction.** Line items come back wrong or invented regardless
   of category. → The total-only path is already shipped, so the honest move is
   to lean on it in the UI and consider a Mistral OCR pre-stage (+~$0.30/month)
   before spending anything else.

**Conclusion**: _pending — measurement in progress._
