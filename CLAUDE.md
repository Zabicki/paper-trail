# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

- **RLS on day one.** Every new table gets row-level security enabled in the same migration that creates it, with granular per-operation, per-role policies. Per the tech-stack doc, the PRD's per-user data isolation guarantee **fails silently** otherwise — nothing errors, the data just leaks across users. See [Data layer](#data-layer-not-yet-built).
- **`createClient()` can return `null`.** `src/lib/supabase.ts` returns `null` when either Supabase env var is missing. Every caller must null-check — see `src/pages/api/auth/signin.ts` (redirects with an error) and `src/middleware.ts` (falls back to `locals.user = null`). Follow this pattern for any new Supabase-backed code path. See [Env vars](#env-vars-are-optional-by-design).
- **Never add `export const prerender = false`.** It is a no-op under `output: "server"`. Use `prerender = true` only to opt a specific page *into* static generation.

## What this project is

**PaperTrail** — a multi-user personal expense/income tracker replacing a sprawling Google Sheet. The binding product constraint is *input friction*: logging a day's spending must take minimal taps. Core scope: user-defined categories, day-contextualized entry with back-dating, date-range and category-distribution charts, a filter that excludes large recurring costs (rent, car payments) so day-to-day patterns become visible, and AI receipt parsing that assigns line items into the *user's own* categories.

Read `context/foundation/prd.md` before non-trivial feature work — it holds the numbered functional requirements (FR-xxx), non-goals, and success criteria. `context/foundation/tech-stack.md` records why this stack was chosen.

**The repo is still the unmodified `10x-astro-starter` scaffold.** `package.json` `name`, `wrangler.jsonc` `name`, and `supabase/config.toml` `project_id` all still say `10x-astro-starter`; `README.md` is the starter's README; `src/pages/index.astro` and `src/components/Welcome.astro` are template content. None of the PaperTrail domain (expenses, categories, receipts) exists yet. Treat existing `src/` code as reference for conventions, not as product code.

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

### Data layer (not yet built)

No tables and no `supabase/migrations/` directory exist — only `supabase/config.toml`. Migrations go in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`. The RLS requirement is in [Hard rules](#hard-rules).

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

- Node v22.14.0 (`.nvmrc`).
- Local dev secrets: `.env` for Node tooling, **`.dev.vars` for Cloudflare workerd** (what `npm run dev` actually reads). Both gitignored; copy from `.env.example`.
- Local Supabase: `npx supabase start` (needs Docker, ~7 GB RAM); Studio at `http://localhost:54323`. Turn off Authentication → Email → Confirm email locally to sign in immediately after signup.
- Deploy: `npm run build` then `npx wrangler deploy`; set secrets via `npx wrangler secret put`.

## CI

`.github/workflows/ci.yml` runs `npm ci` → `npx astro sync` → lint → build. It needs `SUPABASE_URL` / `SUPABASE_KEY` repo secrets.

⚠️ It triggers only on `master`, but the working branch is `main` — as configured, **CI never runs**. Fix the branch filter or rename the branch.

## Working docs (`context/`)

`context/foundation/` holds cross-change living docs (PRD, tech-stack, shape-notes) — edit in place, don't create dated copies. `context/changes/<change-id>/` holds change-scoped artifacts (plan, research, review), archived to `context/archive/` when done. The `/10x-*` skills in `.claude/skills/` read and write these.
