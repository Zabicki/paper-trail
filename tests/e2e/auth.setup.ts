import { test as setup, expect, FIXTURE_CATEGORY, STORAGE_STATE, waitForHydration } from "./fixtures";

// Runs once, before every other project (see `dependencies` in
// playwright.config.ts). Two jobs, both deliberately kept OUT of the specs:
//
//   1. Sign in and persist the session, so no individual test drives the login
//      form. That is the project's E2E rule — "use storageState for
//      authentication, never log in through UI in individual tests" — and it is
//      also why signing in is not itself an E2E scenario: `test-plan.md` §7
//      lists auth mechanics as deliberately untested. We test what auth *gates*.
//   2. Guarantee the one piece of account state the specs cannot create for
//      themselves cheaply. See FIXTURE_CATEGORY below.
//
// Credentials default to the local-only seed user from supabase/seed.sql, which
// exists solely for tests and carries an auth.identities row specifically so a
// real password sign-in works (seed.sql:6-9). Override via env for any other
// environment. Never point these at the demo account: its password is
// deliberately absent from this repo and it exists in production.
const EMAIL = process.env.E2E_EMAIL ?? "rls-test-user-a@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "rls-test-password";

setup("authenticate and provision fixture data", async ({ page }) => {
  await page.goto("/auth/signin");

  // The sign-in form is a controlled React island. Filling before it hydrates
  // lets React wipe the values on its first render. See waitForHydration.
  await waitForHydration(page);

  // Two disambiguations here, both load-bearing:
  //
  //   `exact: true` on the password field — getByLabel matches on SUBSTRING by
  //   default, and the field's own visibility toggle is labelled "Pokaż hasło",
  //   which contains "Hasło". Without exact, this is a strict-mode violation
  //   resolving to the input and the button.
  //
  //   The role scope on the submit button — the <h1> above the form carries the
  //   same "Zaloguj się" text.
  await page.getByLabel("E-mail", { exact: true }).fill(EMAIL);
  await page.getByLabel("Hasło", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // The sign-in endpoint answers with a 302, so waiting on the URL is the
  // honest signal that auth actually succeeded. A failure redirects back to
  // /auth/signin?error=... and this times out — which is the intended loud
  // failure when Supabase is down or .dev.vars is unset.
  await page.waitForURL("**/dashboard");

  // Prove we reached the intended tenant rather than merely *a* rendered page.
  // Topbar renders these server-side, so no hydration wait is involved.
  await expect(page.getByText(EMAIL)).toBeVisible();
  await expect(page.getByRole("button", { name: "Wyloguj się" })).toBeVisible();

  // The entry form cannot submit without a category (EntryForm.tsx:114 gates the
  // submit button on `selectedCategoryId !== null`), and the seed user owns none
  // — the 30 demo categories belong to a different account, and no trigger seeds
  // defaults on signup. So one category has to exist before any entry spec can
  // run. Created over the API rather than through the category dialog: it is
  // setup, not the behaviour under test, and driving a dialog here would put a
  // second UI flow in the failure path of every spec.
  //
  // Idempotent by way of the route's own duplicate handling — 201 on first run,
  // 409 on every run after. `page.request` shares the browser context's cookies,
  // so this is authenticated as the user we just signed in as.
  const response = await page.request.post("/api/categories", {
    data: { name: FIXTURE_CATEGORY, kind: "expense" },
  });
  expect(
    [201, 409],
    `Fixture category could not be provisioned: ${String(response.status())} ${await response.text()}`,
  ).toContain(response.status());

  await page.context().storageState({ path: STORAGE_STATE });
});
