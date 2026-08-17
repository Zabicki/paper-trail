<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Category Distribution View (S-05) ⨯ Receipt Parsing (S-06)

- **Plans**: `context/changes/category-distribution-view/plan.md`, `context/changes/receipt-parsing/plan.md`
- **Scope**: Both plans in full, as merged to `master`. S-05 all 5 phases; S-06 phases 1–3 (Phase 4 is an open measurement phase). Includes the parallel-merge integration (`2e83cee`, `df88d63`).
- **Reviewed tree**: `/Users/krzysztof.zabicki/WebstormProjects/PaperTrail` @ `df88d63`
- **Date**: 2026-08-17
- **Verdict**: REJECTED at review time — driven by a single fixable defect (F1), not by the overall state of the work. **Triaged and cleared the same day**: F1 is fixed, so the condition that produced the REJECTED verdict no longer holds.
- **Findings**: 1 critical, 9 warnings
- **Triage** (2026-08-17): 8 fixed, 2 skipped. Fixed — F1, F2, F4, F5, F6, F7, F9, F10. Skipped by decision — F3 (no rate limit on the paid parse endpoint), F8 (receipt text still reaches Workers Logs). Both skipped findings stand as written for a later pass.
- **Post-triage verification**: `npm run lint` 0 errors (4 pre-existing `no-console` warnings), `npx astro check` 78 files / 0 errors, `npm run build` green, `supabase test db` **Files=6, Tests=102, Result: PASS** against the full thirteen-migration set. Two fixes were verified empirically rather than by reasoning — F4's replay behaviour over live PostgREST, and F6's injectivity across all 240 hex × duplicate-count combinations.

## Context: two changes, one merged tree

S-05 and S-06 were built in parallel in separate worktrees against separate Supabase stacks, then merged back to back onto `master`:

```
aa2b5fd (common ancestor)
  ├── feature/receipt-parsing        cd8b275 → merged as 2e83cee
  └── feature/category-distribution  11bc31e → merged as df88d63  ← master
```

Overlapping files: `src/types.ts`, `src/components/reports/ReportsView.tsx`, `context/foundation/roadmap.md`.

**The merge itself is clean.** No lost work; `src/types.ts` is a true union of both branches' appended blocks; the one relocation the author flagged as risky (S-06's `response.json<EntriesSummary>()` edit to `ReportsView.tsx`, which S-05 rewrote out from under it) is genuinely reapplied in `OverviewBoard.tsx:94`, byte-equivalent and in the same surrounding structure; migration timestamps are strictly increasing with no duplicates; the cross-branch schema interaction is safe by construction (the new `description` column is nullable and additive, and no query in the repo uses `select *`); and the merged config is coherent end to end (`astro.config.mjs` env schema ↔ `.env.example` ↔ `config-status.ts` agree exactly on all four vars, with no orphan and no gap).

Six files on `master` match neither branch tip. Two are correct unions (`types.ts`, `roadmap.md`). Four are merge-time authorship never gated by either plan's success criteria: `.env.example` (+20, fixes a real S-06 omission), `CLAUDE.md` (documents the new convention), and one line each in `CategoriesBoard.tsx` / `OverviewBoard.tsx`. The last two are provably runtime-inert — TypeScript generics erase, so `response.json<T>()` compiles to the identical `response.json()`.

Both plans show unusually high fidelity to their contracts. Every load-bearing claim was checked against the shipped code and the great majority hold exactly, including the ones with silent failure modes: `security invoker` with no `user_id` predicate in the new SQL function, the `revoke`/`grant` pair, the route preamble ordering that keeps an anonymous caller from distinguishing a malformed query from a missing session, the `cf-aig-collect-log-payload: false` header on the image-carrying request, the colour walk over the full sorted list, and `createEntriesBatch`'s two app-layer-only invariants.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria on the merged tree, re-run for this review (neither branch re-verified after the merge):

| Command | Result |
|---|---|
| `node --version` | `v22.14.0` — matches `.nvmrc` |
| `npm run lint` | **pass** — 0 errors, 4 warnings (all `no-console` in `src/lib/services/receipts.ts`, warning-level by design) |
| `npx astro check` | **pass** — 77 files, 0 errors, 0 warnings, 5 hints |
| `npm run build` | **pass** — server built in 6.72s |
| `npx supabase test db` | **NOT RUN against the merged migration set** — see F2 |

## Findings

### F1 — `MAX_BUCKETS` does not bound a buckets × categories response; PostgREST truncates silently

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (correctness / data safety)
- **Location**: src/lib/services/reports.ts:31-36, src/lib/services/reports.ts:297-299
- **Detail**: `getCategorySummary` reuses S-04's `MAX_BUCKETS = 400` guard unchanged, but its own comment documents Board A's arithmetic — "400 buckets is ~802 rows including the grand totals, comfortably clear of the cap." Board A returns 2 rows per bucket; Board B returns `buckets × categories + categories + 1`. `max_rows = 1000` is confirmed at `supabase/config.toml:18`, and PostgREST **truncates rather than erroring**, which the existing comment names as the exact hazard the guard exists to prevent. Nothing downstream detects the truncation — `toCategorySummary(range, input.bucket, result.data ?? [])` consumes whatever arrived.

  The plan anticipated the arithmetic ("a 400-bucket × 30-category response is 12,000 rows, well past PostgREST's `max_rows = 1000`") and concluded it stays safe "in practice" because `bucketFor` caps a year at ~12 month buckets. That reasoning holds for the *bucket* dimension and misses that the *category* count is user-defined and uncapped.
- **Failure scenario**: Two paths, both reachable.
  1. *No crafting needed.* `Cały okres` resolves to a 20-year span, `bucketFor` → month. A user with 3 years of history and 30 categories yields `36 × 30 + 30 + 1 = 1111` rows. Even the **default** `Ostatnie 30 dni` trips it at 34+ categories spent on most days (`30 × 34 + 35 = 1055`) — and the S-05 demo migration deliberately seeds 30.
  2. *Crafted URL, any authenticated user.* `?from=2026-01-01&to=2027-02-04&bucket=day` is exactly 400 buckets, so the guard passes, and 30 categories make it up to 12,000 rows.

  Grouping-set output order is unspecified and the `()` set is emitted last, so the row most likely dropped is the grand total. `total` then stays at its initializer `0` (`reports.ts:246`) and every consumer degrades quietly instead of failing: `shareOf` returns 0 for everything, `aboveMinShare` falls back to `categories.length` so top-N selection silently switches rule, the donut centre reads `0,00 zł`, and every ranking row prints `0%` beside a real złoty amount. Truncated category rows also mean missing slices and missing stack segments. This is precisely the "wrong number that still looks like a valid answer" the guard was written against.
- **Fix A ⭐ Recommended**: Add a truncation tripwire after the RPC — `if (result.data && result.data.length >= 1000) throw new RangeTooLargeError();` — and correct the `MAX_BUCKETS` comment to note it now serves two callers with very different row widths.
  - Strength: Exact, cannot drift as the category count grows, three lines, and it reuses the `RangeTooLargeError` → 400 mapping the route already has. Turns a silent wrong number into the same visible error the range guard already produces.
  - Tradeoff: A legitimate view (`Cały okres` on a mature account with many categories) becomes an error rather than a chart. That is a UX regression for a real user, not just for a crafted URL.
  - Confidence: HIGH — the truncation mechanism and the `max_rows` value are both confirmed in this repo, and `RangeTooLargeError` handling already exists end to end.
  - Blind spot: How often real accounts will actually hit 1000 rows has not been measured; the fix converts a silent corruption into a visible dead end for exactly those users.
- **Fix B**: Split into two RPCs — per-category grand totals (≤ categories + 1 rows) and bucket cells — so only the wide query is capped, and cap it on its own terms.
  - Strength: Keeps `Cały okres` working at any category count, and the percentage denominator (the `()` row) can never be the row that gets dropped.
  - Tradeoff: Two round trips instead of one, a second SQL function or a parameter to the existing one, and it reopens a phase that shipped verified.
  - Confidence: MEDIUM — the shape is clearly workable, but it is a Phase 1+2 change rather than a service-layer patch.
  - Blind spot: Have not checked whether the bucket-cell query alone can still exceed 1000 rows on a wide account (400 × 30 would), so Fix B likely still needs Fix A's tripwire on the wide half.
- **Decision**: FIXED via Fix A — `POSTGREST_MAX_ROWS` tripwire added after the RPC in `getCategorySummary`, and the `MAX_BUCKETS` comment rewritten to state that it bounds buckets rather than rows and that the two callers have different row widths. Triage established that the row count is driven by variety × history (non-empty bucket × category cells), not expense volume, so the realistic exposure is `Cały okres` on a mature many-category account rather than the default preset. Fix B (splitting the RPC so the donut and ranking never truncate) was considered and not taken.

### F2 — The pgTAP suite has never run against the merged migration set

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/ (all five files), supabase/migrations/ (twelve files)
- **Detail**: `npx supabase test db` is an explicit automated success criterion in both plans (S-05 step 1.2, S-06 step 1.2) and both are ticked — but each branch ran it against its own isolated Supabase stack, against its own subset of migrations. Nothing has executed the combined twelve-migration set. Per `CLAUDE.md` this verification is local-only and never runs in CI, so a green deploy will not catch it either. Static analysis says all 92 assertions across the five files still pass, and the specific cross-contamination risk was checked and does not fire — `entries_rls_test.sql:51` and `categories_rls_test.sql:29` do assert absolute `count(*)`, but they survive because the demo user is `33333333-…` while every test impersonates `11111111-…`/`22222222-…` and the counts run under RLS, so demo rows are invisible. Both suites also use explicit insert column lists, so neither assumes the other's table shape. That is reasoning, not evidence.
- **Failure scenario**: A schema or grant interaction between the two branches' migrations breaks an assertion. Because CI never runs pgTAP and the deploy job only does `link` + `db push`, the break surfaces first as a 500 on a live data route against a hosted schema that has already been migrated — the exact failure mode `CLAUDE.md` documents as having broken the first deploy.
- **Fix**: On an isolated stack, per `CLAUDE.md`'s pinned-CLI rule: `npm ci && npx supabase start -x vector && npx supabase db reset && npx supabase test db`. Expect `Files=5`.
- **Decision**: FIXED — run on 2026-08-17 against this worktree's own `paper-trail` stack (the sibling `paper-trail-receipts` stack was left untouched), using the pinned `./node_modules/.bin/supabase` 2.98.2 rather than bare `npx`. All twelve migrations applied in order, then `Files=5, Tests=92, Result: PASS` — every file ok. The static-analysis reasoning in the Detail above is now backed by evidence. Re-run after the F7 migration edit, also green.

### F3 — `/api/receipts/parse` spends third-party money and a hard monthly quota with authentication as its only limit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality (security)
- **Location**: src/pages/api/receipts/parse.ts:15
- **Detail**: Every POST spends AI Gateway Unified Billing credit funded on `RECEIPT_GATEWAY_ID`, and `src/lib/receipt-image.ts:78-80` spends one of the 5,000 free `IMAGES.transform()` per month whenever `.info()` reports a non-JPEG/PNG/WebP format or `width > 2000`. There is no per-user rate limit, daily cap, or counter anywhere in the repo. Signup is open — `src/pages/api/auth/signup.ts:13` is a plain `supabase.auth.signUp` with no invite or allowlist. This is the first endpoint in the app with a marginal cash cost per request, and neither the plan nor the research treated abuse as a decision variable (cost was assessed at 75 receipts/month of honest use).
- **Failure scenario**: Anyone with a working email address registers and scripts 5,000 POSTs of a 3000px-wide JPEG. The Images transform quota is exhausted (error 9422), so `normaliseReceiptImage` falls into its catch at `receipt-image.ts:84` for *every* real user's HEIC upload and forwards un-normalised bytes. Meanwhile the gateway credit balance drains and every later parse returns 402 code 2021, which surfaces to legitimate users as the generic 502 `Usługa odczytu paragonów zwróciła błąd` — the exact indistinguishable failure the comment at `receipts.ts:23-28` records as having already cost real debugging time once.
- **Fix A ⭐ Recommended**: A per-user daily parse cap enforced in the route before the gateway call — a `receipt_parses(user_id, day, count)` table with RLS enabled in the same migration per the project's day-one rule.
  - Strength: Owned by the app, testable by pgTAP for the RLS half and by curl for the cap, and it degrades to a clear Polish message rather than a generic 502. Fits the stack with no new infrastructure.
  - Tradeoff: A migration, a service function, and a new route branch — real work, and it adds a write to the hot path of a feature whose latency budget is already tight.
  - Confidence: MEDIUM — the shape is standard, but the right cap number is unmeasured and Phase 4 is what would inform it.
  - Blind spot: Have not checked whether the already-bound `SESSION` KV would be a cheaper home for the counter than a Postgres table.
- **Fix B**: A Cloudflare rate-limiting rule on the path, configured outside the repo.
  - Strength: Zero code, zero latency cost, and it stops the traffic before it reaches the Worker at all.
  - Tradeoff: Invisible to the codebase and to anyone reading the plan; per-IP rather than per-user, so it neither stops a distributed script nor gives an honest heavy user a clear signal.
  - Confidence: MEDIUM — effective as a blunt instrument, but it does not express "per account per day", which is the actual policy.
  - Blind spot: Have not verified what rate-limiting tier this Cloudflare account has available.
- **Decision**: SKIPPED — no cap added, in the app or at the edge. The endpoint remains protected by authentication alone, on open signup, with a marginal cash cost and a hard 5,000/month Images quota per request. Left deliberately un-addressed; the finding stands as written for whenever it is revisited (Phase 4's measurements are what would size a cap).

### F4 — The batch confirm is not idempotent, and its failure copy invites the retry that doubles the receipt

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: src/components/receipts/ReceiptCapture.tsx:160-176
- **Detail**: The confirm POST has no request id, no client-generated key, and no server-side dedupe — `createEntriesBatch` mints fresh `id`s on every call. On a network rejection the catch sets `Nie udało się połączyć z serwerem. Spróbuj ponownie.` and `ReceiptReview.tsx:110` re-enables the button. `handleBatchSaved`'s dedupe (`DayView.tsx:137`) is by server `id`, so it cannot recognise a re-write as a duplicate.
- **Failure scenario**: A user confirms a 24-line receipt on mobile. The POST commits server-side but the response is lost when the connection drops. The user reads "Spróbuj ponownie", taps again, and 48 entries land on the day. The sum check gives no signal — it compares items against the printed paragon total, not against what is already stored — so the doubling is discoverable only by scrolling the day's list. This is the one path in the app where a single lost response silently doubles a whole receipt's worth of financial data.
- **Fix A ⭐ Recommended**: Generate a `clientBatchId` once per parse in `ReceiptReview`, accept it in `createEntriesBatchSchema`, store it on the rows behind a unique index, and make the insert a no-op on conflict.
  - Strength: Actually closes the hole rather than warning about it, and keeps the retry affordance — which is the right affordance on mobile.
  - Tradeoff: A migration (column + unique index), a schema change, and a service change; touches the write path that shipped verified in Phase 1.
  - Confidence: MEDIUM — mechanically straightforward, but it reopens Phase 1's manual-only invariant checks, which the plan names as a permanent re-verification requirement.
  - Blind spot: Have not checked whether `on conflict do nothing` on a multi-row insert still lets `createEntriesBatch` return the full `Entry[]` the route contract promises.
- **Fix B**: Change only the batch path's network-failure copy to tell the user to check the day's list before retrying.
  - Strength: One string, no migration, ships immediately, and it makes the risk visible to the person who can see the consequence.
  - Tradeoff: Mitigation, not a fix — the double-write remains possible, and a user who retries anyway still gets 48 rows.
  - Confidence: HIGH — trivially correct as far as it goes.
  - Blind spot: None significant; the limitation is inherent, not uncertain. (The single-entry path shares the copy and the same exposure, but at 1 row, which is why the shared string is acceptable there and not here.)
- **Decision**: FIXED via Fix A. Four parts:
  1. `supabase/migrations/20260817190000_add_entry_batch_key.sql` — `batch_id uuid` + `batch_seq smallint`, a `check ((batch_id is null) = (batch_seq is null))`, and `unique (user_id, batch_id, batch_seq)`. Two columns rather than one because a receipt is N rows sharing a batch id and no natural per-item key exists (two identical coffees on one paragon are legitimately two rows). A **plain** constraint, not the partial index the repo's other uniqueness rule uses: PostgREST emits `on conflict (cols) do nothing` with no `index_predicate`, and Postgres only infers a partial unique index when the statement carries a matching one — a partial index would have made every confirm fail outright. NULLs being distinct by default is what lets unlimited manual entries coexist under the key.
  2. `createEntriesBatchSchema` gained a **required** `batchId: z.uuid()`. Required, not optional, because an optional key degrades silently to the non-idempotent behaviour being removed. `batch_seq` is assigned server-side from the array index and never accepted from the client.
  3. `createEntriesBatch` now uses `upsert(..., { onConflict: "user_id,batch_id,batch_seq", ignoreDuplicates: true })` — still one statement, so still one transaction and still the all-or-nothing property the plan made load-bearing.
  4. `ReceiptCapture` mints `crypto.randomUUID()` once per successful **parse** (not per confirm attempt — re-minting per attempt would reopen the hole), holds it across retries, clears it in `toIdle()`, and sends it in the confirm body.
- **Blind spot resolved**: the finding's open question — whether `on conflict do nothing` still lets the service return the full `Entry[]` the route promises — was tested against the local stack's real PostgREST, not reasoned about. **It does not**: the replay returned `[]`, which unfixed would have rendered "Zapisano wpisy z paragonu (0)" for a receipt sitting in the database. The service therefore re-selects by `batch_id` ordered by `batch_seq` whenever the upsert returns fewer rows than it was given, so a retry returns the same `Entry[]` as the first call and `DayView`'s id-keyed dedupe recognises the rows as already present. Measured end to end: first call → 2 rows with joined category; replay → `[]` inserted; stored count → still 2 (**doubling closed**); re-select → both rows in confirm order. `on_conflict` inference works with `user_id` absent from the payload (it defaults to `auth.uid()`), confirmed both in pgTAP and over HTTP.
- **Known edge case, accepted**: if a user *edits* the item list and retries after a lost response, seqs already stored conflict and only genuinely new positions are appended; the re-select then returns everything under the batch id, which is accurate to what is stored. Not corrupting, and re-minting the key on edit would reopen the double-write.
- **New coverage**: `supabase/tests/entries_batch_key_test.sql` (10 assertions) — separate file, per the `entries_description_test.sql` precedent, so `entries_rls_test.sql` passing unchanged remains the evidence that the new columns changed nothing about RLS. Suite is now `Files=6, Tests=102, Result: PASS`.

### F5 — The 10 MB upload limit is enforced after the whole body is buffered into the isolate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/pages/api/receipts/parse.ts:37
- **Detail**: `form = await context.request.formData()` materialises the complete body before `image.size` exists at line 46, so `MAX_IMAGE_BYTES` cannot protect the buffer it is meant to protect. The comment at line 29 ("answers before reading a 10MB body off the wire") is true of the 503 secrets check above it, but not of this one. The legal path is also tighter than it looks: a permitted 10 MB JPEG is held roughly 5× concurrently — the `File` in `FormData`, the `bytes` copy (`receipt-image.ts:48`), a `new Blob([bytes])` copy per `streamOf()` call (`receipt-image.ts:52`, called twice when a transform runs), the ~13.3 MB base64 string, and the ~13.6 MB `JSON.stringify` body — roughly 55–70 MB peak for one in-limit upload against a 128 MB isolate ceiling.
- **Failure scenario**: An authenticated user curls a 90 MB multipart body at `/api/receipts/parse`. The Worker buffers all 90 MB and the intended 413 never renders — the isolate hits the memory ceiling and is killed with error 1102, giving the client a 500 instead of the actionable Polish message.
- **Fix**: Reject on `Content-Length` before line 37 (`const declared = Number(context.request.headers.get("content-length")); if (declared > MAX_IMAGE_BYTES) return 413;`), keeping the existing post-buffer `image.size` check as the authoritative one. Cloudflare enforces the real body size against the declared header, so it is effective as a pre-buffer gate against honest and dishonest clients alike. Separately, pass `file.stream()` to the first `env.IMAGES.info()` call instead of `new Blob([bytes]).stream()` to drop one full copy.
- **Decision**: FIXED — both halves. `parse.ts` gained a `Content-Length` gate before `formData()`, thresholded on a new `MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 KB` rather than `MAX_IMAGE_BYTES` itself: `Content-Length` covers the whole multipart envelope, so gating on the image limit exactly would have rejected an image legitimately at the 10 MB limit. A missing or unparseable header falls through by design (`Number(null) === 0`), leaving `image.size` authoritative for chunked requests. In `receipt-image.ts` the `streamOf()` helper is gone; both `env.IMAGES.info()` and `env.IMAGES.input()` now stream straight off the `File` (a `Blob` is re-readable, so calling `file.stream()` twice is safe), dropping two full-size copies rather than the one the finding named.

### F6 — The duplicate-colour lightness shift is non-injective under clamping: two categories can get byte-identical fills

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (correctness)
- **Location**: src/components/reports/distribution.ts:117-128
- **Detail**: The alternation and the walk over the full sorted list are both correct — the load-bearing invariant (expanding `Pozostałe` cannot recolour a visible arc) holds structurally. The clamp is the defect: once `lightness + direction * magnitude` saturates, successive same-direction occurrences collapse onto the same boundary value. For `#3b82f6` (Niebieski, L = 0.598039, S = 0.912194), occurrence 3 raw-computes 0.858039 and occurrence 5 computes 0.988039 — both clamp to `MAX_LIGHTNESS` 0.84, so both call `hslToHex(h, 0.912194, 0.84)` and return the identical hex. `#ef4444` (Czerwony) collides at the same pair; the low clamp collides at occurrences 6 and 8.
- **Failure scenario**: A user with 6 categories on Niebieski sees the 4th and the 6th rendered in exactly the same colour — two donut arcs, two ranking swatches and two stack segments indistinguishable from each other. That is the precise misread the whole shift mechanism exists to prevent, and it fails silently. Note the S-05 demo migration maxes out at 3 categories per hex (`#22c55e`: Jedzenie/Restauracje/Rośliny; `#64748b`: Prezenty/Książki/Papiernicze), so this is **not** observable in the reproducible fixture that migration was written to provide — manual criterion 3.8 ("no two visible rows share a swatch") passed truthfully and still missed it.
- **Fix A ⭐ Recommended**: Count duplicates per hex in the existing `seen` pre-pass, then distribute occurrences evenly across the `[MIN_LIGHTNESS, MAX_LIGHTNESS]` band instead of stepping a fixed amount — or equivalently pick a step of `min(LIGHTNESS_STEP, band / ceil(k/2))`.
  - Strength: Injective by construction at any duplicate count, stays inside the existing module with no new dependency, and preserves the "first occurrence keeps its hex byte-identical" rule the plan requires.
  - Tradeoff: The shift for a given category now depends on how many siblings share its hex, so the same category can change shade when the user adds another category on that colour. Deterministic per range, but no longer stable across category-list edits.
  - Confidence: MEDIUM — the maths is simple, but the visual result at 6+ shades of one hue may be unusable regardless of spacing, which points at the deeper issue below.
  - Blind spot: Have not checked whether 6 evenly-spaced lightnesses of one hue are actually distinguishable to a viewer, which is the requirement, not injectivity per se.
- **Fix B**: Fall back to a small hue rotation once the lightness band is exhausted.
  - Strength: Yields genuinely distinguishable colours past the point where lightness alone runs out, which is what the requirement actually asks for.
  - Tradeoff: A rotated hue no longer reads as "a shade of the colour the user picked", weakening the link between the swatch here and the dot on `/categories` that manual criterion 3.8 checks.
  - Confidence: MEDIUM — clearly more distinguishable, but it changes the semantics of the swatch.
  - Blind spot: Have not checked how far a hue can rotate before it collides with a *different* palette entry's hue.
- **Decision**: FIXED via Fix A, with one refinement over the finding's sketch. `shiftedFill` now takes the hex's total duplicate `count` (supplied by a new pre-pass in `resolveDistribution`, needed because the step size must be known before the first fill is assigned) and sizes the step **per direction** rather than across one symmetric band: `stepUp = min(LIGHTNESS_STEP, (MAX − L) / ceil((count−1)/2))`, `stepDown = min(LIGHTNESS_STEP, (L − MIN) / floor((count−1)/2))`. Per-direction because no palette hex sits at the band's centre — measured, `#8b5cf6` has 0.1773 of room above and 0.4427 below, so a symmetric step would waste the wide side to fit the narrow one. The clamp is **gone**: the furthest step now lands exactly on the boundary by construction, so a clamp could only mask a broken step calculation.
- **Verified numerically, not argued**: all 12 palette hexes × duplicate counts 1–20 (240 combinations) produce zero collisions, and occurrence 0 returns the hex byte-identical in every one — the rule that keeps the largest category on a colour matching its `/categories` dot. The specific pair the finding named, `#3b82f6` occurrences 3 and 5, previously both `#d6e5fd`-class boundary values, are now `#8ab4fa` and `#b1cdfb`.
- **Precondition recorded in the code**: the injectivity argument needs every `CATEGORY_COLORS` entry strictly inside `[MIN_LIGHTNESS, MAX_LIGHTNESS]` with room on both sides. Measured range 0.4000 (`#14b8a6`) to 0.6627 (`#8b5cf6`); tightest headroom 0.1773 above, 0.1800 below. A future palette entry at or past a bound would give that side a step of 0 and silently collapse onto the unshifted hex, so the numbers are written into the comment on the constants rather than left to be rediscovered.
- **Blind spot accepted, unchanged**: injective is not the same as distinguishable. At six categories on one hex the steps are ~0.08 of lightness; well beyond that they are visibly close. Fix B's hue rotation was not taken, because a rotated hue stops reading as "a shade of the colour the user picked".

### F7 — Demo migration's category join misses `deleted_at is null` and keys on `name` where uniqueness is on `lower(name)`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260816151000_extend_demo_categories.sql:125-127
- **Detail**: The join is `on cat.user_id = '33333333-…' and cat.name = spec.category_name`. Two mismatches with the schema it walks. (1) No soft-delete filter, while `categories_user_id_name_lower_idx` (`20260815145611_add_category_fields.sql:24`) is a *partial* unique index `where deleted_at is null` — so a soft-deleted row and a live row can share a name, and the join matches both. (2) Uniqueness is on `lower(name)` but the join compares exact `name`.
- **Failure scenario**: The demo account is a live shared login, and this migration runs against the hosted database through CI's `supabase db push`. If anyone signed into `demo@papertrail.app` created and then deleted a category named `Kawa`, the `on conflict do nothing` insert at line 79 succeeds (the deleted row sits outside the index predicate), leaving two rows named `Kawa`; the join then matches both and every applicable day inserts two entries. Because `entries_category_summary` deliberately has no `deleted_at` filter, both are counted — `Kawa`'s total doubles, and half of it is filed under a category invisible on `/categories`. The `not exists` guard cannot help: it is keyed on `category_id`, which differs between the two rows. Under the case variant, a demo-account category named `kawa` makes the insert a no-op and the join then finds nothing, so the category is silently absent from the very distribution this migration exists to pin down.
- **Fix**: Add `and cat.deleted_at is null` and match on `lower(cat.name) = lower(spec.category_name)`, so the join key is the key the unique index and the `on conflict` clause already use.
- **Decision**: FIXED — the migration was edited in place (rather than corrected by a forward migration), with both changes plus a comment block recording why the join key has to be the index's key. ⚠ **Open follow-up**: `supabase db push` tracks migrations by version, so if `20260816151000` has already been applied to the hosted database, this edit takes effect only on fresh local `db reset` runs — hosted would keep the old join. Verify whether the deploy job has already pushed this version; if it has, the hosted demo account needs either a corrective migration or a manual catch-up per `context/deployment/deploy-plan.md` Phase 4.

### F8 — Receipt-derived text reaches Workers Logs, contradicting the store-nothing disclosure shown to the user

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (security / privacy)
- **Location**: src/lib/services/receipts.ts:258, src/lib/services/receipts.ts:271
- **Detail**: `wrangler.jsonc:50-52` sets `observability.enabled: true`, so `console.error` output is persisted to Workers Logs. Line 258 writes up to 500 characters of the provider's **raw response body**; line 271's `error`, on the `JSON.parse(raw)` branch, is a V8 `SyntaxError` whose message embeds a snippet of the model's output — i.e. parsed product names and prices from the user's receipt. The store-nothing promise about the *image* holds: `cf-aig-collect-log-payload: "false"` is set and nothing logs `base64` or `image.bytes`. But `ReceiptCapture.tsx:214-218` tells the user `PaperTrail nie zapisuje zdjęcia — zostaje tylko w pamięci przeglądarki`, and a garbled parse does leave receipt-derived text in Cloudflare's log store for the retention window.
- **Failure scenario**: The model returns malformed JSON for a user's pharmacy receipt. `JSON.parse` throws, and the `SyntaxError` message — containing item names and amounts — is written to Workers Logs, where it is readable by anyone with dashboard access and outside the disclosure the user was shown. No error is surfaced to the user beyond the generic 502, so nobody knows it happened.
- **Fix A ⭐ Recommended**: Keep line 258's diagnostic value but narrow it — log `response.status` plus a short allow-listed field extracted from the JSON error envelope rather than an opaque body slice; at line 271 log `error.name` only, not the message.
  - Strength: Preserves the one diagnostic the code explicitly needs (a wrong `RECEIPT_MODEL` string, which is an unverified guess per the plan) while removing receipt content from the log store. Keeps the disclosure copy true as written.
  - Tradeoff: A genuinely novel provider error becomes harder to diagnose from logs alone.
  - Confidence: HIGH — the gateway's error envelope is structured, so an allow-listed field is available.
  - Blind spot: Have not confirmed the exact envelope shape the gateway returns for a 402/2021, which is the error the comment at `receipts.ts:23-28` cares most about.
- **Fix B**: Leave the logging and amend the disclosure copy to say that receipt *text* may be retained in operational logs.
  - Strength: Zero risk to diagnosability, and it makes the user-facing statement accurate — which is the actual obligation.
  - Tradeoff: Weakens the store-nothing property that was a design goal of the whole slice, and adds a caveat to copy the plan said should not be embellished.
  - Confidence: MEDIUM — accurate, but it trades a design guarantee for a diagnostic convenience.
  - Blind spot: Whether the retention window on this Workers plan is short enough that the disclosure change is proportionate.
- **Decision**: SKIPPED — the logging at `receipts.ts:258`/`:271` is unchanged and the disclosure copy is unchanged, so on a garbled parse receipt-derived text still reaches Workers Logs while the user is told PaperTrail stores nothing. The full diagnostic value is retained, which is the reason for the choice. The finding stands as written; revisit if the `RECEIPT_MODEL` guess is confirmed and the raw-body slice stops earning its keep.

### F9 — The range caption's `today` is frozen at mount while each board recomputes it per fetch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence (regression inside a "move, not a rewrite" contract)
- **Location**: src/components/reports/ReportsView.tsx:58, src/components/reports/ReportsView.tsx:89
- **Detail**: The plan required Board A's behaviour to be "byte-for-byte identical — this is a move, not a rewrite." Before the split, the caption was the server's echo of exactly what had been fetched: `{summary && <p>{summary.current.from} – {summary.current.to}</p>}`. It is now `const [today] = useState(() => toLocalDateString(new Date()))` and `resolveRange(view.preset, today)` — derived client-side from a mount-time value — while both boards resolve a *fresh* `today` inside their fetch effects (`OverviewBoard.tsx:81`, `CategoriesBoard.tsx:88`). The related change of making the caption unconditional (it now renders during loading, error and empty states) is documented at lines 84-88; the frozen `today` is not.
- **Failure scenario**: Open `/reports` at 23:59 on 2026-08-17 with `Ostatnie 30 dni` and leave the tab open. At 00:05 click `Ostatnie 7 dni`. Both boards fetch `from=2026-08-12&to=2026-08-18`, while the caption renders `resolveRange("last-7-days", "2026-08-17")` = `2026-08-11 – 2026-08-17`. The label above the charts is off by a day from the money below it, on a page whose entire job is attributing amounts to a date range. Under the previous code the two could not diverge by construction; a dashboard left open overnight is the normal case here.
- **Fix**: Render the caption from the loaded summary's `from`/`to` (both `CategorySummary` and `RangeSummary` already carry them, hoisted via a callback), or thread the boards' `today` from one source the fetch also uses. Keep the unconditional rendering — that part is an improvement.
- **Decision**: FIXED via the hoist-by-callback option, with one refinement: the boards publish the range they are **about to fetch** (`onRangeResolved(range)` immediately after `resolveRange`, before the `await`) rather than the range the response echoed back. Same value either way — the endpoint echoes what it was given — but publishing pre-await means the caption is already correct during the loading branch, so the unconditional rendering is preserved with no placeholder gap. `ReportsView`'s frozen `today` is now only the seed for the first paint (`useState<DateRange>(() => resolveRange(view.preset, …))`), overwritten by the board's own fresh-`today` range on every fetch. Divergence is closed by construction: caption and request are built from the same `range` binding.

### F10 — `roundToCents` is duplicated across exactly the boundary the plan cited S-04 F4 to avoid

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/receipts.ts:132-134, src/components/receipts/receipt-total.ts:13-15
- **Detail**: The two implementations are byte-identical. The S-06 plan's Key Discoveries names "copy-pasted helpers instead of extraction (S-04 F4's duplicated date arithmetic *caused* a numeric bug)" as a theme to pre-empt, and the plan's stated rationale for extracting `receipt-total.ts` at all is that same lesson. The server/client split is a partial excuse, but the repo already has `src/lib/format.ts` as a shared home that both sides import from. Related, same class: the collapsed-tail total is a JavaScript float sum recomputed independently in three files (`CategoryRanking.tsx:67`, `CategoryDonut.tsx:58`, `CategoryTrendChart.tsx:72`) — the one number on Board B that is *not* server-computed, in a module whose doctrine is emphatic that totals come from Postgres `numeric`.
- **Failure scenario**: Someone fixes a rounding edge case in one copy of `roundToCents` — say the half-cent behaviour on `.005` — and the sum-check delta the user sees stops agreeing with the amount the server actually stores. The delta reads `0,00 zł`, the confirm is unblocked, and the stored total differs by a cent from the paragon. This is the exact shape of the S-04 F4 bug the plan set out to avoid.
- **Fix**: Move `roundToCents` to `src/lib/format.ts` (or a sibling `src/lib/money.ts`) and import it in both places; fold `collapsedTotal` into `resolveDistribution` as a field on `Distribution` so it is computed once.
- **Decision**: FIXED — both halves.
  1. `roundToCents` now lives in a new `src/lib/money.ts`, imported by `src/lib/services/receipts.ts`, `src/components/receipts/receipt-total.ts` and `ReceiptReview.tsx`. The sibling module rather than `format.ts`, because that file's header commits it to being "the repo's single source of number **formatting**" and every export there returns a string; `roundToCents` returns a number. `ReceiptReview` was re-pointed at `@/lib/money` directly rather than kept on a re-export from `receipt-total`, so there is one source and no indirection.
  2. `Distribution` gained a `collapsedTotal` field, summed once in `resolveDistribution`. `CategoryRanking` and `CategoryDonut` now destructure it instead of each running their own `reduce`.
- **Correction to the finding**: the collapsed sum was duplicated in **two** files, not three. `CategoryTrendChart.tsx:72` sums `totals?.[categoryId]` **per bucket** — a different quantity from the range grand total, and one that genuinely cannot be hoisted to a single field. It was left alone.

## Also noted, not filed as findings

Real but below the bar for the ten above, recorded so they are not lost:

- **`api-error.ts:8` casts without validating**, so a JSON error body lacking `error` yields `setError(undefined)` and renders an empty `<p className="text-destructive">`. One-line guard: `typeof body?.error === "string" ? body : { error: FALLBACK }`.
- **`ReceiptCapture.tsx:114-117`**: a user cancel *during the read of a non-ok response body* is not re-checked against `controller.signal.aborted` (unlike line 89), so the user who just cancelled sees `Coś poszło nie tak. Spróbuj ponownie.`
- **`receipts.ts:161`**: `name.slice(0, NAME_MAX)` slices by UTF-16 code unit, so a >200-char name ending mid-surrogate-pair yields a lone surrogate, which PostgREST cannot store as `text` — the whole confirm 500s and the user loses the entire receipt rather than one line. Narrow, one-line fix.
- **`receipt-image.ts:70` → `receipts.ts:230`**: the client-declared part `Content-Type` is forwarded verbatim into the provider data URL on the `.info()` failure branch. Contained (JSON-encoded, fixed prompt, enforced `response_format`), but it is attacker-authored text sent to a third party. Whitelist against `PASSTHROUGH_FORMATS`.
- **`response.json<T>()` is an unchecked assertion**, not validation — `worker-configuration.d.ts:1681` declares `json<T>(): Promise<T>`. Exactly as unsound as the `as T` it replaced, but *less visible*: no `as` to grep, no `no-unsafe-assignment` pressure. Fine as a same-origin convention (now documented in `CLAUDE.md`), but `receipts.ts:264` applies it to a genuinely untrusted AI Gateway body — that is the one call site that warrants zod.
- **A merge-gate gap discovered by S-06 and recorded only in commit `3966d6c`'s body**: lint and build both passed against the broken intermediate state; only `tsc --noEmit` caught the eight stale `as T` assertions. CI's gate is `astro sync` → lint → build, so a type error of that class would ship green.
- **Accessibility, inherited not introduced**: `BoardSwitcher.tsx:36-53` matches `RangePicker.tsx:15-32` exactly (`role="radio"`, `aria-checked`, `min-h-11`, `border-foreground`), but neither implements the arrow-key navigation and roving tabindex the ARIA radiogroup pattern requires. Fix both when the pattern is next touched. Separately, `CategoryRanking.tsx:95-115`'s expander button wraps flow content and has no `aria-controls`.
- **`resolveDistribution` runs per render** of the content branch (`CategoriesBoard.tsx:47`), contradicting `distribution.ts:8-11`'s own header and the plan's Performance Considerations. Harmless — pure, deterministic, O(n) via a `Map`, and `react-compiler` memoizes on `summary`. Only the comment is wrong.
- **Switching boards unmounts and refetches** (`ReportsView.tsx:121-125`), so `Przegląd → Kategorie → Przegląd` issues three requests, and walking the back button through `pushState` history refetches each step.
- **Bookkeeping**: `context/foundation/roadmap.md:6-7` was changed on 2026-08-17 but left `updated: 2026-08-16` and `prd_version: 1` in committed frontmatter — already corrected by the uncommitted working-tree change. Note the S-05 branch tip itself left S-05 as `in-progress` while all 40 plan checkboxes were ticked; the merge commit correctly flipped it to `done`.
- **Uncommitted working tree is post-MVP planning, not merge fallout**: `prd.md` → version 2 with FR-017/FR-018, `roadmap.md` → slices S-07 through S-10 plus Stream D, all stamped with provenance from real use. It preserves `S-05 done` / `S-06 in-progress` untouched and is internally consistent. One note: S-10's own risk line correctly flags that per-category receipt grouping will silently invalidate S-06's accuracy-log baseline.

## Deviations reviewed and accepted (no action)

Recorded so a later review does not re-litigate them:

- **S-06, `res.body?.cancel()` → `response.text()`** (`receipts.ts:253-260`). The plan's purpose (don't leak an unconsumed body) is satisfied — `.text()` consumes it fully — and the swap makes a wrong `RECEIPT_MODEL` diagnosable on the first live call, which matters because that string is an admitted guess. The better call. (Its logging is F8.)
- **S-06, `cf-aig-gateway-id` header + `RECEIPT_GATEWAY_ID`** (`receipts.ts:33,221`), not in the plan's header list. Unified Billing credits are funded per gateway, so an unnamed request routes to the account's `default` gateway and fails 402/2021 indistinguishably from having bought no credits. A real discovered constraint, declared in the commit message.
- **S-06, six files touched outside the plan's list** (`api-error.ts`, four `entries`/`categories` components, `ReportsView.tsx`). Every edit is the identical one-line `(await response.json()) as T` → `await response.json<T>()` transform, forced by committing `worker-configuration.d.ts` (needed so CI's type-checked lint can see `env.IMAGES`), which replaces DOM `Response` typing with workerd's. Type-level only, runtime-identical, disclosed in the commit body. The acceptable form of a theme the plan itself flagged.
- **S-06, `cancelled` guard as an unmount-only ref** rather than the per-invocation closure (`ReceiptCapture.tsx:41-55`). Not exploitable: the file input renders only under `status === "idle"`, so a second pick cannot begin while the first is parsing.
- **S-06, object URL owned by `ReceiptCapture` rather than `ReceiptReview`.** Created at `:80`, revoked in an `imageUrl`-keyed effect cleanup at `:61-66`. More robust than the plan's placement — the child unmounts on every `toIdle()`.
- **S-06, a second hard block (`invalidAmount`) the plan did not name** (`ReceiptReview.tsx:88,94`). Justified by `amount numeric(10,2) check (amount > 0)`: the row genuinely cannot be stored, so there is nothing to acknowledge. Same reasoning class as the plan's own.
- **S-05, `eslint.config.js` +8 lines** — adds `{ ignores: ["supabase/.temp/**"] }`, a generated `supabase start` shim outside `tsconfig`'s project. **No rule is disabled or downgraded**, and no `eslint-disable` / `@ts-expect-error` / `as any` appears anywhere in the new code. Out-of-plan but not scope creep.
- **S-05, `src/lib/format.ts` +19 lines** (`formatShare`). The plan's `CategoryRanking` contract requires a percentage and repo convention puts `Intl` formatters here; genuinely new, not a duplicate of `formatPercentDelta`. The plan under-specified its own file list.
- **S-05, ranking bars scaled to the leader, not to share-of-total** (`CategoryRanking.tsx:24-28`). Documented: with 30 categories the leader sits ~17% and every bar would be a stub. The exact share is still printed as text.
- **S-05, `nameKey="key"` instead of the plan's `nameKey="name"`** (`CategoryDonut.tsx:140`). Required for consistency with the `ChartConfig` keyed by stringified `categoryId`, which the same plan paragraph mandates — `nameKey="name"` would have made every config lookup miss. The plan was wrong; the code is right.
- **S-05, `CategoryTrendChart` takes a fourth prop `range`** — unavoidable, since the plan also mandates zero-filling via `enumerateBuckets(range, bucket)`, which the three planned props cannot supply.
- **S-05, demo data overshoots the plan's targets** (9 categories above 2% and 18 below 1%, vs "5–8" and "~15"). Verified by reproducing the generator numerically: 30 categories, 29,168.68 zł total, ≥8 colour-duplicate pairs, 3 tail categories on `#64748b`. With 9 above `MIN_SHARE`, `Math.min(TOP_N, aboveMinShare)` resolves to 8 — so the fixture actually forces the "whichever set is smaller" branch to choose, which a 5–8 head would not have. Drift that improves on the plan.
- **S-05, the entries insert uses a `not exists` guard** rather than the plan's literal `auth.users` check + `on conflict do nothing` (`20260816151000:89-133`). Both properties hold transitively (the insert joins on guarded categories, and entries have no natural unique key). Its real defect is F7, not the guard form.
- **S-05, the inner join to `public.categories` silently drops** an entry filed under another user's `category_id` (`20260816150000:72-73`). Correct failure direction (removes, never leaks), pre-existing in `entries_summary`, and the service-layer `assertCategoryUsable` check is what holds it closed.

## Verified clean — the high-risk items, checked and sound

Recorded because these are the places where failure would be silent:

- **Isolation.** `entries_category_summary` is `security invoker`, `stable`, `set search_path = ''`, with **no `user_id` predicate anywhere in the body** — confirmed line by line against the shipped `entries_summary`, the only differences being the intended ones. Every object reference is schema-qualified; unqualified `date_trunc`/`sum`/casts resolve from the always-searched `pg_catalog`, so the empty `search_path` is not a hijack surface. `p_bucket` reaches `date_trunc` as a bound parameter — no injection. Grants are exactly `revoke execute … from public, anon` then `grant execute … to authenticated`, proven by `has_function_privilege` at `entries_category_summary_test.sql:264-272`. Cross-user isolation through the RPC is proven for both seed users. 25 assertions, `plan(25)` matches.
- **Cache headers.** `/api/entries/category-summary` *is* covered. `src/middleware.ts:29` gates on `isProtected || context.locals.user`; the route only returns 200 with a signed-in user, and middleware has resolved `locals.user` by then, so every successful response carries `Cache-Control: private, no-store`. Identical treatment to `/api/entries/summary`.
- **`createEntriesBatch`'s two app-layer-only invariants are airtight.** `categoryId` is `z.number().int().positive()`, so `requestedIds = [...new Set(...)]` is a set of distinct positive integers; `id` is the PK, so the RLS-scoped `.in("id", …).is("deleted_at", null)` returns at most one row per id, making `usable.length < requestedIds.length` exactly equivalent to "some id was absent / soft-deleted / not mine". No null, non-integer, duplicate or coercion defeats it. The checked set and the inserted set derive from the same array in the same tick — no TOCTOU. `user_id` is never passed (defaults to `auth.uid()` under `with check`). All items share an identical 5-key shape, which is what keeps PostgREST emitting **one** multi-row INSERT — genuinely atomic, genuinely two round trips. `max_rows = 1000` exceeds the 100-item cap, so the select cannot be silently truncated.
- **Prompt injection has no write path.** The parse response is a *suggestion*; the write re-derives everything from RLS-scoped queries and requires a user click. Worst case for an adversarial image is ≤100 plausible expense rows in the user's own categories, pending confirmation. `sanitise()`'s `allowedCategoryIds.has(categoryId)` is correct but is defence-in-depth, not the load-bearing check.
- **Secrets.** `CF_AI_TOKEN` / `CF_ACCOUNT_ID` are `context: "server", access: "secret"`, never logged, and every client-facing error body is a fixed Polish string — no provider body, token, account id or URL is echoed to the client.
- **Store-nothing (image).** `cf-aig-collect-log-payload: "false"` is on the image-carrying request; nothing logs `base64` or `image.bytes`. `Buffer.from(bytes).toString("base64")` is used, never `btoa`.
- **`TimeoutError` vs `AbortError`** is correctly distinguished on both sides (`receipts.ts:244`, `ReceiptCapture.tsx:130/137`), and `AbortSignal.any` propagates the source signal's reason, so the discrimination actually works. Every `fetch` in scope has a `catch`.
- **The escalating stale-response class is closed** in both new boards: `cancelled = { current: false }` on every post-await `setState`, with cleanup. The `Pozostałe` reset fires correctly — `setExpanded(false)` is inside the fetch effect keyed `[preset, recurringHidden]`.
- **The colour walk covers the full sorted list** (`categories.map` before `slice(0, visibleCount)`), so expanding the tail structurally cannot recolour the head. Occurrence 0 returns the hex byte-identical. The selection rule is correct: because the list is sorted descending, the `> MIN_SHARE` set is always a prefix, so `Math.min(TOP_N, aboveMinShare)` really is "whichever set is smaller". No off-by-one; `total === 0` guarded everywhere (including `Number.EPSILON` in `maxShare`, which also defends `Math.max()` over an empty `visible`).
- **The percentage denominator is the SQL `()` row**, never a JS sum. Every total passes through `Number(...)`. The three-way null fold is exhaustive.
- **No `ChartConfig` entry carries `color`** in either new chart, so the self-referential `--color-x: var(--color-x)` hazard at `src/styles/global.css:118-126` is avoided. No `<Cell>`; colour travels on the datum's `fill`. No `<Legend>` on the donut.
- **No third copy** of `pad` / `addDays` / `inclusiveDayCount` — still exactly the two documented client/server copies, both predating this work.
- **No banned patterns**: no `export const prerender = false` anywhere in `src/`; no `Astro.locals.runtime` (the one mention is a comment warning against it); no native modules; `cn()` used throughout; UI copy consistently Polish.
- **The `description` migration is clean**: single additive nullable column with a `char_length <= 200` check, no rewrite, backward-compatible in both directions for the CI build→push→deploy window (the previous Worker's `SELECT_COLUMNS` is an explicit list that never named it). RLS genuinely unaffected — the four `entries` policies are row-scoped and column-agnostic — and the pgTAP file is correctly *separate* so `entries_rls_test.sql` passing unchanged is the evidence.
- **S-06 Phase 4's `accuracy-log.md` is a correctly unfilled scaffold**, consistent with 4.1–4.6 all `[ ]`: full column contract, the extraction-vs-categorisation separation stated with its reasoning, one empty row, placeholder rollup, `**Conclusion**: _pending_`. No fabricated data. One improvement on the plan: the rollup specifies *pooled* rather than averaged fractions, because averaging over-weights short receipts.
