import { describe, expect, it } from "vitest";

import {
  MIN_SHARE,
  POZOSTALE_FILL,
  TOP_N,
  formatCollapsedLabel,
  resolveDistribution,
} from "@/components/reports/distribution";
import { formatShare } from "@/lib/format";
import type { CategorySummary, CategoryTotal } from "@/types";

// Every expectation below is hand-written from an external oracle, never derived
// by calling the code under test. The four sources:
//
// 1. **The selection rule as specified BEFORE the code existed** —
//    `context/foundation/charts_recommendations.md:63-64` and
//    `context/foundation/charts_analysis.md:179`: "render the N largest
//    individually, collapse the tail into one neutral-grey slice labelled with
//    its count (`Pozostałe (7)`) … N ≈ 8, or 'above 2% of total', whichever
//    gives fewer slices." That document is the design note the module was
//    written from, which is exactly the pre-code oracle
//    `context/foundation/test-plan.md` §6.1 asks for.
// 2. **`src/types.ts:262-277` read as a DTO contract** — `CategorySummary.total`
//    comes "from the `()` grouping-set row — an exact Postgres numeric, never a
//    JavaScript sum of `categories[].total`. Every percentage on the board
//    divides by this." The fixtures below deliberately exercise that: several
//    carry a `total` that does NOT equal the sum of their `categories`, which is
//    the only way a test can tell "divided by the SQL total" apart from
//    "divided by whatever happens to be in the list".
// 3. **Arithmetic done by hand.** Every share, every collapsed sum, and every
//    boundary is worked out on paper from the fixture's own numbers and written
//    as a literal; none is obtained by running `resolveDistribution` and copying
//    what came back.
// 4. **IEEE-754 double arithmetic and `Intl.NumberFormat`'s documented
//    `maximumFractionDigits` rounding**, for the two characterisation cases at
//    the bottom of this file.
//
// **The colour derivation is deliberately out of scope** — slot derivation from
// the categoryId, the HSL tier shifts, and the greedy de-collision walk with its
// measured membership-dependent residual (`distribution.ts:268-284`). A wrong
// colour is a cosmetic defect; a wrong number is §2 risk #2, and this file is
// the risk-#2 half. The residual is already measured and written down at the
// source, so a test would restate rather than protect it. `fill` is therefore
// only ever asserted to be *present and derived per category*, never to be a
// particular hex.
//
// No mocking and no fixture files: `resolveDistribution` is a pure function of
// one plain object.

// The Board B totals are expense sums, so a fixture is fully described by an
// amount. Ids are spaced ONE APART on purpose: consecutive ids can never be
// congruent mod 36, so no fixture here trips the de-collision walk and none of
// these cases depends on colour behaviour it does not assert.
function cat(categoryId: number, total: number): CategoryTotal {
  return { categoryId, name: `Kategoria ${String(categoryId)}`, icon: "tag", total };
}

// `total` is passed SEPARATELY from the amounts rather than summed from them.
// That separation is the point — it is what the `()` grouping-set row is on the
// wire, and collapsing the two here would quietly make every share assertion
// below untestable.
function summaryOf(total: number, amounts: number[]): CategorySummary {
  return {
    bucket: "month",
    from: "2026-08-01",
    to: "2026-08-31",
    // Descending, tie-broken by name — the order src/types.ts:268-271 promises
    // and the order top-N selection walks.
    categories: amounts.map((amount, index) => cat(index + 1, amount)),
    points: [],
    total,
  };
}

describe("the constants match the pre-code design note", () => {
  it("renders the eight largest and floors a slice at 2%", () => {
    // charts_recommendations.md:63-64 — "N ≈ 8, or 'above 2% of total'". Pinned
    // as literals because every case below is arithmetic against these two
    // numbers; if one moves, this case names the reason the others went red.
    expect(TOP_N).toBe(8);
    expect(MIN_SHARE).toBe(0.02);
  });

  it("gives the collapsed slice a theme token rather than a palette hex", () => {
    // `Pozostałe` is not a category, so it has no id to derive a fill from and
    // must stay readable in dark mode (distribution.ts:26-37).
    expect(POZOSTALE_FILL).toBe("var(--muted-foreground)");
  });
});

describe("selection — whichever rule yields fewer slices wins", () => {
  it("collapses past the eighth when every category clears the floor", () => {
    // Ten categories summing to 1000; the smallest is 40, i.e. 4%, so the share
    // floor excludes none of them and top-N is the binding rule.
    const distribution = resolveDistribution(summaryOf(1000, [200, 150, 130, 110, 100, 90, 70, 60, 50, 40]));

    expect(distribution.visible.map((slice) => slice.total)).toEqual([200, 150, 130, 110, 100, 90, 70, 60]);
    expect(distribution.collapsed.map((slice) => slice.total)).toEqual([50, 40]);
    expect(distribution.collapsedTotal).toBe(90);
  });

  it("never pads: three categories render as three slices, not eight", () => {
    // The half of the rule that a plain `slice(0, 8)` would also satisfy, and
    // that a "always show eight" implementation would not.
    const distribution = resolveDistribution(summaryOf(300, [150, 100, 50]));

    expect(distribution.visible).toHaveLength(3);
    expect(distribution.collapsed).toEqual([]);
    expect(distribution.collapsedTotal).toBe(0);
  });

  it("stops at the floor when fewer than eight categories clear it", () => {
    // Twelve categories of a 1000 total, so the floor sits at 20. Above it:
    // 300, 250, 200, 100, 30 — five. At or below it: 20, 20, 20, 20, 20, 15, 5
    // — seven. Five is fewer than eight, so the floor is the binding rule and
    // the board renders five slices plus `Pozostałe (7)`.
    const distribution = resolveDistribution(summaryOf(1000, [300, 250, 200, 100, 30, 20, 20, 20, 20, 20, 15, 5]));

    expect(distribution.visible.map((slice) => slice.total)).toEqual([300, 250, 200, 100, 30]);
    expect(distribution.collapsed).toHaveLength(7);
    // 20 + 20 + 20 + 20 + 20 + 15 + 5 = 120.
    expect(distribution.collapsedTotal).toBe(120);
  });

  it("treats a category at exactly 2% as below the floor, not on it", () => {
    // The comparison is `> MIN_SHARE`, not `>=` (distribution.ts:231), so a
    // slice sitting exactly on 2% collapses. Fixture of 1000: 940 (94%),
    // 21 (2.1%, clears), 20 (exactly 2%, does not), 19 (1.9%, does not).
    //
    // The three quotients are exact as doubles — IEEE-754 division is correctly
    // rounded, so 20/1000 is bit-identical to the literal 0.02 and the boundary
    // is decided by the comparison rather than by rounding noise.
    const distribution = resolveDistribution(summaryOf(1000, [940, 21, 20, 19]));

    expect(distribution.visible.map((slice) => slice.total)).toEqual([940, 21]);
    expect(distribution.collapsed.map((slice) => slice.total)).toEqual([20, 19]);
    expect(distribution.collapsedTotal).toBe(39);
  });

  it("keeps the DTO's descending order and carries each category through intact", () => {
    // Selection is a split of `categories`, not a re-sort of it: the ranking
    // rows, the donut arcs and the stacked series all read this order, and the
    // name and icon are what identify a row once the amount is rendered.
    const distribution = resolveDistribution(summaryOf(1000, [200, 150, 130, 110, 100, 90, 70, 60, 50, 40]));
    const rendered = [...distribution.visible, ...distribution.collapsed];

    expect(rendered.map((slice) => slice.categoryId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rendered.map((slice) => slice.name)).toEqual([
      "Kategoria 1",
      "Kategoria 2",
      "Kategoria 3",
      "Kategoria 4",
      "Kategoria 5",
      "Kategoria 6",
      "Kategoria 7",
      "Kategoria 8",
      "Kategoria 9",
      "Kategoria 10",
    ]);
    expect(rendered.every((slice) => slice.icon === "tag")).toBe(true);
    // Every slice carries a fill — asserted as "derived at all", never as a
    // particular hex; see the scope note in the header.
    expect(rendered.every((slice) => slice.fill.startsWith("#"))).toBe(true);
    expect(distribution.total).toBe(1000);
  });
});

describe("share is of the SQL total, never of the visible subset", () => {
  it("divides by the () grouping-set row even when the listed categories fall short of it", () => {
    // The fixture's categories sum to 100 + 60 + 40 = 200, while the SQL total
    // is 400 — the shape you get when the `()` row counts entries whose
    // categories are not all in this list. Hand-computed shares against 400:
    // 100/400 = 0.25, 60/400 = 0.15, 40/400 = 0.10. Against the visible subset
    // they would be 0.50, 0.30, 0.20 — twice as large, and plausible.
    //
    // Read off the FULL slice list rather than off `visible`, deliberately: a
    // share is a property of a category, not of which side of the top-N cut it
    // landed on. Asserting through `visible` would couple this case to the
    // selection rule and it would go red on a floor change that left every share
    // correct — a test that fails for the wrong reason cannot be trusted when it
    // fails for the right one.
    const distribution = resolveDistribution(summaryOf(400, [100, 60, 40]));
    const shares = [...distribution.visible, ...distribution.collapsed].map((slice) => slice.share);

    expect(shares).toEqual([0.25, 0.15, 0.1]);
    expect(distribution.total).toBe(400);
  });

  it("keeps a collapsed slice on the same denominator as a visible one", () => {
    // A collapsed slice is still measured against the range total, so expanding
    // `Pozostałe` cannot make its rows report a different percentage than the
    // one the collapsed row implied. Ten categories of 1000, so the tail's own
    // two are 50/1000 = 0.05 and 40/1000 = 0.04 — the same arithmetic as the
    // eight above them, keyed by id so the assertion survives a re-cut.
    const distribution = resolveDistribution(summaryOf(1000, [200, 150, 130, 110, 100, 90, 70, 60, 50, 40]));
    const shareById = new Map(
      [...distribution.visible, ...distribution.collapsed].map((slice) => [slice.categoryId, slice.share]),
    );

    // 200/1000 (visible, first), 60/1000 (visible, last), then the two the
    // top-N cut sends into the tail.
    expect(shareById.get(1)).toBe(0.2);
    expect(shareById.get(8)).toBe(0.06);
    expect(shareById.get(9)).toBe(0.05);
    expect(shareById.get(10)).toBe(0.04);
  });
});

describe("the zero-total guard", () => {
  // CHARACTERISATION of an explicit guard, not of an accident. The board renders
  // its empty state before a zero total can reach here, but `shareOf` guards it
  // anyway (distribution.ts:223-228) because a bare division would hand every
  // chart NaN — and NaN renders as a BLANK SLICE rather than as an error, so the
  // failure would be silent in exactly the way §2 risk #2 describes.
  const zeroTotal = resolveDistribution(summaryOf(0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

  it("reports every share as 0 rather than NaN", () => {
    const shares = [...zeroTotal.visible, ...zeroTotal.collapsed].map((slice) => slice.share);

    // Asserted as a whole array rather than through `every`, so a regression
    // prints `NaN` against `0` in the diff instead of "expected false to be
    // true" — the failure has to name the value for the guard to be worth
    // pinning.
    expect(shares).toEqual(Array.from({ length: 10 }, () => 0));
    expect(shares.some((share) => Number.isNaN(share))).toBe(false);
  });

  it("degrades selection to top-N alone, since the floor cannot apply", () => {
    // With no total to measure against there is no such thing as "above 2%", so
    // `aboveMinShare` falls back to the full category count and top-N is all
    // that is left. Ten categories therefore split 8 / 2 rather than collapsing
    // wholesale into `Pozostałe`.
    expect(zeroTotal.visible).toHaveLength(8);
    expect(zeroTotal.collapsed).toHaveLength(2);
    expect(zeroTotal.collapsedTotal).toBe(0);
  });
});

describe("the all-below-the-floor degenerate case", () => {
  // CHARACTERISATION, NOT ENDORSEMENT. Reachable and unguarded: with a positive
  // total and no category above 2%, `aboveMinShare` is 0, `visibleCount` is 0,
  // and the board renders a single `Pozostałe (50)` row standing at ~100% with
  // no individual slice beside it. Nothing in the module treats that as special.
  //
  // Fifty categories at 20 each against a total of 1000: every one sits at
  // exactly 2%, which the strict `>` excludes. A user who splits spending evenly
  // across many categories lands here, so it is a real shape rather than a
  // constructed one.
  const flat = resolveDistribution(
    summaryOf(
      1000,
      Array.from({ length: 50 }, () => 20),
    ),
  );

  it("renders nothing individually", () => {
    expect(flat.visible).toEqual([]);
    expect(flat.collapsed).toHaveLength(50);
  });

  it("puts the whole range total into the collapsed row", () => {
    // 50 × 20 = 1000, and that sum is exact in binary — no float residual here,
    // unlike the case below.
    expect(flat.collapsedTotal).toBe(1000);
    expect(flat.collapsedTotal / flat.total).toBe(1);
    expect(formatCollapsedLabel(flat.collapsed.length)).toBe("Pozostałe (50)");
  });
});

describe("collapsedTotal is summed once, here", () => {
  // Computed in the model rather than re-derived by each chart that renders the
  // tail (review finding F10: CategoryRanking, CategoryDonut and
  // CategoryTrendChart each summed it independently — three float sums of the
  // same numbers, three chances to disagree about one figure on one screen).
  //
  // ⚠ THIS IS THE ONE PLACE ON THE BOARD WHERE THE NUMERATOR AND THE
  // DENOMINATOR COME FROM DIFFERENT ARITHMETIC. Every visible slice's share is
  // an exact Postgres `numeric` over an exact Postgres `numeric`. The
  // `Pozostałe` share is a JavaScript float `reduce` (distribution.ts:302) over
  // an exact Postgres `numeric`. The parts are not guaranteed to sum to the
  // whole by construction the way the SQL grouping sets guarantee it upstream.
  it("equals the hand-added tail amounts", () => {
    const distribution = resolveDistribution(summaryOf(1000, [200, 150, 130, 110, 100, 90, 70, 60, 50, 40]));

    // 50 + 40 = 90, added by hand.
    expect(distribution.collapsedTotal).toBe(90);
    // And the share the board prints beside `Pozostałe`: 90/1000 = 0.09. Unlike
    // the per-category shares above, this one legitimately moves with the
    // selection rule — it is a property of the cut, not of a category.
    expect(distribution.collapsedTotal / distribution.total).toBe(0.09);
  });

  it("carries the float residual of that sum, rather than an exact numeric", () => {
    // CHARACTERISATION. Eight categories clear the 2% floor (2% of 99.3 is
    // 1.986, and the smallest of the eight is 4); the tail is 0.20 and 0.10 —
    // two ordinary grosz amounts. Oracle: IEEE-754 binary64 cannot represent
    // 0.1 or 0.2 exactly, and their sum is the documented 0.30000000000000004,
    // the textbook example of the representation error.
    //
    // Postgres would have returned exactly 0.30 for the same sum. The residual
    // is ~4e-17 and cannot survive `formatShare`'s one decimal place, so it is
    // accepted rather than fixed — but it is pinned here so that a future reader
    // who does need exactness (a "parts add up to the whole" assertion, a
    // reconciliation view) finds the fact recorded instead of rediscovering it.
    const distribution = resolveDistribution(summaryOf(99.3, [30, 20, 15, 10, 8, 7, 5, 4, 0.2, 0.1]));

    expect(distribution.collapsed.map((slice) => slice.total)).toEqual([0.2, 0.1]);
    expect(distribution.collapsedTotal).not.toBe(0.3);
    expect(distribution.collapsedTotal).toBeCloseTo(0.3, 10);
  });
});

describe("percentages are not re-normalised to 100", () => {
  it("renders nine equal ninths as nine × 11,1%, i.e. 99,9%", () => {
    // CHARACTERISATION, NOT A DEFECT TO FIX. Nine categories of 100 against a
    // total of 900: each is 100/900 = 11.111…%, and `formatShare`
    // (src/lib/format.ts:36-39, `maximumFractionDigits: 1`) rounds each
    // INDEPENDENTLY to 11,1%. Nine rows of 11,1% read as 99,9% down the column.
    //
    // Oracle: `Intl.NumberFormat`'s documented per-value rounding — it formats
    // one number at a time and has no notion of a set that must total 100.
    // Largest-remainder apportionment is the alternative and it is deliberately
    // not used: it would print a share that does not match the row's own
    // amount ÷ total, which is a worse lie than a column that reads 99,9%.
    //
    // The ninth row is `Pozostałe (1)`: nine categories all clear the floor, so
    // top-N is binding and collapses exactly one of them.
    const distribution = resolveDistribution(
      summaryOf(
        900,
        Array.from({ length: 9 }, () => 100),
      ),
    );

    expect(distribution.visible).toHaveLength(8);
    expect(distribution.collapsed).toHaveLength(1);

    const rendered = [
      ...distribution.visible.map((slice) => formatShare(slice.share)),
      formatShare(distribution.collapsedTotal / distribution.total),
    ];

    expect(rendered).toEqual(["11,1%", "11,1%", "11,1%", "11,1%", "11,1%", "11,1%", "11,1%", "11,1%", "11,1%"]);
    // Stated as arithmetic so the shortfall is legible without adding up the
    // strings above: nine rows at 11,1 each is 99,9, not 100.
    expect(9 * 11.1).toBeCloseTo(99.9, 10);
  });
});

describe("formatCollapsedLabel", () => {
  it("names the tail with its count", () => {
    // The `(n)` is load-bearing: it is one of the three things that
    // disambiguate `Pozostałe` from a real category whose derived fill lands
    // near the muted token (distribution.ts:31-36).
    expect(formatCollapsedLabel(7)).toBe("Pozostałe (7)");
    expect(formatCollapsedLabel(1)).toBe("Pozostałe (1)");
  });

  it("still renders a count of zero, since the caller decides whether to show the row", () => {
    // The board hides the row when nothing collapsed; the formatter does not
    // second-guess that, so a `Pozostałe (0)` on screen points at the caller.
    expect(formatCollapsedLabel(0)).toBe("Pozostałe (0)");
  });
});
