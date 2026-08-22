import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANGE_PRESET,
  RANGE_PRESETS,
  addDays,
  bucketFor,
  enumerateBuckets,
  formatBucketLabel,
  inclusiveDayCount,
  isRangePreset,
  resolveRange,
  type DateRange,
  type RangePreset,
} from "@/components/reports/range";
import type { SummaryBucket } from "@/types";

// Every expectation below is hand-written from an external oracle, never derived
// by calling the code under test. The four sources:
//
// 1. **The Gregorian calendar itself**, consulted independently of this
//    repository (`date -u -d …`). The facts this file leans on: 2026 is not a
//    leap year, so February 2026 has 28 days; 21 August 2026 is a Friday and
//    17 August 2026 the Monday of its week; 21 August 1993 is a Saturday.
// 2. **Postgres' documented `date_trunc` semantics** — `date_trunc('week', …)`
//    snaps to Monday — as consumed by
//    `supabase/migrations/20260816103000_add_entries_summary_function.sql`,
//    which buckets with `date_trunc(p_bucket, occurred_on)::date`. That is the
//    thing `enumerateBuckets` has to agree with; range.ts:16-18 and :103-109 say
//    so, and the cost of disagreeing is an invented empty bucket beside every
//    real one.
// 3. **`range.ts` read as a spec, not as an implementation** — its stated rules
//    for the bucket thresholds (`range.ts:148-157`), the `last-3-months` `+1`
//    (`:128-133`), the month-end clamp ("three months before 31 May means
//    28 February", `:92-94`), and the sizing argument behind
//    `ALL_TIME_MAX_MONTHS_BACK` (`:55-69`).
// 4. **`src/lib/services/reports.ts:46`'s `MAX_BUCKETS = 400`**, restated as a
//    literal below because the constant is module-private. The clamp's whole
//    reason for existing is to stay under it.
//
// No clock faking and no mocking anywhere in this file, and none is needed:
// `resolveRange(preset, today, allTimeStart)` takes both `today` and
// `allTimeStart` as **required** parameters (`range.ts:115-118`), so the module
// is deterministic as written. A module that resolved "now" internally would
// not be reachable this cheaply — that parameter is the reason this suite has
// no setup at all.

// A Friday. Chosen so the week-alignment cases below start mid-week rather than
// on a boundary that would pass under a broken startOfWeek too.
const TODAY = "2026-08-21";

// Stands in for what getFirstEntryDate returns — the user's earliest entry.
// Comfortably inside the all-time floor, so the presets table exercises the
// unclamped branch; the clamp gets its own describe block.
const ALL_TIME_START = "2025-11-05";

// src/lib/services/reports.ts:46. Private there, so this is a deliberate second
// copy — the unit is BUCKETS, not rows or days. If that constant moves, the
// all-time clamp's sizing argument has to be re-checked with it.
const SERVICE_MAX_BUCKETS = 400;

interface PresetCase {
  preset: RangePreset;
  from: string;
  to: string;
  days: number;
  bucket: SummaryBucket;
}

// Each row read off a calendar for TODAY = Friday 21 August 2026, then the day
// count confirmed by counting the months out: e.g. "ytd" is
// 31+28+31+30+31+30+31 = 212 days of January–July plus 21 of August = 233.
const PRESET_CASES: PresetCase[] = [
  { preset: "last-7-days", from: "2026-08-15", to: TODAY, days: 7, bucket: "day" },
  { preset: "last-30-days", from: "2026-07-23", to: TODAY, days: 30, bucket: "day" },
  { preset: "this-month", from: "2026-08-01", to: TODAY, days: 21, bucket: "day" },
  { preset: "last-month", from: "2026-07-01", to: "2026-07-31", days: 31, bucket: "week" },
  { preset: "last-3-months", from: "2026-05-22", to: TODAY, days: 92, bucket: "week" },
  { preset: "ytd", from: "2026-01-01", to: TODAY, days: 233, bucket: "month" },
  { preset: "all-time", from: ALL_TIME_START, to: TODAY, days: 290, bucket: "month" },
];

describe("the preset roster", () => {
  it("offers exactly the seven presets this suite covers, in order", () => {
    // Guards the suite itself: an eighth preset added to the picker without a
    // row here would otherwise ship with no resolution test at all.
    expect(RANGE_PRESETS.map((preset) => preset.value)).toEqual(PRESET_CASES.map((testCase) => testCase.preset));
  });

  it("defaults to the 30-day preset", () => {
    expect(DEFAULT_RANGE_PRESET).toBe("last-30-days");
  });

  it("recognises every offered preset and rejects anything else", () => {
    for (const { value } of RANGE_PRESETS) {
      expect(isRangePreset(value)).toBe(true);
    }
    expect(isRangePreset("last-6-months")).toBe(false);
    expect(isRangePreset("")).toBe(false);
    expect(isRangePreset("Last-7-Days")).toBe(false);
    expect(isRangePreset(null)).toBe(false);
  });
});

describe("resolveRange", () => {
  it.each(PRESET_CASES)("resolves $preset to $from … $to", ({ preset, from, to, days, bucket }) => {
    expect(resolveRange(preset, TODAY, ALL_TIME_START)).toEqual({ from, to });
    // Asserted here rather than in a separate case so a preset whose window
    // moved cannot keep its bucket granularity by coincidence.
    expect(inclusiveDayCount({ from, to })).toBe(days);
    expect(bucketFor({ from, to })).toBe(bucket);
  });

  it("ends every preset except last-month on today itself", () => {
    // "Poprzedni miesiąc" is the one closed window; every other preset is
    // open-ended at today. Pinning this stops a preset silently gaining a
    // one-day lag, which reads as a plausible figure rather than an error.
    for (const { value } of RANGE_PRESETS) {
      const { to } = resolveRange(value, TODAY, ALL_TIME_START);
      expect(to).toBe(value === "last-month" ? "2026-07-31" : TODAY);
    }
  });

  it("clamps last-month from a 31-day month onto a 28-day one", () => {
    // Oracle: February 2026 has 28 days — 2026 is not a leap year. The previous
    // month of a 31-day March must end on the 28th, not roll into March.
    expect(resolveRange("last-month", "2026-03-31", ALL_TIME_START)).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(inclusiveDayCount({ from: "2026-02-01", to: "2026-02-28" })).toBe(28);
  });

  it("clamps last-3-months onto a short month rather than rolling forward", () => {
    // Oracle: range.ts:92-94 states the rule as a spec — "three months before
    // 31 May" is 28 February. The `+1` then makes the window open on 1 March.
    // Note this differs from GNU date's `-3 months`, which overflows 31 February
    // into 3 March; the clamp is the deliberate choice, not an accident.
    expect(resolveRange("last-3-months", "2026-05-31", ALL_TIME_START)).toEqual({
      from: "2026-03-01",
      to: "2026-05-31",
    });
    expect(inclusiveDayCount({ from: "2026-03-01", to: "2026-05-31" })).toBe(92);
  });
});

describe("last-3-months stays inside the week bucket all year", () => {
  // The `+1` at range.ts:129-133 exists for exactly one reason: without it a
  // long quarter spans 93 inclusive days, which is one past bucketFor's 92-day
  // boundary, and the same preset silently re-buckets from weeks to months.
  //
  // Expectations below are the calendar's, not resolveRange's: the day *after*
  // the same date three months back, for the 15th of each month of 2026.
  //
  // range.ts:131 calls the resulting span "90–92 days". Observed here it is
  // 89–92 — a February-containing quarter (today 15 May → from 16 February) is
  // 13+31+30+15 = 89. The comment's lower bound is loose; its upper bound, the
  // one the guard turns on, is exact.
  const QUARTER_CASES: { today: string; from: string; days: number }[] = [
    { today: "2026-01-15", from: "2025-10-16", days: 92 },
    { today: "2026-02-15", from: "2025-11-16", days: 92 },
    { today: "2026-03-15", from: "2025-12-16", days: 90 },
    { today: "2026-04-15", from: "2026-01-16", days: 90 },
    { today: "2026-05-15", from: "2026-02-16", days: 89 },
    { today: "2026-06-15", from: "2026-03-16", days: 92 },
    { today: "2026-07-15", from: "2026-04-16", days: 91 },
    { today: "2026-08-15", from: "2026-05-16", days: 92 },
    { today: "2026-09-15", from: "2026-06-16", days: 92 },
    { today: "2026-10-15", from: "2026-07-16", days: 92 },
    { today: "2026-11-15", from: "2026-08-16", days: 92 },
    { today: "2026-12-15", from: "2026-09-16", days: 91 },
  ];

  it.each(QUARTER_CASES)("opens on $from for today $today", ({ today, from, days }) => {
    const range = resolveRange("last-3-months", today, ALL_TIME_START);
    expect(range).toEqual({ from, to: today });
    expect(inclusiveDayCount(range)).toBe(days);
    expect(days).toBeLessThanOrEqual(92);
    expect(bucketFor(range)).toBe("week");
  });

  it("would tip over the 92-day boundary without the +1", () => {
    // The break the teeth check performs, spelled out as an assertion so the
    // reason for the `+1` survives even if someone reads only this file:
    // the same window opened one day earlier is 93 days, i.e. "month".
    expect(inclusiveDayCount({ from: "2025-10-15", to: "2026-01-15" })).toBe(93);
    expect(bucketFor({ from: "2025-10-15", to: "2026-01-15" })).toBe("month");
  });
});

describe("bucketFor at its exact thresholds", () => {
  // Oracle: range.ts:148-157 read as a rule — `days <= 30` is day, `days <= 92`
  // is week, anything longer is month. These four cases are the boundaries; a
  // test that only sampled the interiors would pass for an off-by-one.
  const THRESHOLD_CASES: { range: DateRange; days: number; bucket: SummaryBucket }[] = [
    { range: { from: "2026-08-01", to: "2026-08-30" }, days: 30, bucket: "day" },
    { range: { from: "2026-08-01", to: "2026-08-31" }, days: 31, bucket: "week" },
    { range: { from: "2026-05-22", to: "2026-08-21" }, days: 92, bucket: "week" },
    { range: { from: "2026-05-21", to: "2026-08-21" }, days: 93, bucket: "month" },
  ];

  it.each(THRESHOLD_CASES)("buckets a $days-day range by $bucket", ({ range, days, bucket }) => {
    expect(inclusiveDayCount(range)).toBe(days);
    expect(bucketFor(range)).toBe(bucket);
  });

  it("buckets a single day by day", () => {
    expect(bucketFor({ from: TODAY, to: TODAY })).toBe("day");
  });
});

describe("inclusiveDayCount counts both ends", () => {
  // SQL's side of the same contract is `between p_from and p_to`, which is
  // inclusive at both ends
  // (supabase/migrations/20260816103000_add_entries_summary_function.sql).
  // An exclusive count here would make every preset one day short of the rows
  // the aggregate actually returns.
  it("counts a single day as one", () => {
    expect(inclusiveDayCount({ from: TODAY, to: TODAY })).toBe(1);
  });

  it("counts the 7-day preset as exactly seven days", () => {
    expect(inclusiveDayCount(resolveRange("last-7-days", TODAY, ALL_TIME_START))).toBe(7);
  });

  it("counts across a month boundary", () => {
    expect(inclusiveDayCount({ from: "2026-07-31", to: "2026-08-01" })).toBe(2);
  });

  it("counts across a year boundary", () => {
    expect(inclusiveDayCount({ from: "2025-12-31", to: "2026-01-01" })).toBe(2);
  });

  it("counts February 2026 as 28 days and February 2024 as 29", () => {
    // 2026 is not a leap year; 2024 is.
    expect(inclusiveDayCount({ from: "2026-02-01", to: "2026-02-28" })).toBe(28);
    expect(inclusiveDayCount({ from: "2024-02-01", to: "2024-02-29" })).toBe(29);
  });
});

describe("addDays", () => {
  it("moves forward and backward across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("moves across a year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("crosses February correctly in a non-leap and a leap year", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("is unaffected by the daylight-saving transitions in Europe/Warsaw", () => {
    // 29 March 2026 and 25 October 2026 are the DST changeovers in Poland, the
    // audience this app serves. The module does its arithmetic in UTC
    // (range.ts:5-9) precisely so these are ordinary days; a local-time
    // implementation drops or repeats an hour and lands a day out.
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("returns the same date for a zero shift", () => {
    expect(addDays(TODAY, 0)).toBe(TODAY);
  });
});

describe("enumerateBuckets lines up with date_trunc", () => {
  it("starts the week enumeration on the Monday at or before from", () => {
    // Oracle: 21 August 2026 is a Friday, so its Monday is 17 August — and
    // Postgres' date_trunc('week', '2026-08-21') returns that same Monday.
    // The leading bucket therefore PREDATES range.from, deliberately
    // (range.ts:164-165): that is where the partial leading bucket lives on the
    // SQL side too, so zero-filling against this list matches the aggregate's
    // rows instead of inventing a second, empty bucket beside each one.
    expect(enumerateBuckets({ from: "2026-08-21", to: "2026-09-04" }, "week")).toEqual([
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
  });

  it("leaves a from that is already a Monday where it is", () => {
    expect(enumerateBuckets({ from: "2026-08-17", to: "2026-08-30" }, "week")).toEqual(["2026-08-17", "2026-08-24"]);
  });

  it("starts the month enumeration on the first of from's month", () => {
    expect(enumerateBuckets({ from: "2026-08-21", to: "2026-11-05" }, "month")).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });

  it("crosses a year boundary in month buckets", () => {
    expect(enumerateBuckets({ from: "2025-11-15", to: "2026-02-03" }, "month")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("starts the day enumeration on from itself and covers every day inclusively", () => {
    const range: DateRange = { from: "2026-08-19", to: "2026-08-21" };
    expect(enumerateBuckets(range, "day")).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
    // The day bucket is the one case where the leading bucket cannot predate
    // `from`, so its length is exactly the inclusive day count.
    expect(enumerateBuckets(range, "day")).toHaveLength(inclusiveDayCount(range));
  });

  it("emits a single bucket for a one-day range at every granularity", () => {
    const range: DateRange = { from: TODAY, to: TODAY };
    expect(enumerateBuckets(range, "day")).toEqual([TODAY]);
    expect(enumerateBuckets(range, "week")).toEqual(["2026-08-17"]);
    expect(enumerateBuckets(range, "month")).toEqual(["2026-08-01"]);
  });
});

describe("formatBucketLabel", () => {
  it("abbreviates the Polish month name for month buckets", () => {
    expect(formatBucketLabel("2026-08-01", "month")).toBe("Sie 2026");
    expect(formatBucketLabel("2026-01-01", "month")).toBe("Sty 2026");
    // Three characters of "Październik" is "Paź" — the diacritic is inside the
    // slice, so a byte-wise abbreviation would corrupt it.
    expect(formatBucketLabel("2026-10-01", "month")).toBe("Paź 2026");
  });

  it("labels day and week buckets with the bucket start's day and month", () => {
    expect(formatBucketLabel("2026-08-21", "day")).toBe("21.08");
    expect(formatBucketLabel("2026-08-17", "week")).toBe("17.08");
  });
});

describe("the all-time left-edge clamp", () => {
  // CHARACTERISATION, NOT ENDORSEMENT. These two cases pin behaviour that was
  // accepted as a residual, not behaviour anyone wants.
  //
  // Decision record: range.ts:55-69. ALL_TIME_MAX_MONTHS_BACK = 396 is sized so
  // that 396 + 1 = 397 month buckets stays under the aggregate's
  // MAX_BUCKETS = 400 (src/lib/services/reports.ts:46) — the bound is expressed
  // in MONTHS rather than years for exactly that reason, since a year-granular
  // bound would tip over the guard in December. The entry form's date field
  // carries no min/max and validates on a shape regex alone, so a mistyped year
  // like 0202 is storable, and one such row would otherwise 400 the entire
  // preset for that user.
  //
  // The accepted cost, stated plainly: a user with entries older than ~33 years
  // silently loses the left edge of "Cały okres". No caption, no warning,
  // nothing in the UI says the window was moved. §3 Phase 5's component layer is
  // what would be needed to signal it; this phase's plan explicitly declines to.
  it("returns an allTimeStart inside the floor unchanged", () => {
    expect(resolveRange("all-time", TODAY, "1995-01-01")).toEqual({
      from: "1995-01-01",
      to: TODAY,
    });
  });

  it("silently replaces an allTimeStart older than the floor, keeping `to`", () => {
    // 396 months back from 21 August 2026 is 21 August 1993 — 33 years exactly.
    expect(resolveRange("all-time", TODAY, "1980-06-15")).toEqual({
      from: "1993-08-21",
      to: TODAY,
    });
  });

  it("keeps the clamped span under the aggregate's bucket ceiling", () => {
    // The sizing argument itself, asserted rather than trusted: the widest
    // window the clamp can produce is 397 month buckets — August 1993 through
    // August 2026 inclusive, (2026 - 1993) × 12 + 1 — against a ceiling of 400.
    const clamped = resolveRange("all-time", TODAY, "1900-01-01");
    expect(clamped.from).toBe("1993-08-21");
    expect(bucketFor(clamped)).toBe("month");

    const buckets = enumerateBuckets(clamped, "month");
    expect(buckets).toHaveLength(397);
    expect(buckets[0]).toBe("1993-08-01");
    expect(buckets.at(-1)).toBe("2026-08-01");
    expect(buckets.length).toBeLessThan(SERVICE_MAX_BUCKETS);
  });

  it("moves the floor with `today`, since it is relative", () => {
    // Not an absolute date: the floor is 396 months back from whatever `today`
    // is, so the same stored entry falls inside the window one year and outside
    // it the next.
    expect(resolveRange("all-time", "2026-12-31", "1980-06-15").from).toBe("1993-12-31");
  });
});
