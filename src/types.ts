// ⚠ THIS FILE MUST NEVER IMPORT FROM "lucide-react". It is reachable from the
// service layer and from API routes, so an icon-component map in here would
// drag ~116 React components into every server bundle. Names live here (the
// services and the zod enum need them); the components live UI-side in
// src/components/categories/icon-catalogue.ts.

// The curated icon set, as kebab-case lucide names. Every entry must also be
// filed into exactly one group in icon-catalogue.ts — that module's
// ICON_COMPONENTS is a `Record<CategoryIconName, …>`, so a name added here
// without a component and a group fails type-check rather than silently
// vanishing from the picker.
export const CATEGORY_ICON_NAMES = [
  // Jedzenie i napoje
  "utensils",
  "utensils-crossed",
  "coffee",
  "pizza",
  "beef",
  "fish",
  "apple",
  "carrot",
  "croissant",
  "cake",
  "ice-cream-cone",
  "wine",
  "beer",
  "cup-soda",
  "milk",
  // Transport
  "car",
  "car-front",
  "fuel",
  "parking-circle",
  "bus",
  "train-front",
  "tram-front",
  "bike",
  "plane",
  "ship",
  "car-taxi-front",
  // Dom i rachunki
  "house",
  "sofa",
  "bed-double",
  "lamp",
  "wrench",
  "hammer",
  "paintbrush",
  "zap",
  "flame",
  "droplet",
  "wifi",
  "phone",
  "tv",
  "trash-2",
  "flower-2",
  "washing-machine",
  "spray-can",
  "key",
  // Zdrowie i uroda
  "heart-pulse",
  "pill",
  "stethoscope",
  "syringe",
  "smile",
  "glasses",
  "scissors",
  "sparkles",
  "bath",
  "dumbbell",
  "activity",
  "brain",
  "baby",
  // Rozrywka i czas wolny
  "party-popper",
  "clapperboard",
  "popcorn",
  "puzzle",
  "gamepad-2",
  "music",
  "headphones",
  "guitar",
  "ticket",
  "book-open",
  "newspaper",
  "palette",
  "camera",
  "tent",
  "mountain",
  "theater",
  // Zakupy i usługi
  "shopping-cart",
  "shopping-bag",
  "shirt",
  "footprints",
  "store",
  "gift",
  "smartphone",
  "laptop",
  "monitor",
  "printer",
  "pencil",
  "package",
  "mail",
  "paw-print",
  "concierge-bell",
  // Finanse i praca
  "banknote",
  "coins",
  "wallet",
  "credit-card",
  "piggy-bank",
  "trending-up",
  "trending-down",
  "landmark",
  "receipt-text",
  "briefcase",
  "building-2",
  "graduation-cap",
  "shield-check",
  "hand-coins",
  "heart",
  "percent",
  // Inne
  "tag",
  "circle",
  "star",
  "flag",
  "bookmark",
  "box",
  "more-horizontal",
  "circle-help",
  "sun",
  "snowflake",
  "calendar",
  "clock",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];

// Matches the `icon text not null default 'tag'` column default in
// 20260818090000_add_category_icon.sql.
export const DEFAULT_CATEGORY_ICON: CategoryIconName = "tag";

// Retained past S-09 on purpose. The user no longer picks a colour — the icon
// is a category's identity — but src/components/reports/distribution.ts still
// derives its chart fills from this palette, and the `color` column is still
// `not null` this deploy. The follow-up change `category-color-drop` owns
// removing these three exports and moving the palette into distribution.ts,
// which is by then their only consumer.
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
  icon: CategoryIconName;
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
  category: Pick<Category, "id" | "name" | "icon">;
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

// --- Category aggregates (S-05) ---
//
// A second aggregate family alongside the S-04 group, for the same reason it
// is separate from Entry: these are sums keyed by category, not entries. The
// board is expense-only — public.entries_category_summary hardcodes
// `type = 'expense'` — so nothing here carries an expense/income dimension.

export interface CategoryTotal {
  categoryId: number;
  name: string;
  icon: CategoryIconName;
  // Retained one phase longer than the rest of S-09's colour removal.
  // src/components/reports/distribution.ts is its last reader, and that module
  // only stops reading a stored hex when Phase 3 derives fills from categoryId
  // instead — so dropping the field here would break the reports build for the
  // sake of a field nothing else consumes. Phase 3 deletes it.
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

// --- Parsed receipts (S-06) ---
//
// The wire shape of POST /api/receipts/parse, shared by the route and the
// review island. Deliberately NOT an Entry: nothing here is persisted, and the
// differences are the whole point — an amount may still be wrong, a categoryId
// may be absent, and a name is a read-only aid rather than a stored field until
// the user confirms. Everything in here is a model's guess pending correction.

export interface ParsedReceiptItem {
  name: string;
  amount: number;
  // Null when the model picked a category that is not the user's, or picked
  // none. An unassigned item is a correction task for the user, never a reason
  // to drop a real purchase — entries.category_id is NOT NULL, so the review
  // panel hard-blocks confirm until every row has one.
  categoryId: number | null;
}

export interface ParsedReceipt {
  // The date printed on the paragon, YYYY-MM-DD, or null if unreadable. Only
  // ever a hint: the entries are filed to the day selected in the calendar.
  receiptDate: string | null;
  // The printed SUMA PLN. The sum check compares this against the items and is
  // computed client-side, because it must recompute as the user edits amounts.
  total: number | null;
  items: ParsedReceiptItem[];
  // How many lines the deterministic post-processing removed (non-positive or
  // non-finite amounts — typically RABAT/OPUST rows the model emitted as
  // products anyway). Surfaced so removed lines are visible, not mysterious.
  droppedItems: number;
}
