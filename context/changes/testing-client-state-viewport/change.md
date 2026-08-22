---
change_id: testing-client-state-viewport
title: Prove the day list tells the truth and no page overflows a phone
status: planned
created: 2026-08-22
updated: 2026-08-22
archived_at: null
---

## Notes

Rollout Phase 5 of `context/foundation/test-plan.md`: "Client state + viewport
regressions". The final phase of the rollout.

Risks covered:

- **#5** — the day list shows something the database does not contain: a row
  duplicated after save, or an inline edit applied to the wrong row or the
  wrong day (Impact Medium, Likelihood High). Evidence: interview Q4 named this
  as the scariest gap; the archive carries a stale-day race at save, a
  duplicate row from optimistic save, and shared inline-edit state leaking
  across rows and across day changes; hot-spot dir `src/components/entries/` —
  35 commits/30d, holding the three top-churning files in the repo.
- **#6** — the app becomes unusable on a phone because one element gives the
  _whole document_ horizontal scroll (Impact Medium, Likelihood High).
  Evidence: interview Q2 and Q3; `lessons.md` carries two separate entries for
  the identical symptom arising from **opposite mechanisms**; both fixes
  shipped straight to `master` with no plan or impl-review.

Test types planned: component tests on React islands, headless
narrow-viewport overflow check. Both are **new capabilities** — §4 lists them
as "none yet — see §3 Phase 5", which is why this phase comes last.

Risk response intent:

- **#5**: prove that after a save, edit, or delete the visible list equals what
  a fresh read would return; that an edit opened on one row never applies to
  another row; and that per-row edit state never survives a day change.
- **#6**: prove that at 320, 360, and 390 CSS px no page gives the _document_
  horizontal scroll, with realistic worst-case user strings (long email, long
  category name, long description).

Must challenge (from §2 Risk Response Guidance):

- that an optimistic update matches the server's result;
- that switching days resets per-row state;
- that a failed request leaves the list in a truthful state;
- that fixing the _named_ element fixed the page — the reported element is
  usually not the overflowing one;
- that a fix for one overflow mechanism covers the other.

Anti-patterns to avoid: asserting the component's internal state instead of
what a user would see rendered; happy-path-only with no failure case and no
rapid-navigation case; a pixel snapshot for #6 (it fails on every Tailwind
change and still never tells you the document overflows).

Also in scope: wiring the two §5 quality gates marked "required after §3
Phase 5" (component tests, narrow-viewport overflow check), and filling §6.5
of the cookbook.

Config constraint to carry into research: `vitest.config.ts` is standalone and
inherits none of `astro.config.mjs`'s Vite settings — including the
`resolve.dedupe: ["react", "react-dom"]` hydration fix, which `CLAUDE.md` says
must be restated when React component tests arrive.
