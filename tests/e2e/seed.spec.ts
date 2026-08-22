// risk: test-plan.md #5 — the day list shows something the database does not contain
// seed: tests/e2e/seed.spec.ts
import { test, expect, FIXTURE_CATEGORY, waitForHydration } from "./fixtures";

/**
 * THE SEED TEST — the example every generated E2E test is modelled on.
 *
 * Its job is twofold. Playwright's planner and generator agents run this file
 * first to reach a ready, signed-in page before they explore. And whatever this
 * file does, generated tests will imitate: role locators here produce role
 * locators there, and a `waitForTimeout` here would produce a flaky suite. What
 * you show is what you get — so every line below is a pattern on purpose.
 *
 * The seven patterns it demonstrates:
 *
 *   1. `test` and `expect` imported from `./fixtures`, never from
 *      "@playwright/test" — the suite has one import boundary.
 *   2. Role- and label-based locators only. No CSS, no XPath, no DOM structure.
 *   3. One self-contained cycle — setup, action, assertion, cleanup — so the
 *      test runs standalone, in any order, and leaves nothing behind.
 *   4. Waiting on state, never on time. Web-first assertions auto-retry.
 *   5. Unique test data owned by a fixture, whose teardown runs even when the
 *      test fails.
 *   6. `test.step` around each top-level user action — one nesting level, every
 *      one awaited — so a failure names the act it happened in.
 *   7. A name and an assertion tied to a named risk, not to the UI mechanics.
 *
 * Authentication is deliberately absent: the storage state written by
 * auth.setup.ts is loaded by the project config, so this test starts signed in.
 */
test("saved expense appears in the day list and survives a reload", async ({ page, entryDescription }) => {
  const amount = "12.34";

  // Scoped to this run's row. The per-row Edytuj/Usuń buttons repeat down the
  // list, so an unscoped getByRole('button', { name: 'Usuń' }) would be strict-
  // mode ambiguous the moment a second entry exists. `filter` rather than
  // `.first()`: position is not identity.
  const row = page.getByRole("listitem").filter({ hasText: entryDescription });

  await test.step("open the day view", async () => {
    await page.goto("/dashboard");

    // The day view is a controlled React island: interacting before it hydrates
    // lets React discard the input on its first render, and the failure is silent.
    await waitForHydration(page);
  });

  await test.step("save an expense in the day's form", async () => {
    // The category chips are radios inside a `Kategoria` radiogroup; the form's
    // submit button stays disabled until one is chosen (EntryForm.tsx:114).
    //
    // `exact: true` on both fields is not decoration. getByLabel matches on
    // substring AND case-insensitively, and a saved row can render buttons
    // labelled "Zwiń opis wpisu" / "Pokaż pozostałe pozycje opisu" — both of which
    // contain "opis". Without exact this test passes today and turns into a
    // strict-mode violation the first time a description wraps.
    await page.getByRole("radio", { name: FIXTURE_CATEGORY }).click();
    await page.getByLabel("Kwota", { exact: true }).fill(amount);
    await page.getByLabel("Opis", { exact: true }).fill(entryDescription);

    await page.getByRole("button", { name: "Zapisz wydatek" }).click();
  });

  await test.step("the entry appears in the day list", async () => {
    await expect(row).toBeVisible();

    // Assert the business outcome — the amount actually landed — rather than just
    // that some element appeared. An assertion that cannot fail when risk #5
    // materialises is not protecting anything.
    await expect(row).toContainText(amount.replace(".", ","));
  });

  await test.step("the entry survives a reload", async () => {
    // This reload is the point of the test. Before it, the row could be nothing
    // more than optimistic local state; after it, the list has been re-read from
    // the server, so a row that survives is a row the database actually holds.
    await page.reload();
    await waitForHydration(page);

    await expect(row).toBeVisible();
    await expect(row).toContainText(amount.replace(".", ","));
  });

  await test.step("delete the entry", async () => {
    // Deleting through the UI is the pattern to copy — the fixture's teardown is
    // a safety net for the failing run, not a substitute for exercising the flow.
    //
    // Delete goes through window.confirm (DayEntriesList.tsx:183). Playwright
    // auto-DISMISSES native dialogs unless a handler says otherwise, so without
    // this line the click resolves, the test still passes, and nothing is deleted.
    page.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Usuń" }).click();

    // Wait on the outcome of the delete, not on a duration.
    await expect(row).toHaveCount(0);
  });
});
