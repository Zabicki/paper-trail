# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

- **RLS on day one.** Every new table gets row-level security enabled in the same migration that creates it, with granular per-operation, per-role policies. Per the tech-stack doc, the PRD's per-user data isolation guarantee **fails silently** otherwise — nothing errors, the data just leaks across users. See [Data layer](#data-layer).
- **`createClient()` can return `null`.** `src/lib/supabase.ts` returns `null` when either Supabase env var is missing. Every caller must null-check — see `src/pages/api/auth/signin.ts` (redirects with an error) and `src/middleware.ts` (falls back to `locals.user = null`). Follow this pattern for any new Supabase-backed code path. See [Env vars](#env-vars-are-optional-by-design).
- **Never add `export const prerender = false`.** It is a no-op under `output: "server"`. Use `prerender = true` only to opt a specific page *into* static generation.
- **`Cache-Control: private, no-store` on every authenticated response.** `src/middleware.ts` sets it for protected routes and for any request with a signed-in user; keep it that way. RLS guards the *database* — it does nothing about a rendered SSR page cached at Cloudflare's edge and served to a different user. This is a second, independent path to the same isolation guarantee failing, and like the RLS failure it is **silent**. See [Deployment](#deployment).
- **`Astro.locals.runtime` does not exist.** `@astrojs/cloudflare` v13 removed it; access bindings directly. Nearly every Astro-on-Cloudflare tutorial and snippet predates this, so it is the most likely wrong thing to reach for — and it fails at *runtime inside workerd*, not at type-check.
- **No native modules on workerd.** `sharp` and friends cannot run. For image work use the Cloudflare Images binding (`env.IMAGES`, already bound — see `astro.config.mjs`) or resize client-side before upload.
- **Use `astro dev`, never `wrangler dev`.** At adapter v13 `astro dev` already runs on workerd via the Cloudflare Vite plugin. Mixing the two produces confusing env-var behaviour, since workerd reads `.dev.vars` and not `.env`.

## What this project is

**PaperTrail** — a multi-user personal expense/income tracker replacing a sprawling Google Sheet. The binding product constraint is *input friction*: logging a day's spending must take minimal taps. Core scope: user-defined categories, day-contextualized entry with back-dating, date-range and category-distribution charts, a filter that excludes large recurring costs (rent, car payments) so day-to-day patterns become visible, and AI receipt parsing that assigns line items into the *user's own* categories.

Read `context/foundation/prd.md` before non-trivial feature work — it holds the numbered functional requirements (FR-xxx), non-goals, and success criteria. `context/foundation/tech-stack.md` records why this stack was chosen.

**The repo is still substantially the `10x-astro-starter` scaffold.** The project has been renamed to `paper-trail` (`package.json`, `wrangler.jsonc`, `supabase/config.toml` `project_id`), but `README.md` is still the starter's README, and `src/pages/index.astro` and `src/components/Welcome.astro` are template content. None of the PaperTrail domain (expenses, categories, receipts) exists yet. Treat existing `src/` code as reference for conventions, not as product code.

## Commands

- `npm run dev` — dev server (Cloudflare workerd runtime, not Node)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules
- `npm run format` — Prettier (prettier-plugin-astro + prettier-plugin-tailwindcss)
- `npx astro sync` — regenerates `.astro/types.d.ts`. **Run this after a fresh clone or after changing the `env.schema` in `astro.config.mjs`**, otherwise `astro:env/server` imports fail to type-check and lint errors out.

**There is no test framework installed.** No vitest/playwright/jest, no test script, no test files. If tests are wanted, that's a setup decision to raise with the user rather than assume.

Pre-commit (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.

## Architecture

Astro 6 SSR + React 19 islands + Tailwind 4 + Supabase auth + shadcn/ui, deployed to Cloudflare Workers.

### Rendering

`output: "server"` — every page is server-rendered by default. See [Hard rules](#hard-rules) for the `prerender` rule.

### Env vars are optional-by-design

`SUPABASE_URL` / `SUPABASE_KEY` are declared `optional: true` in the `astro.config.mjs` `env.schema`, so the app boots and builds without them. Two consequences that shape the code:

- `createClient()` in `src/lib/supabase.ts` **returns `null`** when either var is missing — see [Hard rules](#hard-rules).
- `src/lib/config-status.ts` exports `missingConfigs`, which `Layout.astro` renders as a red banner. Adding a new required integration means adding an entry there, not silently failing.

Both vars are `context: "server", access: "secret"` — never reachable from client code.

### Auth flow

- `src/middleware.ts` runs on every request, resolves the user into `context.locals.user` (typed in `src/env.d.ts`), and redirects unauthenticated requests for anything in `PROTECTED_ROUTES`. **Add new protected paths to that array** — it's prefix-matched via `startsWith`.
- Endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`. They read `FormData` and redirect with `?error=` rather than returning JSON, so the auth forms work without JS.
- Pages: `src/pages/auth/{signin,signup,confirm-email}.astro`; `src/pages/dashboard.astro` is the protected-page example.

### Data layer

`supabase/migrations/` holds one migration per schema change, named `YYYYMMDDHHmmss_short_description.sql` (e.g. `20260815125827_create_categories_table.sql`, the `categories` table from F-01). Every new table's migration enables RLS in that same file — never a follow-up migration — with four granular per-operation policies scoped `to authenticated`, keyed on `(select auth.uid()) = user_id`. The `(select ...)` wrapping matters: it evaluates `auth.uid()` once per statement instead of once per row. `user_id` columns default to plain `auth.uid()` at the column level (no subquery wrapper there — Postgres column defaults can't contain one) and reference `auth.users(id) on delete cascade`. See `categories`' migration for the reference shape every later table copies.

RLS is verified by an actual pgTAP suite (`supabase/tests/*_test.sql`, run via `npx supabase test db`), not assumed. Tests impersonate the two fixed seed users in `supabase/seed.sql` via `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` — a superuser session otherwise bypasses RLS entirely. This verification is local-only; it does not run in CI.

**Migrations reach the hosted database only through the `deploy` job.** `supabase/migrations/*.sql` are applied locally by `supabase start` / `supabase db reset`; nothing else in the pipeline touches the hosted schema. `.github/workflows/ci.yml` runs `supabase link` + `supabase db push` between the build and `wrangler deploy` — schema before code, so every migration must be backward-compatible with the *previous* Worker version. This gap is what broke the first deploy: the Worker shipped against an empty `public` schema, auth worked (the `auth.*` schema is Supabase's, not ours), and every data route 500'd with `Could not find the table 'public.categories' in the schema cache`. **A green deploy is not evidence the schema matches the code.** Never pass `--include-seed` — `supabase/seed.sql` inserts fixed test users into `auth.users`. See `context/deployment/deploy-plan.md` Phase 4 for the manual catch-up commands and the required secrets.

## Conventions

- **Path alias**: `@/*` → `./src/*`.
- **Astro components** for static content/layout; **React** only where interactivity is required. No Next.js directives (`"use client"` etc.).
- **Tailwind**: merge classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge); don't concatenate class strings.
- **shadcn/ui**: `src/components/ui/`, "new-york" style, `neutral` base, lucide icons. Add via `npx shadcn@latest add [name]`.
- **API routes**: uppercase `GET` / `POST` exports, validate input with zod.
- **Reading a fetch response**: `await response.json<T>()`, never `(await response.json()) as T`. The generic overload comes from `worker-configuration.d.ts` — generated by `npx wrangler types` and **committed**, because it is also what types the `env.IMAGES` binding. Regenerate it after changing bindings in `wrangler.jsonc`; don't hand-edit it.
- **Placement**: hooks → `src/components/hooks/`; services/helpers → `src/lib/` (business logic in `src/lib/services/`); shared entities and DTOs → `src/types.ts`. The last three don't exist yet — create them when first needed rather than inventing a different layout.
- ESLint runs `strictTypeChecked` + `stylisticTypeChecked` + `react-compiler` as **errors**. `no-console` is a warning. Unused vars are allowed only with a `_` prefix.
- UI copy in the existing scaffold is a mix of Polish (`config-status.ts` banner) and English. Confirm the intended language with the user before adding user-facing strings.

## Environment & deploy

- Node v22.14.0 (`.nvmrc`) — `nvm use` before building; CI pins Node 22 too.
- Local dev secrets: `.env` for Node tooling, **`.dev.vars` for Cloudflare workerd** (what `npm run dev` actually reads). Both gitignored; copy from `.env.example`.
- Local Supabase: `npx supabase start -x vector` (needs Docker, ~7 GB RAM); Studio at `http://localhost:54323`. Turn off Authentication → Email → Confirm email locally to sign in immediately after signup. The `vector` log-shipper container fails its health check and **aborts the whole `start`** — excluding it costs only local log aggregation.
- **Run `npm ci` before any `npx supabase` command.** The CLI is pinned to `2.98.2` in `devDependencies`, but with no `node_modules` present `npx` silently falls back to whatever is in the npx cache. That is not cosmetic: **CLI ≥ 2.114.0 stops granting `select/insert/update/delete` to `anon` / `authenticated` on new `public` tables**, so `supabase db reset` produces a database whose own app role cannot read its own tables. Same Postgres image (`17.6.1.106`) either way — the divergence is in the CLI's init step. Symptom: every pgTAP file fails with `permission denied for table …` before a single assertion runs, and `npm run dev` 403s on every data route. CI's `supabase/setup-cli@v1` pin of `2.114.0` is unaffected, because CI only does `link` + `db push` against hosted, where the grants already exist. Do NOT "fix" this with a grants migration — use the pinned CLI.
- **Sibling worktrees share this machine.** Each needs its own Supabase stack — set a distinct `project_id` in `supabase/config.toml` and distinct ports, or two worktrees will `db reset` each other's schema and you will chase a phantom "column X does not exist". Check with `docker ps --format '{{.Names}}'` before trusting a local database. `astro dev` auto-increments off `4321` when a sibling holds it, so **read the port out of the dev-server banner rather than assuming 4321**.
- Deploy: pushes to `master` deploy automatically via the `deploy` job in `.github/workflows/ci.yml`, gated by a required-reviewer approval on the `production` GitHub Environment — nothing reaches Cloudflare until that approval is given. Manual `npm run build` + `npx wrangler deploy` remains available for out-of-band fixes and rollback. Set Worker secrets via `npx wrangler secret put` — CI deploys never touch these; they're set once and persist across deploys.

**`context/deployment/deploy-plan.md` is the deployment runbook.** Read it before touching `wrangler.jsonc`, deploy commands, or anything about secrets and monitoring. Two traps it documents:

- **`assets.directory` must stay `./dist/client`.** The adapter writes its own config to `dist/server/wrangler.json`; wrangler bridges the two through the gitignored `.wrangler/deploy/config.json` that only a local build produces. Setting it to `./dist` would publish `dist/server/.dev.vars` as a public asset.
- **A deploy with unset secrets succeeds and serves a silently auth-disabled site.** Both env vars are `optional: true` and `createClient()` returns `null`, so `/dashboard` just redirects forever with only the red config banner as a signal. A green deploy is not evidence that secrets resolved.

**Receipt parsing (S-06) adds a third instance of that same trap.** `CF_AI_TOKEN` / `CF_ACCOUNT_ID` are also `optional: true`; unset, `/api/receipts/parse` answers 503 and the banner names the Gateway. Set them with `npx wrangler secret put` — CI never touches them, and `CF_ACCOUNT_ID` is *not* the build-time `CLOUDFLARE_ACCOUNT_ID` repo variable, which the Worker cannot read. The gateway id is hardcoded as `RECEIPT_GATEWAY_ID` in `src/lib/services/receipts.ts` and must name a real gateway with third-party (Unified Billing) credit funded on it; the auto-created `default` gateway has that switched off, and omitting the `cf-aig-gateway-id` header falls back to it.

## CI/CD

`.github/workflows/ci.yml` has two jobs. `ci` runs `npm ci` → `npx astro sync` → lint → build on every push and PR to `master` (the working branch); it's the merge gate. `deploy` runs only on pushes to `master` (`needs: ci`), targets the `production` GitHub Environment, rebuilds, applies pending Supabase migrations (`supabase/setup-cli@v1` pinned to `2.114.0` → `supabase link` → `supabase db push`, using the `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` / `SUPABASE_PROJECT_REF` environment secrets), then runs `cloudflare/wrangler-action@v3` (`wrangler deploy`) using `CLOUDFLARE_API_TOKEN` (environment secret) and `CLOUDFLARE_ACCOUNT_ID` (repo variable). Because the job targets `environment: production`, GitHub pauses it for a required-reviewer approval in the Actions UI before the secrets are injected and the deploy runs. Migrations are deliberately placed after the build (a compile failure must not leave production migrated with no matching code) and before the deploy (the Worker must never serve against a schema it expects to exist). Nothing validates migrations on PRs — that needs Docker; correctness is still only proven locally via `supabase db reset` and `npx supabase test db`. Remote: `github.com/Zabicki/paper-trail`.

The workflow passes `SUPABASE_URL` / `SUPABASE_KEY` from repo secrets to both jobs' build steps, but **they are not required for the build** — both are `optional: true`, so the build passes with them unset. They matter at runtime, not build time; the actual Worker-side values are set once via `wrangler secret put` and are untouched by CI.

## Working docs (`context/`)

`context/foundation/` holds cross-change living docs (PRD, tech-stack, shape-notes) — edit in place, don't create dated copies. `context/changes/<change-id>/` holds change-scoped artifacts (plan, research, review), archived to `context/archive/` when done. The `/10x-*` skills in `.claude/skills/` read and write these.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 3

Lesson 3 is about **hooks** — turning the quality gates from Lesson 1 and the tests from Lesson 2 into automatic, deterministic checks that fire while the agent works. A hook runs outside the model, so it survives context compression, instruction changes, and the model "forgetting". The payoff for agentic hooks specifically: a `PostToolUse` check can feed its result back into the agent's context, so the agent fixes trivial errors (formatting, a missing import, a wrong type) on its own in the next iteration instead of you discovering them minutes later.

```
context/foundation/test-plan.md  (§4 Quality Gates: which check, required when)
        │
        ▼  (assign each gate to the cheapest layer that still gives signal)
   per-edit (agent hooks)  →  pre-commit (git hooks)  →  pre-push  →  CI
        │ lint, format, scoped tests          │ staged       │ heavier    │ integration
        ▼
   exit code + stdout  →  additionalContext  →  agent reacts next turn
```

### Task Router — Which layer for this check

| You want to | Do this |
| --- | --- |
| React the instant the agent edits a file | A per-edit hook (`PostToolUse` matcher `Write\|Edit` in Claude Code). Right for fast checks: lint/format, and scoped tests on risk-area files. This is the **only** layer that can hand feedback to the agent mid-session. |
| Run only the tests that depend on the edited file | Parse the path from the hook's stdin (`jq -r .tool_input.file_path`) and run your runner's related-tests mode (`vitest related "$FILE" --run`, `jest --findRelatedTests $FILE`). Gate it on whether the file is a risk area in `test-plan.md`; don't run tests on every helper or config edit. |
| Catch changes that bypassed the agent (manual edits, a teammate's commit) | A pre-commit git hook (Lefthook or Husky+lint-staged) over staged files: lint + typecheck, and tests on staged risk files. |
| Run heavier checks before code leaves the machine | Pre-push: full typecheck or a broader test set. Anything too slow for per-edit moves here. |
| Decide where a given gate belongs | Ask: is it fast enough (a few seconds) for per-edit, or should it wait for commit/push/CI? Slow checks block the agent loop on every edit — push them up a layer. |
| Use the same hook across tools | The trigger → matcher → handler → signal pattern is the same in Cursor, Codex, Windsurf, and Copilot; only the config file and event names change. See the cross-tool table below. |

### Hook lifecycle — the universal pattern

Every tool's hooks follow four steps:

1. **Trigger** — an event in the tool (e.g. the agent just saved a file: `PostToolUse`).
2. **Matcher** — a filter deciding whether this hook runs (tool name like `Write`/`Edit`, file type, or a name pattern).
3. **Handler** — the action that runs, usually a shell command.
4. **Signal** — the result returns to the tool. The exit code says pass/fail; stdout can flow into the agent's context as feedback.

### Exit codes and the feedback loop

- **0** — success; the hook passed, continue.
- **2** — blocking error; the agent sees the feedback and should react.
- **anything else** — non-blocking error; logged, but does not interrupt work.

On a blocking failure, stdout flows into the agent's context (in Claude Code via `additionalContext`, capped at 10,000 characters; other tools have similar mechanisms with their own limits). That is why the agent can self-correct: it sees the concrete message — missing type, unimported module, badly formatted line — not just "something failed".

The boundary: the agent reliably fixes **trivial** corrections on its own. When a test fails because of wrong business logic, the hook surfaces it but the agent may not diagnose the real cause — it says "something is off" and tries a trivial fix. If that does not resolve in one or two tries, the signal comes back to you, and the problem may deserve its own change-id with the full `/10x-new → /10x-research → /10x-plan → /10x-implement` workflow.

### Three local layers (plus CI)

| Layer | Catches | Timing |
| --- | --- | --- |
| Per-edit (agent hooks) | Formatting, simple type errors, failing unit tests on risk files. Only layer that feeds the agent mid-work. | ms–s |
| Pre-commit (git hooks) | What slipped past per-edit: manual edits, files changed outside the hook, checks too slow for per-edit. Operates on staged files. | s |
| Pre-push | Heavier checks before pushing to remote (full typecheck, broader test set). | s–min |
| CI | Integration problems, cross-module dependencies, checks needing infra unavailable locally. | min |

Local layers do **not** replace CI — CI stays the key verification for shared repo state and environments you don't control. But each local layer that catches an error is one fewer CI round-trip. You don't need all layers from day one: start with one per-edit hook (lint) and one commit gate, add layers as you see what escapes. The quality gates in `test-plan.md §4` decide which checks are worth automating and when; a plan may legitimately defer per-edit hooks if the cost/signal ratio isn't there yet.

### Key rules

- Keep per-edit hooks fast. If a check takes more than a few seconds, move it to commit, push, or CI — a slow per-edit hook blocks the agent loop on every edit. Lint/format are ideal per-edit; full typecheck is often a commit gate in larger projects.
- Run scoped tests, not the whole suite, per edit — only tests related to the edited file, and only when that file is a risk area in `test-plan.md`.
- `related` is a subcommand, not a flag (`vitest related`, not `--related`). Use `--run` so the hook terminates instead of entering watch mode.
- `PostToolUse` fires once per tool use; three edits in one turn fire it three times independently — there is no built-in aggregation.
- The git hook tool (Lefthook vs Husky+lint-staged) is an implementation detail; the rule is the same — run checks on staged files before commit. If Husky already works, don't migrate.
- **Context injection is not universal.** Claude Code, Cursor, Codex, and Copilot (in VS Code) can pass a hook's result to the agent; Windsurf cannot — it can block (exit 2) but can't tell the agent what went wrong.

### The same pattern in every tool

| Tool | Events | Handlers | Context injection | Config |
| --- | --- | --- | --- | --- |
| Claude Code | ~30 | command, http, mcp_tool, prompt, agent | yes | `.claude/settings.json` |
| Cursor | ~18 | command, prompt | yes | `.cursor/hooks.json` |
| Codex | 10 | command | yes | `.codex/hooks.json` |
| Windsurf | 12 | command | **no** | `.windsurf/hooks.json` |
| Copilot | ~13 | command, http, prompt | yes (VS Code) | `.github/hooks/*.json` |

### Lesson boundaries

- This lesson configures hooks and local quality layers only. The hook JSON, `lefthook.yml`, and the per-edit/commit/push layering are the scope.
- Do not write E2E tests, configure Playwright/MCP, or run browser scenarios. That is Lesson 4.
- Do not run the bug-to-fix-to-regression-test debugging workflow. That is Lesson 5.
- Do not change the risk strategy or quality-gate definitions. That is Lesson 1 (`/10x-test-plan`); read current state with `/10x-test-plan --status`.
- Do not write unit/integration test code from scratch here. That is Lesson 2 — hooks only *run* the tests those lessons produced.
- Do not author CI/CD pipelines. That is Module 1 Lesson 5 / Module 2 Lesson 5; hooks are the local layers in front of CI.

### Paths used by this lesson

- `.claude/settings.json` — hook configuration (`~/.claude/settings.json` global, `.claude/settings.json` project, `.claude/settings.local.json` local overrides). Other tools use their own config file (see the table).
- `lefthook.yml` — pre-commit git hook config (lint + typecheck + tests on `{staged_files}`).
- `context/foundation/test-plan.md` — §4 quality gates decide which checks to automate and at which layer; risk areas decide which edits warrant scoped tests.

<!-- END @przeprogramowani/10x-cli -->
