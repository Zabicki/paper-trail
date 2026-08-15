# Per-User Data Foundation (F-01) — Plan Brief

> Full plan: `context/changes/data-foundation-rls/plan.md`

## What & Why

Establish the migration pipeline and per-user row-level-security pattern that every later PaperTrail table will copy, proven end-to-end on one real table. This is the roadmap's first foundation (F-01): without it, the RLS isolation guarantee — which fails **silently**, not with an error, when missing — would otherwise get invented ad hoc on whichever table ships first.

## Starting Point

The repo has full Supabase auth (sign-in, sign-up, middleware) but zero data-layer code: no `supabase/migrations/`, no `supabase/seed.sql`, no `supabase/tests/`. The app connects with the **anon key only** — there is no service-role bypass anywhere — so RLS is the entire isolation boundary. No test framework of any kind exists yet.

## Desired End State

A `categories` table exists locally with row-level security enabled in the same migration that created it, guarded by four granular per-operation policies (select/insert/update/delete, each `to authenticated`, keyed on `auth.uid() = user_id`). A pgTAP suite proves isolation by simulating two seeded users and asserting neither can read, write, or spoof the other's rows. `supabase db reset && supabase test db` passes repeatably from a clean state.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Proof table | Minimal real `categories` (id, user_id, name, created_at) | Real progress toward S-01 instead of throwaway migration work; S-01 extends it with additive columns later |
| Verification method | pgTAP via `supabase test db` | Tests RLS directly against local Postgres with no new JS dependency, sidestepping the "no test framework" gap |
| `user_id` population | DB default `auth.uid()`, enforced by `WITH CHECK` | A forgotten `user_id` fails safe rather than allowing a spoofed value |
| Hosted linking | Deferred — local-only in this change | `supabase link` needs the DB password, which isn't available right now; roadmap marks this "not gating" |
| Type generation | Deferred | `src/types.ts` doesn't exist yet either; premature for one minimal table |
| CI integration | Deferred — local manual step only | Postgres-in-Docker inside GitHub Actions is real setup work outside this foundation's scope |
| Test-user provisioning | Fixed seed users in `supabase/seed.sql` | Deterministic on every `db reset`; matches the already-enabled `[db.seed]` config |
| On delete behavior | `on delete cascade` from `user_id` to `auth.users(id)` | Matches the no-admin-surface model; avoids orphaned rows nobody can ever reach once RLS locks them to a deleted user |

## Scope

**In scope:**
- Migration pipeline conventions (`supabase migrations new`, naming, one migration per table+RLS)
- `categories` table, minimal shape, with 4 granular RLS policies
- pgTAP extension + test suite proving isolation
- Fixed seed users for deterministic testing
- `CLAUDE.md` data-layer section correction

**Out of scope:**
- Hosted `supabase link` / `db push` (manual follow-up, needs DB password)
- The full `categories` feature (rename semantics, `is_recurring` flag) — that's S-01
- `supabase gen types typescript` / `src/types.ts`
- CI integration of the pgTAP suite
- Any `src/` application code or UI

## Architecture / Approach

One migration creates `categories` and enables RLS together (per `CLAUDE.md`'s hard rule — never a window where a table exists without RLS). A second migration enables the `pgtap` extension, kept separate since it's testing infrastructure rather than product schema. Verification runs entirely at the SQL layer: pgTAP tests impersonate the two seeded users by switching `role` to `authenticated` and setting the `request.jwt.claim.sub` GUC that `auth.uid()` reads — no GoTrue sign-in involved.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Categories table with RLS | Table + 4 granular policies, RLS enabled same-migration | Getting a policy's `USING`/`WITH CHECK` wrong is the exact silent-leak failure mode this foundation exists to prevent |
| 2. pgTAP verification suite | Seeded users + test suite proving isolation | Forgetting `set local role authenticated` in a test makes it silently test nothing (superuser bypasses RLS) |
| 3. End-to-end verification + docs | Reproducible clean-state run, corrected `CLAUDE.md` | Manual sanity check is the only thing catching a gap the automated suite didn't think to cover |

**Prerequisites:** Local Docker running for `supabase start`/`db reset` (per `CLAUDE.md`, ~7GB RAM).
**Estimated effort:** Single session, 3 phases — no application code touched.

## Open Risks & Assumptions

- Hosted linking is deferred by design; F-01 isn't "proven end-to-end" against production until that manual follow-up runs. Phase 3 flags this explicitly so it isn't forgotten before S-01 starts.
- pgTAP's role/JWT-claim impersonation trick is the load-bearing mechanism for every assertion in Phase 2 — if implemented wrong, the suite could pass while testing nothing.

## Success Criteria (Summary)

- A signed-in user can read and write only their own `categories` rows — proven by an automated pgTAP suite, not assumed.
- `supabase db reset && supabase test db` is a repeatable, one-command way to verify the pattern from a clean state.
- The pattern (migration shape, RLS policy shape, verification method) is documented in `CLAUDE.md` clearly enough that S-01 and every later slice can copy it without re-deciding anything.
