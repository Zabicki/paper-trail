# Reports Aggregation Truth — Plan Brief

> Full plan: `context/changes/testing-reports-aggregation-truth/plan.md`
> Research: `context/changes/testing-reports-aggregation-truth/research.md`

## What & Why

Rollout Phase 3 of the test plan, covering §2 risk #2: _a KPI or chart reads
plausibly but is wrong_. The reports path already carries three deliberate
"correct or absent" mechanisms — a pre-flight bucket ceiling, an exact row-count
tripwire, and an all-time date clamp — and **none of them is asserted anywhere,
at any layer.** Two of the three were added reactively, after the feature
shipped. This phase gives all three automated teeth, and closes the one
validation hole that lets the ceiling guard be computed over a different window
than the one actually queried.

## Starting Point

Both pgTAP suites on this path explicitly disclaim these application-layer rules
as out of reach and call them a permanent manual-verification requirement — a
disclaimer written before a JS runner existed, and one `lessons.md:11` already
retired. The reason pgTAP cannot help is structural: `max_rows` truncation is a
**PostgREST** behaviour, and pgTAP talks to Postgres directly, so no fixture size
reproduces it. The guard itself is a plain `array.length` comparison in
TypeScript, which a 1000-row Vitest fixture reaches in milliseconds. Everything
this phase targets is already testable at the cheapest layer; the only harness
gap is that the shared Supabase fake has no `.rpc()`, and the whole reports path
is `.rpc()`.

## Desired End State

`npm run test` covers all three guards and the arithmetic they protect. A
widened grouping set, a loosened ceiling, a re-bucketed preset, a percentage
divided by a JS sum instead of the exact SQL total, or a route that stops mapping
`RangeTooLargeError` to a 400 — each turns a named test red instead of shipping a
plausible wrong number. `/reports` behaves identically to today, except that a
malformed date now returns a 400 with a JSON body instead of a 500 with a
non-JSON one.

## Key Decisions Made

| Decision                           | Choice                                            | Why (1 sentence)                                                                                                              | Source   |
| ---------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| All-time silent clamp (OQ3)        | Characterise as accepted residual                 | The clamp is deliberate and sized to keep 397 buckets under `MAX_BUCKETS`; signalling it needs the Phase 5 component layer    | Plan     |
| Loose date regex (OQ4)             | Fix both copies here, with tests                  | The guard is computed over a normalised window that isn't the one queried — literally "a range resolving to the wrong window" | Plan     |
| Cross-board total agreement (OQ6)  | Include it — one fixture, two projections         | The only check that catches both boards being individually correct and jointly wrong                                          | Plan     |
| Route-layer scope (OQ5)            | Assert the 400 mapping, not the UI                | A thrown error that becomes a 500 is indistinguishable to the user from the truncation this phase prevents                    | Plan     |
| Board A's row-width premise (OQ2)  | Pin the width, don't add a guard                  | 802 < 1000 is provably true today, so a mirrored guard could only fire after a migration already broke the premise            | Plan     |
| Hosted `max_rows` (OQ1)            | Manual console check, recorded with a date        | `config.toml` governs local only and `deploy` never touches API settings, so the constant is an assumed mirror                | Plan     |
| `distribution.ts` depth            | Selection + share arithmetic only                 | A wrong colour is cosmetic; a wrong number is the risk                                                                        | Plan     |
| Which layer reaches the truncation | Vitest, not pgTAP                                 | PostgREST truncates at the API layer; pgTAP structurally cannot cross it                                                      | Research |
| What to fake                       | Supabase client only, extended with `rpc`/`limit` | §6.2's established boundary; internal service modules are not worth faking                                                    | Research |

## Scope

**In scope:**

- `range.ts` units — seven presets, `bucketFor` thresholds, `date_trunc`
  alignment, inclusive bounds, the all-time clamp as characterisation
- `distribution.ts` units — top-N vs min-share, share denominator, zero guard,
  `collapsedTotal`, no renormalisation to 100
- `supabase-fake` gains `rpc` (terminal) and `limit` (chain link)
- `reports.ts` service tests — the ≥1000-row tripwire, the bucket ceiling on both
  callers, total assignment, Board A's width premise, `getFirstEntryDate`,
  cross-board agreement, error propagation
- `summaryQuerySchema` swaps its shape regex for real calendar validation
- Route tests on both reports endpoints — 400 mappings, 401, 200
- `test-plan.md` §6.1/§6.2/§6.6/§3/§8 sync

**Out of scope:**

- The colour derivation and its de-collision walk in `distribution.ts`
- Adding a truncation guard to `getEntriesSummary`
- Making the all-time clamp or the specific 400 message visible to the user
- The one-paint caption window (needs the Phase 5 component layer)
- The direct-RPC bypass (F9 — accepted by decision)
- Anything pgTAP already proves; §6.4's ownership pattern (Phase 4's)
- The two surviving regex copies in `services/receipts.ts` and `api/entries/index.ts`

## Architecture / Approach

Three layers, cheapest first. Two pure co-located modules (`range.ts`,
`distribution.ts`) are plain Vitest units with zero mocking — `resolveRange`
takes `today` as a required parameter, so no clock faking is needed. The service
layer reuses §6.2's recording fake, extended with the two methods the RPC path
requires; `rpc` is terminal rather than a chain link, so it records _and_
resolves. The route layer reuses the `vi.mock("@/lib/supabase")` pattern already
proven on `receipts/entries.ts`, driving the real service against the fake so the
error mapping proves actual wiring rather than merely that a 400 can be built.

## Phases at a Glance

| Phase                          | What it delivers                                                                             | Key risk                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1. Range resolution units      | Preset → date resolution, bucket thresholds, `date_trunc` alignment, the clamp characterised | Expectations derived from the code instead of a calendar — the oracle failure                           |
| 2. Distribution model units    | Selection rule, share denominator, zero guard, collapsed tail                                | Fixtures whose visible slices happen to sum to the total, hiding a denominator bug                      |
| 3. Harness + aggregation truth | `rpc`/`limit` on the fake; the truncation tripwire, ceiling, totals, cross-board agreement   | The cross-board fixture must be hand-derived from a stated population, not from either service's output |
| 4. Route boundary + date fix   | `z.iso.date()` in `summaryQuerySchema`; 400/401/200 on both endpoints                        | Losing a Polish message in the swap — it is user-facing copy the panel renders                          |
| 5. Cookbook and plan sync      | §6.1/§6.2/§6.6 updates, §3 row `complete`, hosted `max_rows` recorded                        | The `rpc`-is-terminal rule not landing in §6.2 — it is the thing a reader gets wrong                    |

**Prerequisites:** Rollout Phase 2 complete (it is — archived
`2026-08-21-testing-receipt-confirm-integrity`), which established the §6.2
pattern and the fake this phase extends. Supabase console access for the one
manual `max_rows` check in Phase 3. No new dependency, no `vitest.config.ts`
change, no Docker.

**Estimated effort:** ~3–4 sessions across 5 phases; Phase 3 is roughly half the
work.

## Open Risks & Assumptions

- **Hosted `max_rows` is assumed to be 1000.** It is a hardcoded mirror of the
  local `config.toml`, and the deploy job never touches hosted API settings. If
  it differs, the tripwire is wrong in both directions. Phase 3 carries the
  manual check that resolves this; until it runs, the tests are green against an
  unverified threshold.
- **Board A's width premise is pinned at the reshaping layer, not the SQL
  layer.** A migration that widens the grouping sets would need this fixture
  updated alongside; the test comment must say so, or it reads as broader than it
  is.
- **The `>=` tripwire is a deliberate conservative false positive.** An
  exactly-1000-row result is rejected as truncated even when it is complete. The
  test encodes that; a reader who thinks it is an off-by-one will "fix" it.
- **Two shape-regex copies survive** outside this path. Phase 2 fixed two, this
  fixes two, and the remaining two are named in §6.6 rather than silently left.

## Success Criteria (Summary)

- A displayed figure is provably either correct or absent: the truncation
  tripwire, the bucket ceiling, and the 400 mapping each have a test that has
  been seen red
- A percentage and its absolute amount are proven to share one denominator — the
  exact SQL `()` row, never a JavaScript sum
- Board A and Board B are proven to agree about the same population, for the
  first time anywhere
