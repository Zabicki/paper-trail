# Client state + viewport regressions — Plan Brief

> Full plan: `context/changes/testing-client-state-viewport/plan.md`
> Research: `context/changes/testing-client-state-viewport/research.md`

## What & Why

Rollout **Phase 5** of `test-plan.md` §3 — the last one. It stands up the two
capabilities the rollout deliberately deferred to the end (React component tests,
a headless narrow-viewport overflow check) and uses them to cover risk **#5**
("the day list shows something the database does not contain") and risk **#6**
("one element gives the whole document horizontal scroll on a phone").

Both risks have shipped bugs in the archive and **zero** automated cover today.

## Starting Point

Fifteen test suites exist, all on the `node` environment; `vitest.config.ts` is
standalone and its glob (`src/**/*.test.ts`) will **silently** not collect a
`.test.tsx`. No DOM environment, no React renderer, no browser driver is in the
lockfile at all.

`DayView` carries **three guards** installed by three separate impl-reviews — a
`selectedDateRef` day guard, an id dedupe, and a `key={selectedDate}` remount.
Each is one deletable line, each is documented only in prose in an archived
review file, and none has a regression test. Meanwhile `button.tsx:8` bakes
lesson 4's exact overflow recipe (`inline-flex whitespace-nowrap shrink-0`, no
`max-w-full`) into every button in the app, with the bound restored at two call
sites out of many.

## Desired End State

`npm run test` runs component suites on jsdom alongside the existing node
suites, and each of the three archived incidents goes red if its guard is
deleted. `npm run test:viewport` asserts against the built stylesheet that no
fixture page overflows at 320/360/390 — and it is **green**, because the
surfaces it found have been brought into conformance. Both gates run in CI on
pull requests, §5's two "required after §3 Phase 5" rows read "required —
wired", and §6.5 becomes the canonical answer to "how do I add a component test
here?"

## Key Decisions Made

| Decision                     | Choice                                                                 | Why (1 sentence)                                                                                                                                                                                        | Source          |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Risk #5's actual mechanism   | Characterise three live guards, not hunt duplicates                    | Nothing in the island is optimistic — every write path is server-echo, so the real failures are **subtractive**, and a suite written to the risk statement as phrased would look in the wrong direction | Research        |
| DOM environment              | `jsdom` + Testing Library, opted in **per-file** via docblock          | Smallest delta — the 15 existing suites keep the `node` env and pay nothing; jsdom is already a declared optional peer of the pinned vitest                                                             | Plan            |
| Component tree reach         | `DayView` with `ReceiptCapture` mocked, plus `DayEntriesList` directly | Reaches all four write paths and all three incidents while removing `useSyncExternalStore`, Canvas and `createImageBitmap` — three unverified environment questions — in one mock                       | Plan            |
| Overflow check target        | Static HTML fixtures linking the glob-resolved built CSS               | Both shipped bugs are behind `PROTECTED_ROUTES`, so a URL-visiting check cannot reach either without a session; the fixture is the only option that also reaches interaction-gated surfaces             | Research + Plan |
| Overflow driver              | `playwright`, chromium only                                            | Its browser binary installs in a **separate** step, so `npm ci` stays the same size in `db-test` and `deploy` — the cost research named                                                                 | Plan            |
| `position: fixed` blind spot | Per-block containment assertion **alongside** the document one         | Sidesteps the unverified question instead of depending on its answer, and catches `CategoriesManager`'s unfixed instance                                                                                | Plan            |
| Pre-settle chart overflow    | Reproduce the 320px box                                                | It is real overflow in shipped SSR HTML at four call sites; excluding it leaves `/reports` silently uncovered                                                                                           | Plan            |
| The two live defects         | Characterisation tests + recorded findings, **not fixed**              | Follows §6.2's characterisation rule and Phase 2's F2 precedent; a behaviour change to the top-churn island inside a testing phase is how three prior reviews each got a guard wrong                    | Plan            |
| Failing overflow surfaces    | Fix them                                                               | A required gate that ships red is not a gate, and these are conformance to `roadmap.md:245`'s already-accepted rule — one class token each                                                              | Plan            |
| CI slot                      | New step in the `ci` job after `npm run build`                         | `ci` is unguarded and the only job that builds on a PR, so §5's "CI on PR" is satisfied with no trigger change                                                                                          | Plan            |

## Scope

**In scope:** jsdom + RTL harness, widened glob, restated `resolve.dedupe`,
ESLint test-file override; `date-utils` unit test; `DayEntriesList` and `DayView`
component suites; two characterisation tests for the live defects; playwright
overflow check with fixtures and two assertion modes; conformance fixes
including the `button.tsx` primitive; CI step; §3/§4/§5/§6.5/§6.6/§7/§8 updates.

**Out of scope:** fixing the two subtractive defects; testing `ReceiptCapture`,
recharts or radix Dialog under a DOM shim (research OQ 3–5 stay open); visiting
real URLs; e2e; snapshot or pixel tests; coverage; hook configuration;
`db-test` and `deploy` changes; re-spiking `getViteConfig`.

## Architecture / Approach

Two capabilities, deliberately **not** merged — and the reason is structural, not
stylistic. `global.css` is imported once, from `Layout.astro`, never from a
`.tsx`. Under Vitest there is no Tailwind plugin, so a rendered island has zero
computed styles and every `className` is an inert string. Overflow is a property
of built CSS that exists only after `astro build`.

```
risk #5 ──► Vitest + jsdom + RTL ──► DayEntriesList.test.tsx
                                 └─► DayView.test.tsx (ReceiptCapture mocked)

risk #6 ──► astro build ──► dist/client/_astro/Layout.<hash>.css
                                 │
                                 └─► playwright chromium ──► fixture pages
                                       @ 320/360/390, two assertion modes
```

## Phases at a Glance

| Phase                                    | What it delivers                                                                                              | Key risk                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Runner extension + first island suite | jsdom/RTL harness proven on the cheapest island; `date-utils` unit test; incident (c) covered                 | Four unverified tooling questions land at once; mitigated by choosing the island that reaches radix only via `ui/label` |
| 2. `DayView` state truth                 | Incidents (a) and (b) and the remount covered; rapid navigation and failure paths; two characterisation tests | Deferred-resolution fetch stubbing is fiddly; a race test that passes for the wrong reason is worse than none           |
| 3. Overflow check + conformance          | The instrument, its reading, and the fixes that make it green                                                 | Fixture drift — it asserts transcribed markup; managed by a source `file:line` comment on every block                   |
| 4. Gates, CI, close-out                  | CI step, §5 gates flipped, §6.5 written, rollout closed                                                       | Browser install now sits on the merge path for every PR; wall-clock must be measured, not assumed                       |

**Prerequisites:** clean `npm ci` and `npx astro sync`; a successful
`npm run build` before any viewport run; network access for the new dependencies
and the chromium download.

**Estimated effort:** ~4 sessions, one per phase; Phase 3 is the largest.

## Open Risks & Assumptions

- **Every tooling feasibility question is inherited as an unknown** — research
  was scoped read-only. Whether jsdom boots under this standalone config, whether
  `@vitejs/plugin-react` is needed on top of `resolve.dedupe`, and whether
  `ubuntu-latest` gives a usable chromium are all first discovered during
  implementation.
- **The fixture can drift from the real components silently.** A comment
  convention is the whole mitigation. If a component's markup changes and the
  fixture does not, the check goes green on markup that no longer exists.
- **The chart fixture hardcodes a constant that lives in `ui/chart.tsx`.**
  Reciprocal comments in both files are the only link.
- **Two characterisation tests will be green while encoding known-wrong
  behaviour.** Only their header comments stop a reader taking them as
  endorsement — this is the failure mode §6.2's rule exists for.
- **`button.tsx` becomes hand-modified**, which §7's `src/components/ui/` bullet
  says triggers re-evaluation of that exclusion.
- The report islands get **no** component cover from this phase, so recharts and
  radix under a DOM shim stay unanswered for whoever needs them next.

## Success Criteria (Summary)

- Deleting any one of the three `DayView`/`DayEntriesList` guards turns exactly
  one test red — the regression cover three impl-reviews asked for and never got.
- Reverting either shipped overflow fix (S-11's `min-w-0 break-all`, S-12's
  `max-w-full`) turns the viewport check red at 360px, in the same
  `actual/expected` shape `roadmap.md:233` recorded — i.e. the check would have
  caught both bugs before they shipped.
- A contributor can add a component test or a fixture block from §6.5 alone,
  without opening another file.
