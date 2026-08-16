// Preset → concrete dates, and the bucket arithmetic that follows from them.
//
// Co-located with the feature rather than living in src/lib/, following the
// src/components/entries/date-utils.ts precedent.
//
// The `today` these functions take is always the browser's local date — see
// date-utils.ts for why that resolution can never move to the server. Once
// `today` is in hand every other calculation here is pure ISO-string
// arithmetic done in UTC, which keeps it timezone-free and deterministic.

import { POLISH_MONTH_NAMES } from "@/components/entries/date-utils";
import type { SummaryBucket } from "@/types";

export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS = [
  { value: "last-7-days", label: "Ostatnie 7 dni" },
  { value: "last-30-days", label: "Ostatnie 30 dni" },
  { value: "this-month", label: "Ten miesiąc" },
  { value: "last-month", label: "Poprzedni miesiąc" },
  { value: "last-3-months", label: "Ostatnie 3 miesiące" },
  { value: "ytd", label: "Od początku roku" },
  { value: "all-time", label: "Cały okres" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export const DEFAULT_RANGE_PRESET: RangePreset = "last-30-days";

const PRESET_VALUES = new Set<string>(RANGE_PRESETS.map((preset) => preset.value));

export function isRangePreset(value: string | null): value is RangePreset {
  return value !== null && PRESET_VALUES.has(value);
}

// "Cały okres" still has to resolve to two concrete dates, because that is
// what the aggregate takes. A literal epoch floor is not usable: the endpoint's
// bucket guard (src/lib/services/reports.ts) rejects any span implying more
// than 400 buckets, and 1970 → today is ~680 months, so the preset would
// answer 400 every time. Twenty years is far beyond anything this app can
// hold, caps the span at ~252 month buckets, and — being relative — never
// drifts into the guard as the years pass.
const ALL_TIME_YEARS_BACK = 20;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function toUtcDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(dateString: string, days: number): string {
  const date = toUtcDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function addMonths(dateString: string, months: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  // Day 0 of the following month is the last day of the target one. Clamping
  // to it is what makes "three months before 31 May" mean 28 February rather
  // than rolling forward into March.
  const lastDayOfTarget = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return toDateString(new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDayOfTarget))));
}

function startOfMonth(dateString: string): string {
  return `${dateString.slice(0, 7)}-01`;
}

// Monday-first, matching both POLISH_WEEKDAY_LABELS and Postgres'
// date_trunc('week', …) — the bucket starts this produces have to line up
// exactly with the ones the aggregate returns, or zero-filling would invent a
// second, empty bucket beside every real one.
function startOfWeek(dateString: string): string {
  return addDays(dateString, -((toUtcDate(dateString).getUTCDay() + 6) % 7));
}

export function inclusiveDayCount({ from, to }: DateRange): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000) + 1;
}

export function resolveRange(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case "last-7-days":
      return { from: addDays(today, -6), to: today };
    case "last-30-days":
      return { from: addDays(today, -29), to: today };
    case "this-month":
      return { from: startOfMonth(today), to: today };
    case "last-month":
      return { from: addMonths(startOfMonth(today), -1), to: addDays(startOfMonth(today), -1) };
    case "last-3-months":
      // The day *after* the same date three months back, so the span is
      // exactly three calendar months (90–92 days). Without the +1 it would be
      // 91–93 and would tip over bucketFor's 92-day boundary in long quarters,
      // silently re-bucketing the same preset from weeks to months.
      return { from: addDays(addMonths(today, -3), 1), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all-time":
      return { from: `${Number(today.slice(0, 4)) - ALL_TIME_YEARS_BACK}-01-01`, to: today };
  }
}

// Derived from the range length, never picked by the user: FR-013 is a single
// preset picker, and exposing the bucket as a second control would turn one
// decision into two without answering a question the first one doesn't.
export function bucketFor(range: DateRange): SummaryBucket {
  const days = inclusiveDayCount(range);
  if (days <= 30) {
    return "day";
  }
  if (days <= 92) {
    return "week";
  }
  return "month";
}

// The complete ordered bucket-start sequence for a range. The aggregate only
// returns buckets that have entries, so a chart drawn straight from its rows
// would skip empty days entirely and draw a continuous line over a gap. Filling
// against this list makes those gaps render as the zeros they are.
//
// The first entry can predate `range.from` for the week and month buckets,
// because that is where date_trunc puts the partial leading bucket too.
export function enumerateBuckets(range: DateRange, bucket: SummaryBucket): string[] {
  const buckets: string[] = [];

  if (bucket === "month") {
    for (let cursor = startOfMonth(range.from); cursor <= range.to; cursor = addMonths(cursor, 1)) {
      buckets.push(cursor);
    }
    return buckets;
  }

  const step = bucket === "week" ? 7 : 1;
  for (let cursor = bucket === "week" ? startOfWeek(range.from) : range.from; cursor <= range.to; ) {
    buckets.push(cursor);
    cursor = addDays(cursor, step);
  }
  return buckets;
}

export function formatBucketLabel(bucketStart: string, bucket: SummaryBucket): string {
  const [year, month, day] = bucketStart.split("-");
  if (bucket === "month") {
    // Abbreviated: a full-year range puts twelve of these on one axis, and
    // "Październik" is wider than the tick it labels.
    return `${POLISH_MONTH_NAMES[Number(month) - 1].slice(0, 3)} ${year}`;
  }
  return `${day}.${month}`;
}
