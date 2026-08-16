export const CATEGORY_COLORS = [
  { value: "#ef4444", label: "Czerwony" },
  { value: "#f97316", label: "Pomarańczowy" },
  { value: "#f59e0b", label: "Bursztynowy" },
  { value: "#eab308", label: "Żółty" },
  { value: "#84cc16", label: "Limonkowy" },
  { value: "#22c55e", label: "Zielony" },
  { value: "#14b8a6", label: "Morski" },
  { value: "#06b6d4", label: "Błękitny" },
  { value: "#3b82f6", label: "Niebieski" },
  { value: "#8b5cf6", label: "Fioletowy" },
  { value: "#ec4899", label: "Różowy" },
  { value: "#64748b", label: "Szary" },
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number]["value"];

export const DEFAULT_CATEGORY_COLOR: CategoryColor = "#64748b";

// Set once at creation and immutable thereafter — an entry's `type` must
// match its category's `kind`, so letting a kind flip would retroactively
// break every entry already pointing at it. Enforced by updateCategorySchema
// omitting the field, not by the database.
export type CategoryKind = "expense" | "income";

export interface Category {
  id: number;
  name: string;
  color: CategoryColor;
  isRecurring: boolean;
  kind: CategoryKind;
  createdAt: string;
}

export type EntryType = "expense" | "income";

export interface Entry {
  id: number;
  amount: number;
  occurredOn: string;
  type: EntryType;
  category: Pick<Category, "id" | "name" | "color">;
  createdAt: string;
}

// --- Aggregates (S-04) ---
//
// A family deliberately separate from Entry: chart endpoints return sums, not
// entries, and the two shapes have no reason to converge. In particular
// Entry.category stays a three-field Pick and is NOT widened with isRecurring
// just because the recurring filter needs it — that filter is applied in SQL
// by public.entries_summary, never client-side against entry rows.

// Not a user control. It is derived from the range length (see
// src/components/reports/range.ts), which keeps FR-013 to a single preset
// picker rather than two stacked dimensions.
export type SummaryBucket = "day" | "week" | "month";

export interface SummaryPoint {
  bucketStart: string;
  expense: number;
  income: number;
}

export interface RangeSummary {
  from: string;
  to: string;
  // Only buckets that actually have entries. Zero-filling gaps is the
  // caller's job, because only the caller knows whether an absent bucket
  // should read as a genuine zero or be omitted entirely.
  points: SummaryPoint[];
  // Summed in Postgres via `grouping sets`, not re-added from `points`.
  totals: { expense: number; income: number };
}

export interface EntriesSummary {
  bucket: SummaryBucket;
  current: RangeSummary;
  // The immediately preceding equal-length range, for the KPI tiles' deltas
  // and the cumulative chart's comparison line.
  previous: RangeSummary;
}

// --- Category aggregates (S-05) ---
//
// A second aggregate family alongside the S-04 group, for the same reason it
// is separate from Entry: these are sums keyed by category, not entries. The
// board is expense-only — public.entries_category_summary hardcodes
// `type = 'expense'` — so nothing here carries an expense/income dimension.

export interface CategoryTotal {
  categoryId: number;
  name: string;
  color: CategoryColor;
  total: number;
}

export interface CategoryBucketPoint {
  bucketStart: string;
  // Keyed by STRINGIFIED categoryId, not by number, because a Recharts
  // `dataKey` is a string and the stacked chart reads these points directly as
  // its chart data. A number-keyed record would force a per-render remap of
  // every point. This is the only reason for the string keys.
  totals: Record<string, number>;
}

export interface CategorySummary {
  bucket: SummaryBucket;
  from: string;
  to: string;
  // Range grand totals per category, sorted descending. This order is what
  // the client's top-N selection and colour assignment both walk, so it is
  // tie-broken by name to stay stable across identical loads.
  categories: CategoryTotal[];
  // Only buckets that actually have expenses. Zero-filling gaps is the
  // caller's job, matching RangeSummary.points.
  points: CategoryBucketPoint[];
  // From the `()` grouping-set row — an exact Postgres numeric, never a
  // JavaScript sum of `categories[].total`. Every percentage on the board
  // divides by this.
  total: number;
}
