# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-22

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
| 1   | Runner bootstrap + CI test floor    | Prove a schema change or a broken build cannot reach production unnoticed, and stand up a real test harness | #4            | unit, CI gate, pgTAP on merged migrations                     | complete      | `context/archive/2026-08-21-testing-runner-bootstrap/`          |
| 2   | Receipt confirm integrity           | Prove that what the user confirms is what persists, exactly once                                            | #1            | unit, service integration                                     | complete      | `context/archive/2026-08-21-testing-receipt-confirm-integrity/` |
| 3   | Reports aggregation truth           | Prove a displayed figure is correct or absent, never plausibly wrong                                        | #2            | unit, integration with oversized fixture                      | complete      | `context/archive/2026-08-21-testing-reports-aggregation-truth/` |
| 4   | Isolation beyond the database       | Prove A cannot reach B's data through any path, and no authenticated page is edge-cacheable                 | #3            | pgTAP extension, route integration, response-header assertion | complete      | `context/archive/2026-08-22-testing-cross-user-isolation/`      |
| 5   | Client state + viewport regressions | Prove the day list tells the truth and no page overflows a phone                                            | #5, #6        | component tests, headless overflow check                      | change opened | `context/changes/testing-client-state-viewport/`                |

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

| Layer                     | Tool                                                                   | Version                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit + integration        | Vitest                                                                 | `4.1.11` (pinned exact)                           | Wired by §3 Phase 1. Standalone `vitest.config.ts` — **not** routed through `getViteConfig`, which is unusable here: `@cloudflare/vite-plugin` rejects the `resolve.external` list Vitest sets, so Vitest fails at startup with the adapter loaded. Consequence: the config resolves `@/*` (explicit alias) but **not** `astro:*` virtual modules, and inherits none of `astro.config.mjs`'s Vite settings. See §6.1; `checked: 2026-08-21`                                                                                                                                                                                                      |
| component (React islands) | none yet — see §3 Phase 5                                              | —                                                 | Candidate: React Testing Library on the Phase 1 runner; asserts rendered output rather than component internals; `checked: 2026-08-21`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| API mocking               | none — hand-rolled fake + `vi.mock`                                    | — (no dependency)                                 | Resolved by §3 Phase 2. The Supabase client is the boundary worth faking; internal service modules are not. A recording fake in `src/lib/services/__fixtures__/supabase-fake.ts` covers the service layer, and Vitest's built-in `vi.mock` covers the route layer. **No MSW, no `getViteConfig`, and no alias stub were needed** — see §6.2 and §6.1's corrected limit. Extended by §3 Phase 3 with `limit` and a **terminal** `rpc`, so the fake now reaches RPC-based paths (both reports aggregates) as well as builder chains; `checked: 2026-08-22`                                                                                         |
| database / RLS            | pgTAP via Supabase CLI                                                 | CLI pinned `2.98.2` (exact, in `devDependencies`) | Exists today: 6 suites in `supabase/tests/`, run by `npx supabase test db`. Since §3 Phase 1, also runs in CI in the `db-test` job on `master` pushes, against the **merged** migration set replayed into an empty database. That job must invoke `npx supabase` after `npm ci`, never `supabase/setup-cli@v1` — it provisions a database, so it is on the local side of the grants divide (`lessons.md`). Cannot reach application code (`lessons.md`)                                                                                                                                                                                          |
| narrow-viewport overflow  | none yet — see §3 Phase 5                                              | —                                                 | Candidate: headless Chromium asserting document scroll width against client width at 320/360/390, against built CSS; `checked: 2026-08-21`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| lint                      | ESLint (`strictTypeChecked` + `stylisticTypeChecked` + react-compiler) | per `package.json`                                | Wired and enforced in CI today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| typecheck                 | `@astrojs/check` (`astro check`)                                       | per `package.json`                                | Wired by §3 Phase 1: `npm run typecheck`, and a CI step in the `ci` job after `astro sync` and before `build`. Chosen over `tsc --noEmit` because it also checks `.astro` frontmatter, which `tsc` does not reach                                                                                                                                                                                                                                                                                                                                                                                                                                |
| e2e                       | Playwright (`@playwright/test`)                                        | `1.62.1` (pinned exact)                           | **Reverses this row's earlier "none — deliberate".** One reviewed spec exists (`tests/e2e/seed.spec.ts`, risk #5) plus a `setup` project that signs in and writes `storageState`. Nothing is mocked: it drives a real `astro dev` server on workerd against a real local Supabase stack, because the risk lives in the seams between middleware, hydration, the API and RLS — faking any of them would test the fake. Serial by necessity (`workers: 1`): every spec signs in as the one seed user from `supabase/seed.sql` and shares that account's rows. Local only — no CI step. See §6.6 and the reversal note in §7; `checked: 2026-08-22` |
| AI-native                 | none — deferred                                                        | —                                                 | An offline receipt-classification eval was proposed and cut by decision. See §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Stack grounding tools (current session):**

- Docs: none — no Context7 or framework-docs MCP exposed; stack facts taken from `package.json`, `astro.config.mjs`, `CLAUDE.md`, and `tech-stack.md`; checked: 2026-08-21
- Search: none — no Exa.ai or web-search MCP exposed; no tool version or release status was verified online, hence the unpinned candidates above; checked: 2026-08-21
- Runtime/browser: Playwright `1.62.1` is installed and driving a real browser against the running app (`npm run test:e2e`); no browser MCP is exposed, so specs are authored from the code and verified by running them rather than from a live accessibility snapshot. The Phase 5 headless viewport check remains a separate, still-unbuilt candidate — note that `context/changes/testing-client-state-viewport/plan.md` specifies the bare `playwright` package for it, which `@playwright/test` now supersedes; that reconciliation belongs to that change. checked: 2026-08-22
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
| e2e (Playwright)                  | local only              | **not required — not wired in CI**                               | cross-boundary regressions: hydration, session, API and RLS in one flow   |
| post-edit hook                    | local (agent loop)      | recommended after §3 Phase 5                                     | the overflow and unit checks at edit time, before review                  |

The two `db-test` gates run on `master` pushes only, because the wall-clock
cost of `supabase start` on a runner was unmeasured when they were wired.
Production is still protected — `deploy` declares `needs: [ci, db-test]`, so a
red database gate leaves the hosted schema untouched — but a bad migration is
discovered _after_ merge rather than in the pull request that introduced it.
Widening the trigger to pull requests is a cost decision, not a correctness
one.

The e2e gate is deliberately listed as **not required**, and the honest
reason is that it is not wired: `.github/workflows/ci.yml` has no Playwright
step, so nothing enforces it on a pull request. Wiring it is not free — the
runner would need `npx playwright install --with-deps chromium` **and** a live
Supabase stack, which is the same `supabase start` cost that already keeps the
two `db-test` gates off pull requests. Until that cost is paid, a green CI run
is not evidence the e2e suite passes; run `npm run test:e2e` locally before
merging anything that touches the day view. Promoting this row to required is a
cost decision for a future rollout phase.

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
  - **Directly** → the transitive trick is unavailable, because the module you
    would mock _is_ the subject. **Corrected by §3 Phase 4** (the mechanism was
    proven by §3 Phase 3): this bullet used to add that
    `vi.mock("astro:env/server", …)` "needs a specifier Vitest can resolve,
    i.e. the alias-stub below anyway", and that is false. **With a factory
    supplied**, Vitest 4's mock registry intercepts the specifier before Vite's
    resolver is consulted, so the mock never reaches resolution and needs no
    alias stub and no config change. Working example:
    `src/middleware.test.ts`, which mocks `astro:middleware` as
    `{ defineMiddleware: (fn) => fn }` — a runtime identity helper, so the real
    `onRequest` body is still the subject — and asserts the five
    `Cache-Control` cases on the actual middleware. A factory-**less**
    `vi.mock("astro:env/server")` asks Vitest to auto-mock the real module and
    therefore still requires resolution; it still fails.

    The genuine limit is intact underneath the correction: this only helps where
    the virtual module's exports are incidental to what the module does. Where
    they are the point — `src/lib/supabase.ts` exists to read `SUPABASE_URL` /
    `SUPABASE_KEY` out of `astro:env/server` — a factory replaces the subject's
    entire input, so the two original options still stand: extract the pure
    logic away from the import, or alias-stub the virtual module in
    `vitest.config.ts`.

  **Third data point, from §3 Phase 3: `src/components/` is not automatically
  the component layer.** `src/components/reports/range.ts` and
  `src/components/reports/distribution.ts` are plain modules that happen to live
  beside the islands that consume them — the co-location convention is about
  **feature ownership, not about React**. Both are pure: no JSX, no hooks, no
  `astro:*`, no network. They are ordinary §6.1 unit targets and need no mocking
  at all, which the text above did not anticipate. Before concluding that
  something under `src/components/` has to wait for §3 Phase 5's component
  runner, check what it actually imports.

  What makes `range.ts` reachable this cheaply is one design choice worth
  copying: `resolveRange(preset, today, allTimeStart)` takes `today` as a
  **required parameter** rather than reading the clock. So the whole module is
  deterministic under Vitest with no clock faking and no `vi.setSystemTime`. A
  module that resolves "now" internally would not be — that is the difference
  between a pure unit target and a test that has to fake the environment.

  Still not reached as they stand, all for the direct-import reason:
  `src/lib/supabase.ts`, `src/lib/config-status.ts` and
  `src/lib/services/receipts.ts` (`astro:env/server`),
  `src/pages/api/receipts/parse.ts` (`astro:env/server` on its own line, not
  only through the services it calls), and `src/lib/receipt-image.ts`
  (`cloudflare:workers`). For `services/receipts.ts` the extract route is the
  realistic one — research bounded roughly 135 of its 296 lines as pure.
  `src/middleware.ts` came **off** this list in §3 Phase 4: it is unit-tested
  today (`src/middleware.test.ts`) by the factory-mock route above. For the
  remaining five the blocker is now a judgement rather than a mechanism — a
  factory mock would resolve, but each of them exists to read what the virtual
  module supplies, so mocking it stubs out the behaviour under test.

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
  Every builder method (`from`, `select`, `in`, `is`, `eq`, `order`, `limit`,
  `upsert`, `insert`, `update`, `delete`, `maybeSingle`, `single`) returns the
  same chainable object and appends `{ method, args }` to `calls`; `then` makes
  the chain awaitable. Bridge it to a service's client parameter with a single
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
- **`rpc` is TERMINAL, and it is the one exception to the rule above.** Added by
  §3 Phase 3, alongside `limit`. Every other method is a chain link that returns
  the chainable object, and `then` pulls from the queue when the chain is
  awaited. `supabase.rpc(…)` is not a chain link — services `await` it directly,
  so the fake's `rpc` both **records and resolves**, returning a promise instead
  of the chainable object. It therefore consumes its queued response at **call**
  time rather than at await time. The practical consequence, and the reason this
  is worth spelling out: a `Promise.all([rpc(a), rpc(b)])` consumes **two** queue
  entries in **array order**, because both calls are made synchronously before
  either is awaited. `getEntriesSummary` is exactly that shape — current range
  first, previous range second — and `reports.test.ts` pins the order with an
  assertion on the recorded `rpc` arguments rather than assuming it. If you add
  a fake method for anything else a service awaits directly, copy `rpc`'s shape,
  not `order`'s.
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

Filled in by §3 Phase 4.

- **Location**: co-located beside the route module —
  `src/pages/api/entries/[id].test.ts` sits next to
  `src/pages/api/entries/[id].ts`. The bracketed filename is fine: it is a
  literal name on disk, not a glob, and `src/**/*.test.ts` matches it. In a
  `describe` title write the route as it is served
  (`"PATCH /api/entries/[id]"`), not as a filesystem path.
- **Naming**: `<route>.test.ts`, mirroring the route file exactly —
  `index.test.ts` for `index.ts`, `[id].test.ts` for `[id].ts`.
- **Shared fixture**: `src/lib/services/__fixtures__/route-context.ts`. It
  supplies the two things `supabase-fake.ts` deliberately does not, because
  they belong to the route boundary rather than the service boundary:
  - `createRouteClient(methods, responses, user)` — the recording fake from
    §6.2 narrowed to the methods a route's service actually calls
    (`"from"`, `"rpc"`), plus an `auth.getUser` surface, because every route
    checks it before it touches a service. Carry the methods over
    **selectively**; spreading the whole fake brings its `then` with it and
    makes the client itself thenable.
  - `routeContext({ url, method, body, params })` — the slice of `APIContext`
    the routes read. **`params` is the piece that unblocked ownership testing
    at all**: `src/pages/api/entries/[id].ts:21` and
    `src/pages/api/categories/[id].ts:20` both read `context.params.id`, and
    no hand-rolled context had it, so "A requests B's id" could not be
    expressed. Bridge the returned object at the call site —
    `routeContext({ … }) as unknown as Parameters<typeof PATCH>[0]` — because
    the target type is derived per route and is not knowable in the fixture.
    The client bridge, by contrast, lives inside the fixture; that collapse of
    four identical casts is the file's reason to exist.
- **The two identities are the pgTAP seed users.** `USER_A` and `USER_B` are
  copied character for character from `supabase/seed.sql`, so a reader moving
  between `supabase/tests/entries_rls_test.sql` and a route test holds one set
  of uuids, not two. Interpolate them into the test title —
  `` `answers 404 when ${USER_A.id} patches an entry owned by ${USER_B.id}` ``
  — so a failure names the actors rather than saying "the other user".
- **Reachability is the same question as §6.1's**, and every route so far has
  the same answer. A route value-imports `@/lib/supabase`, which value-imports
  `astro:env/server`; `vi.mock("@/lib/supabase", …)` displaces it before it
  evaluates, so the virtual module is never resolved and no config change is
  needed. The working shape is the §6.1 one: module-scope mutable holder,
  `vi.mock` factory that reads the holder, then the handlers pulled off an
  `await import("./[id]")` **after** it. `Request`/`Response` are native in
  Node 22 — default `node` environment, no jsdom.
- **Run**: `npm run test`. No Docker, no database, no network.
- **The ownership pattern — this is the deliverable.** Drive the route as user
  A, naming user B's id, and assert the refusal:
  1. Queue the responses the **service** will await, in order — a route test
     drives the real service, so §6.2's "queued in call order, not keyed by
     table" rule governs here too. For "not yours" that means queueing what a
     caller-scoped client returns for a row it cannot see: an empty result, or
     PostgREST's `PGRST116` from `.single()`.
  2. Assert the **status and the body**, never the status alone. The body is
     where the leak would be.
  3. Pair it with the owned-resource case in the same file. A refusal test that
     never sees a success cannot distinguish "correctly refused" from
     "broken for everyone".

  Two verbs can refuse by two different mechanisms and then need two tests that
  cannot be merged — `PATCH /api/categories/[id]` keys on `PGRST116` from
  `.single()` (`src/lib/services/categories.ts:131-133`), `DELETE` on a
  zero-length `.select("id")` result (`:150-152`). The DELETE shape is the one
  that goes silently wrong: without the length check the route answers a
  cheerful 204 for a row it never touched. Assert **404, not 204** by name.

- **The anti-enumeration rule.** The 404 body for "absent" and the 404 body for
  "not yours" must be byte-identical, so a caller cannot use the response to
  discover which of another user's ids exist. `"Nie znaleziono wpisu"` and
  `"Nie znaleziono kategorii"` are that shared string, and
  `src/pages/api/entries/index.ts:65-68` states the reason in the source.
  **Changing one of those strings is a security change, not a copy change** —
  the tests assert them literally, and a route test going red on a string edit
  is the guard working. The counterpart contrast is worth testing in the same
  file: a category the caller _does_ own but of the wrong kind answers a
  specific 400 (`"Kategoria nie pasuje do typu wpisu"`), because there is
  nothing to hide about a row they demonstrably own. Testing the pair is what
  shows the ambiguity is a decision rather than an accident.
- **Reference tests**: `src/pages/api/categories/[id].test.ts` for the simplest
  two-verb ownership shape; `src/pages/api/entries/[id].test.ts` for the same
  plus the foreign-key case (A re-pointing A's own entry at B's category);
  `src/pages/api/entries/index.test.ts` for the 404-vs-400 contrast above.
  `src/pages/api/receipts/entries.test.ts` shows the batch variant — one
  foreign `categoryId` among several must refuse the **whole** batch.
- **The limit that matters most — a route test cannot prove RLS.** The fake has
  no caller identity and no row store; it resolves queued responses in call
  order, whoever is asking. Passing `USER_B` instead of `USER_A` changes
  nothing about what the client returns. So the honest claim of every test here
  is _given a client that returns nothing for B's id, A gets a refusal whose
  body does not confirm B's row exists_ — never _RLS returned nothing_. The
  second half is pgTAP's (§6.3) and is already done. State this in the file's
  header comment; every route test in the repo carries it.

  **One case has no pgTAP to defer to, and it is the exception to read
  carefully.** `entries.category_id` is a plain foreign key, and Postgres FK
  checks are **not** subject to RLS on the referenced table — the migration says
  so in its own words
  (`supabase/migrations/20260815164539_create_entries_table.sql:31-36`), and
  `supabase/tests/entries_rls_test.sql:8-17` excludes the case in writing. The
  only thing refusing A's entry under B's category is the RLS-scoped lookup in
  `assertCategoryUsable` (`src/lib/services/entries.ts:154-181`). For that
  invariant the route tests are the **only** automated guard, at the app layer,
  and a green suite must not be read as covering the database.

- **Middleware is a route-adjacent target, and it is reachable too.**
  `src/middleware.test.ts` mocks `astro:middleware` directly with a factory —
  Vitest 4's mock registry intercepts the specifier before Vite's resolver is
  consulted, so it never reaches resolution (this corrects §6.1; see there).
  `defineMiddleware` is a runtime identity helper, so replacing it with
  `(fn) => fn` leaves the real `onRequest` body as the subject. Use it as the
  reference for asserting **response headers** rather than payloads.
- **Same oracle rule as §6.1 and §6.2**, and it is easy to violate here:
  expectations come from the route source read as a contract, the service read
  for which PostgREST result each refusal keys on, and `supabase/seed.sql` for
  the identities — never from running the route and recording what it said.
  Name the oracles in the header comment. Same teeth rule too: the Phase 4
  checks were dropping `.select("id")` from `deleteEntry` (turns the DELETE
  case red) and short-circuiting `assertCategoryUsable` (turns the
  foreign-`categoryId` cases red), each reverted after.

### 6.5 Adding a React island test and a viewport check

TBD — see §3 Phase 5, which delivers both the list-state component pattern
(assert rendered output after save, edit, delete, failure, and day change)
and the document-overflow assertion at 320/360/390.

### 6.6 Adding an E2E test

- **Location**: `tests/e2e/<feature>.spec.ts`, one test per file. Not co-located
  — these specs belong to no module; they drive the assembled app.
- **Rules**: `tests/e2e/README.md` is the durable rules file. Read it first.
  The generic three-rule block in `CLAUDE.md` sits inside the 10x CLI's
  regeneration markers and will be overwritten; the README will not.
- **Reference test**: `tests/e2e/seed.spec.ts` — the seed. Every other spec is
  modelled on it, so point generation prompts at it **by path** rather than
  pasting it: a path cannot drift from the file it names, and a pasted sample
  makes an agent reproduce that specific flow instead of generalising from it.
- **Run**: `npm run test:e2e` (whole suite), `npm run test:e2e:ui` (debug), or
  `npx playwright test tests/e2e/<feature>.spec.ts --project=chromium` for one
  spec. Needs `npx supabase start -x vector` and a free port 4321 —
  `reuseExistingServer: false` is a deliberate sibling-worktree guard.
- **Authentication is not your problem.** `tests/e2e/auth.setup.ts` runs first
  as a `setup` project dependency, signs in as the seed user from
  `supabase/seed.sql`, provisions the fixture category, and writes
  `storageState`. Specs start signed in and must never drive the login form —
  auth _mechanics_ stay §7 negative space; we test what auth gates.
- **Import `test` and `expect` from `./fixtures`, never `@playwright/test`.**
  That one line is what keeps a spec inside the fixture layer.
- **Unique data and failure-safe cleanup.** Take the unique id from the
  `entryDescription` fixture rather than minting your own. Its teardown runs
  after `use()`, so it fires even when the test fails — which is the run that
  actually leaks. A spec that only deletes its row on its last line cleans up
  exactly when cleanup was not needed; that gap left a stray row in the local
  database, which is what prompted the fixture.
- **Two app-specific traps**, both silent:
  - `await waitForHydration(page)` after every `goto` and `reload`, before
    touching an island. Astro serves fillable inputs before React hydrates, and
    hydration re-renders them from React's own initial state — anything typed
    in the gap is discarded with no error.
  - An API-level write from a test needs an explicit `origin` header. Astro's
    `security.checkOrigin` is on by default and answers `403 Cross-site DELETE
form submissions are forbidden`; a browser sends `Origin` itself, an
    `APIRequestContext` does not. JSON POSTs are exempt from the check, which
    is why `auth.setup.ts`'s POST needs no header and the teardown DELETE does.
- **Prove the assertion, don't assume it.** Before a spec counts as done,
  deliberately break the behaviour its risk names and confirm it goes red — the
  seed was verified this way (GET `/api/entries` forced to `[]`, which failed
  the reload step while the pre-reload step still passed, i.e. exactly risk #5).
  Revert the break immediately; never commit it.
- **Reach for this layer last.** E2E earns its place only when a risk crosses
  several boundaries or exists only in the rendered, hydrated UI. If §6.1–§6.4
  can prove it, use those — they are faster, less flaky, and gated in CI, which
  this layer is not.

### 6.7 Per-rollout-phase notes

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

**Phase 3 — Reports aggregation truth** (`testing-reports-aggregation-truth`):

- **PostgREST, not Postgres, is where the silence lives.** `max_rows` is applied
  by the API layer and TRUNCATES rather than erroring; pgTAP talks to Postgres
  directly and never crosses it, so **no fixture size** reproduces the failure
  there. That is the structural reason both pgTAP suites on this path carried a
  "therefore manual forever" disclaimer
  (`supabase/tests/entries_summary_test.sql:17-22`,
  `entries_category_summary_test.sql:20-25`) — and the reason the disclaimer was
  wrong past its first half. The guard is a plain `array.length` comparison in
  TypeScript, so a 1000-row synthetic response reaches it exactly, in
  milliseconds. When a suite disclaims something as out of reach, check whether
  it is out of reach for _that layer_ or out of reach at all (`lessons.md`,
  first entry).
- **A guard that errors correctly can still fail the user.** The truncation
  tripwire raises a 400 with a specific Polish message and a `field` hint — and
  both boards then discard the response body and render a generic "could not
  load" (`OverviewBoard.tsx:101-113`, `CategoriesBoard.tsx:109-121`). The figure
  is correctly absent, which is the guarantee risk #2 asks for; the _reason_ is
  lost, which is not. Left as-is deliberately: surfacing it is a UI change that
  needs the component layer §3 Phase 5 delivers. Do not read the green route
  tests as evidence the user is told anything useful.
- **The shape-regex class has two survivors.** Phase 2 fixed the two copies in
  `services/entries.ts`; Phase 3 fixed the two in `services/reports.ts`.
  `src/lib/services/receipts.ts:57` and `src/pages/api/entries/index.ts:11`
  still carry `/^\d{4}-\d{2}-\d{2}$/` and still accept `2026-02-30`. Both were
  left alone because neither is on the reports path — named here so the next
  phase touching either one knows the swap is already proven against the
  installed zod `4.4.3` and costs one line.
- **Hosted `max_rows`, as observed: 1000, `checked: 2026-08-22`.** Read from the
  Supabase console for the linked project, so `POSTGREST_MAX_ROWS`
  (`src/lib/services/reports.ts`) is a correct mirror as of that date. The check
  matters because `supabase/config.toml:18` governs the **local** stack only and
  the `deploy` job does `link` + `db push` without ever touching hosted API
  settings — nothing in CI keeps the two in step. If they diverge the guard is
  wrong in both directions: too low truncates before the check fires, too high
  rejects valid ranges.
- **Route tests borrowed the Phase 2 pattern; §6.4 is still not delivered.**
  `summary.test.ts` and `category-summary.test.ts` reuse the `vi.mock` +
  module-scope-holder + `await import()` shape from
  `src/pages/api/receipts/entries.test.ts`, composed with a small
  `auth.getUser` surface, and drive the **real** service against the recording
  fake so the `instanceof RangeTooLargeError` → 400 mapping proves actual
  wiring. That is a status-and-body pattern, not an ownership one: §6.4's
  deliverable — request as A for B's resource, assert refusal, assert cache
  headers — remains §3 Phase 4's.
- **The one check no single board can make.** Board A's expense total and Board
  B's donut centre are two independent SQL aggregates of the same population,
  and each can be individually correct while jointly wrong. The cross-board case
  in `reports.test.ts` projects **one hand-written population** into both RPC
  response shapes and asserts the two agree. It proves the two _reshaping paths_
  agree given consistent inputs; it does not prove the two SQL functions'
  predicates agree — that half is the pgTAP suites'. Any future pair of
  aggregates over one population deserves the same treatment.

**Phase 4 — Isolation beyond the database** (`testing-cross-user-isolation`):

- **The pgTAP half of this phase was already done, and the brief was wrong to
  assume otherwise.** Both aggregates are `security invoker` with
  `set search_path = ''`, take **no user-id parameter**, and are `revoke`d from
  `public`/`anon` — so there is no channel through which a caller can even name
  another user's uuid, and RLS on `entries` keeps applying inside the function.
  Both summary suites already assert the cross-user negative _through the RPC_,
  not merely on the base table (`entries_summary_test.sql:192-220`,
  `entries_category_summary_test.sql`). The phase therefore added **no
  migration and no pgTAP**, and spent its budget on the layer that had nothing:
  the route boundary. Check what the existing suites assert before planning an
  "extension" to them.
- **One ownership invariant is now guarded only at the app layer, on purpose,
  and the record of why is in the database.**
  `supabase/migrations/20260815164539_create_entries_table.sql:31-36` states
  that `entries.category_id` is a plain foreign key and that Postgres FK checks
  are **not** subject to RLS on the referenced table;
  `supabase/tests/entries_rls_test.sql:8-17` excludes the case in writing. So a
  raw SQL insert by A naming B's category id is legal and succeeds, and the only
  refusal is `assertCategoryUsable`'s RLS-scoped lookup
  (`src/lib/services/entries.ts:154-181`). Its automated guards are the three
  route tests (`entries/index.test.ts`, `entries/[id].test.ts`,
  `receipts/entries.test.ts`) and nothing else. A green pgTAP run is not
  evidence here — see §6.4.
- **`Cache-Control` coverage is path-blind, and for API responses it rests on
  one disjunct.** `src/middleware.test.ts` proves what the middleware attaches
  to a response it is _handed_; it does not prove that any particular page or
  route reaches the middleware, and it cannot — the paths are strings the test
  supplies. `PROTECTED_ROUTES` deliberately lists pages only, so every
  `/api/**` response depends solely on `context.locals.user` being truthy. Drop
  that disjunct and only the signed-in `/api/**` case goes red (verified). The
  third disjunct, `isRedirect`, exists for one specific hole: anonymous
  `GET /` is not protected and has no user, yet `src/pages/index.astro` picks
  its `Location` from `locals.user`, and that redirect is built by the **page**
  and arrives through `next()`, so no branch above sees it.
- **The honest limit of every route test here: changing the fake's identity
  constant breaks nothing.** The Phase 1 teeth check swapped `USER_A` for
  `USER_B` in `__fixtures__/route-context.ts` and the suite stayed green,
  because the fake has no caller identity and no row store — it resolves queued
  responses in call order, whoever is asking. That is not a defect to fix; it is
  the statement of what these tests claim. They prove _a route refuses correctly
  given a client that returns nothing_, and the refusal body does not confirm
  B's row exists. That RLS is what returns nothing stays pgTAP's, and only
  pgTAP's. Any future test built on this fixture inherits the same ceiling and
  must say so in its header comment.

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
- **A broad end-to-end layer — reversed in part, 2026-08-22.** This entry
  used to read "an end-to-end layer" flat: every risk in §2 had a cheaper
  layer, so promoting any of them to e2e would cost wall-clock and flake
  without adding signal. That held for the layer as a _sweep_ and still does.
  It did not survive contact with risk #5, whose failure — the day list showing
  what the database does not contain — lives in the seam between SSR, island
  hydration, the API and RLS, and is reproducible by no single cheaper layer:
  a component test renders against a fake, a route test never hydrates, and
  pgTAP cannot reach application code. So a **narrow** e2e layer now exists
  (Playwright, `tests/e2e/`, §4 and §6.6). What stays deliberately out is the
  sweep: no test per page or per button, no e2e for anything §6.1–§6.4 can
  prove, and no pixel or snapshot assertions (see the separate entry above).
  The budget is roughly one reviewed spec per browser-level risk. Re-evaluate
  the _narrowness_ if the suite starts growing faster than §2's risk list.
  (Source: §1 principle #1, amended by the risk #5 rollout.)
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

- Strategy (§1–§5) last reviewed: 2026-08-22 (§3 Phase 4 marked complete —
  risk #3 now has automated coverage at the route and middleware layers: six
  ownership surfaces assert A being refused B's id, and five middleware cases
  pin `Cache-Control: private, no-store` on authenticated and auth-varying
  responses. The database half needed no new work — see §6.7 Phase 4. Earlier:
  2026-08-22, §3 Phase 3 marked complete —
  risk #2 now has automated coverage at the unit, service, and route layers;
  §4's `API mocking` row re-dated for the fake's RPC extension. Earlier:
  2026-08-21, §3 Phase 1 complete and four §5 gates flipped from planned to
  wired)
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
