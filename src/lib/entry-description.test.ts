import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_ITEM_SEPARATOR,
  DESCRIPTION_MAX_CODE_POINTS,
  composeGroupedDescription,
  splitDescriptionItems,
} from "@/lib/entry-description";
import { countCodePoints } from "@/lib/text";

// `composeGroupedDescription` builds the one field of the receipt confirm payload
// that is never rendered before it is written: the panel shows a per-category
// amount and an item count, never the joined description. Nothing else in the
// confirm path is invisible to the user, so nothing else can go wrong silently.
//
// Every expectation below is hand-written from an external oracle, never derived
// by calling the code under test. The four sources:
//
// 1. `supabase/migrations/20260816140000_add_entry_description.sql:28` —
//    `check (char_length(description) <= 200)`. That 200 is the only bound that
//    matters; DESCRIPTION_MAX_CODE_POINTS is asserted against it below rather
//    than being used as an expectation, which would be circular.
// 2. Postgres' documented `char_length()` semantics: it counts CODE POINTS, not
//    UTF-16 code units. `truncateCodePoints` exists for this and `text.test.ts`
//    proves it; here it means an all-emoji name truncates at 200 characters, not
//    at 100.
// 3. `Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2 })`, which is what
//    `formatAmountPlain` is: comma decimal, both places, and a U+00A0 thousands
//    separator that appears only from FIVE integer digits up. Verified against
//    Node 22's ICU this session — see NBSP below.
// 4. The module's own stated rules, read as a spec rather than as code:
//    `entry-description.ts:34-40` (a `·` inside a name is replaced, not the
//    " · " sequence, so a boundary can never be faked) and `:47-59` (over-long
//    groups drop WHOLE items from the tail, and only a single item that cannot
//    fit alone has its NAME cut).
//
// Deliberately NOT asserted: the UTF-16-vs-code-point mismatch between this
// module's bound and the zod `.max(200)` in `src/lib/services/entries.ts`. That
// divergence is real for non-BMP input and is recorded as F2 in this change's
// plan; it is carried to `lessons.md` as a class rather than pinned here, and a
// test asserting today's behaviour would enshrine it.

// The database's bound, from the migration named above.
const DB_BOUND = 200;

// U+00A0 NO-BREAK SPACE — what pl-PL groups thousands with. Written as an escape
// so it is visible in a diff; a literal one is indistinguishable from a space.
const NBSP = " ";

const GRINNING = "😀"; // U+1F600 — astral: 1 code point, 2 UTF-16 code units.

describe("DESCRIPTION_MAX_CODE_POINTS", () => {
  it("still matches the database check constraint", () => {
    // The module's header says it mirrors the migration. If the migration ever
    // moves, this is the line that notices — the composer would happily build
    // strings the database then refuses, failing the WHOLE batch.
    expect(DESCRIPTION_MAX_CODE_POINTS).toBe(DB_BOUND);
  });
});

describe("composeGroupedDescription", () => {
  it("returns null for an empty group", () => {
    expect(composeGroupedDescription([])).toBeNull();
  });

  it("returns null when every name is blank", () => {
    // A group of bare amounts would say nothing the row's own figure does not
    // already say, so the column stores NULL instead.
    expect(
      composeGroupedDescription([
        { name: "", amount: 5 },
        { name: "   ", amount: 3 },
      ]),
    ).toBeNull();
  });

  it("renders a single named item as name then amount", () => {
    expect(composeGroupedDescription([{ name: "Chleb", amount: 4.5 }])).toBe("Chleb 4,50");
  });

  it("renders a blank name as the bare amount when at least one sibling is named", () => {
    expect(
      composeGroupedDescription([
        { name: "", amount: 5 },
        { name: "Chleb", amount: 3 },
      ]),
    ).toBe("5,00 · Chleb 3,00");
  });

  it("joins several items with the separator, in the order given", () => {
    expect(
      composeGroupedDescription([
        { name: "Chleb", amount: 4.5 },
        { name: "Mleko", amount: 3.4 },
        { name: "Masło", amount: 8.99 },
      ]),
    ).toBe("Chleb 4,50 · Mleko 3,40 · Masło 8,99");
  });

  it("collapses a middle dot inside a product name rather than faking a boundary", () => {
    // Without the replacement this renders "Mleko · Łaciate 3,40", which
    // splitDescriptionItems then reads as TWO items — the split would lie about
    // what the group contained.
    const result = composeGroupedDescription([{ name: "Mleko · Łaciate", amount: 3.4 }]);

    expect(result).toBe("Mleko Łaciate 3,40");
    expect(splitDescriptionItems("Mleko Łaciate 3,40")).toStrictEqual(["Mleko Łaciate 3,40"]);
  });

  describe("the U+00A0 grouping trap", () => {
    // formatAmountPlain's separator does NOT appear at four integer digits — a
    // receipt line of 1234,50 has no separator at all, and an assertion that
    // assumed one would be wrong in the direction that hides a real change.
    it("uses no separator below five integer digits", () => {
      expect(composeGroupedDescription([{ name: "Telewizor", amount: 1234.5 }])).toBe("Telewizor 1234,50");
    });

    it("uses a no-break space from five integer digits up", () => {
      expect(composeGroupedDescription([{ name: "Laptop", amount: 12345.6 }])).toBe(`Laptop 12${NBSP}345,60`);
    });

    it("groups every three digits in a large amount", () => {
      expect(composeGroupedDescription([{ name: "Mieszkanie", amount: 1234567.89 }])).toBe(
        `Mieszkanie 1${NBSP}234${NBSP}567,89`,
      );
    });
  });

  it("drops whole items from the tail and records how many with +N", () => {
    // Arithmetic, done by hand against DB_BOUND:
    //   each rendered item is "Pozycja testowa numer NN 99,99" = 24 + 1 + 5 = 30
    //   code points; the separator is 3.
    //   all 7 items      -> 7*30 + 6*3 = 228  (over)
    //   6 items plus +1  -> 6*30 + 6*3 + 2 = 200  (fits, exactly at the bound)
    // So item 07 is dropped WHOLE and replaced by the marker. Cutting mid-item
    // would store a truncated price, which reads as a wrong price — worse than
    // storing fewer items.
    const items = [
      { name: "Pozycja testowa numer 01", amount: 99.99 },
      { name: "Pozycja testowa numer 02", amount: 99.99 },
      { name: "Pozycja testowa numer 03", amount: 99.99 },
      { name: "Pozycja testowa numer 04", amount: 99.99 },
      { name: "Pozycja testowa numer 05", amount: 99.99 },
      { name: "Pozycja testowa numer 06", amount: 99.99 },
      { name: "Pozycja testowa numer 07", amount: 99.99 },
    ];
    const expected =
      "Pozycja testowa numer 01 99,99 · Pozycja testowa numer 02 99,99 · Pozycja testowa numer 03 99,99 · Pozycja testowa numer 04 99,99 · Pozycja testowa numer 05 99,99 · Pozycja testowa numer 06 99,99 · +1";

    expect(composeGroupedDescription(items)).toBe(expected);
    // The hand-computed length above, restated as an assertion so a reader can
    // see the result sits ON the bound rather than under it by luck.
    expect(countCodePoints(expected)).toBe(DB_BOUND);
    // Every surviving item still carries its full price.
    expect(splitDescriptionItems(expected)).toStrictEqual([
      "Pozycja testowa numer 01 99,99",
      "Pozycja testowa numer 02 99,99",
      "Pozycja testowa numer 03 99,99",
      "Pozycja testowa numer 04 99,99",
      "Pozycja testowa numer 05 99,99",
      "Pozycja testowa numer 06 99,99",
      "+1",
    ]);
  });

  it("truncates only the name when a single item cannot fit on its own", () => {
    // Budget, by hand: 200 - len("12,50") - 1 for the space - 0 for no marker
    //   = 200 - 5 - 1 = 194 code points of name.
    // The AMOUNT is never cut — a half-written price is the failure this whole
    // rule exists to avoid.
    const expected = `${"A".repeat(194)} 12,50`;

    expect(composeGroupedDescription([{ name: "A".repeat(250), amount: 12.5 }])).toBe(expected);
    expect(countCodePoints(expected)).toBe(DB_BOUND);
  });

  it("truncates that name by code point, not by UTF-16 code unit", () => {
    // Same 194-code-point budget as above. An all-astral name means the result
    // is 194 characters to Postgres and 388 to String.prototype.length — cutting
    // by code unit would both over-truncate and risk a lone surrogate, which
    // PostgREST refuses and which fails the entire batch.
    const expected = `${GRINNING.repeat(194)} 12,50`;

    expect(composeGroupedDescription([{ name: GRINNING.repeat(250), amount: 12.5 }])).toBe(expected);
    expect(countCodePoints(expected)).toBe(DB_BOUND);
    expect(expected.length).toBe(194 * 2 + 6);
  });

  it("reserves room for the +N marker when the over-long item has siblings", () => {
    // Budget, by hand: 200 - len("12,50") - 1 for the space - len(" · +1")
    //   = 200 - 5 - 1 - 5 = 189 code points of name.
    const expected = `${"A".repeat(189)} 12,50 · +1`;

    expect(
      composeGroupedDescription([
        { name: "A".repeat(250), amount: 12.5 },
        { name: "Chleb", amount: 3 },
      ]),
    ).toBe(expected);
    expect(countCodePoints(expected)).toBe(DB_BOUND);
  });

  it("round-trips through splitDescriptionItems", () => {
    const composed = composeGroupedDescription([
      { name: "Chleb", amount: 4.5 },
      { name: "Mleko", amount: 3.4 },
      { name: "Masło", amount: 8.99 },
    ]);

    expect(composed).toBe("Chleb 4,50 · Mleko 3,40 · Masło 8,99");
    expect(splitDescriptionItems("Chleb 4,50 · Mleko 3,40 · Masło 8,99")).toStrictEqual([
      "Chleb 4,50",
      "Mleko 3,40",
      "Masło 8,99",
    ]);
  });
});

describe("splitDescriptionItems", () => {
  it("yields a single element when there is no separator", () => {
    // What keeps the day list's three-item clamp inert for a manual entry.
    expect(splitDescriptionItems("Zakupy spożywcze")).toStrictEqual(["Zakupy spożywcze"]);
  });

  it("yields nothing for an empty description", () => {
    expect(splitDescriptionItems("")).toStrictEqual([]);
  });

  it("splits on the separator and trims each item", () => {
    expect(splitDescriptionItems("Chleb 4,50 · Mleko 3,40")).toStrictEqual(["Chleb 4,50", "Mleko 3,40"]);
  });

  it("drops empty segments rather than emitting blanks", () => {
    expect(splitDescriptionItems("Chleb 4,50 ·  · Mleko 3,40")).toStrictEqual(["Chleb 4,50", "Mleko 3,40"]);
  });

  it("reads a manual description containing the separator as several items", () => {
    // Accepted and stated at entry-description.ts:8-11: it clamps and offers an
    // expand, which loses nothing. Pinned so the behaviour is a decision on
    // record rather than a surprise.
    expect(splitDescriptionItems("Kino · popcorn")).toStrictEqual(["Kino", "popcorn"]);
  });

  it("uses the exported separator, so both sides cannot drift apart", () => {
    expect(DESCRIPTION_ITEM_SEPARATOR).toBe(" · ");
  });
});
