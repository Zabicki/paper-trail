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
  // The receipt line-item name this entry came from (S-06), or null for
  // anything typed into the manual form. Required rather than optional: the
  // column always exists, it is the *value* that may be absent — and an
  // optional field would let a caller forget it and read as "no receipt".
  description: string | null;
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
