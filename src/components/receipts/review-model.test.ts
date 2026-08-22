import { describe, expect, it } from "vitest";

import {
  evaluateConfirmGate,
  evaluateRows,
  groupByCategory,
  isReceiptDateRejected,
  resolveSaveDate,
  seedReviewRows,
  toConfirmItems,
  wholeReceiptItem,
  type EvaluatedRow,
  type ReviewRow,
} from "@/components/receipts/review-model";

// This module is the whole model behind the receipt review panel's confirm: it
// decides how many entries get written, how the printed lines fold into them,
// what amount each carries, and which day they land on. Risk #1 of
// `context/foundation/test-plan.md` §2 is precisely that this disagrees with the
// preview the user approved — and until this change the only guard on any of it
// was a code comment.
//
// Every expectation below is hand-written from an external oracle, never
// produced by calling the code under test. The sources:
//
// 1. `supabase/migrations/20260815164539_create_entries_table.sql` —
//    `amount numeric(10, 2) not null check (amount > 0)` and
//    `category_id ... not null`. Those two constraints are what the skip rules
//    and the hard block stand in front of: a row failing either cannot be
//    stored, so the preview must not promise it.
// 2. IEEE-754 binary floating point: `0.1 + 0.2 + 0.3` is `0.6000000000000001`,
//    asserted in `receipt-total.test.ts`. A group's amount is a SINGLE rounding
//    of the sum, which is what collapses it back to `0.6`.
// 3. `Intl.NumberFormat("pl-PL")` with two fraction digits, via
//    `formatAmountPlain` — a comma decimal separator, and no thousands
//    separator below five digits. The description literals below are written out
//    character by character rather than composed.
// 4. Dates are YYYY-MM-DD on both sides, so a lexicographic compare IS a
//    chronological one — no `Date` parsing, and therefore no timezone question.

function row(overrides: Partial<ReviewRow> & Pick<ReviewRow, "key">): ReviewRow {
  return { name: "Pozycja", amountText: "1.00", categoryId: 1, ...overrides };
}

function evaluated(input: { row: ReviewRow; amount: number; amountValid?: boolean }): EvaluatedRow {
  return { row: input.row, amount: input.amount, amountValid: input.amountValid ?? true };
}

describe("seedReviewRows", () => {
  it("seeds the amount field with a bare number, never a formatted currency string", () => {
    // The mistake the panel's comment warns about: formatCurrency would put
    // "12,50 zł" into the input, and evaluateRows would then read NaN out of
    // every single row on a freshly parsed receipt.
    const rows = seedReviewRows([{ name: "Mleko", amount: 12.5, categoryId: 3 }]);

    expect(rows).toEqual([{ key: 0, name: "Mleko", amountText: "12.50", categoryId: 3 }]);
  });

  it("pads and truncates to two decimals, matching numeric(10, 2)", () => {
    const rows = seedReviewRows([
      { name: "A", amount: 3, categoryId: 1 },
      { name: "B", amount: 3.456, categoryId: 1 },
    ]);

    expect(rows[0].amountText).toBe("3.00");
    expect(rows[1].amountText).toBe("3.46");
  });

  it("assigns keys from the parse order and carries a missing category through as null", () => {
    // categoryId null is a correction task for the user, never a reason to drop
    // a real purchase.
    const rows = seedReviewRows([
      { name: "Mleko", amount: 3.4, categoryId: 3 },
      { name: "Chleb", amount: 4.2, categoryId: null },
    ]);

    expect(rows.map((entry) => entry.key)).toEqual([0, 1]);
    expect(rows[1].categoryId).toBeNull();
  });

  it("seeds nothing for a receipt with no readable lines", () => {
    expect(seedReviewRows([])).toEqual([]);
  });
});

describe("evaluateRows", () => {
  it("reads a Polish comma decimal", () => {
    // The field is inputMode="decimal" and a Polish keyboard produces a comma.
    const [entry] = evaluateRows([row({ key: 0, amountText: "12,50" })]);

    expect(entry.amount).toBe(12.5);
    expect(entry.amountValid).toBe(true);
  });

  it("reads a dot decimal too — that is what seedReviewRows writes", () => {
    const [entry] = evaluateRows([row({ key: 0, amountText: "12.50" })]);

    expect(entry.amount).toBe(12.5);
    expect(entry.amountValid).toBe(true);
  });

  it("rejects an empty field", () => {
    // Number("") is 0, which would pass a naive finite check and then fail
    // `check (amount > 0)` at the database. The trim guard is what catches it.
    const [entry] = evaluateRows([row({ key: 0, amountText: "" })]);

    expect(entry.amountValid).toBe(false);
  });

  it("rejects a whitespace-only field", () => {
    expect(evaluateRows([row({ key: 0, amountText: "   " })])[0].amountValid).toBe(false);
  });

  it("rejects text that is not a number", () => {
    const [entry] = evaluateRows([row({ key: 0, amountText: "abc" })]);

    expect(Number.isNaN(entry.amount)).toBe(true);
    expect(entry.amountValid).toBe(false);
  });

  it("rejects zero — the check (amount > 0) oracle", () => {
    expect(evaluateRows([row({ key: 0, amountText: "0" })])[0].amountValid).toBe(false);
    expect(evaluateRows([row({ key: 0, amountText: "0,00" })])[0].amountValid).toBe(false);
  });

  it("rejects a negative amount", () => {
    // A refund is not an expense row. Same constraint, other side of zero.
    expect(evaluateRows([row({ key: 0, amountText: "-5" })])[0].amountValid).toBe(false);
  });

  it("keeps the row itself attached, so the caller can still reach its category", () => {
    const source = row({ key: 7, name: "Mleko", amountText: "3,40", categoryId: 9 });

    expect(evaluateRows([source])[0].row).toBe(source);
  });
});

describe("groupByCategory", () => {
  it("preserves first-appearance order when a category reappears later", () => {
    // The saved order tracks the order things were printed on the paragon. A
    // category seen at line 1 and again at line 3 folds into its FIRST position,
    // not a third group and not a new one at the end.
    const groups = groupByCategory([
      evaluated({ row: row({ key: 0, name: "Mleko", categoryId: 3 }), amount: 3.4 }),
      evaluated({ row: row({ key: 1, name: "Szampon", categoryId: 8 }), amount: 12 }),
      evaluated({ row: row({ key: 2, name: "Chleb", categoryId: 3 }), amount: 4.2 }),
    ]);

    expect(groups.map((group) => group.categoryId)).toEqual([3, 8]);
    expect(groups[0].amount).toBe(7.6);
    expect(groups[1].amount).toBe(12);
  });

  it("carries every folded line into the group's items, in printed order", () => {
    // The preview renders items.length as "(N)" — the count is the whole point,
    // because it is what tells the user this row is a fold of several.
    const groups = groupByCategory([
      evaluated({ row: row({ key: 0, name: "Mleko", categoryId: 3 }), amount: 3.4 }),
      evaluated({ row: row({ key: 1, name: "Chleb", categoryId: 3 }), amount: 4.2 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([
      { name: "Mleko", amount: 3.4 },
      { name: "Chleb", amount: 4.2 },
    ]);
  });

  it("skips a row with no category rather than grouping it", () => {
    // entries.category_id is NOT NULL. Such a row is separately hard-blocking;
    // including it here would make the preview promise a write that cannot
    // happen.
    const groups = groupByCategory([
      evaluated({ row: row({ key: 0, name: "Mleko", categoryId: 3 }), amount: 3.4 }),
      evaluated({ row: row({ key: 1, name: "Zagadka", categoryId: null }), amount: 9.99 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].categoryId).toBe(3);
    expect(groups[0].amount).toBe(3.4);
  });

  it("skips a row whose amount is unusable", () => {
    const groups = groupByCategory([
      evaluated({ row: row({ key: 0, name: "Mleko", categoryId: 3 }), amount: 3.4 }),
      evaluated({ row: row({ key: 1, name: "Pusta", categoryId: 3 }), amount: Number.NaN, amountValid: false }),
    ]);

    expect(groups[0].items).toEqual([{ name: "Mleko", amount: 3.4 }]);
    expect(groups[0].amount).toBe(3.4);
  });

  it("produces no groups at all when nothing is storable", () => {
    expect(groupByCategory([])).toEqual([]);
    expect(
      groupByCategory([evaluated({ row: row({ key: 0, categoryId: null }), amount: 1, amountValid: false })]),
    ).toEqual([]);
  });

  it("rounds the group amount ONCE, on the sum", () => {
    // Three tenths in one category. Rounding each line first and the total again
    // can drift by a cent, and a cent is enough to turn a sum the user saw match
    // into a stored mismatch. In IEEE-754 the naive sum is 0.6000000000000001.
    const groups = groupByCategory([
      evaluated({ row: row({ key: 0, categoryId: 3 }), amount: 0.1 }),
      evaluated({ row: row({ key: 1, categoryId: 3 }), amount: 0.2 }),
      evaluated({ row: row({ key: 2, categoryId: 3 }), amount: 0.3 }),
    ]);

    expect(groups[0].amount).toBe(0.6);
    expect(groups[0].amount).not.toBe(0.6000000000000001);
  });

  it("does not round each line before adding", () => {
    // Two half-cent lines sum to exactly one cent. Per-item rounding would round
    // each half-cent up and report two.
    const groups = groupByCategory([
      evaluated({ row: row({ key: 0, categoryId: 3 }), amount: 0.005 }),
      evaluated({ row: row({ key: 1, categoryId: 3 }), amount: 0.005 }),
    ]);

    expect(groups[0].amount).toBe(0.01);
  });
});

describe("resolveSaveDate / isReceiptDateRejected", () => {
  // Four exhaustive cases over the one comparison these two share. `occurredOn`
  // stands in for "today" because the calendar cannot select a future day.

  it("falls back to the calendar day when the paragon had no readable date", () => {
    expect(resolveSaveDate(null, "2026-08-21")).toBe("2026-08-21");
    expect(isReceiptDateRejected(null, "2026-08-21")).toBe(false);
  });

  it("adopts a printed date in the past", () => {
    // The point of the whole feature: a receipt photographed days later files to
    // the day it was actually spent.
    expect(resolveSaveDate("2026-08-14", "2026-08-21")).toBe("2026-08-14");
    expect(isReceiptDateRejected("2026-08-14", "2026-08-21")).toBe(false);
  });

  it("adopts a printed date equal to the calendar day", () => {
    // The boundary is inclusive: today's receipt is not a future receipt.
    expect(resolveSaveDate("2026-08-21", "2026-08-21")).toBe("2026-08-21");
    expect(isReceiptDateRejected("2026-08-21", "2026-08-21")).toBe(false);
  });

  it("refuses a printed date in the future and says so", () => {
    // A misread year is the failure that files a receipt somewhere the calendar
    // cannot casually reach. This is the ONLY case that raises the amber notice.
    expect(resolveSaveDate("2027-01-02", "2026-08-21")).toBe("2026-08-21");
    expect(isReceiptDateRejected("2027-01-02", "2026-08-21")).toBe(true);
  });

  it("compares across a month and a year boundary without parsing a Date", () => {
    // Zero-padded YYYY-MM-DD sorts chronologically as a plain string, which is
    // why there is no timezone question here to get wrong.
    expect(resolveSaveDate("2026-07-31", "2026-08-01")).toBe("2026-07-31");
    expect(resolveSaveDate("2026-09-01", "2026-08-31")).toBe("2026-08-31");
    expect(resolveSaveDate("2025-12-31", "2026-01-01")).toBe("2025-12-31");
    expect(isReceiptDateRejected("2026-08-22", "2026-08-21")).toBe(true);
  });
});

describe("toConfirmItems", () => {
  it("emits one item per group, in group order, each amount paired with ITS OWN category", () => {
    // The assertion that catches a wrong loop variable. Both fields are numbers,
    // so swapping a neighbouring group's categoryId in here typechecks clean and
    // silently files every złoty under the wrong category.
    const items = toConfirmItems([
      { categoryId: 3, amount: 7.6, items: [{ name: "Mleko", amount: 3.4 }] },
      { categoryId: 8, amount: 12, items: [{ name: "Szampon", amount: 12 }] },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].categoryId).toBe(3);
    expect(items[0].amount).toBe(7.6);
    expect(items[1].categoryId).toBe(8);
    expect(items[1].amount).toBe(12);
  });

  it("writes the group's lines into the description the user never sees", () => {
    // Literal, not composed: formatAmountPlain is pl-PL with two fraction digits
    // and no thousands separator below five digits, and the separator is
    // DESCRIPTION_ITEM_SEPARATOR (" · ", U+00B7 between two ordinary spaces).
    const items = toConfirmItems([
      {
        categoryId: 3,
        amount: 7.6,
        items: [
          { name: "Mleko", amount: 3.4 },
          { name: "Chleb", amount: 4.2 },
        ],
      },
    ]);

    expect(items[0].description).toBe("Mleko 3,40 · Chleb 4,20");
  });

  it("stores null rather than a string of bare amounts when no line had a name", () => {
    const items = toConfirmItems([
      {
        categoryId: 3,
        amount: 7.6,
        items: [
          { name: "", amount: 3.4 },
          { name: "  ", amount: 4.2 },
        ],
      },
    ]);

    expect(items[0].description).toBeNull();
  });

  it("emits nothing for no groups", () => {
    // hardBlocked already guarantees a non-empty confirm, but the batch schema's
    // .min(1) is what would 400.
    expect(toConfirmItems([])).toEqual([]);
  });
});

describe("wholeReceiptItem", () => {
  it("files the printed total under the chosen category as one entry named Paragon", () => {
    // The exit from a blocked confirm. "Paragon" is an honest name for what the
    // row is, and is what makes a wrong categorisation recognisable later.
    expect(wholeReceiptItem(42.5, 8)).toEqual([{ amount: 42.5, categoryId: 8, description: "Paragon" }]);
  });

  it("rounds the total to cents before it can reach numeric(10, 2)", () => {
    expect(wholeReceiptItem(0.1 + 0.2, 8)[0].amount).toBe(0.3);
    expect(wholeReceiptItem(19.999, 8)[0].amount).toBe(20);
  });
});

describe("evaluateConfirmGate", () => {
  const okRow = row({ key: 0, categoryId: 3, amountText: "12.50" });
  const okEvaluated = [evaluated({ row: okRow, amount: 12.5 })];

  it("allows the confirm when every row is storable and the sum matches", () => {
    const gate = evaluateConfirmGate({
      rows: [okRow],
      evaluated: okEvaluated,
      delta: 0,
      acknowledged: false,
      submitting: false,
    });

    expect(gate).toEqual({
      missingCategory: false,
      invalidAmount: false,
      hardBlocked: false,
      deltaMismatch: false,
      canConfirmItems: true,
    });
  });

  it("allows the confirm when the paragon showed no total to compare against", () => {
    // delta null is "nothing to compare", not "mismatch". Accusing the user of
    // an error the paragon never showed would block a confirm they cannot
    // unblock.
    const gate = evaluateConfirmGate({
      rows: [okRow],
      evaluated: okEvaluated,
      delta: null,
      acknowledged: false,
      submitting: false,
    });

    expect(gate.deltaMismatch).toBe(false);
    expect(gate.canConfirmItems).toBe(true);
  });

  it("hard-blocks an empty receipt", () => {
    // Nothing to write. The whole-receipt path is the way forward here.
    const gate = evaluateConfirmGate({
      rows: [],
      evaluated: [],
      delta: null,
      acknowledged: true,
      submitting: false,
    });

    expect(gate.hardBlocked).toBe(true);
    expect(gate.canConfirmItems).toBe(false);
  });

  it("hard-blocks a row with no category, and says which block it is", () => {
    // entries.category_id is NOT NULL — there is nothing to acknowledge.
    const noCategory = row({ key: 1, categoryId: null });
    const gate = evaluateConfirmGate({
      rows: [okRow, noCategory],
      evaluated: [...okEvaluated, evaluated({ row: noCategory, amount: 5 })],
      delta: 0,
      acknowledged: true,
      submitting: false,
    });

    expect(gate.missingCategory).toBe(true);
    expect(gate.invalidAmount).toBe(false);
    expect(gate.hardBlocked).toBe(true);
    expect(gate.canConfirmItems).toBe(false);
  });

  it("hard-blocks an unusable amount, and says which block it is", () => {
    const badAmount = row({ key: 1, amountText: "" });
    const gate = evaluateConfirmGate({
      rows: [okRow, badAmount],
      evaluated: [...okEvaluated, evaluated({ row: badAmount, amount: 0, amountValid: false })],
      delta: 0,
      acknowledged: true,
      submitting: false,
    });

    expect(gate.invalidAmount).toBe(true);
    expect(gate.missingCategory).toBe(false);
    expect(gate.hardBlocked).toBe(true);
    expect(gate.canConfirmItems).toBe(false);
  });

  it("soft-blocks a sum that disagrees with the paragon until it is acknowledged", () => {
    // Suspicious, not impossible. The checkbox is what turns bad data into a
    // deliberate choice rather than an accident — so unlike the hard blocks,
    // this one has a way through.
    const blocked = evaluateConfirmGate({
      rows: [okRow],
      evaluated: okEvaluated,
      delta: -1.5,
      acknowledged: false,
      submitting: false,
    });
    const acknowledged = evaluateConfirmGate({
      rows: [okRow],
      evaluated: okEvaluated,
      delta: -1.5,
      acknowledged: true,
      submitting: false,
    });

    expect(blocked.deltaMismatch).toBe(true);
    expect(blocked.hardBlocked).toBe(false);
    expect(blocked.canConfirmItems).toBe(false);
    expect(acknowledged.canConfirmItems).toBe(true);
  });

  it("does not let an acknowledgement unblock a hard block", () => {
    // The two blocks are structurally different and conflating them would let a
    // ticked checkbox submit a row the database will refuse.
    const noCategory = row({ key: 1, categoryId: null });
    const gate = evaluateConfirmGate({
      rows: [okRow, noCategory],
      evaluated: [...okEvaluated, evaluated({ row: noCategory, amount: 5 })],
      delta: -1.5,
      acknowledged: true,
      submitting: false,
    });

    expect(gate.canConfirmItems).toBe(false);
  });

  it("blocks while a submit is in flight, whatever else is true", () => {
    // The double-write guard on the client side of the idempotency key.
    const gate = evaluateConfirmGate({
      rows: [okRow],
      evaluated: okEvaluated,
      delta: 0,
      acknowledged: true,
      submitting: true,
    });

    expect(gate.hardBlocked).toBe(false);
    expect(gate.deltaMismatch).toBe(false);
    expect(gate.canConfirmItems).toBe(false);
  });
});
