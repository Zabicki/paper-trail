---
project: PaperTrail
researched_at: 2026-08-15
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6.3 (SSR) + React 19 islands
  runtime: workerd (Cloudflare Workers)
starting_plan: Free (upgrade triggers recorded below)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The repo is already correctly configured for it — `@astrojs/cloudflare` v13.5, `wrangler` v4.90, and a `wrangler.jsonc` using `main` + `assets.binding: "ASSETS"` — so migration cost is zero against a deadline roughly 2.5 weeks out (2026-09-04). Cloudflare and Vercel both scored 5/5 on the agent-friendliness criteria; Cloudflare wins on the specifics that bear on this project: a 100 MB request body cap versus Vercel's hard 4.5 MB (relevant to receipt upload), 3-day log retention versus Vercel Hobby's 1 hour (relevant to after-hours debugging), no non-commercial licensing clause, and the developer's existing familiarity — the only tiebreaker available, since the interview recorded no prior experience with the alternatives.

Start on the **Free plan**. Measured against this actual repo, the two irreversible risks came back clear: the server bundle is 390 KiB gzipped against a 3 MB limit, and startup CPU is ~24 ms against a 1 second budget. Only per-request CPU is genuinely tight, and that is monitorable and reversible with a one-line plan change.

### Correction to the deployment target of record

`context/foundation/tech-stack.md` records `deployment_target: cloudflare-pages`. **This is stale and should be corrected to `cloudflare-workers`.** `@astrojs/cloudflare` v13 removed Cloudflare Pages support outright — Pages is not an option at the pinned adapter version. Workers + Static Assets is Cloudflare's recommended path for all new projects; Workers Sites is deprecated. The existing `wrangler.jsonc` is already on the correct path.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Railway** | Partial | Pass | Pass | Pass | Pass | **4 Pass / 1 Partial** |
| **Render** | Partial | Pass | Pass | Pass | Pass | **4 Pass / 1 Partial** |
| **Netlify** | Partial | Pass | Pass | Pass | Pass | **4 Pass / 1 Partial** |
| **Fly.io** | Pass | Partial | Pass | Pass | Partial | **3 Pass / 2 Partial** |

**Hard filters applied: none.** The interview answer on persistent connections was "don't know", but `tech-stack.md` records `has_realtime: false` and `has_background_jobs: false`, and the one long-running operation (receipt parsing) is a request-scoped outbound HTTP call rather than a persistent process. Every candidate handles a 30-second awaited call. No platform was dropped.

**Weights applied from the interview:** cost and DX weighted equally (no thumb on the scale); no prior platform familiarity except Cloudflare (used as the final tiebreaker only); single-region deployment (edge-native advantage neutralised to par rather than treated as a bonus); external managed services acceptable (this removes Railway's, Render's, and Fly's co-located-database advantage from the scoring entirely, since Supabase already covers Postgres, auth, and storage).

### Per-platform notes

**Cloudflare Workers** — `wrangler` covers the full operational loop (`deploy`, `deployments list`, `rollback`, `versions deploy` for gradual rollouts, `tail`, `secret put`). Docs publish `llms.txt`, `llms-full.txt`, `.md` on any page, and source on GitHub. Multiple GA MCP servers including a dedicated observability server. Fully managed isolates with no OS surface.

**Vercel** — equally strong across all five. `vercel deploy --prod` / `rollback` / `promote` / `logs --follow`, best-in-class agent docs (`llms.txt`, `llms-full.txt`, `graph.json`, per-page `.md`), GA MCP with documented Claude Code support. Loses on project-specific factors, not on criteria.

**Railway** — Railpack is genuinely managed (no Dockerfile), MCP is GA and bundled into the CLI, docs have `.md` twins and `llms.txt`. Partial on CLI-first: there is no `railway rollback`; reverting is dashboard or GraphQL API only.

**Render** — GA MCP with OAuth Claude Code setup, `render.yaml` Blueprints as IaC, `llms.txt` plus 21 MIT-licensed agent skills. Partial on CLI-first: rollback is not a CLI verb (dashboard/REST only), and Blueprint deploys, scaling, and metrics require the dashboard or API.

**Netlify** — arguably the best agent documentation of any candidate and a GA MCP server, with a whole platform strategy built around agent experience. Partial on CLI-first: rollback is UI-only ("Publish Deploy"), and the function region setting cannot be set from adapter-generated code.

**Fly.io** — strong CLI and the best long-request story. Partial on managed-versus-raw: you inherit a Dockerfile, a base image to patch, and a VM. Partial on MCP: every `fly mcp` subcommand is tagged `[experimental]` in official docs.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Zero migration cost, a 100 MB request body limit, no wall-clock request limit while the client stays connected (only CPU is metered, and `fetch()` wait time is explicitly excluded), and the developer's only prior familiarity. The $5/month Paid plan is billed **per account** covering up to 500 Workers with pooled allowances, so it amortises across every future personal project rather than being a per-app cost.

#### 2. Vercel

Genuinely comparable — 5/5, a $0 Hobby tier, a 300-second Hobby function duration, and a full Node.js runtime (meaning `sharp` and other native modules work). The gap is four project-specific items: an adapter swap to `@astrojs/vercel@10` (version 11.x requires Astro 7 — the pin matters), a hard 4.5 MB request body cap, 1-hour log retention on Hobby, and Hobby's explicit non-commercial-use clause. The full Node runtime is its one real technical advantage, and it is largely neutralised because this project does not need native modules.

#### 3. Railway

The cheapest escape hatch to a plain persistent Node process, which eliminates the entire class of CPU-ceiling, isolate-memory, and function-timeout questions at once. Amsterdam region on the $5 Hobby plan, GA MCP bundled into the CLI. The gap: an adapter swap to `@astrojs/node`, no CLI rollback, and two setup papercuts — Railpack misdetects `output: "server"` Astro projects and builds them as static sites served by Caddy, and `@astrojs/node` binds to localhost by default, producing a green deploy that returns 502 until `HOST=0.0.0.0` is set.

**Why Netlify and Render lost the third slot** despite matching Railway's score: cost shape. Netlify's free tier is a 300-credit hard pause where roughly 20 production deploys exhausts it — fatal for a 3-week iterative build — and EU regions are Pro-gated at $20/month. Render's free tier spins down after 15 minutes with a ~1-minute cold start, directly violating the ≤10s interaction NFR.

## Anti-Bias Cross-Check: Cloudflare Workers

Two items from the initial cross-check were withdrawn after verification. They are recorded here with their corrections rather than deleted, because the corrections are load-bearing.

### Devil's Advocate — Weaknesses

1. **The 10 ms free-tier CPU ceiling is the one real constraint.** Cloudflare's own limits page states the average Worker uses ~2.2 ms, but *"heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10–20 ms."* PaperTrail's pages are exactly that shape: middleware auth, React island SSR, Supabase response parsing, chart aggregation. Cloudflare is documenting that this workload class sits at or above the free ceiling.

2. **`Astro.locals.runtime` was removed in adapter v13.** Essentially every Astro-on-Cloudflare tutorial, forum answer, and model-training snippet predates this change. An agent-assisted build will confidently emit code against the removed API, and it fails at runtime inside workerd rather than at type-check — the slowest possible place to catch it.

3. **`sharp` does not run on workerd** (no native modules). This does *not* prevent server-side image processing — see the withdrawn item below — but it does invalidate the most common Node image-handling recipe, which is what an agent will reach for first.

4. **Adapter v13 silently changed the image service default** from `compile` to `cloudflare-binding`, auto-provisioning a Cloudflare Images binding with a 5,000-transform/month free cap and error 9422 beyond it. A billable service enters the request path without being explicitly chosen. Either adopt it deliberately or disable it.

5. **Rollback reverts code, never schema.** `wrangler rollback` restores a prior Worker version. It does nothing to Supabase migrations. For a project whose entire data layer arrives as migrations, a rollback after a migration deploy leaves code and database desynchronised — potentially worse than the failure it was meant to undo.

**Withdrawn — "server-side image resizing is impossible."** Incorrect. Only `sharp` is unavailable. The Cloudflare Images binding (`env.IMAGES.input(…).transform(…).output(…)`) does exactly this, and adapter v13 already auto-provisions it; WASM libraries such as `@cf-wasm/photon` are a second option, at the cost of bundle size. Verify the current Images binding call signature against live docs before implementing.

**Withdrawn — "isolate memory makes receipt upload risky."** Over-weighted. A 10 MB photo plus a ~13 MB base64 encoding is roughly 25–30 MB peak against a 128 MB isolate. That is a concurrency problem, not a problem at this project's scale. Downgraded to a note: prefer a downscaled image over the full-resolution original, for LLM cost and latency reasons rather than memory ones.

### Pre-Mortem — How This Could Fail

The build starts fast: auth works, categories and manual entry ship in week one. Receipt parsing lands in week two and consumes the schedule, because the first instinct is the Node recipe — `sharp` to downscale, a Supabase Storage bucket, a signed upload flow, a retention job — and none of the first step works on workerd. Three evenings go to rediscovering the Images binding and rewriting the flow.

Meanwhile the deployed Worker is still named `10x-astro-starter`, so its URL is wrong, and renaming means a new Worker with the old one orphaned on a claimed subdomain. A dashboard page ships without an explicit `Cache-Control`, and Cloudflare's edge caches a rendered SSR response containing one user's expenses. The strict-isolation guardrail fails exactly as the tech-stack doc warned RLS failures do — silently, with nothing erroring. RLS is correctly configured and provides no protection whatsoever, because the leak happens above the database.

Traffic is low enough that CPU never triggers 1102, so the plan choice is vindicated while the actual failure goes unnoticed. The deadline passes with parsing half-finished and a data-leak incident nobody has detected.

### Unknown Unknowns

- **Edge caching is a second, independent path to the isolation guardrail failing.** RLS protects the database; it does nothing about a rendered HTML response cached at the edge. Every authenticated SSR page needs an explicit private/no-store `Cache-Control`. Neither `prd.md` nor `tech-stack.md` covers this direction, and it is the highest-ranked risk in the register below.

- **`wrangler dev` is redundant at these versions.** Adapter v13 runs `astro dev` on workerd via the Cloudflare Vite plugin. Most guides and model recall still recommend `wrangler dev`; mixing the two produces confusing environment-variable behaviour, since `.dev.vars` is what workerd reads, not `.env`.

- **Version preview URLs are public by default.** A preview deployment wired to real Supabase credentials is internet-reachable unless fronted with Cloudflare Access.

- **The $5 plan is per-account, not per-app** — up to 500 Workers with pooled allowances. This inverts the cost reasoning for anyone planning multiple side projects. Conversely, on Free the 100k requests/day is *also* per-account, so several apps divide one bucket.

- **There is no hard spend cap on the Paid plan.** Overage runs $0.30/million requests and $0.02/million CPU-ms. Budget alerts (default-on for pay-as-you-go since June 2026) are email-only and explicitly "do not pause or cap usage". `limits.cpu_ms` in `wrangler.jsonc` is the actual denial-of-wallet protection.

- **Free-plan log retention is 3 days** (200k events/day), versus 7 days on Paid. Dashboard *metrics* retain 3 months on both. Monitoring cadence has to be weekly, not monthly, for logs to still exist when checked.

## Operational Story

- **Preview deploys**: `wrangler versions upload` creates a preview URL per version without shifting production traffic; `wrangler versions deploy` promotes, optionally with a percentage for gradual rollout. Workers Builds provides Git-driven CI (3,000 build-minutes/month, 1 concurrent build, included on Free). **Preview URLs are public by default — put Cloudflare Access in front of any preview bound to real Supabase credentials.**

- **Secrets**: `wrangler secret put SUPABASE_URL` / `SUPABASE_KEY` (and the LLM API key) for deployed environments; `.dev.vars` for local `astro dev`, since workerd does not read `.env`. Both `.env` and `.dev.vars` are gitignored. Rotation is `wrangler secret put` again, which takes effect on next deploy. Secrets are write-only via CLI — `wrangler secret list` shows names, never values. `SUPABASE_URL`/`SUPABASE_KEY` are declared `context: "server", access: "secret"` in `astro.config.mjs`, so they are unreachable from client code.

- **Rollback**: `wrangler deployments list` to find the target, then `wrangler rollback [VERSION_ID]`. Time-to-revert is seconds — it re-points to an already-uploaded version. **Data caveat: this reverts the Worker only. Supabase migrations do not roll back.** After any deploy that included a migration, treat rollback as requiring a matching manual database step, and write migrations to be backward-compatible with the previous code version where practical.

- **Approval**: an agent may run `astro build`, `wrangler deploy --dry-run`, `wrangler versions upload` (preview), `wrangler tail`, and `wrangler deployments list` unattended. A human should approve: promoting a version to production, `wrangler secret put` (rotating credentials), any Supabase migration touching existing data, changing the Worker `name`, and switching billing plans.

- **Logs**: `wrangler tail --format pretty` for live streaming, `wrangler tail --status error` to filter failures. `observability.enabled: true` is already set in `wrangler.jsonc`, so invocation logs capture CPU time and wall time. Dashboard: **Metrics → CPU Time per execution** (quantiles, 3-month retention) and **Errors → Invocation Statuses** (watch for `Exceeded CPU Time Limits`). A GraphQL Analytics API and a dedicated observability MCP server (`observability.mcp.cloudflare.com/mcp`) both expose this programmatically.

## Plan Posture: Start Free, Upgrade on Signal

**Starting plan: Free.** Justified by measurement against this repo rather than by estimate — the two irreversible risks came back with clear headroom:

| Measured | Value | Free limit | Headroom |
|---|---|---|---|
| Server bundle (gzipped) | 390 KiB | 3 MB | ~87% unused |
| Startup CPU | ~24 ms | 1 s | ~97% unused |

Per-request CPU is the only tight constraint, and it is both monitorable and reversible with a one-line plan change. Three things soften it: `fetch()` wait time is explicitly excluded from CPU accounting (so Supabase round-trips and the LLM call cost ~0 CPU); static assets served via the `ASSETS` binding never invoke the Worker; and isolates carry "rollover CPU time" grace for infrequent overruns. Failures are per-request — a Cloudflare 1102 error page for that request — not a disabled Worker.

**Upgrade triggers — move to Paid ($5/month) when any of these fires:**

1. `Exceeded CPU Time Limits` appears in Errors → Invocation Statuses.
2. p99 CPU time per execution approaches 10 ms in Metrics.
3. A second real application is deployed to the account — at that point $5 is amortised across both, and Paid also unlocks 30 s CPU, 10,000 subrequests, and 500 Workers.
4. The app moves past private beta to users who are not the developer.

**On upgrading, immediately set** `limits.cpu_ms` in `wrangler.jsonc` and confirm budget alerts are active — there is no hard spend cap on Paid.

**Monitoring cadence: weekly.** Free-plan logs retain only 3 days, so a monthly check will find them already expired.

## Architectural Note: Receipt Flow Without Storage

Recorded here because it materially changes the platform's risk surface and removes an infrastructure dependency. **This is a proposal to confirm during implementation, not a settled decision.**

The receipt image may never need to be stored anywhere:

- **Display during review** — an object URL created from the `File` the user selected. No server round-trip, no storage, instant rendering.
- **Send to the LLM** — the Worker receives the image, forwards it to the model, returns parsed line items. Nothing is written to disk or database.
- **On confirm** — only the line items persist. There is nothing to delete.

**What this removes:** the Supabase Storage bucket, a signed-upload flow, a retention/cleanup job, and the receipt-upload risk from the pre-mortem above.

**What this resolves:** `prd.md` Open Question 3 partially dissolves — the receipt-image retention window stops being a value to choose, because retention becomes zero by construction. This satisfies the existing NFR ("gone once its entries are confirmed") more strongly than a bounded window would. The parsing-timeout half of that open question is unaffected.

**Two conditions:**

1. The review step must be a **React island holding the `File` in memory**, not a full SSR page navigation — a navigation discards the object URL. This fits the existing React-islands convention and the ≤4-interaction budget.
2. If the tab crashes mid-review the image is lost. Acceptable: the durability guardrail covers *confirmed* entries, and nothing has been confirmed at that point.

**Unaffected:** the PRD's disclosure requirement still stands. Users must still be told that receipt contents and category names are sent outside the product for parsing — not storing the image does not change what is transmitted.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Edge-cached SSR response leaks one user's financial data to another | Unknown unknowns | M | **H** | Set explicit `Cache-Control: private, no-store` on every authenticated SSR response in `src/middleware.ts`. Add to CLAUDE.md hard rules alongside the RLS rule — this is a second, independent path to the same guardrail failing. |
| Public version preview URL exposes real Supabase data | Unknown unknowns | M | **H** | Front preview URLs with Cloudflare Access, or bind previews to a separate Supabase project with non-production data. |
| Rollback desyncs code from database schema | Devil's advocate | M | **H** | Write backward-compatible migrations. Treat any rollback following a migration deploy as requiring a matching manual database step. Never roll back code alone after a destructive migration. |
| Agent generates removed `Astro.locals.runtime` API | Devil's advocate | **H** | M | Add a CLAUDE.md note that adapter v13 removed it and bindings are accessed directly. Fails at runtime in workerd, not at type-check. |
| Per-request CPU exceeds 10 ms on Free, causing intermittent 1102 pages | Research finding | M | M | Weekly check of Metrics → CPU Time quantiles and Errors → Invocation Statuses. Upgrade to Paid on first occurrence — a one-line change, no rebuild. |
| Agent reaches for `sharp` / Node image recipes that cannot run on workerd | Devil's advocate | **H** | M | Record in CLAUDE.md: no native modules on workerd. Use the Cloudflare Images binding or client-side resize. |
| Cloudflare Images binding silently enters the request path with a 5,000/month cap | Devil's advocate | M | L | Decide explicitly: adopt it, or disable with `imageService: { build: 'compile', runtime: 'passthrough' }` in `astro.config.mjs`. |
| Worker deployed as `10x-astro-starter`, claiming the wrong subdomain | Pre-mortem | **H** | L | Rename `name` in `wrangler.jsonc` (and `package.json`, `supabase/config.toml`) **before** the first deploy. Cheap now, orphans a Worker later. |
| Unbounded spend after upgrading to Paid (no hard cap exists) | Unknown unknowns | L | M | Set `limits.cpu_ms` per Worker in `wrangler.jsonc`; confirm budget alerts active. Alerts notify only — they do not pause usage. |
| `wrangler dev` used alongside `astro dev`, causing env-var confusion | Unknown unknowns | M | L | Use `astro dev` only — it runs on workerd via the Cloudflare Vite plugin at v13. `.dev.vars` is what workerd reads, not `.env`. |
| Free-plan logs expire before a monthly check | Research finding | M | L | Check weekly. Logs retain 3 days on Free; dashboard metrics retain 3 months. |

## Getting Started

Commands validated against the versions pinned in this repo (`@astrojs/cloudflare` 13.5, `wrangler` 4.90, Astro 6.3), not against general platform documentation.

1. **Rename the project before the first deploy.** Change `name` in `wrangler.jsonc` from `10x-astro-starter` to `paper-trail`, and match it in `package.json` and `supabase/config.toml`. Deploying first claims the wrong `workers.dev` subdomain and orphans a Worker on rename.

2. **Set up local development.** `npx astro sync` (required after a fresh clone, and after any `env.schema` change in `astro.config.mjs`, or `astro:env/server` imports fail type-check and lint errors out), then `npm run dev`. **Do not use `wrangler dev`** — at adapter v13, `astro dev` already runs on workerd via the Cloudflare Vite plugin. Put local secrets in **`.dev.vars`**, not `.env` — workerd reads the former.

3. **Decide the image service explicitly.** Adapter v13 defaults `imageService` to `cloudflare-binding`, auto-provisioning a Cloudflare Images binding. Either keep it deliberately (5,000 transforms/month free, useful for downscaling receipts before the LLM call) or opt out in `astro.config.mjs`:
   ```js
   adapter: cloudflare({ imageService: { build: 'compile', runtime: 'passthrough' } })
   ```

4. **Verify the build before deploying.** `npm run build`, then `npx wrangler deploy --dry-run` to confirm bundle size against the 3 MB gzip free limit (currently ~390 KiB), and `npx wrangler check startup` to confirm startup CPU against the 1 s budget (currently ~24 ms).

5. **Set secrets and deploy.** `npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_KEY`, plus the LLM API key. Then `npx wrangler deploy` for production, or `npx wrangler versions upload` for a preview URL that does not shift production traffic.

6. **Turn on monitoring from the first deploy.** `observability.enabled: true` is already in `wrangler.jsonc`. Bookmark Metrics → CPU Time per execution and Errors → Invocation Statuses, and check weekly — Free-plan logs retain only 3 days.

7. **Fix the CI branch filter.** `.github/workflows/ci.yml` triggers on `master`, but the working branch is `main`, so CI currently never runs. It also needs `SUPABASE_URL` / `SUPABASE_KEY` repo secrets.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (the branch-filter note above is a defect report, not a pipeline design)
- Production-scale architecture (multi-region, HA, disaster recovery)
- Supabase project region selection and its own hosting plan
- LLM provider selection for receipt parsing (`prd.md` Open Question 4)
