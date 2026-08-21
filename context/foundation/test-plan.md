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
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
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
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Confirming a reviewed receipt persists something other than what was on screen — wrong per-category split, wrong receipt-derived date, wrong amount, or a duplicate batch on retry | High | High | interview Q1 (stated top fear), interview Q3; `prd.md` explicit-confirmation guarantee ("never a silent write"); archive: non-idempotent confirm caught only at impl-review, and a later slice redefined per-category grouping after the parse feature shipped; `roadmap.md` records off-plan changes to this flow landing without impl-review; hot-spot dir `src/components/receipts/` — 14 commits/30d |
| 2 | A KPI or chart reads plausibly but is wrong — rows silently dropped, the recurring-cost filter disagreeing with the numbers displayed, or a range resolving to the wrong window | High | High | interview Q3; archive: a reports slice rejected at impl-review because the row ceiling truncated instead of erroring, leaving ranking rows printing 0% beside real amounts; a later slice fixed a clipped axis and an all-time range, both found after ship; `roadmap.md` records the filter invariant being deliberately moved out of a pinned bar into a caption; hot-spot dirs `src/components/reports/` — 40 commits/30d, `src/lib/services/` — 21 commits/30d |
| 3 | One user's financial data becomes reachable by another | High | Medium | `prd.md` strict per-user isolation guarantee and the decision to ship no admin role; `tech-stack.md`: anon key only, no service-role bypass, so RLS is the sole isolation boundary; `CLAUDE.md` hard rules require RLS in the creating migration *and* `private, no-store` on authenticated responses, and state that both fail **silently**; archive: cross-user invariants recorded as having no database backstop, and an aggregation path silently dropping entries filed under another user's category |
| 4 | A schema migration reaches the hosted database ahead of the Worker that matches it, and live data routes fail | High | Medium | `CLAUDE.md`: CI applies migrations between build and deploy, so every migration must be backward-compatible with the *previous* Worker; this already broke the first deploy — every data route 500'd against an empty schema; `roadmap.md` carries an open REQUIRED column-drop follow-up of exactly this shape; archive records the pgTAP suite never having run against the merged migration set; hot-spot dir `supabase/migrations/` — 14 commits/30d |
| 5 | The day list shows something the database does not contain — a row duplicated after save, or an inline edit applied to the wrong row or the wrong day | Medium | High | interview Q4 (named explicitly as the scariest gap); archive: a stale-day race at save, a duplicate row from optimistic save, and shared inline-edit state leaking across rows and across day changes; hot-spot dir `src/components/entries/` — 35 commits/30d, and the three top-churning files in the repo all sit in it |
| 6 | The app becomes unusable on a phone because one element gives the *whole document* horizontal scroll | Medium | High | interview Q2, interview Q3; `lessons.md` carries two separate entries for the identical symptom arising from opposite mechanisms; `roadmap.md`: both fixes shipped straight to `master` with no plan, impl-review, or change folder; `prd.md`'s input-friction thesis assumes a phone |

Risk #3 is the abuse-lens row (authorization / ownership, not merely
authentication). Two further abuse candidates surfaced from the archive —
receipt-endpoint quota drain with authentication as the only limit, and
receipt-derived text reaching platform logs against the store-nothing
disclosure shown to users. Both are recorded in the archive as **accepted
by decision**; they are carried in §7 as visible accepted risk rather than
silently re-litigated here.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Confirming writes exactly the set shown — same count, same per-category split, same amounts, same date the user saw — and a repeated confirm does not double it | That a 200 means the right rows landed; that the rendered review and the submitted payload are the same object; that grouping is decided in exactly one place | Where the confirm payload is assembled versus where it is rendered; the batch-write boundary and its idempotency mechanism; what the save date resolves to when the printed date is absent or reverted; behaviour on partial write | unit (grouping and date resolution) + integration (confirm boundary → persisted rows) | **Oracle problem** — computing the expected rows by calling the same grouping helper under test. Expectations must be hand-written from the reviewed screen, not derived from the implementation |
| #2 | A figure is either correct or absent — never a plausible number derived from a partial result set — and filter state always matches the numbers displayed | That a successful query means a *complete* result set (the real failure was truncation, not an error); that "all time" resolves to a sane window; that a percentage and its absolute amount share one total | The row-count ceiling on the data path and the behaviour at it; where the total is computed relative to per-category rows; how range presets resolve to concrete dates; where filter state lives relative to the caption that reports it | unit (distribution model) + integration (aggregation with a fixture sized **past** the ceiling) | Fixtures too small to reach the boundary that actually broke — a five-category fixture cannot reproduce a thirty-four-category truncation |
| #3 | A request authenticated as user A cannot read, aggregate, or mutate any row owned by user B — including through an aggregation path or a reference to B's category — and no authenticated response is edge-cacheable | That "logged in" implies "owns this resource"; that RLS on base tables covers aggregate and RPC paths; that a green pgTAP suite covers app-layer ownership filtering (it provably cannot) | Which reads go through RLS versus an aggregate path; where ownership is enforced in application code rather than in policy; which responses carry cache headers | pgTAP extension for anything expressible in SQL; route-boundary integration for app-layer-only ownership | Testing only that A sees A's own data. The test that matters is **A explicitly requesting B's id and being refused** |
| #4 | The migration set applies cleanly from scratch, and the *previous* Worker's queries still succeed against the new schema | That a green deploy means the schema matches the code; that per-branch pgTAP runs prove the merged migration set | Which columns and functions the currently deployed Worker reads; what the pending drop would remove; whether migrations are validated anywhere before the hosted push | A CI job: from-scratch migration run plus the pgTAP suite. This is a gate, not a test | Running the suite only against the branch's own migration — precisely what let the merged-set gap through before |
| #5 | After a save, edit, or delete, the visible list equals what a fresh read would return; an edit opened on one row never applies to another row and never survives a day change | That an optimistic update matches the server's result; that switching days resets per-row state; that a failed request leaves the list in a truthful state | How list state is derived and updated after each mutation; where per-row edit state is keyed; behaviour on request failure and on rapid day navigation | component tests on the list island with a mocked data boundary | Asserting the component's internal state instead of what a user would see rendered; happy-path-only, with no failure case and no rapid-navigation case |
| #6 | At 320, 360, and 390 CSS px, no page gives the document horizontal scroll, with realistic worst-case user strings (long email, long category name, long description) | That fixing the *named* element fixed the page — the reported element is usually not the overflowing one; that a fix for one mechanism covers the other | Which pages and components mix user-supplied strings with controls; which rely on intrinsic-width utilities; whether built CSS alone suffices or a signed-in render is required | headless assertion of document scroll width against client width, run against built CSS — `lessons.md` establishes this needs no dev server and no sign-in for at least one of the two mechanisms | A pixel snapshot. It fails on every Tailwind change and still never tells you the document overflows |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Runner bootstrap + CI test floor | Prove a schema change or a broken build cannot reach production unnoticed, and stand up a real test harness | #4 | unit, CI gate, pgTAP on merged migrations | change opened | `context/changes/testing-runner-bootstrap/` |
| 2 | Receipt confirm integrity | Prove that what the user confirms is what persists, exactly once | #1 | unit, service integration | not started | — |
| 3 | Reports aggregation truth | Prove a displayed figure is correct or absent, never plausibly wrong | #2 | unit, integration with oversized fixture | not started | — |
| 4 | Isolation beyond the database | Prove A cannot reach B's data through any path, and no authenticated page is edge-cacheable | #3 | pgTAP extension, route integration, response-header assertion | not started | — |
| 5 | Client state + viewport regressions | Prove the day list tells the truth and no page overflows a phone | #5, #6 | component tests, headless overflow check | not started | — |

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
unpinned candidates for Phase 1 to resolve against current releases**, not
verified selections.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | none yet — see §3 Phase 1 | — | Candidate: Vitest, because the project already builds on Vite via Astro and would share one config and transform chain; `checked: 2026-08-21` |
| component (React islands) | none yet — see §3 Phase 5 | — | Candidate: React Testing Library on the Phase 1 runner; asserts rendered output rather than component internals; `checked: 2026-08-21` |
| API mocking | none yet — see §3 Phase 2 | — | Mock at the network edge only. The Supabase client is the boundary worth faking; internal service modules are not; `checked: 2026-08-21` |
| database / RLS | pgTAP via Supabase CLI | CLI pinned `2.98.2` | Exists today: 6 suites in `supabase/tests/`, run by `npx supabase test db`. Local-only — never runs in CI until §3 Phase 1. Cannot reach application code (`lessons.md`) |
| narrow-viewport overflow | none yet — see §3 Phase 5 | — | Candidate: headless Chromium asserting document scroll width against client width at 320/360/390, against built CSS; `checked: 2026-08-21` |
| lint | ESLint (`strictTypeChecked` + `stylisticTypeChecked` + react-compiler) | per `package.json` | Wired and enforced in CI today |
| typecheck | `@astrojs/check` | per `package.json` | **Installed but never invoked** — no script, no CI step. Phase 1 wires it |
| e2e | none — deliberate | — | Every risk in §2 has a cheaper layer that reaches it. See §7 |
| AI-native | none — deferred | — | An offline receipt-classification eval was proposed and cut by decision. See §7 |

**Stack grounding tools (current session):**
- Docs: none — no Context7 or framework-docs MCP exposed; stack facts taken from `package.json`, `astro.config.mjs`, `CLAUDE.md`, and `tech-stack.md`; checked: 2026-08-21
- Search: none — no Exa.ai or web-search MCP exposed; no tool version or release status was verified online, hence the unpinned candidates above; checked: 2026-08-21
- Runtime/browser: none — no Playwright or browser MCP exposed; the Phase 5 headless check is a candidate approach, not a verified integration; checked: 2026-08-21
- Provider/platform: none — no GitHub, Cloudflare, or Supabase MCP exposed; CI facts read directly from `.github/workflows/ci.yml`; checked: 2026-08-21

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint | local (pre-commit) + CI | required — wired today | syntactic drift, type drift reachable by type-checked rules |
| typecheck | CI | required after §3 Phase 1 | type drift the lint rules do not reach |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions in services and pure model code |
| pgTAP on the merged migration set | CI | required after §3 Phase 1 | RLS and schema regressions; merged-set gaps that per-branch runs miss |
| from-scratch migration apply | CI | required after §3 Phase 1 | a migration that cannot be applied to a clean database |
| component tests | local + CI | required after §3 Phase 5 | list-state and inline-edit regressions in React islands |
| narrow-viewport overflow check | CI on PR | required after §3 Phase 5 | document-level horizontal scroll at phone widths |
| post-edit hook | local (agent loop) | recommended after §3 Phase 5 | the overflow and unit checks at edit time, before review |

The post-edit hook is a **recommended local** convenience, never a CI
substitute. Configuration of hooks is out of scope for this plan.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

TBD — see §3 Phase 2, which delivers the first pattern for pure model code
(receipt grouping and save-date resolution).

### 6.2 Adding a service integration test

TBD — see §3 Phase 2, which delivers the confirm-boundary pattern:
submitted payload in, persisted rows out, including the repeated-confirm
case.

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
  what auth *gates* (risk #3), not the mechanism. Re-evaluate if a slice
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
- **The interaction-count and time budget from the PRD north star** — the
  PRD does not define *interaction* as a unit, so any assertion would
  encode an arbitrary definition rather than the requirement. Stays a
  manual acceptance check. Re-evaluate if the PRD pins the unit.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-21
- Stack versions last verified: 2026-08-21 (local manifests only — no docs
  or search MCP was available, so §4 candidate tools are unpinned)
- AI-native tool references last verified: 2026-08-21 (none adopted)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
