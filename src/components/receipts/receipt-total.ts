// The receipt's arithmetic, in exactly one place.
//
// Extracted rather than inlined into the review panel specifically because
// S-04's duplicated date arithmetic (review finding F4) directly *caused* a
// numeric bug: two copies of the same maths drifted apart. This module is
// small enough that inlining it would look harmless, which is the trap.
//
// roundToCents used to live here too, and was byte-identical to a copy in
// src/lib/services/receipts.ts — the same trap one level up, caught by this
// change's own review as F10. It now lives in src/lib/money.ts, which both sides
// import.
import { roundToCents } from "@/lib/money";

/**
 * What the reviewed line items add up to.
 *
 * Non-finite amounts contribute zero rather than poisoning the whole sum with
 * `NaN` — a half-typed amount must still leave the footer readable. Confirm is
 * separately blocked while any amount is unusable, so this can never be the
 * figure that gets written.
 */
export function sumItems(items: { amount: number }[]): number {
  return roundToCents(items.reduce((total, item) => total + (Number.isFinite(item.amount) ? item.amount : 0), 0));
}

/**
 * Difference between the item sum and the total printed on the paragon.
 *
 * Null when the model could not read SUMA PLN: there is nothing to compare
 * against, and a delta of `sum - 0` would accuse the user of an error the
 * receipt never showed. Both sides are rounded before subtracting, so a
 * genuine match reads as exactly 0 rather than 1e-15.
 */
export function totalDelta(sum: number, printedTotal: number | null): number | null {
  if (printedTotal === null || !Number.isFinite(printedTotal)) {
    return null;
  }
  return roundToCents(roundToCents(sum) - roundToCents(printedTotal));
}
