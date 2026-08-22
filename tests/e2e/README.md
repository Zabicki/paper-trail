# E2E Testing Rules

These rules govern every test under `tests/e2e/`. They exist because an agent
will happily produce a test that passes today and breaks on the first refactor;
constraining the output up front is cheaper than reviewing it after.

**The reference test is [`seed.spec.ts`](./seed.spec.ts).** Read it before
writing a new spec, and match its conventions — it is deliberately over-commented
so that each choice explains itself. Point generation prompts at the file by
path rather than pasting it into a prompt: a path cannot drift from the file it
names, and a pasted sample makes agents copy that specific flow verbatim instead
of generalising from it.

## The rules

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for specific conditions:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use unique identifiers for test data to avoid collisions across runs and
  workers, and clean up after the test.
- Use `storageState` for authentication — never log in through the UI in an
  individual test.

## And three that are specific to this app

- **Import `test` and `expect` from `./fixtures`, never from
  `@playwright/test`.** That single line is what keeps every spec inside the
  suite's fixture layer; a spec that bypasses it also bypasses every fixture
  added later.
- **`await waitForHydration(page)` after every `goto` and every `reload`, before
  touching a React island.** This is Astro SSR: the server sends fillable inputs
  before React takes over, and hydration re-renders them from React's own
  initial state — silently discarding anything typed in the gap. Nothing errors;
  the field is just empty and the form claims you left it blank.
- **`page.locator()` is reserved for `waitForHydration`.** Its
  `astro-island[ssr]` selector is Astro's own readiness flag and has no
  accessible equivalent. That is the suite's only structural selector, and it
  stays the only one.

## Prefer the cheapest layer that reaches the risk

E2E is the slowest and most flake-prone layer in this project, so it earns its
place only when a risk **crosses several system boundaries** (auth → routing →
API → RLS) or **exists only in the rendered, hydrated UI**. If a pure function,
a service integration test, an API-route test, or a pgTAP policy test can prove
it, that is where it belongs — see `context/foundation/test-plan.md` §6 for the
cookbook entry per layer, and §6.6 for this one.

E2E is not the same as zero mocking. Internal boundaries — auth, routing,
Supabase — stay real here, because the seams between them are exactly where the
risks live. Mock only expensive or non-deterministic external calls, and note
that `page.route()` cannot intercept a call the _server_ makes; that has to be
mocked where the server makes it.

## Running

```bash
npm run test:e2e                                            # whole suite
npm run test:e2e:ui                                         # watch/debug UI
npx playwright test tests/e2e/seed.spec.ts --project=chromium   # one spec
```

The suite drives a real `astro dev` server on workerd against a real local
Supabase stack, so both have to be up:

```bash
npm ci && npx supabase start -x vector
```

Port 4321 must be free — `reuseExistingServer: false` is a deliberate
sibling-worktree guard (see the comment in `playwright.config.ts`). Set
`E2E_PORT` to move out of the way of a dev server you want to keep.

Credentials default to the local-only seed user from `supabase/seed.sql` and are
overridable via `E2E_EMAIL` / `E2E_PASSWORD`. Never point them at the demo
account: it exists in production.
