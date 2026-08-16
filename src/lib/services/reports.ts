import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase";
import type { EntriesSummary, RangeSummary, SummaryBucket, SummaryPoint } from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const summaryQuerySchema = z.object({
  from: z.string("Nieprawidłowa data początkowa").regex(DATE_PATTERN, { message: "Nieprawidłowa data początkowa" }),
  to: z.string("Nieprawidłowa data końcowa").regex(DATE_PATTERN, { message: "Nieprawidłowa data końcowa" }),
  bucket: z.enum(["day", "week", "month"], { message: "Nieprawidłowy podział zakresu" }),
  // "shown" rather than a boolean so the value round-trips through the URL as
  // something a human reading /reports?recurring=hidden can interpret.
  recurring: z.enum(["shown", "hidden"], { message: "Nieprawidłowa wartość filtra" }).default("shown"),
});

export type SummaryQueryInput = z.infer<typeof summaryQuerySchema>;

// PostgREST caps a response at max_rows = 1000 and TRUNCATES rather than
// erroring, so a hand-crafted bucket=day over a decade would silently return a
// partial aggregate that still looks like a valid answer. 400 buckets is
// ~802 rows including the grand totals, comfortably clear of the cap while
// far beyond any range the preset picker can produce.
const MAX_BUCKETS = 400;

export class RangeTooLargeError extends Error {
  constructor() {
    super("Range implies too many buckets");
    this.name = "RangeTooLargeError";
  }
}

interface DateRange {
  from: string;
  to: string;
}

// Plain calendar arithmetic on ISO date strings — deliberately UTC-based and
// timezone-free, because by the time a range reaches this module it is two
// concrete dates the client already resolved. "Today" never enters here; see
// src/components/entries/date-utils.ts for why that resolution has to stay in
// the browser (Workers run UTC).
function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear().toString()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function inclusiveDayCount({ from, to }: DateRange): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(diff / 86_400_000) + 1;
}

// The previous range ends the day before `from` and covers the same number of
// inclusive days — not the same calendar month or week. Equal length is what
// makes the KPI deltas and the cumulative chart's bucket-for-bucket
// comparison meaningful.
export function previousRange(range: DateRange): DateRange {
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(inclusiveDayCount(range) - 1)), to };
}

// An upper bound, not an exact count — this only has to be tight enough to
// keep the response under PostgREST's cap, and overestimating a week or month
// span by one bucket costs nothing.
function bucketCountUpperBound(range: DateRange, bucket: SummaryBucket): number {
  const days = inclusiveDayCount(range);
  if (bucket === "day") {
    return days;
  }
  if (bucket === "week") {
    return Math.ceil(days / 7) + 1;
  }
  const [fy, fm] = range.from.split("-").map(Number);
  const [ty, tm] = range.to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// The RPC result is untyped (`any` out of PostgREST), so the shape is declared
// here and asserted once at the boundary, matching how entries.ts handles
// EntryRow. `total` is widened to string because numeric is a type PostgREST
// is entitled to serialise either way; Number() normalises it before it can
// reach arithmetic.
interface SummaryRow {
  bucket_start: string | null;
  entry_type: string;
  total: number | string;
}

// supabase.rpc() is `any` end to end on an untyped client, so the response is
// asserted to this once at the boundary. Doing it here rather than on
// `data` at the call site is what keeps the destructuring itself from being
// an unsafe-any assignment under strictTypeChecked.
interface SummaryResponse {
  data: SummaryRow[] | null;
  error: PostgrestError | null;
}

function toRangeSummary(range: DateRange, rows: SummaryRow[]): RangeSummary {
  const byBucket = new Map<string, SummaryPoint>();
  const totals = { expense: 0, income: 0 };

  for (const row of rows) {
    const amount = Number(row.total);
    const isIncome = row.entry_type === "income";

    // bucket_start is null on the `grouping sets` grand-total rows.
    if (row.bucket_start === null) {
      if (isIncome) {
        totals.income = amount;
      } else {
        totals.expense = amount;
      }
      continue;
    }

    let point = byBucket.get(row.bucket_start);
    if (!point) {
      point = { bucketStart: row.bucket_start, expense: 0, income: 0 };
      byBucket.set(row.bucket_start, point);
    }
    if (isIncome) {
      point.income = amount;
    } else {
      point.expense = amount;
    }
  }

  // The function returns no ORDER BY — grouping sets makes the row order an
  // implementation detail — so sorting is this layer's job. ISO dates sort
  // correctly as strings.
  const points = [...byBucket.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));

  // A range with only expenses still reports income: 0 rather than omitting
  // the key, so every consumer can read both without a presence check.
  return { from: range.from, to: range.to, points, totals };
}

export async function getEntriesSummary(supabase: SupabaseClient, input: SummaryQueryInput): Promise<EntriesSummary> {
  const current: DateRange = { from: input.from, to: input.to };

  if (bucketCountUpperBound(current, input.bucket) > MAX_BUCKETS) {
    throw new RangeTooLargeError();
  }

  const previous = previousRange(current);
  const excludeRecurring = input.recurring === "hidden";

  // Two calls rather than one wider query, so the previous-period boundary
  // logic lives in exactly one place (previousRange). Both are covered by
  // entries_user_id_occurred_on_idx and issued in parallel — the sequential
  // per-result error checks below mirror listCategoriesForEntryForm.
  const [currentResult, previousResult] = (await Promise.all([
    supabase.rpc("entries_summary", {
      p_from: current.from,
      p_to: current.to,
      p_bucket: input.bucket,
      p_exclude_recurring: excludeRecurring,
    }),
    supabase.rpc("entries_summary", {
      p_from: previous.from,
      p_to: previous.to,
      p_bucket: input.bucket,
      p_exclude_recurring: excludeRecurring,
    }),
  ])) as [SummaryResponse, SummaryResponse];

  if (currentResult.error) {
    throw currentResult.error;
  }
  if (previousResult.error) {
    throw previousResult.error;
  }

  return {
    bucket: input.bucket,
    current: toRangeSummary(current, currentResult.data ?? []),
    previous: toRangeSummary(previous, previousResult.data ?? []),
  };
}
