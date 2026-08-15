---
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
---

## Why this stack

Solo build of a multi-user expense tracker in three after-hours weeks against a hard deadline, with accounts and a receipt-classification step that calls an external model. The dominant constraint is that auth is the single largest chunk of that budget, so a starter shipping accounts, a Postgres database with row-level security, and file storage removes the most expensive work rather than merely speeding it up. 10x-astro-starter is the recommended default for web plus JavaScript and clears all four agent-friendly gates, so an agent working in this repo has strong priors about its conventions. Bootstrapper confidence is first-class: scaffolding is expected to work but has not been run end to end on this stack. Auth and AI flags are set; payments, realtime, and background jobs are out of scope per the PRD's non-goals. Deployment is Cloudflare Pages, the starter default, with GitHub Actions and auto-deploy on merge. Two gotchas on the starter card bear directly on the PRD: row-level security must be configured on day one or the strict-isolation guardrail fails quietly, and the edge runtime constrains long-running work — which is the shape of the receipt-parsing call.
