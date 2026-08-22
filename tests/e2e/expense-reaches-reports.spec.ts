// risk: test-plan.md #2 — a KPI or chart reads plausibly but is wrong, rows
//       silently dropped; and #5 — the day list shows something the database
//       does not contain
// seed: tests/e2e/seed.spec.ts
import { test, expect, waitForHydration } from "./fixtures";

/**
 * One expense, entered once, read back through BOTH surfaces that report it.
 *
 * The seed test proves a saved entry survives a reload of the page that created
 * it. This one crosses further: the day view writes, and `/reports` reads the
 * same row back through an entirely different path — a Postgres aggregate
 * (`entries_category_summary`), a range resolved in the browser, and a chart
 * model (`resolveDistribution`) that decides which categories are rendered
 * individually at all. Nothing below the write is shared between the two
 * surfaces, which is why this is an E2E and not a component test: risk #2's
 * failure is precisely a row that exists, shows in the list, and then quietly
 * fails to arrive in the aggregate.
 *
 * WHY THE EXPECTED FIGURE IS TRUSTWORTHY. `reportCategory` mints a category for
 * this run alone, so the report's total for it can only be this test's one
 * entry. The expectation is therefore hand-written arithmetic — one entry of
 * AMOUNT means a category total of AMOUNT — and never a number read out of the
 * app and compared against itself. That is `test-plan.md` §6.1's oracle rule
 * applied at this layer, and it is what makes a dropped row fail the test
 * instead of quietly changing both sides of the comparison.
 */

// U+00A0 NO-BREAK SPACE and U+2212 MINUS SIGN, written as escapes rather than as
// literal characters. §6.6 asks for the literal so it shows up in a diff, and
// that is right for a unit expectation; here it would be a lie — a U+00A0 is
// pixel-identical to a space in every diff view, and this file carries three of
// them plus a minus sign that is not a hyphen. Named constants say which
// codepoint is meant and make a wrong one impossible to write by accident.
const NBSP = "\u00A0";
const MINUS = "\u2212";

// Five significant digits on purpose. `formatCurrency` (pl-PL) emits a group
// separator only ABOVE four digits — 1234.56 renders "1234,56 zł" with no
// separator at all — so a four-digit amount would leave the NBSP thousands
// separator untested, which is the trap §6.6's Phase 2 note records. Large
// enough, too, that the category clears `distribution.ts`'s MIN_SHARE floor and
// is rendered as its own ranking row rather than folded into "Pozostałe".
const AMOUNT = "12345.67";
const AMOUNT_IN_DAY_LIST = `${MINUS}12${NBSP}345,67${NBSP}zł`;
const AMOUNT_IN_REPORT = `12${NBSP}345,67${NBSP}zł`;

test("an expense saved in the day view is attributed to its category in the reports", async ({
  page,
  entryDescription,
  reportCategory,
}) => {
  // Scoped by the description, which is unique to this run. `filter` rather than
  // `.first()`: position is not identity, and the day list holds whatever else
  // the account has for today.
  const dayListRow = page.getByRole("listitem").filter({ hasText: entryDescription });

  await test.step("open the day view", async () => {
    await page.goto("/dashboard");

    // The day view is a controlled React island: interacting before it hydrates
    // lets React discard the input on its first render, and the failure is silent.
    await waitForHydration(page);
  });

  await test.step("save an expense under this run's own category", async () => {
    // The chip list collapses to five (CategoryPicker.tsx:23) and orders by
    // recency, so a category created moments ago sits in the hidden alphabetical
    // tail on any account with a few categories. Typing into the search box is
    // not a workaround for that — the component documents it as "the
    // one-interaction escape hatch to any chip, hidden or not" (:43-44), and it
    // is what a user reaching for a rarely-used category actually does. It also
    // makes this step independent of how many categories the account holds,
    // which a bare getByRole on the chip would not be.
    await page.getByLabel("Szukaj kategorii").fill(reportCategory);
    await page.getByRole("radio", { name: reportCategory }).click();

    // `exact: true` on both fields: getByLabel matches on substring and
    // case-insensitively, and a saved row can render buttons labelled "Zwiń opis
    // wpisu" / "Pokaż pozostałe pozycje opisu", both of which contain "opis".
    await page.getByLabel("Kwota", { exact: true }).fill(AMOUNT);
    await page.getByLabel("Opis", { exact: true }).fill(entryDescription);

    await page.getByRole("button", { name: "Zapisz wydatek" }).click();
  });

  await test.step("the day list shows the expense against that category", async () => {
    await expect(dayListRow).toBeVisible();

    // Both halves matter. The category name is what the reports assertion below
    // is going to look for, so a row filed under the wrong category has to fail
    // HERE rather than surfacing as a confusing miss two steps later; the amount
    // is the figure the whole test is about. The list signs expenses with U+2212
    // (DayEntriesList.tsx:362) while the reports surface leaves them unsigned —
    // the two expectations differ on purpose, and neither is a typo.
    await expect(dayListRow).toContainText(reportCategory);
    await expect(dayListRow).toContainText(AMOUNT_IN_DAY_LIST);
  });

  await test.step("the category report attributes the amount to that category", async () => {
    // A fresh navigation, not a client-side transition: this is the point of the
    // test. Everything the day list showed could still be state held by the
    // island that wrote it. What renders here has been through Postgres'
    // aggregate and back.
    await page.goto("/reports");
    await waitForHydration(page);

    // "Przegląd" is the default board (BoardSwitcher.tsx:14); the per-category
    // figures live on "Kategorie". The default range is "Ostatnie 30 dni"
    // (range.ts:DEFAULT_RANGE_PRESET), which contains today — left untouched so
    // this test exercises the range a user actually lands on.
    await page.getByRole("radio", { name: "Kategorie" }).click();

    // The ranking is the only list on this board — the donut and the trend chart
    // both deliberately render no legend, each naming the ranking as their
    // text-equivalent (CategoryDonut.tsx:14, CategoryTrendChart.tsx:19). So a
    // listitem carrying this run's category name is that category's ranking row,
    // and it stays unambiguous however many categories the account has.
    const rankingRow = page.getByRole("listitem").filter({ hasText: reportCategory });

    await expect(rankingRow).toBeVisible();

    // The assertion the risk is about. This category was created for this run
    // and holds exactly one entry, so its range total is that entry's amount —
    // arithmetic done here, not a figure read back out of the app. A row dropped
    // anywhere between the write and the aggregate leaves this row absent or
    // showing a smaller number; both fail.
    await expect(rankingRow).toContainText(AMOUNT_IN_REPORT);
  });

  // No delete step. The seed's user-driven delete is there because deletion is
  // part of the flow it covers; this test's flow ends at the report, and
  // `entryDescription`'s teardown removes the row whether this run passed or
  // failed — which is the run that actually leaks.
});
