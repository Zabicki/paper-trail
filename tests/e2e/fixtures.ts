import { test as base, expect, type Page } from "@playwright/test";

export { expect };

// The single import boundary for the whole E2E suite: every spec does
// `import { test, expect } from "./fixtures"`, never from "@playwright/test".
//
// That is not style policing. The seed test is the example every later spec is
// modelled on, and its import line is the most-copied line in it — whichever
// module `test` comes from is the module the next spec will reach for. Routing
// it through here means a fixture added tomorrow reaches every spec written
// yesterday, instead of each file quietly bypassing the layer.

/** Where auth.setup.ts persists the signed-in session. Gitignored — it holds a real token. */
export const STORAGE_STATE = "tests/e2e/.auth/user.json";

/**
 * The category every entry spec files its entries under. Provisioned once by
 * auth.setup.ts; see the comment there for why the seed user has none of its own.
 * Named distinctly so it is obvious in the UI that it belongs to the test suite.
 */
export const FIXTURE_CATEGORY = "E2E Kategoria";

/**
 * Wait until every Astro island on the page has hydrated.
 *
 * **Call this after every `goto` and `reload` before touching a React island.**
 * This app is Astro SSR with React islands, and the forms are controlled
 * components. The server sends fully-formed HTML, so inputs are present and
 * fillable *before* React takes over — and when it does, it re-renders them from
 * its own initial state, silently wiping anything typed in the gap. The failure
 * is nasty because nothing errors: the field just ends up empty and the form
 * reports "Podaj adres e-mail" as though nothing was entered.
 *
 * This is the one place the suite uses a structural selector, and it is
 * deliberate: `astro-island[ssr]` is not a user-facing element but Astro's own
 * readiness flag — the runtime calls `removeAttribute("ssr")` the moment a
 * component finishes hydrating (astro/dist/runtime/server/astro-island.js:189).
 * There is no accessible attribute that exposes "this island is interactive",
 * so no getByRole equivalent exists. Everything else in this suite locates
 * elements the way a user perceives them.
 *
 * Safe to await unconditionally: every island in this app is `client:load`, so
 * they all hydrate eagerly. A `client:visible` island scrolled out of view would
 * never drop the attribute and this would time out — revisit if one is added.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

/**
 * Today, on the *browser's* local calendar — the same rule `src/components/
 * entries/date-utils.ts` follows for the day view. Node and the browser share a
 * clock and a timezone here (the config sets no `timezoneId`), so a local
 * computation agrees with what the app is showing. UTC would not: it puts the
 * suite on the wrong day for several hours of every evening in Europe/Warsaw.
 */
function todayLocal(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Remove every entry on `date` carrying exactly this description. Best-effort:
 * a suite that has already failed must not fail a second time in teardown and
 * bury the real error, so a non-OK list response is simply left alone.
 *
 * `page.request` shares the browser context's cookies, so this runs as the
 * signed-in user and RLS scopes it to that user's rows.
 *
 * **The `origin` header is load-bearing.** Astro's `security.checkOrigin` is on
 * by default under `output: "server"` (astro.config.mjs sets no `security`
 * block), and it rejects any non-GET request whose `Origin` does not match the
 * site — `403 Cross-site DELETE form submissions are forbidden`. A browser
 * sends `Origin` on its own; Playwright's APIRequestContext does not, so an
 * API-level write from a test has to supply it. The check exempts requests
 * whose content-type is not form-like, which is why auth.setup.ts's JSON POST
 * to /api/categories sails through and this bodiless DELETE does not — an
 * inconsistency that costs an hour if you meet it without this comment.
 */
async function deleteEntriesDescribed(page: Page, origin: string, date: string, description: string): Promise<void> {
  const response = await page.request.get(`/api/entries?date=${date}`);
  if (!response.ok()) {
    return;
  }
  // Playwright's APIResponse.json() has no generic overload, so this is the one
  // place the repo's `response.json<T>()` convention (CLAUDE.md) cannot apply.
  const entries = (await response.json()) as { id: number; description: string | null }[];
  for (const entry of entries.filter((candidate) => candidate.description === description)) {
    await page.request.delete(`/api/entries/${String(entry.id)}`, { headers: { origin } });
  }
}

interface Fixtures {
  /**
   * A description no other run can produce, for one day entry — and the safety
   * net that deletes whatever ends up carrying it.
   */
  entryDescription: string;
}

export const test = base.extend<Fixtures>({
  // Teardown lives after `use()` on purpose. A spec that deletes its own row on
  // its last line only cleans up when it *passes*; the run that fails halfway is
  // exactly the run that leaves a row behind, and those accumulate in the day
  // list until an unrelated spec trips over one. Fixture teardown runs either
  // way, so the specs keep their user-driven delete step as the thing under
  // test while this guarantees the account is left as it was found.
  //
  // Unique on two axes: the timestamp separates re-runs, `parallelIndex`
  // separates workers. The suite is serial today (workers: 1), so the index is
  // always 0 — it is here so that flipping `fullyParallel` on later does not
  // silently turn every spec into a collision.
  entryDescription: async ({ page, baseURL }, use, testInfo) => {
    const description = `Seed ${String(Date.now())}-${String(testInfo.parallelIndex)}`;
    const date = todayLocal();

    await use(description);

    await deleteEntriesDescribed(page, new URL(baseURL ?? "http://localhost:4321").origin, date, description);
  },
});
