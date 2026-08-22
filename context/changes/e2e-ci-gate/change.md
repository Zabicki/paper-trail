---
change_id: e2e-ci-gate
title: Decide whether the Playwright e2e suite becomes a CI gate, and wire it if so
status: implementing
created: 2026-08-22
updated: 2026-08-22
archived_at: null
---

## Notes

Wire the `tests/e2e/` Playwright suite into `.github/workflows/ci.yml` — or
decide, on measured cost, that it stays local-only and say so explicitly rather
than by omission.

**Why this is its own change.** `test-plan.md` §5 already carries the e2e gate
as **not required — not wired in CI**, and names the reason: the runner needs
`npx playwright install --with-deps chromium` _and_ a live Supabase stack. That
second half is the same `supabase start` wall-clock that already keeps both
`db-test` gates off pull requests, and §5 records widening that trigger as "a
cost decision, not a correctness one". So this is a cost decision with a
measurement in front of it, not a config edit — which is exactly what should
not ride along inside an unrelated change.

**Current state (verified 2026-08-22).** `.github/workflows/ci.yml` contains no
reference to Playwright or e2e in any of its three jobs. The suite is two specs
plus a `setup` project:

- `tests/e2e/seed.spec.ts` — risk #5, the reference test.
- `tests/e2e/expense-reaches-reports.spec.ts` — risks #2 and #5: an expense
  saved in the day view reaches the day list and is attributed to its category
  in the reports. Break-verified twice (a dropped aggregate row, and a
  one-grosz error) — see §6.6.

**Questions this change has to answer, in order:**

1. What does `supabase start -x vector` plus `npx playwright install --with-deps
chromium` actually cost on a runner? `db-test`'s trigger was narrowed on an
   _unmeasured_ number (`CLAUDE.md`, §5); repeating that mistake here would
   re-litigate the same unknown a third time.

   → **Answered (2026-08-22).** The whole `e2e` job is **211–237 s** across
   three pull-request runs (`32591458225`, `32591965510`, `32592444333`), under
   the ~285 s projected. `npx supabase start -x vector` 104–114 s and
   `npx supabase db reset` 28–32 s, i.e. ~140 s of provisioning; the browser
   install is only **21–30 s** and the suite itself 25–30 s against 23.7 s
   locally. Caching Chromium would optimise the small term, so it was not done.
   The `db-test` figures the change also needed: 134 s / 195 s
   (run `32489937016`). Per-step table in `test-plan.md` §6.7.

2. Push-only (the `db-test` precedent) or pull-request (what a merge gate
   means)? These are different products: push-only catches a break after merge
   and before deploy; PR catches it in review. §5's e2e row asks for the latter,
   `db-test`'s existing shape delivers the former.

   → **Answered.** Pull request **and** push. The job carries no `if:` guard, so
   it inherits the workflow triggers; that is what makes it a merge gate and what
   §5's row asked for. At ~211 s against a ~100 s `ci` job it becomes the PR
   critical path, which was judged affordable.

3. Does `deploy` gain `needs: e2e`? Today it is `needs: [ci, db-test]`.

   → **Answered.** Yes — `needs: [ci, db-test, e2e]`. The edge was added only
   _after_ the teeth check was observed red (forced `GET /api/entries` → `[]`,
   run `32591965510`: `e2e` red, `ci` green, trace in the artifact). Rollback is
   a one-line revert of that list, which leaves the job reporting without
   holding a release.

4. Serial-by-necessity is a real constraint: `workers: 1`, because every spec
   signs in as the one seed user from `supabase/seed.sql` and shares that
   account's rows. Suite wall-clock grows linearly with spec count, so the
   trigger decision has a shelf life.

   → **Answered: acknowledged, not solved.** `workers: 1` is unchanged — making
   the suite parallel is a fixtures problem, not a CI one. Three specs cost
   25–30 s inside a 211–237 s job, so the provisioning floor hides the growth for
   now. Recorded as a shelf-life note in `test-plan.md` §6.7 and
   `tests/e2e/README.md`; revisit when the suite's own step approaches the
   provisioning cost.

A fifth question surfaced and was answered along the way: **does the job need
secrets?** No. `astro dev` on workerd resolves `.dev.vars` → `.env` → process
environment, and a checkout has neither file, so `npx supabase status -o env`
piped into `$GITHUB_ENV` is enough. The job references no `secrets.*` and
declares no `environment:`.

**Constraints inherited from documents, not to be re-derived:**

- The `db-test` job's CLI rule is load-bearing and hostile to copy-paste: a job
  that _provisions_ a database must run `npm ci` then `npx supabase`, never
  `supabase/setup-cli@v1`. Getting it wrong fails every suite with
  `permission denied for table …`, which reads exactly like a broken migration
  (`CLAUDE.md`, `lessons.md`). An e2e job needs a Supabase stack, so it is on
  the same side of that divide.
- `-x vector` is mandatory: the analytics log-shipper's failing health check
  aborts the whole `supabase start`, and there is no config block to disable it.
- The browser install belongs in its own step so `npm ci` stays the same size in
  `db-test` and `deploy`.
- E2E needs secrets `db-test` does not — the suite drives a real `astro dev`
  against a real stack, so it needs `SUPABASE_URL` / `SUPABASE_KEY` pointing at
  the _local_ stack, not the hosted one. Check this before assuming `db-test`'s
  secret-free shape transfers.

**Overlap to reconcile, not to duplicate.**
`context/changes/testing-client-state-viewport/plan.md` Phase 4 already wires a
_separate_ Playwright-driven check (`npm run test:viewport`) into the `ci` job,
with exactly the separate-browser-install shape this change needs — and its
plan still names the bare `playwright` package, which the installed
`@playwright/test` `1.62.1` supersedes (§4 flags that reconciliation as
belonging to that change). Sequence against that phase rather than landing two
browser-install steps independently.

Whatever this change concludes, §5's e2e gate row and §4's e2e row must end up
saying it — including "stays local-only, deliberately", if that is the answer.
