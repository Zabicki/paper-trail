import { describe, expect, it } from "vitest";

import { sumItems, totalDelta } from "@/components/receipts/receipt-total";

// These two functions decide whether the review panel accuses the user of a
// mismatch between the lines they edited and the total printed on the paragon.
// A false accusation blocks a confirm the user cannot unblock; a missed one lets
// a wrong amount through. Both failure modes are arithmetic, and both are one
// misplaced rounding away.
//
// Every expectation below is hand-written from an external oracle, never derived
// by calling the code under test. The three sources:
//
// 1. `supabase/migrations/20260815164539_create_entries_table.sql:12` —
//    `amount numeric(10, 2) not null check (amount > 0)`. Two decimal places is
//    the storage unit, which is why cents are the rounding unit here; the
//    `> 0` half is enforced upstream in the panel, not in these functions.
// 2. IEEE-754 binary floating point, asserted directly below so a reader can see
//    the drift the rounding exists to absorb rather than taking it on trust.
// 3. `receipt-total.ts:14-21` and `:26-33`, read as a spec: non-finite amounts
//    contribute zero rather than poisoning the sum, and a missing printed total
//    yields no delta at all rather than a delta against zero.

describe("the floating-point facts these functions absorb", () => {
  // Not a test of the module — the premise of the two tests that follow it.
  it("adds tenths inexactly", () => {
    expect(0.1 + 0.2).toBe(0.30000000000000004);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(0.1 + 0.2 + 0.3).toBe(0.6000000000000001);
  });

  it("leaves a residue when an exact match is subtracted naively", () => {
    expect(0.1 + 0.2 - 0.3).toBe(5.551115123125783e-17);
    expect(0.1 + 0.2 - 0.3).not.toBe(0);
  });
});

describe("sumItems", () => {
  it("sums an empty list to zero", () => {
    // The footer must read 0,00 zł on a receipt whose lines were all cleared,
    // not NaN.
    expect(sumItems([])).toBe(0);
  });

  it("adds the amounts of a normal receipt", () => {
    expect(sumItems([{ amount: 12.5 }, { amount: 3.4 }])).toBe(15.9);
  });

  it("treats NaN as a zero contribution rather than poisoning the sum", () => {
    // A half-typed amount ("12,") parses to NaN. The footer must stay readable;
    // the confirm is separately blocked while any amount is unusable, so this
    // figure can never be the one that gets written.
    expect(sumItems([{ amount: Number.NaN }, { amount: 5 }])).toBe(5);
  });

  it("treats Infinity the same way", () => {
    expect(sumItems([{ amount: Number.POSITIVE_INFINITY }, { amount: 5 }])).toBe(5);
    expect(sumItems([{ amount: Number.NEGATIVE_INFINITY }, { amount: 5 }])).toBe(5);
  });

  it("rounds once, on the sum, so tenths add up exactly", () => {
    // The single-rounding property. 0.1 + 0.2 is 0.30000000000000004 in IEEE-754
    // (asserted above); one rounding of the total collapses it to 0.3.
    expect(sumItems([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(sumItems([{ amount: 0.1 }, { amount: 0.2 }, { amount: 0.3 }])).toBe(0.6);
  });

  it("does not round each item before adding", () => {
    // The distinguishing case, and the reason the property is worth pinning:
    // two half-cent lines sum to exactly one cent, whereas rounding each first
    // would round each half-cent UP and report two. That one-cent gap is what
    // the panel would show as a mismatch against the printed total.
    expect(sumItems([{ amount: 0.005 }, { amount: 0.005 }])).toBe(0.01);
    expect(Math.round(0.005 * 100) / 100).toBe(0.01); // what per-item rounding gives, twice over
  });
});

describe("totalDelta", () => {
  it("is null when the receipt showed no total", () => {
    // Nothing to compare against. A delta of `sum - 0` would accuse the user of
    // an error the paragon never showed.
    expect(totalDelta(15.9, null)).toBeNull();
  });

  it("is null when the parsed total is not a finite number", () => {
    expect(totalDelta(15.9, Number.NaN)).toBeNull();
    expect(totalDelta(15.9, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("reads a genuine match as exactly zero", () => {
    // Both sides are rounded before subtracting, so the 5.55e-17 residue
    // asserted above never reaches the comparison. Object.is pins the sign too:
    // -0 would render as "-0,00 zł".
    const delta = totalDelta(0.1 + 0.2, 0.3);

    expect(delta).toBe(0);
    expect(Object.is(delta, 0)).toBe(true);
  });

  it("is positive when the items add up to more than the printed total", () => {
    expect(totalDelta(20, 15)).toBe(5);
  });

  it("is negative when the items add up to less than the printed total", () => {
    expect(totalDelta(15, 20)).toBe(-5);
  });

  it("rounds the difference to cents", () => {
    expect(totalDelta(15.904, 15.9)).toBe(0);
    expect(totalDelta(15.91, 15.9)).toBe(0.01);
  });
});
