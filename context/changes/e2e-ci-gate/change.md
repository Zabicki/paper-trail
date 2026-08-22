---
change_id: e2e-ci-gate
title: Decide whether the Playwright e2e suite becomes a CI gate, and wire it if so
status: new
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
2. Push-only (the `db-test` precedent) or pull-request (what a merge gate
   means)? These are different products: push-only catches a break after merge
   and before deploy; PR catches it in review. §5's e2e row asks for the latter,
   `db-test`'s existing shape delivers the former.
3. Does `deploy` gain `needs: e2e`? Today it is `needs: [ci, db-test]`.
4. Serial-by-necessity is a real constraint: `workers: 1`, because every spec
   signs in as the one seed user from `supabase/seed.sql` and shares that
   account's rows. Suite wall-clock grows linearly with spec count, so the
   trigger decision has a shelf life.

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
