---
project: PaperTrail
doc: deploy-plan
version: 1
status: ready-to-execute
created: 2026-08-15
platform: Cloudflare Workers
worker_name: paper-trail
plan: Free
deploy_trigger: manual (npx wrangler deploy)
sources:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
---

# First Deployment Plan — PaperTrail → Cloudflare Workers

## Execution status — first deploy completed 2026-08-15

**Live: https://paper-trail.paper-trail.workers.dev** · account `fc458ce6796b08efb77e342a9a946906` · repo `github.com/Zabicki/paper-trail`

| Phase | Status |
|---|---|
| 0 — Git baseline | ✅ Branch renamed to `master`; index cleaned; scaffold committed as rollback point (`b7f8aa9`) |
| 1 — Rename to `paper-trail` | ✅ `package.json`, `package-lock.json`, `wrangler.jsonc`, `supabase/config.toml` |
| 2a — Pin `SESSION` KV | ✅ `df70b747…` (prod) + `ca58c768…` (preview). **A `previews` block was also required** — see below |
| 2b — `assets.directory` | ✅ `./dist/client`, reason inline in `wrangler.jsonc` |
| 2c — Images binding | ✅ Kept deliberately; rationale in `astro.config.mjs` |
| 2d — `compatibility_date` | ✅ Left at `2026-05-08` |
| 3 — Cache-Control guardrail | ✅ `src/middleware.ts`, covering the redirect path too |
| 4 — Supabase project | ✅ Hosted project live and wired. `supabase link` **deferred** — it needs the DB password and buys nothing while `supabase/migrations/` is empty |
| 5 — Secrets | ✅ `SUPABASE_URL` + `SUPABASE_KEY` set via `wrangler secret put`; `.dev.vars` and `.env.example` documented |
| 6 — Pre-flight | ✅ Node 22.14.0 installed; lint clean; **391.09 KiB gzip**; startup **22 ms measured on Cloudflare** |
| 7 — First deploy | ✅ Version `363f42fd`, then `42f87e27` auto-deployed on secret change |
| 8 — Post-deploy config | ✅ `site` set and sitemap emitting; Supabase Site URL / Redirect URLs set |
| 9 — CI | ✅ Green on `master`. Repo secrets turned out **not** to be required |
| 10 — Monitoring | ✅ `observability.enabled: true`; weekly cadence — see below |
| 11 — Doc corrections | ✅ `CLAUDE.md`, `tech-stack.md`, `infrastructure.md` |

Bundle baseline moved 390.44 → **391.09 KiB gzip** (+0.65 KiB, the Cache-Control guardrail). Use 391.09 KiB as the regression baseline.

### Findings from execution

**Preview bindings are injected separately from top-level ones.** Pinning `kv_namespaces` was not enough — the adapter calls `getNonInheritableBindings(config.previews)` independently, so `wrangler versions upload` still received a bare id-less `SESSION` binding. A `previews.kv_namespaces` block in `wrangler.jsonc` is required as well. Both blockers predicted before execution were confirmed real.

**`wrangler versions upload` cannot be the first deploy.** It fails with "You cannot upload a new version of a Worker that does not yet exist." The preview-first sequence in Phase 7 applies from the *second* deploy onward; the first must be `wrangler deploy`.

**CI does not need the Supabase repo secrets.** Both env vars are `optional: true`, so `npm run build` passes with them unset — confirmed by two green runs made before any secret existed. `CLAUDE.md` previously claimed otherwise.

### ⚠️ `*.workers.dev` is blocked on the Ocado corporate network

Requests from the corporate network return `303 → blocked.teams.cloudflare.com` with `block_reason=DNS Default Deny [BLOCKED DOMAINS LIST]`. This is Cloudflare Gateway policy, unrelated to the deployment, and it means **the deployed app cannot be reached or tested from a work machine on that network.** Options, in rough order of effort:

1. Test from an unblocked network (personal device off corporate DNS).
2. Request an unblock at `links.ocado.com/site-unblock`.
3. ~~Custom domain.~~ **Considered and declined 2026-08-15.** It would have cost ~$11/yr, was not guaranteed to help (newly-registered-domain policies commonly block fresh domains for ~30 days), and would not have fixed `wrangler tail` anyway, since tailing goes through `tail.developers.workers.dev` regardless of the app's domain. Revisit only if a domain is wanted for product reasons.

**Working arrangement:** stay on `workers.dev` and **turn the VPN off when the deployed app or `wrangler tail` is needed.** The block is intermittent purely as a function of VPN state — it was observed flipping mid-session, which is also what turned one `wrangler versions deploy` into a bare `fetch failed`. If a Cloudflare command fails with `fetch failed`, a 303, or `SELF_SIGNED_CERT_IN_CHAIN`, check the VPN before debugging anything else.

**`wrangler tail` is blocked too — same root cause.** Its WebSocket endpoint is `tail.developers.workers.dev`, which falls under the same category deny. Debugging this took two steps, both worth recording:

1. First symptom was `Error: self-signed certificate in certificate chain` (`SELF_SIGNED_CERT_IN_CHAIN`). That is the corporate TLS-inspecting proxy, and it is *not* specific to Cloudflare — Node does not read the macOS keychain, so it rejects the Gateway/Ocado roots the OS already trusts. Fix:
   ```bash
   security find-certificate -a -p /Library/Keychains/System.keychain > ~/.config/certs/macos-system-roots.pem
   security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >> ~/.config/certs/macos-system-roots.pem
   export NODE_EXTRA_CA_CERTS=~/.config/certs/macos-system-roots.pem
   ```
   This bundle is already generated on the dev machine. Keep it in mind for **any** Node tool that hits the network from a corporate laptop, not just wrangler. Never reach for `NODE_TLS_REJECT_UNAUTHORIZED=0` instead — it disables verification globally.

2. With TLS fixed, the tail WebSocket then returned `Unexpected server response: 303` — the Gateway block page. So the DNS deny is the real wall, and no client-side fix gets past it.

**What still works from the corporate network:** `wrangler deploy`, `secret put/list`, `deployments list`, `kv namespace create`, and `versions upload` — these hit `api.cloudflare.com`, which is not blocked. Dashboard **Workers Logs**, **Metrics** and **Errors** also work in the browser, since the browser trusts the corporate CA. Only live `tail` and actually loading the app require an unblocked network.

## Purpose

`infrastructure.md` selected Cloudflare Workers and sketched a "Getting Started" sequence. Nothing has been deployed, and the repo is still the unmodified `10x-astro-starter` scaffold. This document is the executable runbook for the **first** deployment, and the living record of how PaperTrail is deployed thereafter.

Update this doc in place as deployment practice changes. Change-scoped work belongs under `context/changes/<change-id>/`.

### Decisions of record

| Decision | Choice | Rationale |
|---|---|---|
| Timing | Deploy the current scaffold now, before feature work | Proves secrets, KV, bindings, and the URL while no real data is at risk; de-risks the 2026-09-04 deadline |
| Deploy trigger | Manual `npx wrangler deploy` from the laptop | Matches `infrastructure.md`'s approval rule — a human promotes to production. No CI deploy job, no Cloudflare API token |
| Supabase | New hosted project, EU region | Local `npx supabase start` remains the dev database |
| Images binding | Keep, deliberately | Workerd-native receipt downscaling; `sharp` cannot run on workerd |
| Git branch | `master` | `.github/workflows/ci.yml` already targets it |

---

## Baseline measured in this repo

Verified against the working tree on 2026-08-15, not taken from platform documentation.

| Check | Result | Limit | Status |
|---|---|---|---|
| `wrangler deploy --dry-run` | Succeeds — 1911 KiB raw / **390.44 KiB gzip** | 3 MB gzip (Free) | ~87% headroom |
| Startup CPU | ~24 ms (per `infrastructure.md`) | 1 s | ~97% headroom |
| Bindings resolved | `SESSION` (KV), `IMAGES`, `ASSETS` | — | See blockers below |
| `wrangler` version | 4.123.0 | — | Newer than the 4.90 recorded in `infrastructure.md` |
| `wrangler whoami` | **Not logged in** | — | Blocks everything |
| Git state | No commits, no branches, no remote | — | Phase 0 |
| Active Node | v25.2.1 vs `.nvmrc` 22.14.0 | — | `nvm use` before building |
| `supabase/migrations/` | Does not exist; not linked; Docker not running | — | Auth-only deploy |
| `Cache-Control` in `src/middleware.ts` | **Absent** | — | Top risk unmitigated |

Re-run the two size/CPU checks before every deploy and treat the numbers above as the regression baseline.

## Two blockers not covered by `infrastructure.md`

Found by reading the adapter source and the generated config. These are the most likely first-deploy failures.

**1. The `SESSION` KV namespace has no id.**
`@astrojs/cloudflare` v13 auto-injects an Astro-sessions KV binding. Confirmed in `node_modules/@astrojs/cloudflare/dist/wrangler.js`, function `withSessionKVBinding`, which pushes `{ binding: "SESSION" }` with **no `id`**. It reaches `dist/server/wrangler.json` under both `kv_namespaces` and `previews.kv_namespaces`. A KV binding without an id either hard-fails the deploy or drops wrangler into an interactive auto-provisioning prompt. Fixed in Phase 2a.

**2. Root and generated configs disagree on `assets.directory`, and the root value is a data-exposure hazard.**
Root `wrangler.jsonc` says `"directory": "./dist"`. The adapter-generated `dist/server/wrangler.json` says `"../client"` (= `dist/client`). Wrangler bridges them through `.wrangler/deploy/config.json`, which is gitignored and written only by a local build. If that redirect is ever absent, the root config publishes **all of `dist/`** as public static assets — including `dist/server/.dev.vars` and `dist/server/wrangler.json`. The `.assetsignore` that would protect them lives in `dist/client/`, not `dist/`. Fixed in Phase 2b.

---

## Inputs required from the operator

None of these can be derived from the repo. Items 1–4 block the first deploy.

| # | Input | Where to get it | Blocks |
|---|---|---|---|
| 1 | Cloudflare account access | `npx wrangler login` (interactive, opens a browser) | Everything |
| 2 | `workers.dev` subdomain | Claimed on first deploy — account-wide and permanent. Decide the name before being prompted; the URL becomes `paper-trail.<subdomain>.workers.dev` | First deploy |
| 3 | Supabase project URL + `anon` key | supabase.com → new EU project (e.g. `eu-central-1`) → Settings → API. Save the DB password separately | Working auth |
| 4 | Supabase project ref | The `xxxx` in `https://xxxx.supabase.co` — needed for `supabase link` | Migrations |
| 5 | LLM API key | Deferred to the receipt-parsing feature — the operator does not hold a key yet, and PRD Open Question 4 (provider choice) is still open. When it lands: `npx wrangler secret put <KEY_NAME>`, add it to `astro.config.mjs` `env.schema` as `context: "server", access: "secret"`, and add an entry to `src/lib/config-status.ts` so a missing key surfaces in the banner instead of failing at request time | Nothing yet |

Secrets are supplied via `npx wrangler secret put`, which reads them interactively and never echoes them. **Do not paste secret values into chat, into this doc, or into any tracked file.**

---

## Phase 0 — Git baseline

The repo has zero commits, so there is currently no rollback point.

```bash
git branch -m master          # branch is unborn — pure ref rename, nothing to rewrite
git rm --cached .DS_Store     # staged despite being gitignored
```

Also drop the stale staged-then-deleted `src/index.ts` entry, then make the initial commit on `master`.

Renaming the branch (rather than editing the workflow) resolves the CI mismatch flagged in `CLAUDE.md` and `infrastructure.md`: `ci.yml` already triggers on `master`. No remote is needed for manual deploys — add one when CI is wanted (Phase 9).

## Phase 1 — Rename off the starter

Do this **before** the first deploy. Deploying first claims `10x-astro-starter.<subdomain>.workers.dev` and orphans a Worker on rename.

- `wrangler.jsonc` → `"name": "paper-trail"`
- `package.json` → `"name": "paper-trail"`
- `supabase/config.toml` → `project_id = "paper-trail"`

`tech-stack.md` already records `project_name: paper-trail`; this aligns the repo with the doc of record.

## Phase 2 — Fix the deploy-config hazards

All changes in `wrangler.jsonc`.

### 2a. Pin the `SESSION` KV namespace

```bash
npx wrangler kv namespace create SESSION
npx wrangler kv namespace create SESSION --preview
```

Add both returned ids:

```jsonc
"kv_namespaces": [
  { "binding": "SESSION", "id": "<id>", "preview_id": "<preview_id>" }
]
```

Declaring it explicitly short-circuits the adapter's id-less injection (`hasSessionBinding` in `withSessionKVBinding`). Pinning beats accepting auto-provisioning: it is deterministic, reviewable in git, and survives any future move to non-interactive CI.

### 2b. Correct `assets.directory`

Change `"./dist"` → `"./dist/client"` so root and generated configs agree and the exposure hazard cannot fire.

### 2c. Adopt the Images binding deliberately

Leave `cloudflare()` un-optioned so `IMAGES` stays bound — but record it here as *chosen*, not inherited, which is the specific failure mode `infrastructure.md` flags. Free cap is 5,000 transforms/month; error 9422 beyond it. This is the intended receipt-downscale path.

To reverse the decision later: `adapter: cloudflare({ imageService: { build: 'compile', runtime: 'passthrough' } })` in `astro.config.mjs`.

### 2d. Leave `compatibility_date` alone

`"2026-05-08"` is what the verified build was produced against. Bumping it changes runtime behaviour and is a separate, deliberate change.

## Phase 3 — Cache-Control guardrail

The highest-ranked risk in `infrastructure.md`'s register. RLS protects the database; it does nothing about a rendered SSR response cached at Cloudflare's edge. That path leaks one user's financial data to another **above** the database — silently, with nothing erroring, exactly as the isolation guardrail is described failing.

In `src/middleware.ts`, capture `const response = await next()` and set `Cache-Control: private, no-store` on any response for an authenticated user or a `PROTECTED_ROUTES` path before returning. The file currently returns `next()` directly, so this is a small restructure.

This is app code rather than infrastructure, but it must land before any deploy carrying real user data, so it belongs in the first-deploy sequence.

## Phase 4 — Supabase production project

1. Create the EU-region project (input #3).
2. `npx supabase link --project-ref <ref>`.
3. **After Phase 7**, set Authentication → URL Configuration → **Site URL** to the deployed Worker URL and add it to Redirect URLs. Otherwise confirmation emails point at `http://127.0.0.1:3000`, per `supabase/config.toml`.
4. Leave email confirmation **on** for the hosted project; it stays off locally.

No migrations exist yet, so there is nothing to `db push`. When the first one lands, observe the standing caveat: **`wrangler rollback` reverts the Worker only — never the schema.** Write migrations to be backward-compatible with the previous code version, and treat any rollback following a migration deploy as requiring a matching manual database step.

## Phase 5 — Secrets

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Create a root **`.dev.vars`** (gitignored; does not exist yet) with the same two keys for local dev — workerd reads `.dev.vars`, not `.env`. The existing `.env` holds `###` placeholders. Add a `.dev.vars` note to `.env.example`.

> **Soft-failure trap.** Both env fields are `optional: true`, and `createClient()` returns `null` when either is missing. A deploy with unset secrets **succeeds** and serves a silently auth-disabled site: `/dashboard` redirects to sign-in forever, with only the red Polish config banner as a signal. Confirm secrets are set before trusting a green deploy — see Verification step 4.

Rotation is `wrangler secret put` again, effective on next deploy. `wrangler secret list` shows names, never values.

## Phase 6 — Pre-flight verification

```bash
nvm use                      # .nvmrc pins 22.14.0
npx astro sync
npm run lint
npm run build
npx wrangler deploy --dry-run
npx wrangler check startup
```

Gates: gzip bundle < 3 MB (baseline 390.44 KiB) and startup CPU < 1 s (baseline ~24 ms).

## Phase 7 — First deploy

Preview first — this does not shift production traffic:

```bash
npx wrangler versions upload
```

> **Preview URLs are public by default.** This preview is bound to real Supabase credentials. Either front it with Cloudflare Access, or accept the exposure only while no real data exists — which is precisely why deploying the scaffold now is the low-risk window. Revisit before real user data lands.

Then promote:

```bash
npx wrangler deploy
npx wrangler deployments list
```

## Phase 8 — Post-deploy configuration

- Add `site: "https://paper-trail.<subdomain>.workers.dev"` to `astro.config.mjs`. `@astrojs/sitemap` is registered but silently emits nothing without it.
- Complete the Supabase Site URL / Redirect URL step (Phase 4, step 3).
- Optional cleanup: `dist/client/template.png` is a 1.27 MB starter asset uploaded on every deploy; it goes away with `Welcome.astro`.

## Phase 9 — CI

`.github/workflows/ci.yml` triggers on `master`, which the Phase 0 rename now matches — **`ci.yml` needs no changes.** Leave both `branches: [master]` filters as written.

- Add `SUPABASE_URL` / `SUPABASE_KEY` repo secrets once a GitHub remote exists.
- Push `master` and confirm the workflow actually fires. It never has, so its first green run is itself unverified.
- **No deploy job.** Production promotion stays a manual human action, matching `infrastructure.md`'s approval rule.

## Phase 10 — Monitoring

`observability.enabled: true` is already set in `wrangler.jsonc`.

- Bookmark **Metrics → CPU Time per execution** and **Errors → Invocation Statuses**.
- **Check weekly.** Free-plan logs retain 3 days, so a monthly cadence finds them already expired. Dashboard metrics retain 3 months.
- `npx wrangler tail --format pretty` for live streaming; `--status error` to filter failures.

### Upgrade triggers (Free → Paid, $5/mo, billed per account)

Move to Paid when any of these fires:

1. `Exceeded CPU Time Limits` appears in Errors → Invocation Statuses.
2. p99 CPU time per execution approaches 10 ms.
3. A second real application is deployed to the account.
4. The app moves past private beta to users other than the developer.

On upgrading, immediately set `limits.cpu_ms` in `wrangler.jsonc` and confirm budget alerts are active. **There is no hard spend cap on Paid** — alerts notify, they do not pause usage.

## Phase 11 — Doc corrections

Make these alongside the first deploy:

- **`context/foundation/tech-stack.md`** — `deployment_target: cloudflare-pages` → `cloudflare-workers`. Adapter v13 removed Pages support outright; `infrastructure.md` already flags this as stale.
- **`CLAUDE.md`, CI section** — drop the ⚠️ warning that CI never runs due to the `master`/`main` mismatch; Phase 0 resolves it. Same correction to `infrastructure.md` Getting Started step 7.
- **`CLAUDE.md`, hard rules** — add, per the risk register:
  - `Cache-Control: private, no-store` on authenticated SSR responses, alongside the RLS rule. A second, independent path to the same guardrail failing.
  - Adapter v13 removed `Astro.locals.runtime`; bindings are accessed directly. Fails at runtime inside workerd, not at type-check.
  - No native modules on workerd — no `sharp`. Use the Images binding or a client-side resize.
  - Use `astro dev`, never `wrangler dev`. At adapter v13 `astro dev` already runs on workerd via the Cloudflare Vite plugin; mixing the two produces confusing env-var behaviour.

---

## Verification — passed 2026-08-15 against version `42090844`

| # | Check | Result |
|---|---|---|
| 1 | `GET /` | **200** |
| 2 | `GET /dashboard` | **302 → `/auth/signin`** with **`cache-control: private, no-store`** — Phase 3 guardrail confirmed live |
| 3 | Signup → confirmation email URL | Site URL + Redirect URLs set to the Worker URL (operator, 2026-08-15). The end-to-end signup flow is the one step never exercised — confirm the email link points at the Worker and not `127.0.0.1:3000` on the first real signup |
| 4 | Config banner absent | **absent** — proves secrets resolved (a green deploy does not) |
| 5 | `/server/.dev.vars`, `/server/wrangler.json`, `/.dev.vars`, `/wrangler.json`, `/_worker.js` | **all 404** — Phase 2b confirmed |
| 6 | `wrangler tail` | ❌ unavailable on the corporate network, see above |
| 7 | `deployments list` / rollback target | **valid** |
| — | `/sitemap-index.xml` | **200** |

**The sitemap check initially failed (404)** because `site` was set *after* the previous deploy, so the live bundle predated it. Worth remembering as a general trap: a config change is not live until a rebuild **and** a redeploy, and `wrangler secret put` auto-deploying a version can create the illusion that the latest local build is already out there.

The fix also exercised the real Phase 7 sequence for the first time: `versions upload` → verify the preview URL → `versions deploy --percentage 100`. That confirmed the `previews.kv_namespaces` pin works, since the upload had failed on an id-less binding before it.

## Verification procedure

Run against the deployed URL after Phase 7.

1. `curl -I https://paper-trail.<subdomain>.workers.dev/` → 200, and no `10x-astro-starter` anywhere in the URL.
2. `curl -I .../dashboard` → 302 to `/auth/signin`, **and** `cache-control: private, no-store` present (Phase 3).
3. Sign up through the deployed UI. The confirmation email link points at the Worker URL, not `127.0.0.1:3000`. Sign in and reach `/dashboard`.
4. The red Polish config banner is **absent** — this is what proves secrets resolved, given the soft-failure trap in Phase 5.
5. `curl .../dist/server/.dev.vars` and `.../server/wrangler.json` → 404, confirming Phase 2b.
6. `npx wrangler tail --format pretty` shows invocations with CPU time logged while the above runs.
7. `npx wrangler deployments list` shows exactly one production version, and `npx wrangler rollback` names a valid target.

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback [VERSION_ID]
```

Time-to-revert is seconds — it re-points to an already-uploaded version. **This reverts the Worker only. Supabase migrations do not roll back.** See Phase 4.

## Out of scope for the first deployment

LLM provider and key (PRD Open Question 4) · Supabase migrations and RLS policies — none exist yet; the RLS-on-day-one rule binds the first table, not this deploy · custom domain · Cloudflare Access on preview URLs (revisit before real user data) · a CI deploy job · the receipt-storage decision (`infrastructure.md` proposes storing nothing — confirm during implementation).
