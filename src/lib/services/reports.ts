import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase";
import { DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON } from "@/types";
import type {
  CategoryBucketPoint,
  CategoryColor,
  CategoryIconName,
  CategorySummary,
  CategoryTotal,
  EntriesSummary,
  RangeSummary,
  SummaryBucket,
  SummaryPoint,
} from "@/types";

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

// PostgREST caps a response at max_rows = 1000 (supabase/config.toml) and
// TRUNCATES rather than erroring, so a hand-crafted bucket=day over a decade
// would silently return a partial aggregate that still looks like a valid
// answer.
//
// ⚠ MAX_BUCKETS bounds BUCKETS, not ROWS, and the two callers have very
// different row widths. entries_summary returns 2 rows per bucket, so 400
// buckets is ~802 rows — comfortably clear of the cap while far beyond any
// range the preset picker can produce. entries_category_summary returns one row
// per non-empty (bucket × category) cell, a width the user's category count
// sets and nothing here can see, so for that caller this guard alone does NOT
// keep the response under the cap. getCategorySummary therefore carries a
// second, exact truncation check.
const POSTGREST_MAX_ROWS = 1000;
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
//
// ⚠ These are a deliberate second copy of the same helpers in
// src/components/reports/range.ts (which owns the client half: preset → dates,
// bucket derivation, zero-fill enumeration). Keeping them separate is
// intentional — that module is browser-only — but the two are COUPLED and the
// coupling is not visible from either file alone:
//
//   `previousRange` here defines the comparison period as an equal number of
//   INCLUSIVE DAYS. Anything downstream that compares the two periods must
//   measure in days too. Bucket counts are NOT equal — shifting back by N days
//   re-aligns the range against Monday and first-of-month boundaries, so a
//   month-long range can hold 5 week-buckets while its predecessor holds 6.
//
// That exact assumption broke CumulativeChart once (it indexed the comparison
// by bucket position and silently dropped the previous period's last bucket).
// If you change the definition of "previous period" here, re-check
// range.ts's enumerateBuckets and CumulativeChart's sampleAt.
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

/**
 * The earliest date this user has any entry on, or `null` if they have none.
 *
 * This is what "Cały okres" resolves its start to. It lives here rather than in
 * entries.ts because it is range vocabulary — the same concern as previousRange
 * and MAX_BUCKETS — not entry CRUD.
 *
 * Three deliberate omissions:
 *
 *   - No `user_id` filter: RLS supplies the predicate, and
 *     entries_user_id_occurred_on_idx (user_id, occurred_on) then covers the
 *     ordered limit-1 read. Don't reach for a security definer function here.
 *   - No `deleted_at` filter on the joined category. Both summary functions
 *     deliberately count entries filed under soft-deleted categories (see
 *     20260816103000_add_entries_summary_function.sql), and a start date that
 *     disagreed with them would sit AFTER the earliest bar they plot.
 *   - No recurring-cost filter, so toggling FR-015 never moves the X-axis. The
 *     visible cost is a few leading zero buckets when the filter is on; the
 *     alternative re-scales — and can re-bucket — the chart under the user on a
 *     control that is supposed to change the bars.
 *
 * `entries` has no deleted_at of its own: entry deletion is hard (entries.ts's
 * deleteEntry), so there is nothing to exclude on this side either.
 */
export async function getFirstEntryDate(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("entries")
    .select("occurred_on")
    .order("occurred_on", { ascending: true })
    .limit(1);

  if (error) {
    throw error;
  }
  const rows = data as { occurred_on: string }[];
  return rows.length > 0 ? rows[0].occurred_on : null;
}

// --- Category summary (S-05) ---
//
// Deliberately in this module rather than a category-reports.ts of its own, so
// MAX_BUCKETS, RangeTooLargeError, bucketCountUpperBound and the date helpers
// stay single-copy. They already exist in a second copy in
// src/components/reports/range.ts (see the note above); a third would be the
// point at which they stop agreeing.

// Same boundary-assertion pattern as SummaryRow.
//
// `category_color` is on its way out. S-09 Phase 3 makes
// src/components/reports/distribution.ts derive chart fills from categoryId
// rather than from a stored hex, at which point nothing reads this — but until
// then distribution.ts is still its consumer, so it is mapped through onto
// CategoryTotal.color rather than dropped here. The follow-up change
// `category-color-drop` removes it from the function and from this interface.
// It is typed as CategoryColor rather than string because the categories
// table's CHECK constraint restricts the column to the CATEGORY_COLORS palette.
//
// `category_icon` carries no such constraint — there is no CHECK on the column
// (see 20260818090000_add_category_icon.sql), so this is a boundary ASSERTION
// rather than a guarantee. CategoryIcon.tsx degrades an unrecognised name to
// its `tag` fallback rather than crashing a render.
interface CategorySummaryRow {
  bucket_start: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: CategoryColor | null;
  category_icon: CategoryIconName | null;
  total: number | string;
}

interface CategorySummaryResponse {
  data: CategorySummaryRow[] | null;
  error: PostgrestError | null;
}

function toCategorySummary(range: DateRange, bucket: SummaryBucket, rows: CategorySummaryRow[]): CategorySummary {
  const categories: CategoryTotal[] = [];
  const byBucket = new Map<string, CategoryBucketPoint>();
  let total = 0;

  for (const row of rows) {
    const amount = Number(row.total);

    // The three grouping sets are told apart by which key columns are null.
    // Both null is the `()` row: the range grand total.
    if (row.bucket_start === null && row.category_id === null) {
      total = amount;
      continue;
    }

    // Defensive: category_id is non-null on both remaining sets, but the
    // narrowing is what lets the two branches below index by it.
    if (row.category_id === null) {
      continue;
    }

    if (row.bucket_start === null) {
      categories.push({
        categoryId: row.category_id,
        name: row.category_name ?? "",
        icon: row.category_icon ?? DEFAULT_CATEGORY_ICON,
        // Unread by every consumer except distribution.ts, which stops
        // reading it in Phase 3. See CategoryTotal.color in src/types.ts.
        color: row.category_color ?? DEFAULT_CATEGORY_COLOR,
        total: amount,
      });
      continue;
    }

    let point = byBucket.get(row.bucket_start);
    if (!point) {
      point = { bucketStart: row.bucket_start, totals: {} };
      byBucket.set(row.bucket_start, point);
    }
    point.totals[row.category_id.toString()] = amount;
  }

  // The function returns no ORDER BY. Sorting descending by total is what the
  // client's top-N and colour rules walk; the localeCompare tie-break makes
  // that order — and therefore every colour assignment — stable across two
  // identical loads, which is the difference between a steady board and one
  // that reshuffles its palette on refresh.
  categories.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const points = [...byBucket.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));

  return { bucket, from: range.from, to: range.to, categories, points, total };
}

export async function getCategorySummary(supabase: SupabaseClient, input: SummaryQueryInput): Promise<CategorySummary> {
  const range: DateRange = { from: input.from, to: input.to };

  if (bucketCountUpperBound(range, input.bucket) > MAX_BUCKETS) {
    throw new RangeTooLargeError();
  }

  // One call, not two: there is no previous-period comparison on this board
  // (B4 is out of scope), so nothing here needs previousRange.
  const result = (await supabase.rpc("entries_category_summary", {
    p_from: range.from,
    p_to: range.to,
    p_bucket: input.bucket,
    p_exclude_recurring: input.recurring === "hidden",
  })) as CategorySummaryResponse;

  if (result.error) {
    throw result.error;
  }

  // Exact truncation detection, because MAX_BUCKETS cannot bound this
  // response's width (see its comment). PostgREST truncates silently, and
  // grouping-set row order is unspecified — so the row dropped may well be the
  // `()` grand total, which would leave `total` at 0 and make every consumer
  // render 0% beside a real złoty amount. Raising the same error as the range
  // guard means the route's existing 400 mapping already covers it.
  if ((result.data?.length ?? 0) >= POSTGREST_MAX_ROWS) {
    throw new RangeTooLargeError();
  }

  return toCategorySummary(range, input.bucket, result.data ?? []);
}
