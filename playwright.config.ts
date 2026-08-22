import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./tests/e2e/fixtures";

// The E2E suite runs against a real `astro dev` server on workerd and a real
// local Supabase stack. Nothing here is mocked: `test-plan.md`'s risks live in
// the seams between middleware, RLS and the rendered page, so faking any of
// them would test the fake.
//
// Port is pinned rather than discovered, and the server is never reused. This
// is the sibling-worktree guard: `astro dev` auto-increments off 4321 when
// another worktree already holds it (CLAUDE.md), and Astro has no `--strictPort`
// CLI flag to stop it. Were the server reused, Playwright would find *something*
// answering on 4321, call it ready, and run the whole suite against a different
// worktree's app — passing or failing for reasons that have nothing to do with
// this checkout. Refusing to reuse turns that into a loud "port already used"
// at startup. Set E2E_PORT to move out of the way of a dev server you want to keep.
const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_URL = `http://localhost:${String(PORT)}`;

export default defineConfig({
  testDir: "tests/e2e",

  // Serial on purpose. Every test signs in as the same seed user, so they share
  // one account's rows; parallel workers would see each other's entries in the
  // day list and the `listitem` assertions would race.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Signs in once and writes the storage state every other project loads, so
    // no individual spec drives the login form. See tests/e2e/auth.setup.ts.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${String(PORT)}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
