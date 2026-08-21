// The receipt review panel's model, in exactly one place — and, crucially,
// reachable without a DOM.
//
// Same reason receipt-total.ts exists (see its header): logic that decides what
// gets *written* must be assertable on its own. Everything here used to live
// inside ReceiptReview.tsx, where the only way to reach it was to render a React
// island, so the panel's most consequential behaviour — how printed lines fold
// into per-category entries, which date they land on, and what the POST body
// ends up containing — was protected by comments and nothing else.
//
// These functions were MOVED, not rewritten. The comments moved with them: each
// one documents a decision that was reversed at review cost, so they are
// load-bearing rather than decoration.
import { composeGroupedDescription } from "@/lib/entry-description";
import { roundToCents } from "@/lib/money";
import { sumItems } from "./receipt-total";
import type { ParsedReceiptItem } from "@/types";

// The wire shape of one confirmed line, matching createEntriesBatchSchema's
// item. `type` is absent on purpose: receipt items are always expenses.
export interface ConfirmItem {
  amount: number;
  categoryId: number;
  description: string | null;
}

export interface ReviewRow {
  // Assigned once from the parse order and never reused. Not the index: rows
  // can be removed, and an index key would make React reuse a removed row's
  // input state for its successor.
  key: number;
  name: string;
  amountText: string;
  categoryId: number | null;
}

// One reviewed row with its amount parsed and judged. `amountValid` stands in
// front of `check (amount > 0)`, so an unusable amount blocks the confirm rather
// than reaching Postgres.
export interface EvaluatedRow {
  row: ReviewRow;
  amount: number;
  amountValid: boolean;
}

// One saved entry's worth of reviewed lines. Review itself stays one row per
// printed line — this is only what the confirm folds them into.
export interface CategoryGroup {
  categoryId: number;
  amount: number;
  items: { name: string; amount: number }[];
}

// The two structurally different confirm blocks, plus the flags the panel
// renders as messages. Returned together so the panel cannot compute one of them
// from a different set of rows than the other.
export interface ConfirmGate {
  missingCategory: boolean;
  invalidAmount: boolean;
  hardBlocked: boolean;
  deltaMismatch: boolean;
  canConfirmItems: boolean;
}

/**
 * The initial editable rows for a freshly parsed receipt.
 */
export function seedReviewRows(items: ParsedReceiptItem[]): ReviewRow[] {
  return items.map((item, index) => ({
    key: index,
    name: item.name,
    // Seeds a text input, so a bare number — formatCurrency's "12,50 zł"
    // would land in the field and fail the amount parse, exactly as
    // DayEntriesList's startEdit notes.
    amountText: item.amount.toFixed(2),
    categoryId: item.categoryId,
  }));
}

/**
 * Parses each row's typed amount and judges whether it can be stored.
 *
 * Comma decimals, because a Polish keyboard produces "12,50" and the field is
 * `inputMode="decimal"`.
 */
export function evaluateRows(rows: ReviewRow[]): EvaluatedRow[] {
  return rows.map((row) => {
    const amount = Number(row.amountText.replace(",", "."));
    return {
      row,
      amount,
      amountValid: row.amountText.trim().length > 0 && Number.isFinite(amount) && amount > 0,
    };
  });
}

/**
 * Groups the reviewed rows by category, preserving FIRST-APPEARANCE order so the
 * saved order tracks the order things were printed on the paragon.
 *
 * Rows that cannot be stored (no category, unusable amount) are skipped rather
 * than grouped: they are separately hard-blocking, and including them would make
 * the preview promise a write that cannot happen.
 */
export function groupByCategory(rows: EvaluatedRow[]): CategoryGroup[] {
  const groups: { categoryId: number; items: { name: string; amount: number }[] }[] = [];
  const indexByCategory = new Map<number, number>();

  for (const { row, amount, amountValid } of rows) {
    if (row.categoryId === null || !amountValid) {
      continue;
    }
    const existing = indexByCategory.get(row.categoryId);
    if (existing === undefined) {
      indexByCategory.set(row.categoryId, groups.length);
      groups.push({ categoryId: row.categoryId, items: [{ name: row.name, amount }] });
    } else {
      groups[existing].items.push({ name: row.name, amount });
    }
  }

  // sumItems, not a bare reduce: it is the same function — and therefore the
  // same single rounding, applied once to the sum — that produces the panel's
  // `Suma pozycji`. Rounding per item and again on the total can drift by a cent
  // and turn a sum the user saw match into a stored mismatch.
  return groups.map((group) => ({ ...group, amount: sumItems(group.items) }));
}

/**
 * The date a receipt's entries should be filed to.
 *
 * Prefer the paragon's own date — the model reads header fields far more
 * reliably than line items — but NEVER adopt one in the future. A misread year
 * is the failure that files a receipt somewhere the calendar cannot casually
 * reach, which is the risk S-06's hint-only guard was protecting against.
 *
 * `occurredOn` stands in for "today" because the calendar cannot select a
 * future day. Do NOT "fix" this into a `new Date()` call — that would
 * reintroduce the timezone question date-utils.ts already settled. Both sides
 * are YYYY-MM-DD, so a lexicographic compare IS a chronological one.
 */
export function resolveSaveDate(receiptDate: string | null, occurredOn: string): string {
  return receiptDate !== null && receiptDate <= occurredOn ? receiptDate : occurredOn;
}

/**
 * Whether resolveSaveDate REFUSED a printed date, which is the only case the
 * panel's amber notice explains.
 *
 * The panel decides this once at mount for the same reason the save date is
 * decided once: derived live, it would start claiming the date was rejected
 * simply because the user later moved the calendar backwards.
 */
export function isReceiptDateRejected(receiptDate: string | null, occurredOn: string): boolean {
  return receiptDate !== null && receiptDate > occurredOn;
}

/**
 * Turns the grouped preview into the POST body.
 *
 * One entry per CATEGORY, not per printed line. The reduce happens immediately
 * before the POST, which is what keeps FR-012's per-line correction and the
 * accuracy log's per-line columns intact — review above is still one row per
 * line.
 *
 * createEntriesBatch assigns batch_seq from this array's index, so the
 * idempotency key stays well-defined over the grouped array and a replay still
 * dedupes. No server change is needed for any of this.
 */
export function toConfirmItems(groups: CategoryGroup[]): ConfirmItem[] {
  return groups.map((group) => ({
    amount: group.amount,
    categoryId: group.categoryId,
    description: composeGroupedDescription(group.items),
  }));
}

/**
 * The second write path: the whole paragon as a single entry.
 */
export function wholeReceiptItem(total: number, categoryId: number): ConfirmItem[] {
  return [
    {
      amount: roundToCents(total),
      categoryId,
      // An honest name for what this row is. The column exists so a wrong
      // categorisation stays diagnosable, and "one entry for a whole
      // receipt" is precisely the thing worth being able to recognise later.
      description: "Paragon",
    },
  ];
}

/**
 * Whether the item confirm is allowed, and why not when it is not.
 *
 * Two structurally different blocks, and conflating them would be wrong.
 *
 * Hard: entries.category_id is NOT NULL and amount is `check (amount > 0)`.
 * There is nothing to acknowledge — the row literally cannot be stored.
 *
 * Soft: a sum that disagrees with the paragon is suspicious, not impossible.
 * The checkbox is what turns bad data into a deliberate choice rather than
 * an accident.
 */
export function evaluateConfirmGate(input: {
  rows: ReviewRow[];
  evaluated: EvaluatedRow[];
  delta: number | null;
  acknowledged: boolean;
  submitting: boolean;
}): ConfirmGate {
  const missingCategory = input.rows.some((row) => row.categoryId === null);
  const invalidAmount = input.evaluated.some((entry) => !entry.amountValid);
  const hardBlocked = input.rows.length === 0 || missingCategory || invalidAmount;
  const deltaMismatch = input.delta !== null && input.delta !== 0;

  return {
    missingCategory,
    invalidAmount,
    hardBlocked,
    deltaMismatch,
    canConfirmItems: !hardBlocked && !(deltaMismatch && !input.acknowledged) && !input.submitting,
  };
}
