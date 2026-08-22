# E2E CI Gate Implementation Plan

## Overview

Add a fourth job, `e2e`, to `.github/workflows/ci.yml`. It provisions its own
local Supabase stack, installs Chromium, and runs the Playwright suite against a
real `astro dev` server on pushes **and** pull requests; `deploy` gains a
dependency on it. Then correct every document that currently states the e2e
suite is local-only.

The change exists because `test-plan.md` §5 lists the e2e gate as **not required
— not wired in CI** and gives an unmeasured cost as the reason. That number is
now measured (see below), and it does not support leaving the gate off.

## Current State Analysis

`.github/workflows/ci.yml` has three jobs — `ci` (push + PR, the merge gate),
`db-test` (push-only, provisions a database and runs pgTAP), and `deploy`
(push-only, `needs: [ci, db-test]`, gated behind the `production` environment's
required reviewer). None of them mentions Playwright or e2e.

The suite is three tests: `tests/e2e/auth.setup.ts` (a `setup` project that signs
in as the `supabase/seed.sql` user, provisions the fixture category, and writes
`storageState`), `tests/e2e/seed.spec.ts` (risk #5), and
`tests/e2e/expense-reaches-reports.spec.ts` (risks #2 and #5). Nothing is mocked:
`playwright.config.ts` starts a real `npm run dev -- --port 4321` and drives it
against a real Supabase stack.

`playwright.config.ts` already keys three behaviours off `process.env.CI`, which
GitHub Actions sets: `forbidOnly: true`, `retries: 2`, and
`reporter: [["github"], ["html", { open: "never" }]]`. `trace: "on-first-retry"`
and `screenshot: "only-on-failure"` are set unconditionally. **No config change
is needed for CI** — the file was written for this.

### Measured costs

From GitHub Actions run `32489937016` (`master`, 2026-08-21, `ubuntu-latest`),
step-level timings read from the Actions API:

| Step                            | Measured  |
| ------------------------------- | --------- |
| `npm ci`                        | 17 s      |
| `npx supabase start -x vector`  | **134 s** |
| `npx supabase db reset`         | 31 s      |
| `npx supabase test db`          | 3 s       |
| **`db-test` job, total**        | **195 s** |
| `ci` job, total (runs parallel) | 98 s      |

Locally, 2026-08-22: the whole e2e suite is **23.7 s** for three tests, serial,
including a 4.5 s `astro dev` boot.

Projected `e2e` job: 17 + 134 + 31 + (browser install, the one term still
unmeasured, typically 40–90 s) + (suite, slower than 23.7 s on runner hardware)
≈ **~285 s**. Running in parallel with `ci` (98 s) and `db-test` (195 s), it
becomes the critical path: pull-request feedback goes from the measured 98 s to
roughly four and three-quarter minutes.

### Key Discoveries

- **Process environment is sufficient to configure the app — no file, no repo
  secret.** Verified empirically on 2026-08-22 by moving both `.dev.vars` and
  `.env` aside and exporting `SUPABASE_URL` / `SUPABASE_KEY` into the shell:
  `astro dev` on workerd resolved them and `auth.setup.ts` completed a real
  password sign-in. The precedence is `.dev.vars` → `.env` → process env, and
  the dev server names which file it used on startup (`Using secrets defined in
.dev.vars`); with neither present it prints no such line and still works.
  This settles `change.md`'s open question — `db-test`'s secret-free shape
  **does** transfer, and the `e2e` job needs no `secrets.*` and no `environment:`.
- **`npx supabase status -o env` is the supply line.** With
  `--override-name api.url=SUPABASE_URL --override-name auth.anon_key=SUPABASE_KEY`
  it emits `SUPABASE_URL="…"` and `SUPABASE_KEY="…"` on stdout among fourteen
  other variables. Version-update notices and the "Stopped services" line go to
  stderr, so stdout is clean `KEY="value"` lines.
- **The suite depends on `seed.sql`.** `auth.setup.ts` signs in as
  `rls-test-user-a@example.com` (`supabase/seed.sql:27`), which exists only
  because `[db.seed] enabled = true` in `supabase/config.toml` runs the file on
  reset. `supabase/config.toml` also sets `enable_confirmations = false` and the
  seeded rows carry `email_confirmed_at`, so a password sign-in works
  immediately.
- **`testing-client-state-viewport` Phase 4 does not block this change.** Its
  browser-install step targets the `ci` job; this one targets a new `e2e` job.
  Separate jobs each need their own install regardless, so there is no
  duplication to reconcile and no ordering constraint. The one real overlap is
  that the sibling plan names the bare `playwright` package, which the installed
  `@playwright/test` `1.62.1` supersedes — recorded as a note, not acted on from
  here.
- **`db-test`'s CLI rule applies to this job too.** It provisions a database, so
  it is on the local side of the grants divide: `npm ci` then `npx supabase`,
  never `supabase/setup-cli@v1` (`CLAUDE.md`; `lessons.md` entry 2).

## Desired End State

`.github/workflows/ci.yml` has four jobs. On every pull request, `ci` and `e2e`
both run and both must be green to merge. On every push to `master`, all three
gates run and `deploy` waits on all three, so a browser-level regression leaves
the hosted schema and the Worker untouched.

The `e2e` job has been observed **red** at least once from a deliberate break, so
it is a verified gate rather than a decoration. When it fails it leaves the
Playwright HTML report and traces as downloadable artifacts.

`test-plan.md` §4, §5, §6.6, §6.7 and §8, `CLAUDE.md`'s CI/CD section, and
`tests/e2e/README.md` all state that e2e runs in CI, and §5 carries the measured
`db-test` numbers so its own still-open trigger question no longer rests on an
unknown.

Verify by: opening a pull request and seeing `e2e` in the checks list; running
`gh run view <id>` on a `master` push and seeing `deploy` queued behind three
jobs; and grepping the three documents for "local only" / "not wired".

## What We're NOT Doing

- **Not widening `db-test` to pull requests.** The measurement makes it
  attractive — 195 s in parallel with a ~285 s `e2e` job costs nothing on the
  critical path — but that is a separate cost decision, and `change.md`'s own
  argument against riding cost decisions along inside unrelated changes applies
  to this one too. Phase 2 writes the measured numbers into §5 so the decision
  can be made on data; it does not make it.
- **Not caching the Chromium binary.** Its cost is the one term still unmeasured.
  Pre-optimising it would repeat exactly the mistake this change exists to
  correct. Phase 1 records the number; caching is a follow-up if it proves large.
- **Not touching `playwright.config.ts`.** Its `process.env.CI` branches already
  do the right thing.
- **Not editing `context/changes/testing-client-state-viewport/plan.md`.** That
  plan is approved and belongs to another change; Phase 2 records the
  `playwright` / `@playwright/test` reconciliation as a note in §4 rather than
  reaching into it.
- **Not adding e2e specs.** The suite's contents are §3 Phase 5's business and
  `/10x-e2e`'s. This change wires what exists.
- **Not making the suite parallel.** `workers: 1` is load-bearing (one shared
  seed account); changing it is a fixtures problem, not a CI problem.

## Implementation Approach

A fourth job rather than steps appended to `db-test`. The stack provisioning is
duplicated — 165 s of `supabase start` + `db reset` paid twice per push — and
that is the price of a red gate that names the thing that broke. A browser flake
inside `db-test` would block `deploy` under a job name that says "db-test", and
would muddy that job's `if: failure()` docker-logs step, which currently has
exactly one meaning.

The job is landed and the `deploy` edge added together, but the deliberate-break
verification sits between them in the checklist: the job must be seen red on a
pull request before anyone relies on it to hold a release.

## Critical Implementation Details

**The quote strip is load-bearing.** `supabase status -o env` emits
`SUPABASE_URL="http://127.0.0.1:54321"` — with the double quotes as literal
characters. `$GITHUB_ENV` does not interpret them, so appending the raw line
hands the app a URL whose first character is `"`. The failure is not a clean
error: `createClient()` receives a non-empty string, so the null-check in
`src/lib/supabase.ts` passes, and the break surfaces later as a fetch failure
during sign-in. Strip the quotes, and filter to the two variables so the
service-role key and JWT secret never enter the app's environment.

**Step order is fixed by three dependencies.** `npm ci` before any `npx supabase`
(the grants divide). `supabase start` before `supabase status` (nothing to report
otherwise). `supabase db reset` before the suite (it is what runs `seed.sql`, and
the suite's sign-in has no other source for its user). The browser install has no
ordering constraint and is placed last before the suite so its measured duration
reads cleanly off the step timings.

**`npx astro sync` is not needed here.** `astro dev` generates its own types at
startup, and this job never runs `astro check`. The `ci` job already owns
typecheck.

**The `deploy` edge is only ever exercised on pushes.** `deploy` keeps its
`if: github.event_name == 'push'` guard, so on a pull request `e2e` runs and
`deploy` is skipped entirely — the same shape the existing `db-test` edge has,
and worth stating in the comment for the same reason it is stated there.

---

## Phase 1: The `e2e` job, verified and gating

### Overview

Add the job, prove it goes green on a runner, prove it goes red on a real break,
and wire `deploy` behind it.

### Changes Required:

#### 1. New `e2e` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the Playwright suite on every push and every pull request against
a real, locally-provisioned Supabase stack, so a cross-boundary regression is
caught in review rather than after merge.

**Contract**: A fourth job named `e2e`, placed after `db-test` and before
`deploy`. `runs-on: ubuntu-latest`. **No `if:` guard** — it inherits the
workflow's push-and-pull_request triggers, which is what makes it a merge gate
and what §5's "CI on PR" row asks for. **No `secrets.*` reference and no
`environment:`**, for the same reason `db-test` has neither: the stack is local,
and the app's two variables come out of it.

Steps, in this order:

1. `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 22` and
   `cache: npm` — identical to the other three jobs.
2. `npm ci`.
3. `npx supabase start -x vector`.
4. `npx supabase db reset`.
5. Export the local stack's credentials into the job environment:
   `npx supabase status -o env --override-name api.url=SUPABASE_URL --override-name auth.anon_key=SUPABASE_KEY`,
   filtered to the two `SUPABASE_` lines and stripped of the literal double
   quotes, appended to `$GITHUB_ENV`. See _Critical Implementation Details_ for
   why the strip and the filter are not cosmetic.
6. `npx playwright install --with-deps chromium` — its own step, so `npm ci`
   stays byte-identical across all four jobs and so the install's duration reads
   off the step timings on its own.
7. `npm run test:e2e`.

Comments the job must carry, each stating a rule that is invisible from the YAML:

- The same CLI-divide warning `db-test` carries at `:47-53`. This job provisions
  a database; it must resolve the lockfile's `2.98.2` via `npm ci` + `npx
supabase` and must never adopt `deploy`'s `supabase/setup-cli@v1` block.
- `-x vector` is mandatory — `[analytics] enabled = true` spawns a log-shipper
  whose failing health check aborts the whole `start`, and there is no config
  block to disable it.
- Why the job needs no secrets: `astro dev` on workerd reads `.dev.vars`, then
  `.env`, then the process environment, and the third is enough — the values
  here are the _local_ stack's, never the hosted project's.
- Why `db reset` is not redundant with `start`: it is what applies
  `supabase/seed.sql`, and `tests/e2e/auth.setup.ts` signs in as a user that
  exists nowhere else.

#### 2. Failure artifacts

**File**: `.github/workflows/ci.yml`

**Intent**: Make a red e2e run diagnosable. `trace: "on-first-retry"` and
`screenshot: "only-on-failure"` already produce exactly the right evidence and it
is currently unreachable from CI.

**Contract**: An `actions/upload-artifact@v4` step under `if: failure()`,
uploading `playwright-report/` and `test-results/`, with `retention-days` set
short and `if-no-files-found: ignore`. Comment it against `db-test`'s
`docker logs` precedent at `:66-67`: same failure class — opaque without a dump.

#### 3. `deploy` gains the edge

**File**: `.github/workflows/ci.yml`

**Intent**: Make the gate a gate. A red e2e must leave the hosted schema and the
Worker untouched.

**Contract**: `needs: [ci, db-test]` → `needs: [ci, db-test, e2e]`. Extend the
existing comment above it: `deploy` stays push-only, so on pull requests all
three gates run and this edge is never evaluated — the same note the comment
already makes about `db-test`.

**Land this only after the deliberate-break verification below has been
observed.** A `needs` edge on a job nobody has seen fail is a release that can
get stuck for a reason no one has rehearsed.

### Success Criteria:

#### Automated Verification:

- The `e2e` job appears and passes on a pull request
- The `e2e` job appears and passes on a push to `master`
- The job log shows Supabase CLI `2.98.2` and contains no `permission denied for table`
- The job log contains no `Using secrets defined in` line — confirming the process-environment path, not an accidental checked-in file
- `deploy` is queued behind three jobs on a `master` push: `gh run view <id> --json jobs`
- Local gate still passes unchanged: `npm ci && npx astro sync && npm run lint && npm run typecheck && npm run test && npm run build`

#### Manual Verification:

- **Teeth check.** On a branch, break a behaviour the suite covers — force `GET /api/entries` to return `[]`, the break §6.6 records for the seed spec — push, and confirm the `e2e` job goes red on the pull request while `ci` stays green. Revert; never merge the break.
- Download the failure artifact from that red run and open the trace; confirm it shows the failing step
- Record the measured duration of every step from the Actions API, especially `npx playwright install --with-deps chromium` and the suite itself
- Confirm the total pull-request wall-clock against the 98 s baseline and note whether the browser install is large enough to justify caching
- Confirm no `secrets.*` reference was added to the new job

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
teeth check was observed before proceeding to Phase 2 — Phase 2 writes "required
— wired" into §5, and that claim rests on the break having been seen.

---

## Phase 2: Documents and close-out

### Overview

Every document that says the e2e suite is local-only becomes wrong the moment
Phase 1 lands. Correct them, record what was measured, and close the change.

### Changes Required:

#### 1. `test-plan.md` §5 — the gate rows

**File**: `context/foundation/test-plan.md`

**Intent**: Promote the e2e row, and retire the unmeasured number that both the
e2e paragraph and the `db-test` paragraph currently rest on.

**Contract**: The `e2e (Playwright)` row's Where becomes the `e2e` job, Required?
becomes `required — wired; runs on pushes and pull requests`. Replace the
paragraph beginning "The e2e gate is deliberately listed as **not required**"
with what was actually decided and measured: the job's shape, why it is separate
from `db-test` rather than appended to it, why it needs no secrets, and its
measured wall-clock.

Amend the `db-test` paragraph too. It currently says the trigger is push-only
"because the wall-clock cost of `supabase start` on a runner was unmeasured" —
that is no longer true. State the measured figures (`supabase start -x vector`
134 s; whole job 195 s; run `32489937016`, 2026-08-21) and that widening to pull
requests is now wall-clock-free once `e2e` runs there in parallel, while leaving
the decision explicitly open and out of this change's scope.

#### 2. `test-plan.md` §4 — the e2e stack row

**File**: `context/foundation/test-plan.md`

**Contract**: Replace "Local only — no CI step; whether that changes is now an
open change of its own" with the resolved answer and the archived change path.
Bump `checked:`. Keep the note that the sibling change's plan names the bare
`playwright` package which `@playwright/test` `1.62.1` supersedes — that
reconciliation still belongs to that change.

#### 3. `test-plan.md` §6.6 — the cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: §6.6's closing bullet tells authors to prefer cheaper layers because
those "are faster, less flaky, and gated in CI, which this layer is not." The
last clause is now false, and it sits in the sentence that steers layer choice.

**Contract**: Rewrite that bullet so the argument survives the fact changing: e2e
is now gated, so the reason to reach for it last is cost and flake, not absence
of enforcement — and name the cost with the measured number. Add a short
**Running in CI** bullet: the job name, that it provisions its own stack and
needs no secrets, that the process-environment path is what supplies
`SUPABASE_URL` / `SUPABASE_KEY`, and where the failure artifacts land.

#### 4. `test-plan.md` §6.7 and §8

**File**: `context/foundation/test-plan.md`

**Contract**: A §6.7 note for this change recording what it measured — every
step timing from Phase 1, the browser-install duration, the suite's runtime on a
runner against its 23.7 s local figure, and the finding that process env
substitutes for `.dev.vars` (with the `.dev.vars` → `.env` → process-env
precedence, since that is a fact about the whole app and not only about CI). Note
the shelf life: `workers: 1` is a necessity, so suite wall-clock grows linearly
with spec count and the trigger decision will want revisiting. A §8 Freshness
Ledger entry for the same.

#### 5. `CLAUDE.md` — the CI/CD section

**File**: `CLAUDE.md`

**Contract**: The section opens "`.github/workflows/ci.yml` has three jobs" —
now four. Describe `e2e` alongside the others: trigger, that it is secret-free
and why, the CLI-divide rule it shares with `db-test`, and that `deploy` now
declares `needs: [ci, db-test, e2e]`. Also correct the **Commands** section's
`npm run test:e2e` line, which currently reads as a purely local command.

#### 6. `tests/e2e/README.md` — the Running section

**File**: `tests/e2e/README.md`

**Contract**: Add to **Running** that the suite also runs in CI in the `e2e` job
on pushes and pull requests, that a failure leaves a downloadable HTML report and
trace, and that the port-4321 and `reuseExistingServer: false` guidance is about
local sibling worktrees — a runner has no such conflict.

#### 7. Change close-out

**File**: `context/changes/e2e-ci-gate/change.md`

**Contract**: `status: complete`, `updated: <date>`. The Notes section's four
numbered questions each get their answer recorded inline, including question 1's
measured number — this change was opened to answer them, and the answers should
survive in the change record, not only in `test-plan.md`.

### Success Criteria:

#### Automated Verification:

- Prettier clean on every edited markdown file: `npm run format`
- No document still asserts the e2e suite is CI-less: `grep -rn "local only\|local-only\|not wired\|which this layer is not" context/foundation/test-plan.md CLAUDE.md tests/e2e/README.md` returns nothing about e2e
- The full local gate still passes from a clean install
- The `ci` and `e2e` jobs both pass on the pull request carrying these edits

#### Manual Verification:

- §5's e2e row and §4's e2e row agree with what `.github/workflows/ci.yml` actually runs — no row claims a gate that is not wired, and none claims one that is
- §5's `db-test` paragraph states the measured figures and states the trigger question as open, without implying this change settled it
- Someone who did not write it can read §6.6's Running-in-CI bullet and know what a red `e2e` job means and where to get the trace
- `CLAUDE.md`'s job count and `deploy` `needs:` list match the file

---

## Testing Strategy

This change adds no test code; what it adds is enforcement, so the strategy is
about proving the enforcement is real.

### The teeth rule

`test-plan.md` §6.1 and the runner-bootstrap plan both hold that a gate never
observed failing has not been verified. Phase 1's teeth check is the whole
verification:

| Break this                               | Expected to turn red                     |
| ---------------------------------------- | ---------------------------------------- |
| `GET /api/entries` forced to return `[]` | `e2e` job only; `ci` and `db-test` green |

That specific break is chosen because §6.6 records it as the one already used to
verify `seed.spec.ts` locally, so a red run confirms the CI job reproduces a
known-good local signal rather than merely failing for some new CI-shaped reason.
Revert immediately; never commit it to `master`.

### What is not being tested

The specs themselves. Their assertions were break-verified when they were written
(§6.6 records two breaks for `expense-reaches-reports.spec.ts`, including the
one-grosz shift that proved the amount assertion carries its own weight). This
change does not re-verify them.

### Manual testing steps

1. Open a pull request with the `e2e` job only; confirm it runs and passes, and
   read every step's duration out of the Actions API.
2. On the same branch, apply the break above; confirm `e2e` goes red and `ci`
   does not; download the artifact and open the trace; revert.
3. Land the `deploy` edge; push to `master`; confirm `deploy` queues behind three
   jobs and still pauses for the `production` environment's required reviewer.
4. Confirm the `e2e` job log names CLI `2.98.2` and shows no
   `permission denied for table`.

## Performance Considerations

Pull-request wall-clock goes from a measured 98 s to a projected ~285 s, because
`e2e` becomes the critical path. Roughly 165 s of that is `supabase start` +
`db reset` duplicated from `db-test` — the deliberate price of a gate whose red
names its own cause.

Two follow-ups this change deliberately leaves open, both now holding real
numbers rather than assumptions:

- **Browser-install caching.** Record the measured duration in §6.7. If it is a
  meaningful share of the job, `actions/cache` on `~/.cache/ms-playwright` keyed
  on the pinned `@playwright/test` version is the follow-up — with
  `install-deps` kept separate, since apt packages are not cacheable.
- **`db-test` on pull requests.** Wall-clock-free once `e2e` runs there, since
  195 s sits inside ~285 s of parallel work. Costs runner-minutes and puts a
  second Docker-dependent job on every PR. §5 records the numbers; the decision
  is someone else's change.

The suite is serial by necessity — every spec signs in as the one seed user and
shares that account's rows — so its wall-clock grows linearly with spec count.
Three tests cost 23.7 s locally today. This trigger decision has a shelf life,
and §6.7 should say so.

## Migration Notes

No schema changes. `supabase/migrations/` is untouched; this change only causes
those migrations to be executed in one more place.

`deploy`'s behaviour changes in one way: it now waits on a third gate. Rollback
is a one-line revert of the `needs:` list, which leaves the `e2e` job running and
reporting without holding a release — a usable intermediate state if the job
proves flaky in practice.

## References

- Change brief: `context/changes/e2e-ci-gate/change.md`
- Quality contract: `context/foundation/test-plan.md` §4 (e2e row), §5 (gate
  table and both trailing paragraphs), §6.6, §6.7, §8
- `context/foundation/lessons.md` entry 2 — the CLI/grants divide
- `.github/workflows/ci.yml:38-67` — the `db-test` job this one is modelled on,
  including the CLI-divide comment block and the `if: failure()` diagnostic dump
- `.github/workflows/ci.yml:69-73` — `deploy`'s `needs:` list and its comment
- `playwright.config.ts:29-36` — the `process.env.CI` branches that already make
  the suite CI-ready
- `tests/e2e/auth.setup.ts:19-20` — the seed credentials the job's `db reset`
  must provision
- `context/changes/testing-client-state-viewport/plan.md:686-720` — the sibling
  browser-install step, for the reconciliation note only
- `context/archive/2026-08-21-testing-runner-bootstrap/plan.md:665-680` — the
  teeth rule for CI gates, and the `supabase start` measurement this change
  finally supplies
- GitHub Actions run `32489937016` — the source of every measured figure above

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The `e2e` job, verified and gating

#### Automated

- [x] 1.1 The `e2e` job appears and passes on a pull request — 6adfb08
- [ ] 1.2 The `e2e` job appears and passes on a push to `master`
- [x] 1.3 Job log shows CLI `2.98.2` and no `permission denied for table` — 6adfb08
- [x] 1.4 Job log contains no `Using secrets defined in` line — 6adfb08
- [ ] 1.5 `deploy` is queued behind three jobs on a `master` push
- [x] 1.6 Local gate still passes unchanged — 6adfb08

#### Manual

- [x] 1.7 Teeth check: forced-`[]` break turns `e2e` red and leaves `ci` green; reverted — 6adfb08
- [x] 1.8 Failure artifact downloaded and trace opened on that red run — 6adfb08
- [x] 1.9 Every step duration recorded, especially the browser install and the suite — 6adfb08
- [x] 1.10 Pull-request wall-clock compared against the 98 s baseline; caching verdict noted — 6adfb08
- [x] 1.11 No `secrets.*` reference in the new job — 6adfb08

### Phase 2: Documents and close-out

#### Automated

- [x] 2.1 Prettier clean on every edited markdown file
- [x] 2.2 No document still asserts the e2e suite is CI-less
- [x] 2.3 Full local gate passes from a clean install
- [ ] 2.4 `ci` and `e2e` both pass on the pull request carrying these edits

#### Manual

- [x] 2.5 §5's and §4's e2e rows agree with what the workflow actually runs
- [x] 2.6 §5's `db-test` paragraph carries the measured figures and leaves its trigger question open
- [x] 2.7 §6.6's Running-in-CI bullet is legible to someone who did not write it
- [x] 2.8 `CLAUDE.md`'s job count and `deploy` `needs:` list match the file
