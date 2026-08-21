import { describe, expect, it } from "vitest";

import { countCodePoints, truncateCodePoints } from "@/lib/text";

// Every expectation below is hand-written from an external oracle, never derived
// by calling the code under test. The three sources:
//
// 1. `supabase/migrations/20260816140000_add_entry_description.sql:28` —
//    `check (char_length(description) <= 200)`.
// 2. Postgres' documented `char_length()` semantics: it counts CODE POINTS, not
//    UTF-16 code units, so a string of 200 emoji is 200 characters to the
//    database and 400 to `String.prototype.length`.
// 3. The UTF-16 spec fact this module exists for: `"a😀b".slice(0, 2)` cuts
//    between the two halves of a surrogate pair and yields a lone surrogate,
//    while `[..."a😀b"].length === 3`.
//
// Deliberately NOT asserted: grapheme-cluster behaviour. `text.ts:11-19` argues
// that clustering is the wrong unit — it would under-count against the database
// bound and let an over-long value through. A test encoding it would enshrine
// the bug the module rejects.

// The database's bound, from the migration named above.
const DB_BOUND = 200;

const GRINNING = "😀"; // U+1F600 — astral: 1 code point, 2 UTF-16 code units.

/**
 * True when `value` contains an unpaired surrogate — the exact corruption
 * PostgREST refuses to store. Written against the UTF-16 spec rather than
 * reusing anything from the module under test.
 */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    const isHigh = unit >= 0xd800 && unit <= 0xdbff;
    const isLow = unit >= 0xdc00 && unit <= 0xdfff;
    if (isHigh) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++; // consumed a well-formed pair
      continue;
    }
    if (isLow) return true; // a low surrogate with no high before it
  }
  return false;
}

describe("countCodePoints", () => {
  it("counts an empty string as zero", () => {
    expect(countCodePoints("")).toBe(0);
  });

  it("counts BMP characters one apiece", () => {
    expect(countCodePoints("abc")).toBe(3);
    expect(countCodePoints("zażółć")).toBe(6);
  });

  it("counts an astral character as one, the way Postgres char_length() does", () => {
    // The whole reason this function exists: JavaScript's own .length says 4.
    expect("a😀b".length).toBe(4);
    expect(countCodePoints("a😀b")).toBe(3);
  });

  it("counts an all-astral string at half its UTF-16 length", () => {
    const value = GRINNING.repeat(DB_BOUND);
    expect(value.length).toBe(DB_BOUND * 2);
    expect(countCodePoints(value)).toBe(DB_BOUND);
  });
});

describe("truncateCodePoints", () => {
  it("returns a value that already fits unchanged", () => {
    expect(truncateCodePoints("abc", 10)).toBe("abc");
    expect(truncateCodePoints("a😀b", 3)).toBe("a😀b");
  });

  it("returns a value at exactly the bound unchanged", () => {
    expect(truncateCodePoints("abc", 3)).toBe("abc");
  });

  it("drops exactly one code point at bound + 1", () => {
    expect(truncateCodePoints("abcd", 3)).toBe("abc");
  });

  it("keeps bound - 1 code points when asked for one less", () => {
    expect(truncateCodePoints("abc", 2)).toBe("ab");
  });

  it("never emits a lone surrogate when the cut lands inside a surrogate pair", () => {
    // `.slice(0, 2)` is the defect this module replaced: it cuts by code UNIT,
    // so it splits the pair and produces a string PostgREST cannot store.
    const naive = "a😀b".slice(0, 2);
    expect(naive.length).toBe(2);
    expect(hasLoneSurrogate(naive)).toBe(true);

    const safe = truncateCodePoints("a😀b", 2);
    expect(hasLoneSurrogate(safe)).toBe(false);
    expect(safe).toBe("a😀");
    // Well-formed AND short: 2 code points, which is 3 UTF-16 units.
    expect(countCodePoints(safe)).toBe(2);
    expect(safe.length).toBe(3);
  });

  it("truncates an all-astral string to the database bound, not the UTF-16 bound", () => {
    const overLong = GRINNING.repeat(DB_BOUND + 1);
    const truncated = truncateCodePoints(overLong, DB_BOUND);

    expect(countCodePoints(truncated)).toBe(DB_BOUND);
    expect(truncated.length).toBe(DB_BOUND * 2);
    expect(hasLoneSurrogate(truncated)).toBe(false);
  });

  it("returns an empty string when the bound is zero", () => {
    expect(truncateCodePoints("a😀b", 0)).toBe("");
  });
});
