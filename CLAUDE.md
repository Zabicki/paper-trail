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

**Hosted linking is still outstanding.** `supabase link --project-ref <ref>` has never been run against the hosted project (needs the DB password) — migrations exist only locally so far. Run `supabase link` then `supabase db push` before any slice needs a real signed-in user against production. See `context/deployment/deploy-plan.md` Phase 4.

## Conventions

- **Path alias**: `@/*` → `./src/*`.
- **Astro components** for static content/layout; **React** only where interactivity is required. No Next.js directives (`"use client"` etc.).
- **Tailwind**: merge classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge); don't concatenate class strings.
- **shadcn/ui**: `src/components/ui/`, "new-york" style, `neutral` base, lucide icons. Add via `npx shadcn@latest add [name]`.
- **API routes**: uppercase `GET` / `POST` exports, validate input with zod.
- **Placement**: hooks → `src/components/hooks/`; services/helpers → `src/lib/` (business logic in `src/lib/services/`); shared entities and DTOs → `src/types.ts`. The last three don't exist yet — create them when first needed rather than inventing a different layout.
- ESLint runs `strictTypeChecked` + `stylisticTypeChecked` + `react-compiler` as **errors**. `no-console` is a warning. Unused vars are allowed only with a `_` prefix.
- UI copy in the existing scaffold is a mix of Polish (`config-status.ts` banner) and English. Confirm the intended language with the user before adding user-facing strings.

## Environment & deploy

- Node v22.14.0 (`.nvmrc`) — `nvm use` before building; CI pins Node 22 too.
- Local dev secrets: `.env` for Node tooling, **`.dev.vars` for Cloudflare workerd** (what `npm run dev` actually reads). Both gitignored; copy from `.env.example`.
- Local Supabase: `npx supabase start` (needs Docker, ~7 GB RAM); Studio at `http://localhost:54323`. Turn off Authentication → Email → Confirm email locally to sign in immediately after signup.
- Deploy: `npm run build` then `npx wrangler deploy`; set secrets via `npx wrangler secret put`. Production promotion is a **manual human action** — there is no CI deploy job by design.

**`context/deployment/deploy-plan.md` is the deployment runbook.** Read it before touching `wrangler.jsonc`, deploy commands, or anything about secrets and monitoring. Two traps it documents:

- **`assets.directory` must stay `./dist/client`.** The adapter writes its own config to `dist/server/wrangler.json`; wrangler bridges the two through the gitignored `.wrangler/deploy/config.json` that only a local build produces. Setting it to `./dist` would publish `dist/server/.dev.vars` as a public asset.
- **A deploy with unset secrets succeeds and serves a silently auth-disabled site.** Both env vars are `optional: true` and `createClient()` returns `null`, so `/dashboard` just redirects forever with only the red config banner as a signal. A green deploy is not evidence that secrets resolved.

## CI

`.github/workflows/ci.yml` runs `npm ci` → `npx astro sync` → lint → build on `master` (the working branch). Remote: `github.com/Zabicki/paper-trail`. Verified green.

The workflow passes `SUPABASE_URL` / `SUPABASE_KEY` from repo secrets, but **they are not required** — both are `optional: true`, so the build passes with them unset (confirmed on the first runs, which had no secrets configured). Set them only if a future build step genuinely needs to reach Supabase.

## Working docs (`context/`)

`context/foundation/` holds cross-change living docs (PRD, tech-stack, shape-notes) — edit in place, don't create dated copies. `context/changes/<change-id>/` holds change-scoped artifacts (plan, research, review), archived to `context/archive/` when done. The `/10x-*` skills in `.claude/skills/` read and write these.
