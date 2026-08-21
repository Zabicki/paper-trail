# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-21

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`.
Excluded: `node_modules`, `dist`, `.astro`, generated worker types,
lockfiles, and `context/` documentation. Scoped history over the 30 days to
2026-08-21 carried 49 commits — sufficient signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                            | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Confirming a reviewed receipt persists something other than what was on screen — wrong per-category split, wrong receipt-derived date, wrong amount, or a duplicate batch on retry | High   | High       | interview Q1 (stated top fear), interview Q3; `prd.md` explicit-confirmation guarantee ("never a silent write"); archive: non-idempotent confirm caught only at impl-review, and a later slice redefined per-category grouping after the parse feature shipped; `roadmap.md` records off-plan changes to this flow landing without impl-review; hot-spot dir `src/components/receipts/` — 14 commits/30d                                                                                                    |
| 2   | A KPI or chart reads plausibly but is wrong — rows silently dropped, the recurring-cost filter disagreeing with the numbers displayed, or a range resolving to the wrong window    | High   | High       | interview Q3; archive: a reports slice rejected at impl-review because the row ceiling truncated instead of erroring, leaving ranking rows printing 0% beside real amounts; a later slice fixed a clipped axis and an all-time range, both found after ship; `roadmap.md` records the filter invariant being deliberately moved out of a pinned bar into a caption; hot-spot dirs `src/components/reports/` — 40 commits/30d, `src/lib/services/` — 21 commits/30d                                          |
| 3   | One user's financial data becomes reachable by another                                                                                                                             | High   | Medium     | `prd.md` strict per-user isolation guarantee and the decision to ship no admin role; `tech-stack.md`: anon key only, no service-role bypass, so RLS is the sole isolation boundary; `CLAUDE.md` hard rules require RLS in the creating migration _and_ `private, no-store` on authenticated responses, and state that both fail **silently**; archive: cross-user invariants recorded as having no database backstop, and an aggregation path silently dropping entries filed under another user's category |
| 4   | A schema migration reaches the hosted database ahead of the Worker that matches it, and live data routes fail                                                                      | High   | Medium     | `CLAUDE.md`: CI applies migrations between build and deploy, so every migration must be backward-compatible with the _previous_ Worker; this already broke the first deploy — every data route 500'd against an empty schema; `roadmap.md` carries an open REQUIRED column-drop follow-up of exactly this shape; archive records the pgTAP suite never having run against the merged migration set; hot-spot dir `supabase/migrations/` — 14 commits/30d                                                    |
| 5   | The day list shows something the database does not contain — a row duplicated after save, or an inline edit applied to the wrong row or the wrong day                              | Medium | High       | interview Q4 (named explicitly as the scariest gap); archive: a stale-day race at save, a duplicate row from optimistic save, and shared inline-edit state leaking across rows and across day changes; hot-spot dir `src/components/entries/` — 35 commits/30d, and the three top-churning files in the repo all sit in it                                                                                                                                                                                  |
| 6   | The app becomes unusable on a phone because one element gives the _whole document_ horizontal scroll                                                                               | Medium | High       | interview Q2, interview Q3; `lessons.md` carries two separate entries for the identical symptom arising from opposite mechanisms; `roadmap.md`: both fixes shipped straight to `master` with no plan, impl-review, or change folder; `prd.md`'s input-friction thesis assumes a phone                                                                                                                                                                                                                       |

Risk #3 is the abuse-lens row (authorization / ownership, not merely
authentication). Two further abuse candidates surfaced from the archive —
receipt-endpoint quota drain with authentication as the only limit, and
receipt-derived text reaching platform logs against the store-nothing
disclosure shown to users. Both are recorded in the archive as **accepted
by decision**; they are carried in §7 as visible accepted risk rather than
silently re-litigated here.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                          | Must challenge                                                                                                                                                                                              | Context `/10x-research` must ground                                                                                                                                                                                                      | Likely cheapest layer                                                                                                                                                                             | Anti-pattern to avoid                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1   | Confirming writes exactly the set shown — same count, same per-category split, same amounts, same date the user saw — and a repeated confirm does not double it                                                      | That a 200 means the right rows landed; that the rendered review and the submitted payload are the same object; that grouping is decided in exactly one place                                               | Where the confirm payload is assembled versus where it is rendered; the batch-write boundary and its idempotency mechanism; what the save date resolves to when the printed date is absent or reverted; behaviour on partial write       | unit (grouping and date resolution) + integration (confirm boundary → persisted rows)                                                                                                             | **Oracle problem** — computing the expected rows by calling the same grouping helper under test. Expectations must be hand-written from the reviewed screen, not derived from the implementation |
| #2   | A figure is either correct or absent — never a plausible number derived from a partial result set — and filter state always matches the numbers displayed                                                            | That a successful query means a _complete_ result set (the real failure was truncation, not an error); that "all time" resolves to a sane window; that a percentage and its absolute amount share one total | The row-count ceiling on the data path and the behaviour at it; where the total is computed relative to per-category rows; how range presets resolve to concrete dates; where filter state lives relative to the caption that reports it | unit (distribution model) + integration (aggregation with a fixture sized **past** the ceiling)                                                                                                   | Fixtures too small to reach the boundary that actually broke — a five-category fixture cannot reproduce a thirty-four-category truncation                                                        |
| #3   | A request authenticated as user A cannot read, aggregate, or mutate any row owned by user B — including through an aggregation path or a reference to B's category — and no authenticated response is edge-cacheable | That "logged in" implies "owns this resource"; that RLS on base tables covers aggregate and RPC paths; that a green pgTAP suite covers app-layer ownership filtering (it provably cannot)                   | Which reads go through RLS versus an aggregate path; where ownership is enforced in application code rather than in policy; which responses carry cache headers                                                                          | pgTAP extension for anything expressible in SQL; route-boundary integration for app-layer-only ownership                                                                                          | Testing only that A sees A's own data. The test that matters is **A explicitly requesting B's id and being refused**                                                                             |
| #4   | The migration set applies cleanly from scratch, and the _previous_ Worker's queries still succeed against the new schema                                                                                             | That a green deploy means the schema matches the code; that per-branch pgTAP runs prove the merged migration set                                                                                            | Which columns and functions the currently deployed Worker reads; what the pending drop would remove; whether migrations are validated anywhere before the hosted push                                                                    | A CI job: from-scratch migration run plus the pgTAP suite. This is a gate, not a test                                                                                                             | Running the suite only against the branch's own migration — precisely what let the merged-set gap through before                                                                                 |
| #5   | After a save, edit, or delete, the visible list equals what a fresh read would return; an edit opened on one row never applies to another row and never survives a day change                                        | That an optimistic update matches the server's result; that switching days resets per-row state; that a failed request leaves the list in a truthful state                                                  | How list state is derived and updated after each mutation; where per-row edit state is keyed; behaviour on request failure and on rapid day navigation                                                                                   | component tests on the list island with a mocked data boundary                                                                                                                                    | Asserting the component's internal state instead of what a user would see rendered; happy-path-only, with no failure case and no rapid-navigation case                                           |
| #6   | At 320, 360, and 390 CSS px, no page gives the document horizontal scroll, with realistic worst-case user strings (long email, long category name, long description)                                                 | That fixing the _named_ element fixed the page — the reported element is usually not the overflowing one; that a fix for one mechanism covers the other                                                     | Which pages and components mix user-supplied strings with controls; which rely on intrinsic-width utilities; whether built CSS alone suffices or a signed-in render is required                                                          | headless assertion of document scroll width against client width, run against built CSS — `lessons.md` establishes this needs no dev server and no sign-in for at least one of the two mechanisms | A pixel snapshot. It fails on every Tailwind change and still never tells you the document overflows                                                                                             |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                          | Goal (one line)                                                                                             | Risks covered | Test types                                                    | Status        | Change folder                                                   |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------- | ------------- | --------------------------------------------------------------- |
| 1   | Runner bootstrap + CI test floor    | Prove a schema change or a broken build cannot reach production unnoticed, and stand up a real test harness | #4            | unit, CI gate, pgTAP on merged migrations                     | complete      | `context/changes/testing-runner-bootstrap/`                     |
| 2   | Receipt confirm integrity           | Prove that what the user confirms is what persists, exactly once                                            | #1            | unit, service integration                                     | complete      | `context/archive/2026-08-21-testing-receipt-confirm-integrity/` |
| 3   | Reports aggregation truth           | Prove a displayed figure is correct or absent, never plausibly wrong                                        | #2            | unit, integration with oversized fixture                      | change opened | `context/changes/testing-reports-aggregation-truth/`            |
| 4   | Isolation beyond the database       | Prove A cannot reach B's data through any path, and no authenticated page is edge-cacheable                 | #3            | pgTAP extension, route integration, response-header assertion | not started   | —                                                               |
| 5   | Client state + viewport regressions | Prove the day list tells the truth and no page overflows a phone                                            | #5, #6        | component tests, headless overflow check                      | not started   | —                                                               |

Order rationale: Phase 1 first because nothing else can land without a
runner, and because #4 is the cheapest high-impact risk with a loaded
trigger already outstanding. Phases 2 and 3 take the two High × High risks
at the cheapest layer that reaches them. Phase 4 needs the integration
capability Phases 2–3 establish. Phase 5 introduces two new capabilities
and covers the two Medium-impact rows, so it comes last.

## 4. Stack

The classic test base for this project. Tool rows carry a `checked:` date so
future readers can see which lines need re-verification. Recommendations in
this section are grounded in local manifests and configs only — no docs or
search MCP was exposed in the authoring session, so **versions below are
unpinned candidates for the named rollout phase to resolve against current
releases**, not verified selections. Rows resolved by a shipped phase carry a
real version instead; as of §3 Phase 1 those are `unit + integration`,
`typecheck`, and `database / RLS`.

| Layer                     | Tool                                                                   | Version                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration        | Vitest                                                                 | `4.1.11` (pinned exact)                           | Wired by §3 Phase 1. Standalone `vitest.config.ts` — **not** routed through `getViteConfig`, which is unusable here: `@cloudflare/vite-plugin` rejects the `resolve.external` list Vitest sets, so Vitest fails at startup with the adapter loaded. Consequence: the config resolves `@/*` (explicit alias) but **not** `astro:*` virtual modules, and inherits none of `astro.config.mjs`'s Vite settings. See §6.1; `checked: 2026-08-21`             |
| component (React islands) | none yet — see §3 Phase 5                                              | —                                                 | Candidate: React Testing Library on the Phase 1 runner; asserts rendered output rather than component internals; `checked: 2026-08-21`                                                                                                                                                                                                                                                                                                                  |
| API mocking               | none — hand-rolled fake + `vi.mock`                                    | — (no dependency)                                 | Resolved by §3 Phase 2. The Supabase client is the boundary worth faking; internal service modules are not. A recording fake in `src/lib/services/__fixtures__/supabase-fake.ts` covers the service layer, and Vitest's built-in `vi.mock` covers the route layer. **No MSW, no `getViteConfig`, and no alias stub were needed** — see §6.2 and §6.1's corrected limit; `checked: 2026-08-21`                                                           |
| database / RLS            | pgTAP via Supabase CLI                                                 | CLI pinned `2.98.2` (exact, in `devDependencies`) | Exists today: 6 suites in `supabase/tests/`, run by `npx supabase test db`. Since §3 Phase 1, also runs in CI in the `db-test` job on `master` pushes, against the **merged** migration set replayed into an empty database. That job must invoke `npx supabase` after `npm ci`, never `supabase/setup-cli@v1` — it provisions a database, so it is on the local side of the grants divide (`lessons.md`). Cannot reach application code (`lessons.md`) |
| narrow-viewport overflow  | none yet — see §3 Phase 5                                              | —                                                 | Candidate: headless Chromium asserting document scroll width against client width at 320/360/390, against built CSS; `checked: 2026-08-21`                                                                                                                                                                                                                                                                                                              |
| lint                      | ESLint (`strictTypeChecked` + `stylisticTypeChecked` + react-compiler) | per `package.json`                                | Wired and enforced in CI today                                                                                                                                                                                                                                                                                                                                                                                                                          |
| typecheck                 | `@astrojs/check` (`astro check`)                                       | per `package.json`                                | Wired by §3 Phase 1: `npm run typecheck`, and a CI step in the `ci` job after `astro sync` and before `build`. Chosen over `tsc --noEmit` because it also checks `.astro` frontmatter, which `tsc` does not reach                                                                                                                                                                                                                                       |
| e2e                       | none — deliberate                                                      | —                                                 | Every risk in §2 has a cheaper layer that reaches it. See §7                                                                                                                                                                                                                                                                                                                                                                                            |
| AI-native                 | none — deferred                                                        | —                                                 | An offline receipt-classification eval was proposed and cut by decision. See §7                                                                                                                                                                                                                                                                                                                                                                         |

**Stack grounding tools (current session):**

- Docs: none — no Context7 or framework-docs MCP exposed; stack facts taken from `package.json`, `astro.config.mjs`, `CLAUDE.md`, and `tech-stack.md`; checked: 2026-08-21
- Search: none — no Exa.ai or web-search MCP exposed; no tool version or release status was verified online, hence the unpinned candidates above; checked: 2026-08-21
- Runtime/browser: none — no Playwright or browser MCP exposed; the Phase 5 headless check is a candidate approach, not a verified integration; checked: 2026-08-21
- Provider/platform: none — no GitHub, Cloudflare, or Supabase MCP exposed; CI facts read directly from `.github/workflows/ci.yml`; checked: 2026-08-21

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                              | Where                   | Required?                                                        | Catches                                                                   |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| lint                              | local (pre-commit) + CI | required — wired today                                           | syntactic drift, type drift reachable by type-checked rules               |
| typecheck                         | CI (`ci` job)           | required — wired                                                 | type drift the lint rules do not reach, including in `.astro` frontmatter |
| unit + integration                | local + CI (`ci` job)   | required — wired                                                 | logic regressions in services and pure model code                         |
| pgTAP on the merged migration set | CI (`db-test` job)      | required — wired; runs on `master` pushes, **not** pull requests | RLS and schema regressions; merged-set gaps that per-branch runs miss     |
| from-scratch migration apply      | CI (`db-test` job)      | required — wired; runs on `master` pushes, **not** pull requests | a migration that cannot be applied to a clean database                    |
| component tests                   | local + CI              | required after §3 Phase 5                                        | list-state and inline-edit regressions in React islands                   |
| narrow-viewport overflow check    | CI on PR                | required after §3 Phase 5                                        | document-level horizontal scroll at phone widths                          |
| post-edit hook                    | local (agent loop)      | recommended after §3 Phase 5                                     | the overflow and unit checks at edit time, before review                  |

The two `db-test` gates run on `master` pushes only, because the wall-clock
cost of `supabase start` on a runner was unmeasured when they were wired.
Production is still protected — `deploy` declares `needs: [ci, db-test]`, so a
red database gate leaves the hosted schema untouched — but a bad migration is
discovered _after_ merge rather than in the pull request that introduced it.
Widening the trigger to pull requests is a cost decision, not a correctness
one.

The post-edit hook is a **recommended local** convenience, never a CI
substitute. Configuration of hooks is out of scope for this plan.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

Filled in by §3 Phase 1.

- **Location**: co-located beside the module under test —
  `src/lib/text.test.ts` sits next to `src/lib/text.ts`. No separate `tests/`
  tree; the discovery glob is `src/**/*.test.ts` (`vitest.config.ts`).
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/text.test.ts` — code-point counting and
  truncation, the shape a new unit test should copy.
- **Run**: `npm run test` (single pass, terminates — this is what CI and any
  future hook use) or `npm run test:watch` (watch mode). `npm run typecheck`
  covers the test file too: `tsconfig.json`'s `include` is `**/*`, so a new
  `*.test.ts` is inside the TS project automatically, and `eslint.config.js`
  uses `projectService: true`, so type-aware lint reaches it with no extra
  config.
- **The anti-pattern that matters most** (§2, risk #1): expectations must be
  **hand-written from an external oracle**, never derived by calling the code
  under test. `text.test.ts` names its three oracles in a header comment — a
  database `check` constraint, Postgres' documented `char_length()` semantics,
  and a UTF-16 spec fact — and reimplements its surrogate-pair predicate rather
  than importing one. A test that computes its expectation from the
  implementation passes for a broken implementation.
- **A test is not done until it has been seen red.** The Phase 1 teeth check
  was: break `truncateCodePoints` to use `.slice()`, confirm the surrogate-pair
  case fails legibly, revert.
- **Limit — `astro:*` does not resolve.** `vitest.config.ts` is standalone and
  maps `@/*` by an explicit `resolve.alias` (Vite does not read
  `tsconfig.paths`). Astro's sanctioned `getViteConfig` route, which _would_
  resolve `astro:env/server`, is **unusable in this project**: with
  `adapter: cloudflare()` loaded, `@cloudflare/vite-plugin` rejects the
  `resolve.external` list Vitest sets on its `ssr` environment and Vitest dies
  at startup before resolving anything. Verified empirically —
  `context/changes/testing-runner-bootstrap/research.md`, _Addendum: OQ6 spike
  result_. `import type` is not affected — `verbatimModuleSyntax` erases it,
  which is why `services/categories.ts`, `services/entries.ts` and
  `services/reports.ts` are testable as they stand.

  **Corrected by §3 Phase 2: there are three options, not two.** The
  distinguishing question is whether the module under test reaches the virtual
  module _directly_ or _transitively_.
  - **Transitively, through a resolvable local path** → `vi.mock` on that path.
    The mock replaces the module before it is ever evaluated, so the virtual
    module is never resolved and no config change is needed. Proven on
    `src/pages/api/receipts/entries.ts`, which value-imports `@/lib/supabase` at
    `:2`: all six status branches were asserted in ~400 ms on the default `node`
    environment, with native `Request`/`Response` and no jsdom. The working
    shape is a module-scope mutable holder — `vi.mock` factories are hoisted
    above the imports, so the factory body must not close over a binding
    evaluated later — plus `const { POST } = await import("./entries")` _after_
    it. This is the cheapest option and should be tried first.
  - **Directly** → `vi.mock` cannot help, because mocking the module under test
    removes the subject, and `vi.mock("astro:env/server", …)` needs a specifier
    Vitest can resolve, i.e. the alias-stub below anyway. So it remains: extract
    the pure logic away from the import, or alias-stub the virtual module in
    `vitest.config.ts`.

  Still genuinely unreachable as they stand, all for the direct-import reason:
  `src/lib/supabase.ts`, `src/lib/config-status.ts` and
  `src/lib/services/receipts.ts` (`astro:env/server`),
  `src/pages/api/receipts/parse.ts` (`astro:env/server` on its own line, not
  only through the services it calls), `src/middleware.ts` (`astro:middleware`),
  and `src/lib/receipt-image.ts` (`cloudflare:workers`). For
  `services/receipts.ts` the extract route is the realistic one — research
  bounded roughly 135 of its 296 lines as pure.

- **Second limit**: the standalone config inherits **none** of
  `astro.config.mjs`'s Vite settings, including
  `resolve.dedupe: ["react", "react-dom"]` — documented there as preventing a
  real hydration crash. §6.5 will have to restate it rather than inherit it.

### 6.2 Adding a service integration test

Filled in by §3 Phase 2.

- **Location**: co-located, same as §6.1 — `src/lib/services/entries.test.ts`
  sits next to `src/lib/services/entries.ts`.
- **Shared helpers live under `__fixtures__/`** —
  `src/lib/services/__fixtures__/supabase-fake.ts`. That directory name is not
  cosmetic: `vitest.config.ts`'s only discovery glob is `src/**/*.test.ts`, so a
  helper named `*.test.ts` would be collected as a suite and fail the run with
  "No test found". `__fixtures__/` also keeps it clear of the co-located
  `<module>.test.ts` convention that marks a real suite.
- **What to fake**: the Supabase client, and nothing else. Internal service
  modules are not a boundary worth faking — faking one would only assert that
  the test's own stub was called.
- **The fake**: `createSupabaseFake(responses)` returns `{ client, calls }`.
  Every builder method (`from`, `select`, `in`, `is`, `eq`, `order`, `upsert`,
  `insert`, `update`, `delete`, `maybeSingle`, `single`) returns the same
  chainable object and appends `{ method, args }` to `calls`; `then` makes the
  chain awaitable. Bridge it to a service's client parameter with a single
  `as unknown as` **at the call site** — that keeps `any` out of both files,
  which matters because `eslint.config.js` applies `strictTypeChecked` to test
  files with no override (see the caveat at the end of this sub-section).
- **Responses are queued in call order, NOT keyed by table.** This is the one
  thing a reader gets wrong. A service making several round trips consumes one
  queued response per `await`, in the order the awaits execute. For
  `createEntriesBatch` that is: (1) the category check, (2) the batch upsert,
  (3) the re-select — the third **only** on a replay. So a happy-path test
  queues two responses and a replay test queues three. Run the queue dry and the
  fake throws naming how many builder calls it had recorded and which.
- **Reference test**: `src/lib/services/entries.test.ts`, scoped to
  `createEntriesBatch`. Its four oracles are named in a header comment: the
  `unique (user_id, batch_id, batch_seq)` migration for the `onConflict` string,
  the `entries` table's `type` check and `occurred_on date not null`, the
  service read as a spec for its three app-layer-only invariants, and an
  archived impl-review for the accepted replay trade.
- **Run**: `npm run test`. No Docker, no database, no network — the whole suite
  is ~460 ms.
- **The pattern**: _submitted payload in, asserted row array out._ Assert the
  recorded `upsert` argument, not only the value the service returns. The
  `batch_seq` assignment, the `occurred_on` shared across every row, the
  hardcoded `type`, and the conflict options are all invisible in the return
  value — and they are exactly the fields a refactor can change without a single
  existing check going red.
- **Always include the repeated-confirm case.** A 201 from the batch endpoint
  means "the batch exists", never "the rows you just submitted are in it" — the
  service discriminates a replay by comparing row counts, and on a replay
  returns _what is stored_ under that batch id. That branch is the one
  `supabase/tests/entries_batch_key_test.sql` structurally cannot reach: pgTAP
  asserts the resulting row _count_, never what the statement _returned_. Do not
  duplicate what that suite already proves.
- **Characterisation tests must say so.** Where a case pins accepted behaviour
  rather than desired behaviour — the retry-after-edit trade is the existing
  example — the comment must name the decision record and state plainly that it
  encodes an accepted trade, not an endorsement. A reader mistaking one for the
  other is the failure mode such a test creates.
- **Same oracle rule as §6.1**: expectations hand-written from an external
  source, never derived by calling the code under test. Same teeth rule too —
  the Phase 2 checks were `batch_seq: index + 1` and `ignoreDuplicates: false`,
  each confirmed to turn exactly one case red, then reverted.
- **Caveat — test files get no lint exemption.** `eslint.config.js:41` matches
  `**/*.{js,jsx,ts,tsx}` with no test override, so `strictTypeChecked` applies.
  In practice: `consistent-type-definitions` rejects `type X = { … }` in favour
  of `interface`, and the `no-unsafe-*` family bites any fake that leans on
  `any`. Type canned responses as `{ data: unknown; error: unknown }` and let
  the service's own casts do the narrowing.

### 6.3 Adding a database / RLS test (pgTAP)

Filled in — this layer exists today.

- **Location**: `supabase/tests/`.
- **Naming**: `<table>_<concern>_test.sql` — for example the existing
  `categories_rls_test.sql`, `entries_rls_test.sql`,
  `entries_batch_key_test.sql`.
- **Reference test**: `supabase/tests/categories_rls_test.sql` — the
  canonical shape every later suite copies.
- **Impersonation**: suites adopt the two fixed seed users from
  `supabase/seed.sql`; a superuser session bypasses RLS entirely, so the
  role and JWT claim must be set inside the transaction.
- **Run locally**: `npm ci` first, then `npx supabase test db`. Running
  `npx supabase` without `node_modules` present resolves an unpinned CLI
  and produces a database whose own app role cannot read its own tables —
  see `lessons.md`. A shipped, unmodified suite going red is the tell that
  the environment is wrong, not the code.
- **Limit**: pgTAP cannot reach application code. Any invariant enforced in
  the service layer rather than in policy or schema needs a test from §6.2
  or §6.4 instead.

### 6.4 Adding a test for an API route

TBD — see §3 Phase 4, which delivers the ownership pattern: request as one
user for another user's resource, assert refusal, and assert the response's
cache headers.

### 6.5 Adding a React island test and a viewport check

TBD — see §3 Phase 5, which delivers both the list-state component pattern
(assert rendered output after save, edit, delete, failure, and day change)
and the document-overflow assertion at 320/360/390.

### 6.6 Per-rollout-phase notes

(Filled in as phases land. After each phase, `/10x-implement` appends two
or three lines capturing anything surprising the phase taught — a fixture
location worth reusing, a boundary that turned out to be in a different
place than expected, a mocking decision that should be copied.)

**Phase 1 — Runner bootstrap + CI test floor** (`testing-runner-bootstrap`):

- Astro's sanctioned `getViteConfig` is a dead end under the Cloudflare
  adapter, and it fails at _startup_ with a Vite-environment error that says
  nothing about Astro or `astro:env` — so it reads as a config mistake rather
  than an incompatibility. Don't re-derive it; see §6.1 and the research
  addendum.
- `npx astro sync` is **not** a precondition for resolving `astro:env/server`
  under Vitest — `.astro/` holds type declarations only, and the virtual module
  is generated from `env.schema` at config-resolution time. It _is_ required
  for `astro check` and type-aware lint.
- The first unit target was chosen for having a **genuinely external oracle**
  (a database `check` constraint plus a spec fact), not for being easy to
  reach. A pure module with no external oracle proves the harness and nothing
  else.
- CI-command form is load-bearing in the `db-test` job: `npm ci` then
  `npx supabase`, never `supabase/setup-cli@v1`. Copying the neighbouring
  deploy-job block produces `permission denied for table …` on suites that have
  shipped green, which looks exactly like a broken migration (`lessons.md`).

**Phase 2 — Receipt confirm integrity** (`testing-receipt-confirm-integrity`):

- **The `astro:*` blocker did not apply to this path**, and the phase needed no
  `vitest.config.ts` change and no new dependency. `services/entries.ts` only
  ever `import type`s `@/lib/supabase`, and the route's value-import is
  displaced by `vi.mock` before it evaluates. §6.1's limit is corrected
  accordingly — check whether the virtual-module import is direct or transitive
  before concluding a module is unreachable.
- **A 201 from the batch endpoint is evidence the batch exists, never that the
  submitted rows are in it.** The service discriminates a replay by comparing
  `insertedRows.length` against `input.items.length` — a length comparison, not
  a replay flag — and when they differ it returns _what is stored_ under that
  batch id. Any future test of a batch write must assert the recorded payload,
  not the status.
- **`z.iso.date()` gives full calendar validation for free where a shape regex
  does not.** `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-02-30`, which then reaches
  Postgres, fails `occurred_on date not null`, and rethrows into an Astro error
  page — a 500 with a non-JSON body that the client degrades to a generic
  message. Verified against the installed zod `4.4.3`: `z.iso.date()` rejects
  `2026-02-30`, `2026-04-31` and `2026-02-29`, accepts `2024-02-29`. Four copies
  of that regex survive elsewhere (`services/receipts.ts`, `services/reports.ts`
  ×2, `api/entries/index.ts`); only the two in `services/entries.ts` were fixed.
- **The U+00A0 formatting trap.** `formatAmountPlain` emits a non-breaking space
  as the thousands separator, and **only above four digits**: `1234.5` is
  `"1234,50"` with no separator at all, `1234567.89` is `"1 234 567,89"`. A
  literal expectation must use the right character _and_ must not assume a
  separator appears at four digits. Write the U+00A0 into the expectation so it
  is visible in a diff.
- **Extraction is what makes a hot-spot component testable at all.** The panel's
  payload assembly moved to `src/components/receipts/review-model.ts` with its
  comments intact, following the precedent `receipt-total.ts` set for the same
  reason. Until §3 Phase 5 stands up a component layer, the extracted module's
  own tests are the only regression guard on that file.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5) plus two
carried decisions from the archive. Future contributors should respect
these unless the underlying assumption changes.

- **shadcn/ui primitives in `src/components/ui/`** — vendored generated
  code; the upstream library is its own test. Re-evaluate if a primitive is
  hand-modified. (Source: Phase 2 interview Q5.)
- **Live LLM accuracy in CI** — calling the model on real receipts per run
  costs third-party money, is non-deterministic, and burns a monthly quota.
  Re-evaluate never for CI; measurement belongs in a manual log. (Source:
  Phase 2 interview Q5.)
- **Blanket visual or snapshot tests of every screen** — they break on
  every Tailwind change and catch little. The targeted overflow assertion
  in §3 Phase 5 is deliberately not this. (Source: Phase 2 interview Q5.)
- **Auth and session mechanics themselves** — sign-in, token refresh, and
  password reset are baseline scaffold that no slice re-implements. We test
  what auth _gates_ (risk #3), not the mechanism. Re-evaluate if a slice
  modifies the auth flow. (Source: Phase 2 interview Q5.)
- **An end-to-end layer** — every risk in §2 has a cheaper layer that
  reaches it, so promoting any of them to e2e would cost wall-clock and
  flake without adding signal. Re-evaluate if a risk appears whose failure
  requires the full deployed shape. (Source: §1 principle #1.)
- **Offline receipt-classification accuracy eval** — proposed as a sixth
  rollout phase and cut by decision at brief review. It remains the only
  thing that would answer the PRD's stated accuracy floor, which is
  currently unmeasured. Re-evaluate after the current deadline, or whenever
  the prompt, the model, or the category-assignment logic changes.
- **Two accepted abuse findings** — receipt-endpoint quota drain with
  authentication as the only limit, and receipt-derived text reaching
  platform logs against the store-nothing disclosure shown to users. Both
  are recorded in the archive as accepted by decision. Re-evaluate if the
  product gains untrusted users or the disclosure text is challenged.
- **The deploy-window gap: the _old_ Worker against the _new_ schema
  (risk #4, Face B)** — §3 Phase 1's `db-test` job covers Face A only: a
  migration that cannot apply, or code running against a schema that is not
  there. Both fail loudly. Face B is the migration that applies cleanly but is
  backward-_incompatible_ with the Worker still serving during the window
  between `supabase db push` and `wrangler deploy` — a dropped or narrowed
  column the live Worker still reads. That one fails silently, and a green
  `db-test` must not be read as covering it. Not gated because gating it needs
  a "last deployed SHA" concept this repo does not have; what makes it
  tolerable today is that no `select("*")` exists anywhere in `src/`, every
  read names its columns explicitly, and the one declared-but-unused column
  (`category_color`, `src/lib/services/reports.ts:294`) is never dereferenced.
  **Re-evaluate the moment a migration drops or narrows something the deployed
  Worker actually reads** — the pending `categories.color` drop
  (`context/archive/2026-08-17-category-icons/plan.md:382-388`) is exactly that
  trigger. (Source: §3 Phase 1 plan, _What We're NOT Doing_.)
- **The incremental `db push` path** — `db-test` replays the merged migration
  set into an _empty_ database. That is not evidence the next incremental push
  onto the existing production schema succeeds: `20260818090000_add_category_icon.sql`
  does `drop function … ; create function …` and runs a one-shot data backfill,
  both of which behave differently on clean replay. Gating it needs a shadow
  database seeded to the last-deployed schema. Re-evaluate if an incremental
  push ever fails against hosted. (Source: §3 Phase 1 plan, _What We're NOT
  Doing_.)
- **Line or statement coverage as a metric** — §1 makes _risk_ coverage the
  metric. Deliberately not reported, which also keeps a `coverage/` directory
  out of a `tsconfig.json` whose `exclude` replaces TypeScript's defaults.
  Re-evaluate never as a gate; a one-off local run to find an untested area is
  fine. (Source: §1 principle.)
- **The interaction-count and time budget from the PRD north star** — the
  PRD does not define _interaction_ as a unit, so any assertion would
  encode an arbitrary definition rather than the requirement. Stays a
  manual acceptance check. Re-evaluate if the PRD pins the unit.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-21 (§3 Phase 1 marked complete;
  four §5 gates flipped from planned to wired)
- Stack versions last verified: 2026-08-21 — `unit + integration`
  (Vitest `4.1.11`), `typecheck` (`astro check`) and `database / RLS`
  (Supabase CLI `2.98.2`) resolved against the installed tree by §3 Phase 1.
  The remaining §4 rows are still unpinned candidates: no docs or search MCP
  was available in either session
- AI-native tool references last verified: 2026-08-21 (none adopted)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
