---
bootstrapped_at: 2026-08-14T17:42:14Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: paper-trail
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

# Bootstrap verification — paper-trail

## Hand-off

Verbatim from `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: paper-trail
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**Why this stack** (from the hand-off body):

Solo build of a multi-user expense tracker in three after-hours weeks against a hard deadline, with accounts and a receipt-classification step that calls an external model. The dominant constraint is that auth is the single largest chunk of that budget, so a starter shipping accounts, a Postgres database with row-level security, and file storage removes the most expensive work rather than merely speeding it up. 10x-astro-starter is the recommended default for web plus JavaScript and clears all four agent-friendly gates, so an agent working in this repo has strong priors about its conventions. Bootstrapper confidence is first-class: scaffolding is expected to work but has not been run end to end on this stack. Auth and AI flags are set; payments, realtime, and background jobs are out of scope per the PRD's non-goals. Deployment is Cloudflare Pages, the starter default, with GitHub Actions and auto-deploy on merge. Two gotchas on the starter card bear directly on the PRD: row-level security must be configured on day one or the strict-isolation guardrail fails quietly, and the edge runtime constrains long-running work — which is the shape of the receipt-parsing call.

## Pre-scaffold verification

| Signal      | Value                                                      | Severity | Notes |
| ----------- | ---------------------------------------------------------- | -------- | ----- |
| npm package | not run                                                     | n/a      | `cmd_template` starts with `git clone`; no npm-distributed CLI to resolve |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17   | fresh    | 89 days before run date — inside the 3-month threshold, but close to the boundary |

**Registry discrepancy (not part of the standard check, recorded because it is material):** the starter card in `starter-registry.yaml` declares `stars: 50000`. The live repository reports **92** stargazers at run time. The `popular_in_training` quality gate — one of the four agent-friendly gates that produced `quality_override: false` — was justified in part by that figure. At 92 stars this starter is a course template, not a mainstream one, and an agent's priors about its conventions will be correspondingly weaker. The other three gates (typed, convention-based, well-documented) are unaffected. Recommend correcting the registry snapshot.

Additional detail: repo is public, not archived, default branch `master`, `updated_at` 2026-08-07.

Note: the check was executed against the public GitHub REST endpoint rather than `gh api`, because `gh` is not authenticated in this environment (`gh auth login` not run). Same endpoint, same field, unauthenticated.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 48 (plus `node_modules/` moved wholesale — 774 packages installed, 895 total in the dependency graph)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: append-merged — pre-existing cwd lines kept in order, 13 new lines appended under a `# from 10x-astro-starter` separator, exact-match de-duped
**.bootstrap-scaffold cleanup**: deleted
**Upstream `.git/` removed before move-up**: yes (git-clone strategy) — no upstream history leaked into this repo
**`context/**` drops**: 0 (starter ships no `context/` directory)

### Pre-scaffold cwd modification (operator action, recorded for the audit trail)

The cwd carried three scaffold-shaped stub files from an earlier `npm init` / `tsc --init`: `package.json` (TypeScript-only stub), `tsconfig.json` (stock `commonjs` config, incompatible with Astro), and `src/index.ts` (a one-line `console.log` placeholder). Under the standard conflict policy these would have won over the starter's real files, sidelining the working `package.json` and `tsconfig.json` as `.scaffold` siblings and leaving a project whose root manifest contained none of Astro, React, or Supabase.

The user was shown this consequence and chose to delete the three stubs before scaffolding. They were staged in git at the time, so their blobs remain in the object store and are recoverable with `git checkout -- package.json tsconfig.json src/index.ts`:

- `package.json` → `ce78250a69bbca895b03442624692bd92ad4bf7b`
- `tsconfig.json` → `1efdceb77220bff8d2d10b4a56a3ae9de02b5468`
- `src/index.ts` → `04bf26ec60915234f3f4c7bda003176be3f87d58`

This is why the conflict matrix produced zero `.scaffold` siblings.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Exit code**: 1 (informational only — non-zero is expected when findings exist; not a halt condition)
**Summary**: 1 CRITICAL, 13 HIGH, 7 MODERATE, 2 LOW (23 total)
**Direct vs transitive**: 3 of 23 findings are direct dependencies — `astro` (high), `supabase` (moderate), `wrangler` (moderate). The remaining 20 are transitive.
**Dependency graph**: 430 prod, 316 dev, 131 optional, 24 peer (895 total)

### CRITICAL findings

- **tar** — transitive. Six advisories against node-tar: PAX size-override parser interpretation differential enabling file smuggling; process crash via PAX numeric path type confusion; decompression/parse DoS via unlimited input; infinite loop on negative tar entry size; uncaught-exception DoS via NUL byte in PAX path/linkpath records; uncatchable stack-overflow DoS via uncontrolled recursion in `mapHas`/`filesFilter`. Reached through the build/tooling chain rather than request-handling code.

### HIGH findings

- **astro** — **direct**. XSS via unescaped attribute names in spread props, plus XSS via unescaped spread attribute names in `renderHTMLElement` (an incomplete fix for CVE-2026-54298). This is the framework itself and the only high-severity finding the project owns directly.
- **brace-expansion** — transitive. DoS via exponential-time expansion of consecutive non-expanding `{}` groups.
- **devalue** — transitive. DoS via sparse array deserialization.
- **fast-uri** — transitive. Host confusion via literal backslash authority delimiter/introducer.
- **js-yaml** — transitive. Quadratic-complexity DoS in merge-key handling via repeated aliases.
- **miniflare** — transitive. Inherits `sharp` and `undici` advisories.
- **nanoid** — transitive. Non-secure generators loop indefinitely on negative size; custom generators loop indefinitely when size is zero.
- **postcss** — transitive. Path traversal in previous-source-map auto-loading (`sourceMappingURL`) leading to arbitrary `.map` file disclosure; incomplete fix of GHSA-6g55-p6wh-862q.
- **sharp** — transitive. Inherited libvips vulnerabilities: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591.
- **svgo** — transitive. `removeScripts` plugin leaves some executable scripts intact.
- **undici** — transitive. TLS certificate validation bypass via dropped `requestTls` in SOCKS5 ProxyAgent; HTTP header injection via `Set-Cookie` percent-decoding.
- **vite** — transitive. `server.fs.deny` bypass on Windows alternate paths; launch-editor NTLMv2 hash disclosure via UNC path handling on Windows.
- **ws** — transitive. Uninitialized memory disclosure; memory-exhaustion DoS from tiny fragments and data chunks.

### MODERATE findings

`supabase` (direct), `wrangler` (direct), `@astrojs/language-server`, `@cloudflare/vite-plugin`, `volar-service-yaml`, `yaml`, `yaml-language-server`.

### LOW / INFO findings

`@babel/core`, `esbuild`.

### Reading these against the PRD

Two findings deserve attention beyond the raw counts, because they touch requirements rather than just the dependency graph:

- The **direct `astro` XSS** advisories concern unescaped attribute rendering. This application renders user-authored content by design — custom category names (FR-004) are free-text and appear throughout the visualization surfaces. An XSS path in attribute rendering is squarely in scope for the strict-isolation guardrail, since a stored payload in one account's category name is the classic route to reaching another account's session.
- **`sharp`** sits in the image-processing chain and this project uploads user-supplied receipt photographs (FR-010). Image-decode vulnerabilities are reachable from untrusted input in a way that build-time tooling findings are not.

Neither observation is a halt condition, and nothing here was auto-patched — bootstrapper informs, you decide.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | true                |
| has_background_jobs     | false               |

Note on `deployment_target` and `ci_provider`: the starter happens to ship `wrangler.jsonc` and `.github/workflows/ci.yml` of its own accord. Those files came from the template, not from bootstrapper acting on these hints — they have not been checked against the recorded values.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` is not needed — this cwd was already a git repository, and the upstream starter's history was deleted before move-up, so nothing foreign entered your history.
- No `.scaffold` siblings were created, so there is nothing to diff and promote.
- `package.json` still carries `"name": "10x-astro-starter"` from the template. The hand-off's `project_name` is `paper-trail`; bootstrapper does not rewrite the manifest name, so change it by hand if you want them to match.
- The merged `.gitignore` now contains both `.vscode/*` (pre-existing) and the starter's entries. The starter ships `.vscode/extensions.json`, `launch.json`, and `settings.json`, which that pre-existing rule will ignore. Drop the `.vscode/*` line if you want the starter's editor config tracked.
- `.DS_Store` and `.idea/` are now covered by the merged `.gitignore`, but both were already staged in git before this run and remain tracked. `git rm --cached` them if that is not what you want.
- Copy `.env.example` to `.env` and fill in Supabase credentials before the app will run.
- Address audit findings per your risk tolerance. `npm audit fix` handles part of it; the direct `astro` advisory is the one worth resolving first.
