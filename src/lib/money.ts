// Money arithmetic shared across the server/client boundary.
//
// A sibling of format.ts rather than an addition to it: that module's stated job
// is turning numbers into strings via Intl, and every export there returns a
// string. This one returns a number, and mixing the two would blur the one thing
// format.ts's header promises.
//
// It exists because roundToCents was byte-identical in two places — the parser
// (src/lib/services/receipts.ts) and the review panel's sum check
// (src/components/receipts/receipt-total.ts) — which is exactly the shape S-04's
// review finding F4 named: two copies of the same arithmetic drifted apart and
// *caused* a numeric bug. The server/client split looks like a reason to
// duplicate and is not; a pure function imports fine from either side.

/**
 * Cents-precision rounding.
 *
 * Every figure the receipt sum check compares goes through this first, so
 * binary-float noise (0.1 + 0.2) never renders as a mismatch the user has no way
 * to act on. The parser applies the same rounding before an amount is ever
 * stored, which is what keeps the delta the user sees agreeing with the total the
 * database holds — and the reason this must stay ONE implementation.
 */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
