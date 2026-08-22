# Isolation Beyond the Database — Plan Brief

> Full plan: `context/changes/testing-cross-user-isolation/plan.md`
> Research: `context/changes/testing-cross-user-isolation/research.md`

## What & Why

Rollout Phase 4 of `context/foundation/test-plan.md` — the guard for risk #3,
"one user's financial data becomes reachable by another." Four archived slices
each verified a cross-user refusal **once, by hand, with `curl`, at ship time**.
None left a test behind. This phase turns all four into assertions that run on
every pull request, and adds the second isolation path `CLAUDE.md` names: that
no authenticated response is edge-cacheable.

## Starting Point

Research resolved the phase's shape and inverted its stated weighting. The
database layer is **stronger** than the brief assumed — both aggregates are
`security invoker` with no user parameter, and both pgTAP summary suites already
assert the cross-user negative _through the RPC_. What has no guard is the
application layer: `entries.category_id` is a plain FK, Postgres FK checks are
not subject to RLS on the referenced table, and the only prevention is
TypeScript, in two independently-maintained copies. Separately, every `/api/**`
route escapes `PROTECTED_ROUTES`, so its `Cache-Control: private, no-store`
rests solely on the `|| context.locals.user` disjunct at `src/middleware.ts:48-50`
— the only cache mechanism in the repo.

The harness is ready: 11 files, 254 tests, ~580 ms, green. The one concrete
blocker is that no route-context helper produces `context.params`, which both
`[id].ts` routes read.

## Desired End State

Every cross-user refusal ever checked by hand is checked by `npm run test` on
every pull request — six surfaces, each asserting the _response body_, not just
the status, because the ambiguous 404 string is itself the anti-enumeration
property. `src/middleware.test.ts` pins that `/api/**` gets the cache header
when signed in and **not** when anonymous, so the guarantee goes red the moment
its single disjunct is weakened. The anonymous `GET /` redirect carries the
header, and a comment that claimed coverage it did not have becomes true.

## Key Decisions Made

| Decision                   | Choice                                          | Why (1 sentence)                                                                                                                                    | Source         |
| -------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| F5 — the composite FK      | Test around it; no migration                    | A migration would drag risk #4's deploy-window concern into a testing phase; testing existing behaviour is the in-scope reading of the phase title. | Plan           |
| pgTAP scope                | None added                                      | The six existing suites already cover the SQL-expressible half, and anything new would land with no pull-request gate.                              | Plan           |
| Cheapest layer             | JS route tests, not pgTAP                       | Research inverted §2's emphasis: the route layer is both the real work and the only layer with PR enforcement.                                      | Research       |
| `Cache-Control` gap at `/` | Test **and** fix                                | One line, and it makes a directly contradicted comment true again.                                                                                  | Plan           |
| Fixture scope              | Shared helper + retrofit the 3 green files      | Proves the helper against known-green suites before new tests depend on it; removes four copies of a hand-rolled `auth.getUser`.                    | Plan           |
| Route breadth              | All six surfaces                                | Maps one-for-one onto the four archived `curl` verifications, and covers both refusal mechanisms.                                                   | Plan           |
| Test identities            | The `supabase/seed.sql` uuids                   | Makes the JS and pgTAP layers name the same two actors and read together.                                                                           | Research (OQ4) |
| `test-plan.md` edits       | §6 cookbook only                                | §1–§5 are frozen strategy; `--refresh` exists to change them through a change folder.                                                               | Plan           |
| Middleware testability     | `vi.mock("astro:middleware")`, no config change | Re-verified empirically in research; corrects a false clause in §6.1.                                                                               | Research       |

## Scope

**In scope:** a shared `__fixtures__/` route-context helper carrying `params` and
an identity-parameterised `auth.getUser`; retrofitting three green route tests;
six A-requests-B refusal cases; `src/middleware.test.ts`; a one-line middleware
fix for the anonymous `GET /` redirect; `test-plan.md` §6.4, the §6.1
correction, §6.6 notes, and the §3 status flip.

**Out of scope:** any new pgTAP; the F5 composite-FK migration; the F10
aggregate drop; F9; widening `db-test` to pull requests; `vitest.config.ts`
changes; new dependencies; component and viewport work (Phase 5); auth mechanics
(§7); `listEntryDaysForMonth` and the `.gte`/`.lte` fixture methods.

## Architecture / Approach

Two test layers, no new infrastructure. Route tests drive the **real** service
against the recording Supabase fake behind `vi.mock("@/lib/supabase")`, so each
refusal proves actual wiring rather than that a route could build a 404.
Middleware tests drive the real `onRequest` behind
`vi.mock("astro:middleware")`, with `next()` returning a plain mutable
`Response`.

The honest claim of this layer, stated in every new file's header: _given a
client that returns nothing for B's id, A gets a 404 whose body does not confirm
B's row exists._ The fake has no caller identity and no row store, so it cannot
prove RLS — that is pgTAP's job and is already done.

## Phases at a Glance

| Phase                         | What it delivers                                                                                                    | Key risk                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Shared route-test fixtures | `params`-carrying context builder, identity-parameterised `auth.getUser`, seed uuids; three green files retrofitted | Churn in three passing files — breakage there is noise against the real signal                                               |
| 2. Ownership refusal ×6       | Three new route test files plus a batch case; both refusal mechanisms                                               | Response-queue ordering — the fake is call-order-keyed, not table-keyed, and the two-await `PATCH` case is easy to get wrong |
| 3. Edge-cacheability          | `src/middleware.test.ts` (5 cases) + the one-line `/` fix                                                           | The only product-code change in the phase; the `/` test must be seen red first                                               |
| 4. Cookbook and plan sync     | §6.4 written, §6.1 corrected, §6.6 notes, §3 row flipped                                                            | Scope creep into frozen §1–§5                                                                                                |

**Prerequisites:** none — no new dependency, no config change, no Docker, no
network.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- **The FK ownership gap ends up proven only at the application layer.** With no
  pgTAP added, its sole database-side record stays the prose at
  `20260815164539_create_entries_table.sql:31-36` and
  `entries_rls_test.sql:8-17`. A green suite must not be read as covering it.
- **These tests cannot prove RLS**, and a reader who mistakes them for proof has
  been misled by the test — which is worse than no test. Mitigated by a required
  header comment in every new file and by stating it as a limit in §6.4.
- **Phase 3 changes product code** inside a phase whose remit is proving current
  behaviour. Bounded to one condition and one comment; `PROTECTED_ROUTES` is not
  touched.
- Retrofitting three green files assumes their behaviour is genuinely
  construction-independent; if any assertion shifts, the retrofit is wrong, not
  the test.

## Success Criteria (Summary)

- A request authenticated as A for any of B's ids is refused at all six
  surfaces, with a body indistinguishable from "that id does not exist" — and
  each assertion has been seen red before it was made green.
- Weakening the `Cache-Control` guarantee — dropping the `locals.user` disjunct
  — turns a test red instead of shipping silently.
- `test-plan.md` §6.4 answers "how do I add an ownership test for a new route?"
  read cold, and §6.1 no longer sends the next reader into a config change it
  does not need.
