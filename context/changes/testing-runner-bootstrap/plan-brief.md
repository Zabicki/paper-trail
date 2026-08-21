# Runner Bootstrap + CI Test Floor — Plan Brief

> Full plan: `context/changes/testing-runner-bootstrap/plan.md`
> Research: `context/changes/testing-runner-bootstrap/research.md`

## What & Why

Rollout phase 1 of `context/foundation/test-plan.md` §3, covering risk #4: *a
schema migration reaches the hosted database ahead of the Worker that matches
it*. Today `supabase db push --yes` (`ci.yml:60`) is the **first and only**
execution of any migration anywhere in the pipeline — and it runs against
production. This change stands up the project's first JavaScript test runner and
turns four planned quality gates into enforced ones.

## Starting Point

There is no test runner, no `test` script, and no test file in the repo.
`@astrojs/check` is a dependency that is invoked nowhere — no script, no CI step —
and the archive records lint and build passing a broken intermediate state that
only a hand-run `tsc --noEmit` caught. Six pgTAP suites totalling ~104 assertions
exist in `supabase/tests/` and have never run outside a laptop; research found a
`docker ps` stack labelled `krzysztof`, not `paper-trail`, on this repo's exact
ports, so even those local runs may have been hitting a sibling worktree's
database. The `ci` job is `npm ci` → `astro sync` → `lint` → `build`, with no
Docker and no Supabase anywhere.

## Desired End State

`npm run test` and `npm run typecheck` exist and are enforced on every push and
pull request. A separate `db-test` job applies the merged migration set to an
empty database from scratch and runs every pgTAP assertion; `deploy` cannot reach
`supabase db push` unless it is green. The Supabase CLI is genuinely pinned where
the docs have long claimed it was, and the test-plan reflects all of it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Database gate trigger | Separate `db-test` job, `master` pushes only | Production stays protected via `needs`, at the cost of discovering a bad migration after merge rather than in the PR | Plan |
| Risk #4 coverage depth | pgTAP as tripwire; Face B recorded as uncovered | The loaded trigger is provably safe today, and a real Face-B gate needs a "last deployed SHA" concept this repo lacks | Research → Plan |
| Typecheck tool | `astro check` | Covers 83 files including `.astro` frontmatter that `tsc --noEmit` skips entirely; verified 0 errors before choosing | Plan |
| Vitest config | Standalone with explicit `@/*` alias, plus a non-gating spike | `text.ts` imports nothing, so the runner is proven before the `astro:env` question — which research warns must not block the bootstrap | Research → Plan |
| First unit target | `src/lib/text.ts` | Zero imports (so a failure can only be the harness) and a triple-sourced external oracle: the DB `char_length()` bound, Postgres code-point semantics, and the UTF-16 spec | Research |
| Supabase CLI pin | Hard-pin `2.98.2` in `package.json` | The whole grants-trap safety argument rested on a pin that lived only in the lockfile, reachable by `npm update` with **no diff to any workflow file** | Research → Plan |
| Coverage reporting | Not included | test-plan §1 makes risk coverage the metric, and skipping it avoids a `coverage/` dir needing both gitignore and a `tsconfig.exclude` entry | Plan |

## Scope

**In scope:** Vitest 4.1.11 + standalone config + `test`/`test:watch`/`typecheck`
scripts; one real unit test on `src/lib/text.ts`; `typecheck` and `test` added to
the `ci` job; a Docker-backed `db-test` job gating `deploy`; the Supabase CLI hard
pin; a time-boxed `getViteConfig` spike; and updates to test-plan §3/§4/§5/§6.1/§7,
`CLAUDE.md`, and `lessons.md`.

**Out of scope:** the Face-B (old-Worker-vs-new-schema) gate; the incremental
`db push` path; coverage reporting; pre-commit or per-edit hooks; component-test,
API-mocking and headless-browser tooling (test-plan Phases 2–5); and the
2026-10-30 Supabase grants deprecation.

## Architecture / Approach

Four gates across three surfaces, sequenced so each is proven where it is cheapest
to debug. The runner is stood up and proven **locally** on a module that imports
nothing — so a red test can only mean a real defect, never a resolution problem —
then wired into the fast CI lane. The database gate lands third as a **separate**
job, because `supabase link` writes project state into the same `supabase/`
directory a local stack reads, and both `test db --linked` and `db reset --linked`
target production. Keeping it separate also keeps it secret-free, since
`supabase start` is fully local.

```
ci (push + PR)          db-test (push to master)
npm ci → astro sync     npm ci → npx supabase start -x vector
  → lint                  → db reset   (from-scratch merged apply + seed)
  → typecheck             → test db    (~104 pgTAP assertions)
  → test
  → build                        ↓
        └────────────► deploy: needs: [ci, db-test] ──► db push ──► wrangler
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap | Vitest, config, scripts, `text.test.ts`, CLI hard pin | A green test that would pass regardless — mitigated by an explicit teeth check |
| 2. CI fast lane | `typecheck` + `test` in the `ci` job | `astro check` must run after `astro sync`; already true by construction |
| 3. CI database gate | `db-test` job + `deploy: needs: [ci, db-test]` | **Copying the deploy job's `setup-cli` 2.114.0 pin** — all assertions then fail `permission denied` before one runs |
| 4. `getViteConfig` spike | A definite answer to research OQ6 | Scope creep into solving `astro:env` — deliberately non-gating and placed after CI is green |
| 5. Documentation | test-plan §3/§4/§5/§6.1/§7, CLAUDE.md, lessons.md | Stale §3 status silently misroutes the next `/10x-test-plan` run |

**Prerequisites:** Docker available locally for a pre-push sanity run; push access
to `master` (Phase 3's verification requires a real `master` push); the existing
`production` environment approval remains in force, so no deploy happens unattended.

**Estimated effort:** ~2–3 sessions across 5 phases. Phases 1 and 5 are the bulk of
the writing; Phase 3 is short to write and the slowest to verify.

## Open Risks & Assumptions

- The **2026-10-30 Supabase grants deprecation** requires CLI ≥ 2.102.0 for the
  `auto_expose_new_tables` escape hatch, which conflicts with the `2.98.2` pin this
  change makes exact. Needs its own change before October.
- **`db-test` on `master` only** means a bad migration is caught after merge.
  Production is still protected; the fix just happens on `master`.
- Two archived findings remain **PENDING** and may surface for the first time in a
  clean CI environment rather than on a long-lived local stack: the categories
  migration has no `begin;`/`commit;` wrapper, and the seed users have NULL
  auth-token columns.
- **`supabase start` wall-clock in CI is unmeasured** — Phase 3 records it, and
  that number decides whether the trigger can later widen to pull requests.
- Hard-pinning `supabase` makes Dependabot open PRs against the pin. Intended, but
  new noise.

## Success Criteria (Summary)

- A migration that breaks the schema/code contract turns CI red **before** it can
  reach the hosted database — verified by actually pushing one and watching
  `deploy` never start.
- Type errors in `.astro` frontmatter and logic regressions in pure modules both
  fail the merge gate, closing two holes that have each already shipped green once.
- Anyone can add the next test by reading test-plan §6.1 alone, and the next
  `/10x-test-plan` run correctly proposes Phase 2.
