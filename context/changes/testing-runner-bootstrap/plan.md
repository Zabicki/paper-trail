# Runner Bootstrap + CI Test Floor — Implementation Plan

## Overview

Stand up the project's first JavaScript test runner and convert four planned
quality gates into enforced CI gates: typecheck, unit tests, pgTAP on the merged
migration set, and a from-scratch migration apply. This is rollout phase 1 of
`context/foundation/test-plan.md` §3, covering risk #4 — *a schema migration
reaches the hosted database ahead of the Worker that matches it*.

The change ships a real unit test with an external oracle (not a smoke test), a
Docker-backed `db-test` CI job that runs all existing pgTAP assertions before
`deploy` is allowed to push migrations to production, and the documentation
updates that keep the test-plan orchestrator's state honest.

## Current State Analysis

**No JS test infrastructure exists.** `package.json:5-13` defines
`dev`/`build`/`preview`/`astro`/`lint`/`lint:fix`/`format`. There is no `test`
script, no `typecheck` script, no runner dependency, and no test file anywhere in
the tree.

**No typecheck gate exists.** `@astrojs/check` is a dependency
(`package.json:15`) and is invoked nowhere — no script, no CI step. The archive
records the consequence: lint and build both passed a broken intermediate state
and only a hand-run `tsc --noEmit` caught eight stale `as` assertions
(`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:237`).

**No migration is executed anywhere in the pipeline except against production.**
`.github/workflows/ci.yml` was read in full. The `ci` job (`:10-24`) is
`npm ci` → `astro sync` → `lint` → `build`. There is no Docker service, no
`supabase start`, no `db reset`, no `test db`. `supabase db push --yes`
(`ci.yml:60`) is the first and only execution of any migration, and it targets
the hosted database. Because `deploy` is gated to `push` at `:27`, **a pull
request that adds a destructive migration is green** — Supabase is never
contacted on a PR.

**104 pgTAP assertions have never run outside a laptop.** Six suites exist in
`supabase/tests/`, each wrapped `begin;` … `select * from finish(); rollback;`,
each depending on the two fixed seed users in `supabase/seed.sql`. Research also
found, via `docker ps`, a Supabase stack labelled `krzysztof` — not
`paper-trail` — publishing exactly this repo's ports, meaning even the local runs
may have been talking to a sibling worktree's database.

**Both typecheck candidates are green today** (verified in this planning
session): `npx tsc --noEmit` exits 0, and `npx astro check` reports
`0 errors, 0 warnings, 5 hints` across 83 files and exits 0. Neither requires a
cleanup detour before being made a required gate.

### Key Discoveries

- **`src/lib/text.ts` imports nothing** (`:1-42`) — no `astro:*`, no Supabase, no
  React, no `Intl`, no `Date`, no DOM. A failure in its test can only be the
  harness. This is why the runner can be proven *before* the `astro:env/server`
  question is solved, and research states plainly that the virtual-module
  question must not block the bootstrap.
- **`text.ts` has a genuinely external, triple-sourced oracle**: the database
  bound `check (char_length(description) <= 200)`
  (`supabase/migrations/20260816140000_add_entry_description.sql:28`), Postgres'
  documented code-point counting semantics, and the UTF-16 surrogate-pair spec
  fact that `'a😀b'.slice(0,2)` yields a lone surrogate while
  `[...'a😀b'].length === 3`. The module's own header (`text.ts:11-19`) argues
  against the plausible-but-wrong `Intl.Segmenter` alternative, which would
  *under*-count against the database bound.
- **The `slice` defect the header describes is already fixed** —
  `src/lib/services/receipts.ts:174` calls `truncateCodePoints`. The test pins
  the fix against regression; it does not catch a live bug.
- **The CLI pin is the #1 implementation trap.** `package.json:55` reads
  `^2.23.4`; the real `2.98.2` pin lives only in `package-lock.json:13359`; the
  workflow's existing `supabase/setup-cli@v1` block (`ci.yml:50-52`) pins
  `2.114.0`. CLI ≥ 2.114.0 stops granting `select/insert/update/delete` to
  `anon`/`authenticated` on new `public` tables, so a job that *provisions* a
  database with it produces one whose own app role cannot read its own tables —
  all assertions fail `permission denied` before the first one runs
  (`context/foundation/lessons.md:15-23`). `link` + `db push` against hosted is
  unaffected, which is why the existing pin is safe *where it is* and wrong
  anywhere that runs `supabase start`.
- **`[analytics] enabled = true` at `supabase/config.toml:371-372`** is what
  spawns the vector log-shipper whose failing health check aborts the whole
  `start`. There is no vector block to disable — the `-x vector` CLI flag is the
  only lever.
- **`project_id = "paper-trail"` (`config.toml:5`)** ⇒ the local database
  container is named `supabase_db_paper-trail`, which is how a failure-path log
  dump can reach it.
- **`eslint.config.js:85` calls `includeIgnoreFile(gitignorePath)`** on the root
  `.gitignore`, so anything gitignored is automatically lint-ignored — no
  separate ESLint ignore entry is needed for generated output.
- **`tsconfig.json:3` is `include: [".astro/types.d.ts", "**/*"]`**, so a new
  `*.test.ts` is automatically inside the TS project; `eslint.config.js:18` uses
  `projectService: true`, so type-aware linting will reach it without a
  "file not in tsconfig" error.
- **`tsconfig.json:4` is `exclude: ["dist"]`**, which *replaces* TypeScript's
  defaults — any new generated directory lands inside the TS program unless
  explicitly excluded. (Avoided here by not producing one; see *What We're NOT
  Doing*.)
- **Vitest 4.1.11 is current**, peer range `vite: ^6 || ^7 || ^8`, which matches
  this repo's `overrides: { vite: "^7.3.2" }` (`package.json:60-62`). ≥4.1 is
  also the floor `getViteConfig` requires.
- **A documented Postgres SEGFAULT** exists at
  `supabase/tests/entries_summary_test.sql:225-249`: the local image crashes the
  backend with signal 11 when a function-EXECUTE denial is raised inside an
  impersonated transaction. Both summary suites already work around it with
  `has_function_privilege` instead of `throws_ok`. In CI this matters because a
  segfault drops every connection, so the remaining files fail with connection
  errors and the real cause is invisible in the log.

## Desired End State

- `npm run test`, `npm run typecheck`, and `npm run test:watch` all exist and work.
- One unit test file exists, is green, and provably has teeth (breaking the module
  under test turns it red).
- The `ci` job runs lint, typecheck, and unit tests on every push and pull
  request, and stays secret-free.
- A `db-test` job runs on pushes to `master`, applies the merged migration set to
  an empty database from scratch, runs every pgTAP assertion, and blocks `deploy`
  when either fails.
- `deploy` cannot reach `supabase db push` unless both `ci` and `db-test` are green.
- `package.json` hard-pins the Supabase CLI, and the three documents that
  misdescribe that pin are corrected.
- `context/foundation/test-plan.md` reflects the new reality: §3 Phase 1 complete,
  §4 stack rows resolved, four §5 gates flipped to `required — wired`, §6.1
  cookbook filled in, and §7 carrying an explicit entry for the part of risk #4
  this change does **not** cover.

**Verification**: open a PR containing a deliberately destructive migration
against `master` and observe that `db-test` goes red on the merge commit before
`deploy` runs. Revert without deploying.

## What We're NOT Doing

- **Not building the Face-B gate** (old Worker vs new schema). Risk #4 has two
  faces. Face A — the migration cannot apply, or code runs against a schema that
  isn't there — fails loudly and is what this change gates. Face B — the migration
  applies cleanly but is backward-*incompatible* with the Worker still running
  during the deploy window — fails silently, and gating it requires a
  "last deployed SHA" concept that does not exist in this repo. Research confirms
  the currently loaded trigger is safe: there is no `select("*")` anywhere in
  `src/`, every read names its columns explicitly, and `category_color` is
  declared at `src/lib/services/reports.ts:294` but never dereferenced. Face B is
  recorded in test-plan §7 rather than left to be implied as covered.
- **Not gating the incremental `db push` path.** A clean replay into an empty
  database is not evidence the next incremental push onto the existing production
  schema succeeds — `20260818090000_add_category_icon.sql:104` does
  `drop function … ; create function …` and `:40-90` runs a one-shot data
  backfill, both of which behave differently on clean replay. Gating it needs a
  shadow database seeded to the last-deployed schema. Out of scope.
- **Not adding coverage reporting.** test-plan §1 makes *risk* coverage the
  metric, not line coverage. Skipping it also avoids adding a `coverage/`
  directory that would need excluding from `tsconfig.json` (whose `exclude`
  replaces the defaults) as well as gitignoring.
- **Not running unit tests or pgTAP pre-commit.** `.husky/pre-commit` runs
  `npx lint-staged` only; hook configuration is explicitly a later lesson's scope
  and test-plan §5 lists the post-edit hook as *recommended after §3 Phase 5*.
- **Not adding component-test, API-mocking, or headless-browser tooling.** Those
  belong to test-plan §3 Phases 2–5.
- **Not resolving the 2026-10-30 Supabase grants deprecation.** It has a real
  deadline inside the project's horizon and needs a CLI bump to ≥2.102.0, which
  directly conflicts with hard-pinning `2.98.2` in this change. Flagged in
  *Open Risks*, deliberately not solved here.
- **Not adding a speculative ESLint override for test files.** Research predicted
  one might be needed; `text.test.ts` is pure string manipulation, so the override
  is added only if `npm run lint` actually trips.

## Implementation Approach

Four gates, three surfaces, sequenced so each is proven where it is cheapest to
debug before the next depends on it.

The runner is stood up and proven **locally** first, on a module that imports
nothing — so a red test can only mean a real defect, never a resolution problem.
Only then is it wired into the fast CI lane alongside typecheck. The Docker-backed
database gate comes third, as a **separate job**, because `supabase link` writes
project state into the same `supabase/` directory a local stack reads, and both
`test db --linked` and `db reset --linked` target production. Keeping it separate
also keeps it secret-free: `supabase start` is fully local, so the job needs no
`production` environment and therefore no approval gate.

The `getViteConfig` question — whether Astro's sanctioned Vitest integration
actually resolves `astro:env/server` under the Cloudflare adapter — is answered as
a deliberately **non-gating spike** placed after CI is working, so it can inform
test-plan Phases 2 and 5 without ever being able to block this one.

## Critical Implementation Details

**CLI invocation form is load-bearing, not stylistic.** Any job that runs
`supabase start` or `db reset` **provisions** a database, which puts it on the
local side of the grants divide. It must run `npm ci` first and invoke
`npx supabase`, resolving the lockfile's `2.98.2`. Copying the neighbouring
`supabase/setup-cli@v1` / `version: 2.114.0` block from `ci.yml:50-52` into the new
job is the single most likely way to produce a green-but-meaningless run — and its
failure mode (`permission denied for table …` on suites that have shipped green)
looks exactly like a broken migration, which `lessons.md:15-23` records having
already cost a wrongly-approved grants migration and an edit to a shipped test.

**Job ordering relative to `deploy`.** `deploy` currently declares `needs: ci`. It
must become `needs: [ci, db-test]`, otherwise the database gate exists but gates
nothing. Both `deploy` and `db-test` carry `if: github.event_name == 'push'`, so on
pull requests both are skipped and the `needs` edge is never exercised.

**Debug surface on failure.** A Postgres segfault
(`supabase/tests/entries_summary_test.sql:225-249`) drops every connection, so the
files after it fail with connection errors and the genuine cause never appears in
the pgTAP output. The job needs an `if: failure()` step dumping the
`supabase_db_paper-trail` container's log, or a real crash will be misread as a
test failure.

## Phase 1: Runner Bootstrap

### Overview

Install Vitest, add a standalone config, add the three npm scripts, write the
first unit test, and hard-pin the Supabase CLI. Everything verified locally; no CI
changes.

### Changes Required:

#### 1. Runner dependency and CLI pin

**File**: `package.json`

**Intent**: Add Vitest as a dev dependency, and replace the Supabase caret range
with an exact pin so the grants trap cannot be reintroduced by `npm install`,
`npm update supabase`, or a Dependabot bump — none of which would produce a diff
to any workflow file.

**Contract**: `devDependencies` gains `vitest` at `4.1.11` (peer
`vite: ^6 || ^7 || ^8`, satisfied by the existing `overrides.vite: ^7.3.2`), and
`"supabase": "^2.23.4"` becomes `"supabase": "2.98.2"` — the version already
resolved in `package-lock.json:13359` and installed in this tree, so `npm ci`
produces no version change. `scripts` gains three entries:

- `typecheck` → `astro check`
- `test` → `vitest run`
- `test:watch` → `vitest`

`vitest run` (not bare `vitest`) is what makes the script terminate rather than
enter watch mode, which is what CI and any future hook require.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Give the runner the one thing it cannot infer — the `@/*` path alias —
without pulling in Astro's plugin chain. Vite does not read `tsconfig.paths`
automatically, and the first test's own `import { … } from "@/lib/text"` is what
proves the alias resolves.

**Contract**: Default-exported Vitest config declaring `resolve.alias` mapping
`@/` to `./src/`, mirroring `tsconfig.json:9-11`. Test discovery covers
`src/**/*.test.ts`. Environment stays the default Node environment — no jsdom,
nothing DOM-related is under test in this phase. Deliberately does **not** go
through `getViteConfig`; see Phase 4.

Note the standing consequence, recorded here because Phase 5 of the *test-plan*
will need it: a standalone config inherits none of `astro.config.mjs`'s Vite
settings, including the `resolve.dedupe: ["react", "react-dom"]` fix that
`astro.config.mjs:18-27` documents as preventing a real hydration crash.

#### 3. First unit test

**File**: `src/lib/text.test.ts` (new)

**Intent**: Prove the harness on a module that imports nothing, and pin the
code-point truncation contract against regression. Co-located with the module,
`*.test.ts`, establishing the convention test-plan §6.1 will record.

**Contract**: Tests `countCodePoints` and `truncateCodePoints` from `@/lib/text`.
Expectations are hand-written from the external oracle — **not** derived by calling
the implementation. The cases that carry the signal:

- A string already within the bound is returned **unchanged** (identity, not a
  rebuilt copy).
- `countCodePoints` counts an astral character as **one**, matching Postgres'
  `char_length()` rather than JavaScript's `.length` (`'a😀b'` → 3, not 4).
- Truncating at a boundary that falls **inside** a surrogate pair never emits a
  lone surrogate — the defect the module exists to prevent. Assert the result is
  well-formed, not merely short.
- Truncation at exactly the bound, and at bound − 1 / bound + 1.
- The 200-code-point database bound from
  `20260816140000_add_entry_description.sql:28` is honoured for an all-astral
  string, where the UTF-16 length is double the code-point count.

Do **not** assert grapheme-cluster behaviour. `text.ts:11-19` argues explicitly
that clustering is the wrong unit and would under-count against the database
bound; a test encoding it would enshrine the bug the module rejects.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Typecheck passes with 0 errors: `npm run typecheck`
- Lint passes, including the new files: `npm run lint`
- Build still passes: `npm run build`
- After `npm ci`, the pinned CLI is installed: `npx supabase --version` reports `2.98.2`

#### Manual Verification:

- `npm run test:watch` enters watch mode and re-runs on edit, then exits cleanly
- **Teeth check**: temporarily change `truncateCodePoints` to use `value.slice()`
  instead of code-point iteration; confirm the surrogate-pair test goes red with a
  legible failure message, then revert
- If `npm run lint` flags the test file, the minimal `files: ["**/*.test.ts"]`
  override added relaxes only the rules actually tripped — not the set research
  predicted

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: CI Fast Lane

### Overview

Add typecheck and unit tests to the existing `ci` job, so both run on every push
and every pull request. No Docker, no secrets, no new job.

### Changes Required:

#### 1. Extend the `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Turn two of the four §5 gates from planned into enforced, in the job
that is already the merge gate.

**Contract**: Two steps inserted into the `ci` job between `npm run lint`
(`:20`) and `npm run build` (`:21`): `npm run typecheck` and `npm run test`.

Ordering is load-bearing in one direction only: `astro check` needs generated
types, so it must come **after** the existing `npx astro sync` at `:19` — which it
does by construction. Placing both before `build` means a type or logic failure
surfaces without paying for a full build first.

The job stays secret-free. `SUPABASE_URL`/`SUPABASE_KEY` remain scoped to the
`build` step's `env:` block, where they already are; neither new step needs them.

Set `ASTRO_TELEMETRY_DISABLED: 1` at job level so `astro check`'s telemetry
notice does not clutter the log.

### Success Criteria:

#### Automated Verification:

- The workflow file is valid YAML and the job is accepted by GitHub Actions
- `ci` passes on a pull request with both new steps present and green
- The `ci` job runs no Supabase CLI and requires no secrets beyond the existing build-step pair

#### Manual Verification:

- The CI log shows `astro check` reporting `0 errors` over ~83 files
- The CI log shows Vitest's file and test counts, not a watch-mode hang
- **Teeth check**: push a commit with a deliberate type error in a `.astro`
  frontmatter block; confirm `ci` goes red at the typecheck step (this is the
  hole `tsc --noEmit` would have left open), then revert

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 3: CI Database Gate

### Overview

Add a Docker-backed `db-test` job that applies the merged migration set to an
empty database and runs every pgTAP assertion, and make `deploy` depend on it.
Runs on pushes to `master` only.

### Changes Required:

#### 1. The `db-test` job

**File**: `.github/workflows/ci.yml`

**Intent**: Execute the migration set somewhere other than production, and run the
104 assertions that have never run outside a laptop — against the **merged** set,
which is the gap per-branch local runs structurally cannot close.

**Contract**: A new top-level job `db-test`, `runs-on: ubuntu-latest`,
`if: github.event_name == 'push'`, requiring no secrets and no `environment:`.

A snippet is warranted here because the CLI invocation form is the phase's
load-bearing trap and reads as an arbitrary style choice otherwise:

```yaml
  db-test:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      # npm ci FIRST, and `npx supabase` throughout. This job PROVISIONS a
      # database, which puts it on the local side of the grants divide: it must
      # resolve the lockfile's 2.98.2. Do NOT reuse the supabase/setup-cli@v1
      # 2.114.0 block from the deploy job below — that CLI stops granting
      # select/insert/update/delete to anon/authenticated on new public tables,
      # and every pgTAP file then fails "permission denied for table ..." before
      # a single assertion runs. See context/foundation/lessons.md.
      - run: npm ci
      # -x vector: [analytics] enabled = true (supabase/config.toml:371-372)
      # spawns a log-shipper whose failing health check aborts the whole start.
      # There is no vector block to disable; the CLI flag is the only lever.
      - run: npx supabase start -x vector
      # From-scratch apply of the MERGED migration set, plus seed.sql — which the
      # pgTAP suites hard-require for the two fixed users their rows FK to.
      - run: npx supabase db reset
      - run: npx supabase test db
      # A Postgres segfault (entries_summary_test.sql:225-249) drops every
      # connection, so later files fail with connection errors and the real cause
      # never reaches the pgTAP output.
      - if: failure()
        run: docker logs supabase_db_paper-trail --tail 200
```

`npx supabase start` on a fresh runner already applies migrations from scratch, so
`db reset` is a second clean replay. That redundancy is deliberate: it makes the
from-scratch gate explicit rather than incidental, and it keeps the CI command
sequence identical to the one `CLAUDE.md` documents locally, which is what §6.3 of
the cookbook tells contributors to run.

**Expected assertion count**: the six suites' `plan(n)` declarations sum to
**104** (19 + 20 + 10 + 23 + 26 + 6). An archived manual run recorded
`Files=6, Tests=102`. Reconcile the discrepancy from the actual CI output rather
than assuming either figure — a suite reporting fewer tests than it planned is
itself a finding.

#### 2. Gate the deploy

**File**: `.github/workflows/ci.yml`

**Intent**: Make the new job actually block the one step that reaches production.

**Contract**: `deploy`'s `needs: ci` (`:28`) becomes `needs: [ci, db-test]`. Both
jobs already carry `if: github.event_name == 'push'`, so pull requests skip both
and the edge is never exercised there.

### Success Criteria:

#### Automated Verification:

- `db-test` runs and passes on a push to `master`
- `npx supabase test db` reports 6 files and the reconciled assertion count, with zero failures
- `deploy` declares `needs: [ci, db-test]` and does not start until both complete
- The job completes with no secrets configured and no `production` environment

#### Manual Verification:

- The CI log shows the Supabase CLI resolving to **2.98.2**, not 2.114.0
- No `permission denied for table` appears anywhere in the output — the tell that the wrong CLI provisioned the database
- **Teeth check**: push a branch adding a migration that drops `categories.color`;
  confirm `db-test` goes red — expected to break 5 of 6 suites, including a fixture
  `INSERT` at `entries_category_summary_test.sql:57` that aborts that file before
  assertion 1 — and confirm `deploy` never starts. Revert without deploying.
- Wall-clock cost of the job is recorded, since it was previously unmeasured and is
  the input to any future decision about running it on pull requests too

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 4: `getViteConfig` Spike

### Overview

Answer one question and record it. Deliberately non-gating, and placed after CI is
green so it cannot block anything: **does `getViteConfig` from `astro/config`
resolve `astro:env/server` under the Cloudflare adapter?**

Astro's docs do not state it, and the linked upstream issues concern integrations
rather than Vitest. The answer determines how test-plan Phase 2 reaches
`src/lib/services/receipts.ts` and how Phase 5 gets React component tests the
`resolve.dedupe` fix they need.

### Changes Required:

#### 1. Throwaway spike

**File**: scratch only — nothing from this phase is committed except the finding

**Intent**: Empirically determine whether a Vitest config routed through
`getViteConfig(viteConfig, inlineAstroConfig)` can import a module that does
`import { SUPABASE_URL } from "astro:env/server"`.

**Contract**: A temporary config and a temporary test importing
`@/lib/config-status` (`src/lib/config-status.ts:1` is a value import of
`astro:env/server`, so it is blocked under the standalone config and is the
minimal probe). Record three outcomes: whether the import resolves, whether
`npx astro sync` is a precondition, and whether the Cloudflare adapter's presence
changes the result. Delete the scratch files afterwards.

The finding matters regardless of which way it goes. Research established that
`services/categories.ts`, `services/entries.ts` and `services/reports.ts` import
**zero** Astro virtual modules — they use `import type` only, which
`verbatimModuleSyntax` erases — and take a `SupabaseClient` as a parameter
(`src/lib/services/categories.ts:12`). So test-plan Phases 2 and 3 are reachable
with a stub client and no Astro plugin at all. Only `receipts.ts` and
`config-status.ts` are actually blocked. A negative spike result narrows the
problem rather than creating one.

#### 2. Record the finding

**File**: `context/changes/testing-runner-bootstrap/research.md`

**Intent**: Close research Open Question 6 with an evidence-backed answer so the
next phase does not re-derive it.

**Contract**: An addendum section stating the result, the exact command used, and
the version of Vitest and Astro it was observed against.

### Success Criteria:

#### Automated Verification:

- Scratch config and scratch test are removed from the tree
- `npm run test` still green and `npm run lint` still clean after cleanup
- `git status` shows no stray spike artifacts

#### Manual Verification:

- Research OQ6 has a definite yes/no answer with the commands that produced it
- The answer names what it implies for test-plan Phase 2 (`receipts.ts`) and Phase 5 (React `resolve.dedupe`)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 5: Documentation

### Overview

Update every document this change makes false, and advance the test-plan
orchestrator's state.

### Changes Required:

#### 1. Test-plan rollout state and stack

**File**: `context/foundation/test-plan.md`

**Intent**: §3 is the orchestrator's state — stale here and the next
`/10x-test-plan` run resumes on the wrong phase.

**Contract**: Four edits.

- **§3** — the Phase 1 row's Status becomes `complete`.
- **§4** — the `unit + integration` row resolves from "none yet" to Vitest with
  its actual version and a `checked:` date; the `typecheck` row records that
  `astro check` is now wired rather than "installed but never invoked"; the
  `database / RLS` row's "Local-only — never runs in CI until §3 Phase 1" clause
  is replaced with the job that now runs it.
- **§5** — `typecheck`, `unit + integration`, `pgTAP on the merged migration set`,
  and `from-scratch migration apply` all flip from `required after §3 Phase 1` to
  `required — wired`. Note in the last two rows that they run on `master` pushes,
  not pull requests.
- **§8** — bump the strategy/stack review dates.

#### 2. Test-plan §6.1 cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: §6.1 currently reads "TBD — see §3 Phase 2", but this phase is what
delivers the first unit test. §6 is the canonical answer to "how do I add a test
for X in this project?" and is what `/10x-tdd` reads.

**Contract**: Fill §6.1 with location (co-located beside the module under test),
naming (`<module>.test.ts`), reference test (`src/lib/text.test.ts`), run commands
(`npm run test`, `npm run test:watch`), and two limits worth recording: that the
standalone config resolves `@/*` but not `astro:*` virtual modules (with Phase 4's
answer), and the §2 anti-pattern that expectations must be hand-written from an
external oracle rather than derived by calling the code under test.

#### 3. Test-plan §7 — Face B

**File**: `context/foundation/test-plan.md`

**Intent**: Prevent a green `db-test` job from reading as "risk #4 is handled".

**Contract**: A §7 entry recording that the old-Worker-against-new-schema window is
deliberately not covered: what it is, why (it needs a "last deployed SHA" concept
absent from this repo), what makes it currently tolerable (no `select("*")` in
`src/`, every read names its columns, `category_color` never dereferenced), and the
re-evaluate trigger — a migration that drops or narrows something the deployed
Worker actually reads.

#### 4. CLAUDE.md corrections

**File**: `CLAUDE.md`

**Intent**: Two standing claims become false the moment this ships.

**Contract**: The *Commands* section's "**There is no test framework installed.**
No vitest/playwright/jest, no test script, no test files" is replaced with the
runner, the scripts, and a pointer to test-plan §6.1. The *Environment & deploy*
section's "The CLI is pinned to `2.98.2` in `devDependencies`" becomes accurate —
after Phase 1 it genuinely is, so this is a wording fix, not a caveat. Add the
`db-test` job to the *CI/CD* section's description of what the workflow does, and
state that it must never adopt the deploy job's `setup-cli` pin.

#### 5. lessons.md amendments

**File**: `context/foundation/lessons.md`

**Intent**: One lesson's scope shrinks, another's context line is wrong.

**Contract**: The *"Soft-delete and other app-layer-only invariants aren't provable
by pgTAP"* rule (`:5-13`) keeps its substance — pgTAP still cannot reach
application code — but its implicit "therefore permanently manual-only" conclusion
no longer holds now that a JS runner exists. Amend the **Rule** to route
app-layer-only invariants to a unit or service test rather than to permanent manual
verification. In the CLI lesson (`:15-23`), the **Context** line's
"CLI pinned to `2.98.2` in `devDependencies`" was aspirational when written and is
true only after Phase 1 — leave the lesson's substance untouched and note that the
pin was made real by this change.

### Success Criteria:

#### Automated Verification:

- `npm run format` leaves the edited Markdown unchanged (or the formatting change is committed)
- `npm run lint` passes
- No document still claims "there is no test framework installed", and no document still describes the four wired gates as "required after §3 Phase 1"

#### Manual Verification:

- test-plan §3's Phase 1 row reads `complete`, so a subsequent `/10x-test-plan` run
  correctly proposes Phase 2 rather than re-opening this one
- §6.1 is specific enough that someone who was not part of this change could add a
  second unit test from it alone
- The §7 Face-B entry names a concrete re-evaluate trigger, not just a caveat

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful.

---

## Testing Strategy

This change *is* test infrastructure, so its own strategy is mostly about proving
the gates have teeth rather than merely being present.

### Unit Tests:

- `src/lib/text.test.ts` — code-point counting and truncation against the
  Postgres `char_length()` oracle and the UTF-16 surrogate-pair spec
- Key edge cases: astral characters, truncation landing inside a surrogate pair,
  exact-bound and off-by-one lengths, and the unchanged-value identity case

### Integration Tests:

- None added here. The pgTAP suite is the database-layer integration test and
  already exists; this change makes it run somewhere that matters.

### Manual Testing Steps:

1. Break `truncateCodePoints` to use `.slice()`; confirm the unit test goes red; revert.
2. Introduce a type error in `.astro` frontmatter; confirm `ci` goes red at typecheck; revert.
3. Add a migration dropping `categories.color`; confirm `db-test` goes red and
   `deploy` never starts; revert without deploying.
4. Confirm the `db-test` log reports CLI `2.98.2` and contains no `permission denied for table`.

Each of these is the corresponding gate's proof that it is a gate and not a
decoration. A gate that has never been observed failing has not been verified.

## Performance Considerations

`supabase start` wall-clock in CI was previously unmeasured, which is exactly why
`db-test` is scoped to `master` pushes rather than every pull request. Record the
measured duration in Phase 3 — it is the input to any later decision to widen the
trigger. `ubuntu-latest` provides Docker preinstalled; local guidance calls for
~7 GB RAM for the stack, which standard GitHub-hosted runners exceed.

The `ci` job grows by `astro check` (~20 s observed locally, including type
generation) plus a Vitest run over one trivial file. Both run before `build`, so a
failure short-circuits the more expensive step.

## Migration Notes

No schema changes. `supabase/migrations/` is untouched — this change only causes
those migrations to be *executed* somewhere they previously were not.

The `deploy` job's behaviour changes in one way: it now waits on `db-test`. A red
`db-test` leaves production entirely untouched, which is the intended outcome; the
previous behaviour was that nothing stood between a merged migration and
`supabase db push --yes`.

## Open Risks & Assumptions

- **The 2026-10-30 Supabase grants deprecation has a deadline inside this
  project's horizon.** From that date, new `public` tables require explicit
  `GRANT`s; no migration in this repo grants any table-level privilege today. The
  escape hatch `[api] auto_expose_new_tables = false` needs CLI ≥ 2.102.0, which
  conflicts with the `2.98.2` pin this change makes exact. Deliberately unresolved
  here; it needs its own change before October.
- **Hard-pinning `supabase` will make Dependabot open PRs against the pin** rather
  than floating silently. That is the point, but it is new noise.
- **`db-test` on `master` only means a bad migration is discovered after merge.**
  Production is still protected — `deploy` cannot run — but the fix happens on
  `master` rather than in the PR that caused it.
- **Two archived findings remain PENDING and should not be assumed fixed**: the
  categories migration has no `begin;`/`commit;` wrapper, and the seed users have
  NULL auth-token columns. Either could surface for the first time when
  `db reset` runs in a clean CI environment rather than on a developer's
  long-lived local stack.
- **The demo account's data window (`2026-05-16 .. 2026-08-16`) expired on
  2026-08-16**, so range presets render empty for it. Unrelated to this change but
  live, and it will be visible during any manual verification that signs in.

## References

- Research: `context/changes/testing-runner-bootstrap/research.md`
- Change brief: `context/changes/testing-runner-bootstrap/change.md`
- Strategy: `context/foundation/test-plan.md` §3 Phase 1 (`:79`), §5 gates (`:125-134`)
- The CLI trap: `context/foundation/lessons.md:15-23`
- The rejected-then-reversed CI decision: `context/archive/2026-08-15-data-foundation-rls/plan.md:36`
- The merged-set gap: `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:80-89`
- The pending colour drop: `context/archive/2026-08-17-category-icons/plan.md:382-388`
- Deployment gap statement: `context/deployment/deploy-plan.md:303`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner Bootstrap

#### Automated

- [x] 1.1 Unit tests pass: `npm run test`
- [x] 1.2 Typecheck passes with 0 errors: `npm run typecheck`
- [x] 1.3 Lint passes, including the new files: `npm run lint`
- [x] 1.4 Build still passes: `npm run build`
- [x] 1.5 After `npm ci`, `npx supabase --version` reports `2.98.2`

#### Manual

- [x] 1.6 `npm run test:watch` enters watch mode, re-runs on edit, exits cleanly
- [x] 1.7 Teeth check: `.slice()` regression turns the surrogate-pair test red, then reverted
- [x] 1.8 Any ESLint test-file override relaxes only the rules actually tripped

### Phase 2: CI Fast Lane

#### Automated

- [ ] 2.1 Workflow file is valid YAML and accepted by GitHub Actions
- [ ] 2.2 `ci` passes on a pull request with both new steps green
- [ ] 2.3 `ci` runs no Supabase CLI and needs no secrets beyond the existing build-step pair

#### Manual

- [ ] 2.4 CI log shows `astro check` reporting `0 errors` over ~83 files
- [ ] 2.5 CI log shows Vitest file and test counts, not a watch-mode hang
- [ ] 2.6 Teeth check: a type error in `.astro` frontmatter turns `ci` red at typecheck, then reverted

### Phase 3: CI Database Gate

#### Automated

- [ ] 3.1 `db-test` runs and passes on a push to `master`
- [ ] 3.2 `npx supabase test db` reports 6 files and the reconciled assertion count, zero failures
- [ ] 3.3 `deploy` declares `needs: [ci, db-test]` and waits for both
- [ ] 3.4 Job completes with no secrets and no `production` environment

#### Manual

- [ ] 3.5 CI log shows CLI `2.98.2`, not 2.114.0
- [ ] 3.6 No `permission denied for table` anywhere in the output
- [ ] 3.7 Teeth check: a `categories.color` drop turns `db-test` red and `deploy` never starts, then reverted
- [ ] 3.8 Wall-clock cost of the job recorded

### Phase 4: `getViteConfig` Spike

#### Automated

- [ ] 4.1 Scratch config and scratch test removed from the tree
- [ ] 4.2 `npm run test` green and `npm run lint` clean after cleanup
- [ ] 4.3 `git status` shows no stray spike artifacts

#### Manual

- [ ] 4.4 Research OQ6 has a definite yes/no answer with the commands that produced it
- [ ] 4.5 The answer names its implications for test-plan Phase 2 and Phase 5

### Phase 5: Documentation

#### Automated

- [ ] 5.1 `npm run format` leaves edited Markdown unchanged, or the formatting change is committed
- [ ] 5.2 `npm run lint` passes
- [ ] 5.3 No document claims "there is no test framework installed" or describes the four wired gates as "required after §3 Phase 1"

#### Manual

- [ ] 5.4 test-plan §3 Phase 1 row reads `complete`, so the orchestrator proposes Phase 2 next
- [ ] 5.5 §6.1 is specific enough to add a second unit test from it alone
- [ ] 5.6 The §7 Face-B entry names a concrete re-evaluate trigger
