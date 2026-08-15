---
change_id: data-foundation-rls
title: Establish migration pipeline and per-user RLS pattern
status: impl_reviewed
created: 2026-08-15
updated: 2026-08-15
archived_at: null
---

## Notes

Roadmap ID: F-01 (foundation). Source: `context/foundation/roadmap.md`. GitHub issue: [#1](https://github.com/Zabicki/paper-trail/issues/1).

- **Outcome:** a migration pipeline exists and a per-user row-level-security pattern is established and proven end-to-end on the first real table — a signed-in user can read and write only their own rows, verified by test rather than assumed.
- **PRD refs:** FR-001 (already satisfied by the auth baseline — this foundation adds the isolation half, not sign-in), FR-002, Access Ctrl.
- **Prerequisites:** none — this is the first foundation.
- **Unlocks:** S-01 through S-06; every later slice writes user-scoped rows against this pattern.
- **Scope is deliberately narrow:** migration tooling (`supabase/migrations/`, `YYYYMMDDHHmmss_short_description.sql` naming), the RLS policy shape (granular per-operation, per-role — see `CLAUDE.md` hard rules), and one real table proving the pattern. Not the whole data model — that's for later slices to decide as they need tables.
- **Risk:** an RLS mistake leaks one user's financial data to another and fails silently — nothing errors. This is why it's a foundation gated before any real data exists, per `CLAUDE.md` and `context/foundation/tech-stack.md`.
- **Outstanding setup (non-gating):** hosted Supabase project is live, but `supabase link` has not been run yet (needs the DB password).
