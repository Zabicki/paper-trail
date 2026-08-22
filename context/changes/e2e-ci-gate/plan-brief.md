# E2E CI Gate — Plan Brief

> Full plan: `context/changes/e2e-ci-gate/plan.md`
> Change brief: `context/changes/e2e-ci-gate/change.md`

## What & Why

`test-plan.md` §5 lists the e2e gate as **not required — not wired in CI**, and
gives an unmeasured runner cost as the reason. This change measures that cost and
acts on it: a fourth `e2e` job in `.github/workflows/ci.yml`, running the
Playwright suite on pushes and pull requests, with `deploy` gated behind it. §5's
own framing allowed "stays local-only, deliberately" as an outcome; the numbers
do not support it.

## Starting Point

Three jobs: `ci` (push + PR, 98 s measured), `db-test` (push-only, 195 s
measured), `deploy` (push-only, `needs: [ci, db-test]`). None mentions Playwright.
The suite is three tests — a `setup` project plus two specs — driving a real
`astro dev` server on workerd against a real local Supabase stack, 23.7 s
locally. `playwright.config.ts` already branches on `process.env.CI` for
`forbidOnly`, `retries: 2`, and the GitHub reporter, so it needs no change.

## Desired End State

Four jobs. A pull request runs `ci` and `e2e` and both must be green to merge; a
push to `master` runs all three gates and `deploy` waits on all three. The `e2e`
job has been observed red from a deliberate break, so it is a verified gate, and
a red run leaves a downloadable HTML report and trace. Every document that said
"local only" says what CI actually does.

## Key Decisions Made

| Decision                | Choice                                            | Why (1 sentence)                                                                                            | Source |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| Runner cost             | Measured: `supabase start` 134 s, `db-test` 195 s | Read from Actions run `32489937016`; the unknown that kept the gate off is retired.                         | Plan   |
| App configuration in CI | Process environment, no file, no repo secret      | Verified empirically — with `.dev.vars` and `.env` both absent, `astro dev` on workerd resolved shell vars. | Plan   |
| Job shape               | Its own `e2e` job                                 | A red gate should name the thing that broke; a browser flake must not turn the _database_ gate red.         | Plan   |
| Trigger                 | Push **and** pull request                         | This is what §5's "CI on PR" row asks for, and ~285 s of PR feedback is affordable.                         | Plan   |
| `deploy` edge           | `needs: [ci, db-test, e2e]`                       | A gate nothing enforces is documentation; `retries: 2` already absorbs single-shot flake.                   | Plan   |
| Sequencing vs sibling   | Land independently now                            | The sibling's browser install targets the `ci` job, this one a new job — separate jobs, no real dependency. | Plan   |
| Browser install         | Plain install, measure, cache later               | Pre-optimising an unmeasured cost repeats the mistake this change exists to correct.                        | Plan   |
| Failure artifacts       | Upload report + traces on `if: failure()`         | The traces already exist and are currently unreachable from CI.                                             | Plan   |
| `db-test` on PRs        | Out of scope, but record the number               | Attractive and now wall-clock-free, but it is its own cost decision — §5 gets the data, not the verdict.    | Plan   |
| Documentation reach     | test-plan + `CLAUDE.md` + `tests/e2e/README.md`   | All three currently assert e2e is local-only, including the §6.6 bullet that steers layer choice.           | Plan   |

## Scope

**In scope:** the `e2e` job; failure-artifact upload; `deploy`'s `needs:` edge;
the deliberate-break verification; `test-plan.md` §4, §5, §6.6, §6.7, §8;
`CLAUDE.md`'s CI/CD and Commands sections; `tests/e2e/README.md`'s Running
section; change close-out.

**Out of scope:** widening `db-test` to pull requests (numbers recorded, decision
left open); caching the Chromium binary; any edit to `playwright.config.ts`; any
edit to `testing-client-state-viewport`'s approved plan; new e2e specs; making
the suite parallel.

## Architecture / Approach

A fourth job rather than steps appended to `db-test`, which already has the stack
up. That duplicates ~165 s of `supabase start` + `db reset` per push, and buys a
gate whose red names its own cause. The job is self-contained: `npm ci` →
`npx supabase start -x vector` → `npx supabase db reset` (this is what applies
`seed.sql`, whose user the suite signs in as) → export the local stack's URL and
anon key out of `npx supabase status -o env` into `$GITHUB_ENV` → install
Chromium → `npm run test:e2e`. No `secrets.*`, no `environment:`, same as
`db-test`, and on the same side of the CLI/grants divide — `npm ci` then
`npx supabase`, never `supabase/setup-cli@v1`.

## Phases at a Glance

| Phase                                 | What it delivers                                                   | Key risk                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1. The `e2e` job, verified and gating | The job, failure artifacts, the `deploy` edge, and a red-run proof | `astro dev` on workerd inside a runner is unproven; it surfaces as a `webServer` timeout |
| 2. Documents and close-out            | §4/§5/§6.6/§6.7/§8, `CLAUDE.md`, e2e README, change close-out      | Writing "required — wired" before the teeth check was actually observed                  |

**Prerequisites:** none — the suite, its fixtures and `playwright.config.ts` all
exist and pass locally today. Phase 2 depends on Phase 1's measurements.
**Estimated effort:** ~1–2 sessions; most of Phase 1's wall-clock is waiting on
Actions runs rather than editing.

## Open Risks & Assumptions

- **`astro dev` on workerd has never been run on a GitHub runner.** The
  Cloudflare Vite plugin simulates the `IMAGES` and `SESSION` bindings locally,
  which should need no network — but if it does, it fails as a 120 s `webServer`
  timeout that reads like a slow boot rather than a missing capability.
- **The browser-install duration is the one unmeasured term** in the ~285 s
  projection. If it lands high, the caching follow-up gets sharper, not the
  trigger decision.
- **Quote-stripping the `supabase status` output is load-bearing.** The raw lines
  are `KEY="value"` with literal quotes; appended unstripped, `createClient()`
  still passes its null-check and the break surfaces later as a sign-in failure.
- **The trigger decision has a shelf life.** `workers: 1` is a necessity — every
  spec shares one seed account — so suite wall-clock grows linearly with spec
  count.

## Success Criteria (Summary)

- A pull request that breaks a covered flow goes red in review, not after merge.
- A red `e2e` job leaves the hosted schema and the Worker untouched, and hands
  whoever looks a trace rather than an assertion line.
- No document claims a gate that is not wired, and none claims one that is.
