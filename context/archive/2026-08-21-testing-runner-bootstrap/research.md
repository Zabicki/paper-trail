---
date: 2026-08-21T15:09:28+02:00
researcher: Krzysztof
git_commit: c2b87816da892bebcb0ff390bd14c9f9db1083bd
branch: master
repository: paper-trail
topic: "Runner bootstrap + CI test floor — grounding risk #4 (migration reaches hosted DB ahead of the matching Worker)"
tags: [research, codebase, ci, supabase, pgtap, vitest, migrations, test-plan-phase-1]
status: complete
last_updated: 2026-08-21
last_updated_by: Krzysztof
---

# Research: Runner bootstrap + CI test floor

**Date**: 2026-08-21T15:09:28+02:00
**Researcher**: Krzysztof
**Git Commit**: `c2b87816da892bebcb0ff390bd14c9f9db1083bd` (pushed; permalink base
`https://github.com/Zabicki/paper-trail/blob/c2b8781/`)
**Branch**: `master`
**Repository**: `paper-trail`

## Research Question

Rollout phase 1 of `context/foundation/test-plan.md` §3: *"Prove a schema change or
a broken build cannot reach production unnoticed, and stand up a real test
harness."* Risk #4.

The brief from `test-plan.md:67` requires research to ground three things:

1. Which columns and functions the currently deployed Worker reads.
2. What the pending `category-color-drop` would remove.
3. Whether migrations are validated anywhere before the hosted push.

And to challenge two beliefs: *that a green deploy means the schema matches the
code*, and *that per-branch pgTAP runs prove the merged migration set*.

**Scope confirmed with the user before research**: all four gates §5 marks
"required after §3 Phase 1" land in CI (typecheck, unit, pgTAP on the merged set,
from-scratch apply); the unit layer gets one real pure-module target with an
external oracle rather than a smoke test.

## Summary

**Risk #4 has two faces, and they need different gates. The plan currently
describes only the weaker one.**

**Face A — the migration cannot apply, or the code runs against a schema that
isn't there.** This is what broke the first deploy: the Worker shipped against an
empty `public` schema and every data route 500'd with `Could not find the table
'public.categories' in the schema cache` (`context/deployment/deploy-plan.md:215`).
It fails **loudly**. A from-scratch apply plus the pgTAP suite in CI catches it,
and `supabase start` on a fresh runner gives the from-scratch apply almost free.

**Face B — the migration applies fine, but is backward-*incompatible* with the
Worker still running.** CI applies migrations between the build and
`wrangler deploy` (`.github/workflows/ci.yml:44-63`), so for that window the
**previous** Worker serves against the **new** schema. This face fails
**silently**, for three compounding reasons:

- `src/lib/supabase.ts:9` calls `createServerClient` with **no `Database`
  generic** — every table and column reference in the Worker is an unchecked
  string literal (`src/lib/services/categories.ts:66`,
  `src/lib/services/entries.ts:101`).
- Both RPC result sets are cast with a bare `as` and no zod
  (`src/lib/services/reports.ts:212`, `:369`).
- So a field removed from a `RETURNS TABLE` becomes a **missing JSON key →
  `undefined`**, which renders as a blank slice or a `NaN`, never as an error.

A smoke gate asking "does the app 500?" is structurally blind to Face B. So is a
gate that applies the new migrations and runs **HEAD's** tests — because the code
at risk is the *previous* Worker, and nothing in this repo has any notion of "the
last deployed SHA."

**The de-escalating finding: the currently loaded trigger is safe.** The pending
`category-color-drop` would **not** break the deployed Worker. There is no
`select("*")` anywhere in `src/`, every read names its columns explicitly and none
names `color`, and `category_color` is declared at
`src/lib/services/reports.ts:294` but **never dereferenced** — `toCategorySummary`
(`:309-341`) reads five other fields. So Phase 1 does not need to build the hard
old-code-vs-new-schema gate in order to survive the next deploy. It needs to make
the *class* visible.

**And the cheap tripwire already exists.** `supabase/tests/` holds 6 suites and
**104 assertions** that have never run anywhere but a laptop. The colour drop
breaks 5 of them — including a **fixture INSERT** at
`entries_category_summary_test.sql:57`, which aborts that file before assertion 1.
Putting pgTAP in CI converts "silent schema/code drift" into "red build" for
everything expressible in SQL, which is the layer `test-plan.md:66` already
nominated. That is the cost × signal answer for Phase 1.

**The single most likely way to build a green-but-meaningless job**: copying the
existing `supabase/setup-cli@v1` / `version: 2.114.0` block
(`.github/workflows/ci.yml:50-52`) into the new test job. That pin is safe *only*
because the deploy job does `link` + `db push` against a hosted database where
grants already exist. A job that **provisions** a database is on the local side and
must use the lockfile's `2.98.2`, or all 104 assertions fail `permission denied`
before one runs (`context/foundation/lessons.md:15-23`).

**Two corrections to standing documentation** are recorded in "Corrections" below:
the CLI is **not** pinned in `devDependencies`, and Supabase has a **dated
deprecation** that gives the current pinning strategy about ten weeks of runway.

## Detailed Findings

### 1. What the deployed Worker actually reads

**There is no `select("*")` anywhere in `src/`.** Every read is an explicit column
list. Two shared constants carry nearly all of it:

- `src/lib/services/categories.ts:66` — `"id, name, icon, is_recurring, kind, created_at"`
- `src/lib/services/entries.ts:101` — `"id, amount, occurred_on, type, created_at, description, category:categories(id, name, icon)"`
  (the `category:categories(...)` embed makes this read depend on the FK
  `entries.category_id → categories.id`)

`user_id` is never named in TypeScript — supplied by the column default
`auth.uid()` and filtered by RLS.

| RPC | Args | Fields read | Fields declared but unread |
|---|---|---|---|
| `entries_summary` (called twice) | `p_from, p_to, p_bucket, p_exclude_recurring` | `bucket_start, entry_type, total` | — |
| `entries_category_summary` | same | `bucket_start, category_id, category_name, category_icon, total` | **`category_color`** |

Call sites: `src/lib/services/reports.ts:200-211`, `:364-369`. Both results cast
with `as` at `:212` and `:369`.

### 2. What `category-color-drop` removes — and why it is safe

Scheduled for removal per `context/archive/2026-08-17-category-icons/plan.md:382-388`:

| Target | Location |
|---|---|
| `categories.color` + its CHECK | `supabase/migrations/20260815145611_add_category_fields.sql:10-16` |
| `category_color` from `entries_category_summary` — needs **drop + recreate**, Postgres cannot alter a `returns table` shape in place | `20260818090000_add_category_icon.sql:112-119`, `:129`, `:138-139` |
| `CATEGORY_COLORS`, `CategoryColor`, `DEFAULT_CATEGORY_COLOR` | `src/types.ts:151-168` |
| the unread boundary field | `src/lib/services/reports.ts:294` |

**Would the deployed Worker break? No.** Table side: nothing couples to the whole
row shape, and `createCategory` (`src/lib/services/categories.ts:93-100`)
deliberately omits `color`, relying on the default — after the drop the same insert
is still valid. Function side: `category_color` is never dereferenced.
`entries_summary` never mentions `color` at all.

**One live subtlety**: `src/components/reports/distribution.ts:15` imports
`CATEGORY_COLORS` — the **TypeScript palette constant**, not the DB column. The
palette must be **moved into `distribution.ts`, not deleted**. `distribution.ts:60-68`
records a lightness-headroom precondition that binds on whatever palette survives.

**What the drop *does* break is the pgTAP suite** — see §4 — which CI never runs.

### 3. Where the backward-compatibility rule is enforced: nowhere

`.github/workflows/ci.yml` read in full. Verified absences across the whole file:
no Docker service, no `supabase start`, no `db reset`, no `test db`, no `db lint`,
no `db diff`, no dry run, no shadow database.

**`supabase db push --yes` at `ci.yml:60` is the first and only execution of any
migration anywhere in the pipeline, and it executes against production.**

Two aggravating details:

- The `pull_request` trigger (`:6-7`) runs only the `ci` job; `deploy` is gated at
  `:27`. **A PR adding a destructive migration is green** — Supabase is never
  contacted on a PR.
- The backward-compat rule lives **only in prose**, restated by hand in each
  migration header (`20260815181500:6-10`, `20260816140000:10-14`,
  `20260817190000:39-45`, `20260818090000:4-11`) plus `CLAUDE.md`. Zero mechanical
  backing.

No SQL linter is configured. `lint-staged` globs (`package.json:63-70`) are
`*.{ts,tsx,astro}` and `*.{json,css,md}` — **`.sql` matches neither**.

`deploy-plan.md:303` states the gap outright:

> "The `ci` job does **not** validate migrations on PRs — that would need Docker
> and a local Supabase stack in the runner. […] A migration that is valid locally
> but fails against production will fail the `deploy` job *after* approval, leaving
> the previous Worker live and **the schema partially applied at whatever statement
> errored**."

### 4. The pgTAP suite: 104 assertions that have never run in CI

| File | `plan(n)` | Broken by the colour drop? |
|---|---|---|
| `categories_rls_test.sql` | 19 | **yes** — `:49-53` (colour default), `:87-92` (palette CHECK) |
| `entries_rls_test.sql` | 20 | no |
| `entries_batch_key_test.sql` | 10 | no |
| `entries_summary_test.sql` | 23 | no |
| `entries_category_summary_test.sql` | 26 | **yes** — `:57` fixture INSERT, `:154-159`, `:161-166` |
| `entries_description_test.sql` | 6 | no |

Every file is wrapped `begin;` … `select * from finish(); rollback;` — self-cleaning
and order-independent.

**The suite hard-requires `supabase/seed.sql`.** All six write rows whose `user_id`
FKs to `auth.users` for the fixed UUIDs `1111…` / `2222…`. `[db.seed]` is enabled at
`supabase/config.toml:61-65`, so `db reset` runs it automatically; `--no-seed` turns
all 104 assertions into FK violations.

**Load-bearing mechanic** (`context/archive/2026-08-15-data-foundation-rls/plan.md:47-56`):
`set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` —
*"Forgetting `set local role authenticated` is the single most likely way this test
suite would silently pass while testing nothing."*

**⚠ A documented Postgres SEGFAULT** at `entries_summary_test.sql:225-249`: the local
image crashes the backend with signal 11 when a function-EXECUTE denial is raised
inside an impersonated transaction. Both summary suites work around it with
`has_function_privilege` rather than `throws_ok`. In CI this matters twice — a
segfault drops every connection, so remaining files fail with connection errors and
the real cause is invisible in the log.

**The per-branch gap is real and recorded.** From
`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:80-89`
(F2): the suite was an automated success criterion in both S-05 and S-06, ticked in
each branch against its own isolated stack and its own migration subset — never
against the merged set. Closed by hand: `Files=6, Tests=102, PASS`.

### 5. The CLI trap — the #1 implementation risk

| Where | Value |
|---|---|
| `package.json:55` | **`"supabase": "^2.23.4"`** — a caret range |
| `package-lock.json:13359` | **`2.98.2`** — the actual pin |
| Installed in this tree | `2.98.2` (verified) |
| `.github/workflows/ci.yml:50-52` | **`2.114.0`** via `supabase/setup-cli@v1` |
| npm registry latest | `2.115.0` |

Failure mode, from `context/foundation/lessons.md:15-23`: CLI ≥ 2.114.0 stops
granting `select/insert/update/delete` to `anon`/`authenticated` on new `public`
tables, so `db reset` produces a database whose own app role cannot read its own
tables. **All pgTAP files fail `permission denied for table …` before a single
assertion runs — including ones that had shipped green.**

**Which side is which:**

- Local `db reset` / `db start` / `test db` **provision** the database → the CLI's
  init step decides the grants → must be **2.98.2**.
- The CI `deploy` job does `link` + `db push` against hosted, where grants already
  exist → 2.114.0 is safe *there*.
- **A new CI job that runs `supabase start` provisions a database, so it is on the
  local side.** It must invoke `npx supabase` / `./node_modules/.bin/supabase` after
  `npm ci` — **not** `supabase/setup-cli@v1`.

The lesson also records the damage from misdiagnosis: a grants migration and an edit
to a shipped RLS test were both written and approved before `npm ci` restored the
correct CLI, and both had to be reverted.

### 6. Harness blockers for a JS runner

**`getViteConfig` is the sanctioned route.** `astro/config` exports
`getViteConfig(viteConfig, inlineAstroConfig)`
(`node_modules/astro/dist/config/index.d.ts:13`) — runs Vitest through Astro's full
plugin chain so `astro:env/server` and `@/*` both resolve. Astro's testing guide
requires **Vitest ≥ 3.2 or ≥ 4.1** for it; 4.0.x is not enough. Current release is
**4.1.11**, peer range `vite: ^6 || ^7 || ^8`, which matches this repo's
`overrides: { vite: "^7.3.2" }` (`package.json:60-62`). Vitest 5 is still rc.

**The `astro:env` blast radius is much smaller than it looks.** 18 files reference
`@/lib/supabase`, but three use `import type`, which `verbatimModuleSyntax` erases:

| Blocked (value import of a virtual module) | **Not** blocked (type-only) |
|---|---|
| `src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`, `src/lib/services/receipts.ts:3`, `src/pages/api/receipts/parse.ts:2`, `src/middleware.ts:1` | `src/lib/services/categories.ts:2`, `src/lib/services/entries.ts:2`, `src/lib/services/reports.ts:3` |

**This is the most useful finding for Phases 2 and 3**: `services/categories.ts`,
`services/entries.ts` and `services/reports.ts` import **zero** Astro virtual
modules. They take a `SupabaseClient` as a parameter
(`src/lib/services/categories.ts:12`) and are testable with a stub client and no
Astro plugin at all. Only `receipts.ts` is blocked.

A fourth virtual module, not Astro's: `src/lib/receipt-image.ts:11` imports
`{ env } from "cloudflare:workers"`.

**Config facts a runner must mirror:**

- `tsconfig.json:8-11` — `paths: {"@/*": ["./src/*"]}`. Vite does **not** read
  `tsconfig.paths` automatically; needs `getViteConfig`, `vite-tsconfig-paths`, or an
  explicit alias.
- `tsconfig.json:3` — `include: [".astro/types.d.ts", "**/*"]`. **A new `*.test.ts`
  is automatically in the TS project**, so type-aware ESLint will *not* hit the
  classic "file not in tsconfig" error. `eslint.config.js:18` uses
  `projectService: true`.
- `tsconfig.json:4` — `exclude: ["dist"]` **replaces** TS's defaults. A new
  `coverage/` directory lands inside the TS program; gitignore *and* exclude it.
- `.astro/` is gitignored (`.gitignore:19`) but is in `include` — any CI job must run
  `npx astro sync` first or `astro:env/server` has no declaration.
- `strictTypeChecked` + `stylisticTypeChecked` apply with no `files` restriction
  (`eslint.config.js:14-15`), and prettier-as-error runs last (`:92`). Expect a
  `files: ["**/*.test.ts"]` override relaxing 3–4 rules (`no-unsafe-assignment`,
  `no-non-null-assertion`, `unbound-method`).
- `.husky/pre-commit` runs `npx lint-staged`, whose first glob matches `*.test.ts`
  and `vitest.config.ts` → `eslint --fix` on commit. No test run pre-commit.
- **There is no standalone `vite.config.*`.** Vite config lives inside
  `astro.config.mjs`, including the `resolve.dedupe: ["react","react-dom"]` fix that
  `astro.config.mjs:18-27` documents as preventing a real hydration crash. A
  standalone `vitest.config.ts` inherits **none** of it unless it goes through
  `getViteConfig` — which matters for Phase 5's component tests.

### 7. The first unit target: `src/lib/text.ts`

Recommended over `money.ts`, `format.ts`, `range.ts`, `distribution.ts`,
`receipt-total.ts` and `entry-description.ts`.

**Important negative finding: `context/foundation/prd.md` contains no currency,
rounding or precision rule.** The only hit is the non-goal at `prd.md:162` ("No
multi-currency"). So `money.ts` has no PRD oracle — and its only external oracle
(`amount numeric(10,2)` at
`supabase/migrations/20260815164539_create_entries_table.sql:12`) sits under a
one-line function, which cannot prove a transform chain.

**`text.ts` has a genuinely external, triple-sourced oracle:**

1. `supabase/migrations/20260816140000_add_entry_description.sql:28` —
   `add column description text check (char_length(description) <= 200)`
2. Postgres `char_length()` counts **code points**, not UTF-16 units — documented
   Postgres semantics, verifiable against the running local database.
3. UTF-16 surrogate-pair behaviour is a spec fact: `'a😀b'.slice(0,2)` yields a lone
   surrogate; `[...'a😀b'].length === 3`.

The module itself (`src/lib/text.ts:1-19`) states the contract and, unusually,
defends it against the plausible-but-wrong alternative — `Intl.Segmenter` grapheme
clusters would **under**-count against the database bound and let an over-long value
through.

**Accuracy note.** The `name.slice(0, NAME_MAX)` defect the header mentions
(`text.ts:7`) is **already fixed** — `src/lib/services/receipts.ts:174` now calls
`truncateCodePoints(item.name, NAME_MAX)`. `text.ts` *is* the fix. A test therefore
**pins the fix against regression**; it does not catch a live bug.

**No Phase 2/3 overlap, and it complements pgTAP rather than duplicating it.**
`entries_description_test.sql` (6 assertions) proves the **database rejects** 201
characters. A unit test on `text.ts` proves the **app never sends** a lone surrogate
or an over-long string. Different halves of the same guarantee.

Why it proves the harness: zero imports (no `astro:*`, Supabase, React, Intl,
`Date`, DOM, ICU), so a failure can only be the harness. The test file's own
`import { … } from "@/lib/text"` is what proves the `@/*` alias resolves.

**Sequencing consequence**: because `text.ts` imports nothing, Phase 1 can prove the
runner **before** solving the `astro:env/server` problem. Do not let the virtual-module
question block the runner bootstrap.

**Runner-up**: `src/components/entries/date-utils.ts` — also zero imports, oracle is
the Gregorian calendar (`daysInMonth("2100-02") === 28`). Second because it uses
local-timezone `Date` constructors (`:23, 29, 34`), so the runner must pin `TZ`, and
`POLISH_MONTH_NAMES` (`:38-51`) is consumed by `range.ts:27` — a thin edge of Phase 3.

**Explicitly not first**: `format.ts` builds five module-scope
`Intl.NumberFormat("pl-PL")` instances (`:5,14,22,27,36`) emitting an NBSP before
`zł`; `.nvmrc` pins `22.14.0` but CI pins only `node-version: 22`
(`ci.yml:16`), so ICU can differ between them.

### 8. Shape of the CI job, derived only from this repo

1. `actions/checkout@v4`
2. `actions/setup-node@v4`, `node-version: 22`, `cache: npm`
3. **`npm ci`** — mandatory *before* any `supabase` invocation
4. Invoke as **`npx supabase`**, never `supabase/setup-cli@v1` (see §5)
5. `npx supabase start -x vector` — `[analytics] enabled = true`
   (`config.toml:371-372`) is what spawns the vector log-shipper; there is **no
   vector block to disable**, which is why the workaround is a CLI flag
6. `npx supabase db reset` — from-scratch merged-set apply + seed
7. `npx supabase test db` — 104 assertions
8. Wire `deploy` to `needs: [ci, db-test]`

**No secrets required.** `supabase start` is fully local. `SUPABASE_ACCESS_TOKEN` /
`SUPABASE_DB_PASSWORD` / `SUPABASE_PROJECT_REF` exist only for `link` + `db push`
(`ci.yml:53-63`), and `deploy-plan.md:48` records that CI does not need
`SUPABASE_URL`/`SUPABASE_KEY` either — "confirmed by two green runs made before any
secret existed." That is the job's biggest safety property: it can run on pull
requests with no `production` environment and therefore no approval gate.

**Keep it a separate job.** `supabase link` writes project state into the same
`supabase/` directory a local stack reads; `test db --linked` and
`db reset --linked` both target **production**.

## Code References

- `src/lib/supabase.ts:9` — `createServerClient` with no `Database` generic; the root cause of silent schema drift
- `src/lib/supabase.ts:3` — `import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"`
- `src/lib/services/reports.ts:212`, `:369` — bare `as` casts on both RPC boundaries, no zod
- `src/lib/services/reports.ts:294` — `category_color` declared; `:309-341` never reads it
- `src/lib/services/categories.ts:66`, `src/lib/services/entries.ts:101` — the two `SELECT_COLUMNS` string literals
- `src/lib/services/categories.ts:12` — services take `SupabaseClient` as a parameter (stub-testable)
- `src/lib/text.ts:1-19` — the contract and its defence against grapheme clustering
- `src/lib/services/receipts.ts:174` — the fixed call site
- `src/components/reports/distribution.ts:15` — imports the TS palette, not the DB column
- `.github/workflows/ci.yml:44-63` — migrations between build and deploy; `:60` the only migration execution in the pipeline
- `.github/workflows/ci.yml:50-52` — the 2.114.0 pin that must **not** be copied into a test job
- `supabase/config.toml:61-65` — `[db.seed]`, which the pgTAP suite depends on
- `supabase/config.toml:371-372` — `[analytics] enabled`, the reason for `-x vector`
- `supabase/config.toml:18` — `max_rows = 1000`, hardcoded again at `src/lib/services/reports.ts:45`
- `supabase/tests/entries_summary_test.sql:225-249` — the SEGFAULT workaround
- `supabase/tests/entries_category_summary_test.sql:57` — fixture INSERT naming `color`
- `package.json:55` vs `package-lock.json:13359` — the CLI pin discrepancy
- `tsconfig.json:3-11` — `include: **/*` and the `@/*` alias

## Architecture Insights

- **The schema/code boundary is entirely untyped and unvalidated.** No `Database`
  generic, no `supabase gen types` anywhere (deferred at
  `context/archive/2026-08-15-data-foundation-rls/plan.md:35`), no zod on RPC
  results. `npm run lint` and `npm run build` — the only two things the merge gate
  runs — are **structurally incapable** of detecting schema drift in either
  direction. This is why the gate has to be a *database* gate, not a type gate.
- **`max_rows = 1000` is duplicated** between `config.toml:18` and
  `reports.ts:45` with nothing linking them — a second undetected config/code
  coupling of the same family as risk #4, and the mechanism behind the archived
  truncation defect.
- **A green from-scratch apply is not evidence the next `db push` succeeds.**
  `db reset` replays into an empty database; production applies incrementally onto
  an existing schema. `20260818090000_add_category_icon.sql:104` does
  `drop function … ; create function …` and `:40-90` runs a one-shot data backfill —
  behaviours that differ between clean replay and incremental push. The incremental
  path is the one `deploy-plan.md:303` actually describes, and the proposed job does
  **not** cover it.

## Historical Context (from prior changes)

- **CI migration verification was proposed and rejected once, explicitly on cost.**
  `context/archive/2026-08-15-data-foundation-rls/plan.md:36`: *"**Not** adding a CI
  job that spins up Postgres/Docker to run the pgTAP suite."* Decision table
  (`plan-brief.md:26`): *"CI integration | Deferred — local manual step only |
  Postgres-in-Docker inside GitHub Actions is real setup work outside this
  foundation's scope."* **This change reverses that decision.** The reversal is
  justified — the schema-cache incident and the merged-set gap are new evidence —
  but it must be made knowingly.
- **pgTAP was chosen precisely to sidestep the missing JS runner**
  (`data-foundation-rls/plan-brief.md:22`). Phase 1 removes that constraint, which
  means `lessons.md:5-13` ("app-layer-only invariants are permanently manual-only")
  **shrinks in scope** and should be amended rather than left standing.
- **The merge gate demonstrably ships type errors green.**
  `category-distribution-view/reviews/impl-review.md:237`: lint and build both passed
  a broken intermediate state; only `tsc --noEmit` caught eight stale `as`
  assertions. `@astrojs/check` is installed (`package.json:15`) and invoked
  **nowhere** — four slices ran it by hand, later slices switched to `tsc --noEmit`.
  Pick one and wire it; do not re-argue whether type checking is needed.
- **`category-color-drop` deferral rationale**, `category-icons/plan.md:83`: *"between
  those two steps the **previous** Worker runs against the **new** schema. […] This is
  what makes the follow-up change necessary rather than optional."*
- **Never edit an already-pushed migration in place** — F7 did, leaving an unresolved
  hosted-vs-local divergence (`category-distribution-view/reviews/impl-review.md:181`).
- **Two findings remain PENDING and should not be assumed fixed**: the categories
  migration has no `begin;`/`commit;` wrapper, and the seed users' NULL auth-token
  columns (`data-foundation-rls/reviews/impl-review.md:23-60`).

## Corrections to standing documentation

1. **The Supabase CLI is not pinned in `devDependencies`.** `CLAUDE.md` and
   `test-plan.md:106` both say "pinned to `2.98.2` in `devDependencies`".
   `package.json:55` actually reads `^2.23.4`; the pin lives only in
   `package-lock.json:13359`. `npm ci` is therefore safe, but `npm install`,
   `npm update supabase`, or a Dependabot bump floats to 2.115.0 and silently
   reintroduces the grants trap with **no diff to any workflow file**. The whole
   safety argument rests on a pin that is not where the docs say it is.

2. **Supabase's grant behaviour is a dated deprecation, not a CLI bug.** Verified
   against the official breaking-change discussion: the opt-out became available
   2026-04-28, became the default for new projects 2026-05-30, and applies to **all
   existing projects on 2026-10-30**. Existing tables keep their grants; only **new**
   tables in `public` will require explicit `GRANT`s. Consequences here:
   - **No migration in this repo grants any table-level privilege** — only function
     `EXECUTE` (`20260816103000:66`, `20260816150000:88`, `20260818090000:147`). The
     tables rely entirely on implicit grants.
   - The escape hatch `[api] auto_expose_new_tables = false` needs CLI **≥ 2.102.0**;
     this repo is on 2.98.2, so it cannot currently set it.
   - `lessons.md:15-23` remains correct as written — 2.114.0 *was* the wrong CLI for
     a 2.98.2 lockfile, and reverting *was* right — but its rule acquires an expiry
     date. After the deprecation lands, a grants migration becomes the **correct**
     answer rather than the broken-environment accommodation it was in August.
     The reference migration shape in `CLAUDE.md` will need a `grant` line.

3. **`text.ts`'s `slice` defect is already fixed** (`receipts.ts:174`). A test pins
   the fix; it does not catch a live bug.

## Live environment findings

- **`docker ps` shows a Supabase stack labelled `krzysztof`, not `paper-trail`**,
  publishing exactly the ports `config.toml` claims (54321/54322/54327). This is
  CLAUDE.md's sibling-worktree trap, live: `npx supabase test db` from this directory
  can talk to **another project's database**. A genuine argument for moving the suite
  to CI — and a reason CI green will not validate a developer's local setup.
- Installed CLI verified as **2.98.2** (correct); registry latest is 2.115.0.
- HEAD `c2b8781` equals `origin/master`; working tree has `CLAUDE.md` modified and
  `context/foundation/test-plan.md` untracked.

## Accepted risks this change should not re-litigate

- **A real, password-authenticatable demo account exists in production.**
  `supabase/migrations/20260816120000_seed_demo_account.sql:24-55` inserts
  `demo@papertrail.app` with `email_confirmed_at = now()` and a committed bcrypt
  digest, via the one path that reaches hosted. This was **deliberate and
  documented** — the header (`:10-13`) acknowledges the public repo, states the
  plaintext was handed over out of band, and gives the removal procedure (`:20-22`).
  Two observations rather than objections: it writes into `auth.*` during the deploy
  window, which `20260816151000:26-31` itself flags as capable of aborting a deploy;
  and its data window is pinned to `2026-05-16 .. 2026-08-16`, which **expired five
  days ago**, so most range presets now render empty for that account.
- Receipt-endpoint quota drain and receipt text reaching Workers Logs — both recorded
  as accepted (`test-plan.md:207-230`).

## Open Questions

1. **Does Phase 1 build the old-Worker-vs-new-schema gate, or accept pgTAP as the
   tripwire?** Research says the loaded trigger is safe and pgTAP catches the colour
   drop loudly. Building a real Face-B gate requires introducing a "last deployed
   SHA" concept that does not exist in this repo. **Recommendation: accept pgTAP for
   Phase 1**, and record Face B explicitly as uncovered rather than letting a green
   job imply it is covered.
2. **Should the incremental `db push` path be gated too?** The proposed job proves
   from-scratch apply only, and the incremental path is what `deploy-plan.md:303`
   describes. Gating it needs a shadow database seeded to the last-deployed schema.
3. **Fix the `package.json` caret to a hard pin?** Cheap, and the current safety
   argument depends on it.
4. **What is the decision before 2026-10-30 on table grants?** Options: bump the CLI
   to ≥2.102.0 and set `auto_expose_new_tables = false`; or start adding explicit
   `grant` lines to the reference migration shape. Either way `CLAUDE.md` and
   `lessons.md` need amending. This is outside Phase 1's scope but has a deadline
   inside the project's horizon.
5. **Wall-clock cost of `supabase start` in CI is unmeasured** — it gates whether this
   runs on every PR or only on `master`.
6. ~~**Does `getViteConfig` actually resolve `astro:env/server` under the Cloudflare
   adapter?**~~ **ANSWERED — no.** See *Addendum: OQ6 spike result* below.

## Addendum: OQ6 spike result (2026-08-21, plan Phase 4)

**Answer: NO — not with `adapter: cloudflare()` loaded.** `getViteConfig` never gets
as far as resolving anything: Vitest fails at **startup**, before module resolution.
The blocker is not Astro and not `astro:env` — it is `@cloudflare/vite-plugin`
rejecting an option Vitest itself sets.

**Observed against**: `astro@6.3.1`, `vitest@4.1.11`, `vite@7.3.3`,
`@astrojs/cloudflare@13.5.0`, `@cloudflare/vite-plugin@1.36.3`, Node v22.14.0.

**Probe**: a scratch `src/lib/spike-env.test.ts` importing `@/lib/config-status`
(`:1` is a *value* import of `astro:env/server`, so it is the minimal blocked
module), run under four scratch configs. All scratch files deleted afterwards; only
this finding is committed.

| # | Config | Command | Result |
|---|---|---|---|
| A | the shipped standalone `vitest.config.ts` | `npx vitest run src/lib/spike-env.test.ts` | ❌ `Error: Cannot find package 'astro:env/server' imported from src/lib/config-status.ts` — baseline, confirms the probe is genuinely blocked |
| B | `getViteConfig({ test })`, real `astro.config.mjs` (adapter present) | `npx vitest run --config vitest.spike.config.ts` | ❌ **Startup Error** — `The following environment options are incompatible with the Cloudflare Vite plugin: "ssr" environment: resolve.external: [...]` at `validateWorkerEnvironmentOptions` (`@cloudflare/vite-plugin/dist/index.mjs:48511`) |
| C | `getViteConfig({ test }, { configFile: false, output: "server", env: { schema } })` — identical project minus the adapter | `npx vitest run --config vitest.spike2.config.ts` | ✅ **1 passed** — `astro:env/server` resolves, and `@/*` resolves too without an explicit alias |
| D | as C, with `.astro/` moved aside first | same | ✅ **1 passed**, and `.astro/` was **not** regenerated |
| E | as B, plus `environments.ssr.resolve.external: []` in user config | `npx vitest run --config vitest.spike3.config.ts` | ❌ identical startup error — Vitest re-applies `resolve.external` after user config, so there is no user-config escape hatch |

**What each cell establishes:**

- **The adapter is the whole variable.** C vs B is a single-variable diff. Astro's
  Vitest integration works exactly as documented; `@astrojs/cloudflare` pulls in
  `@cloudflare/vite-plugin`, which validates the resolved Vite config and hard-fails
  on any `resolve.external` in a Worker environment. Vitest sets that list (the ~110
  Node builtins) unconditionally for its `ssr` environment. The two are structurally
  incompatible at these versions.
- **`npx astro sync` is NOT a precondition** (D). `astro:env/server` is generated by
  Astro's Vite plugin from the `env.schema` at config-resolution time. `.astro/` holds
  *type* declarations only — needed by `tsc` / `astro check` / type-aware ESLint,
  irrelevant to runtime resolution under Vitest.
- **`getViteConfig` supplies `@/*` for free** (C) — it reads `tsconfig.paths`. The
  explicit `resolve.alias` in the shipped `vitest.config.ts` is required *because* we
  are standalone, not as belt-and-braces.
- **No cheap workaround exists** (E). Anything that works has to remove the Cloudflare
  plugin from the Vitest config — i.e. `configFile: false` plus re-declaring what is
  needed, which forfeits `astro.config.mjs`'s integrations and Vite settings.

**Implication for test-plan Phase 2 (`receipts.ts`)**: unchanged and unblocked. The
services Phase 2 actually targets — `services/categories.ts`, `services/entries.ts`,
`services/reports.ts` — import zero Astro virtual modules and take a
`SupabaseClient` as a parameter, so they run under the shipped standalone config with
a stub client. `receipts.ts:3` is the one genuinely blocked module. Two live routes
for it, neither requiring this question to be reopened: extract the pure parsing /
mapping logic away from the `astro:env/server` import (cheapest, and the same shape
`text.ts` already demonstrates), or give the standalone config a `resolve.alias`
stub for `astro:env/server`. Do **not** budget for `getViteConfig`.

**Implication for test-plan Phase 5 (React `resolve.dedupe`)**: this is where the
answer costs something. Phase 5 wanted `getViteConfig` to inherit
`astro.config.mjs:25-27`'s `resolve.dedupe: ["react", "react-dom"]` — the fix
documented there as preventing a real `useHostTransitionStatus` hydration crash.
That inheritance is not available. Phase 5 must **restate** `dedupe` (and the React
plugin, and `environment: "jsdom"`) in the standalone Vitest config, and accept that
it is now a second copy that can drift from `astro.config.mjs`. Worth a comment in
both files pointing at the other. Re-check on any `@cloudflare/vite-plugin` or
Vitest major bump — the incompatibility is a validation rule, not a design decision,
and could be relaxed upstream.

## Related Research

- `context/foundation/test-plan.md` — §2 risk #4 and its Risk Response row (`:67`); §3 Phase 1 (`:79`); §4 stack candidates now resolved (`:103-107`)
- `context/deployment/deploy-plan.md:215`, `:303`, `:369` — the first-deploy incident, the stated gap, and verification step 4a
- `context/foundation/lessons.md:15-23` — the CLI trap, now with an expiry date
- `context/archive/2026-08-15-data-foundation-rls/` — the rejected CI decision and the pgTAP impersonation mechanic
- `context/archive/2026-08-17-category-icons/plan.md:382-388` — the `category-color-drop` checklist
