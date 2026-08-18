// The repo's single source of number formatting. Constructing an
// Intl.NumberFormat is the expensive part, so every instance lives at module
// scope rather than being rebuilt on every render.

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// No currency symbol: axis ticks are narrow, and a repeated "zł" on every
// gridline collides long before the numbers do.
const compactFormatter = new Intl.NumberFormat("pl-PL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Comma decimal, both places, no currency symbol. Module scope like its
// siblings — one per item per render is the specific mistake the header warns
// about, and a grouped receipt description builds several of these per row.
const plainAmountFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentDeltaFormatter = new Intl.NumberFormat("pl-PL", {
  style: "percent",
  signDisplay: "exceptZero",
  maximumFractionDigits: 1,
});

// Distinct from percentDeltaFormatter: a share is never signed, so the
// "exceptZero" plus sign that reads as "up" on a delta would be meaningless
// noise here.
const shareFormatter = new Intl.NumberFormat("pl-PL", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatCurrencyCompact(amount: number): string {
  return compactFormatter.format(amount);
}

/**
 * A bare comma-decimal amount, for use inside an entry description.
 *
 * Distinct from formatCurrencyCompact, which DROPS precision (`1,2 tys.`) to fit
 * an axis tick. This one keeps both decimals and only omits the currency symbol:
 * the row already shows one, and a `zł` repeated per item inside a joined
 * description is noise that eats the 200-character budget.
 */
export function formatAmountPlain(amount: number): string {
  return plainAmountFormatter.format(amount);
}

/**
 * A category's share of a range total, as a percentage.
 *
 * One decimal place rather than none: Board B deliberately renders a long tail
 * of sub-1% categories, and rounding those to a flat "0%" would make the
 * smallest rows indistinguishable from empty ones.
 */
export function formatShare(share: number): string {
  return shareFormatter.format(share);
}

/**
 * Percentage change of `current` against `previous`.
 *
 * Returns `null` when `previous` is 0 — a change from zero has no percentage,
 * and callers are expected to render a dash rather than an invented number.
 * This is the common case in the product's first weeks, not an edge case.
 *
 * The divisor is `Math.abs(previous)` so a negative baseline (the Bilans tile
 * can run negative) still reads "more" as a positive delta.
 */
export function formatPercentDelta(current: number, previous: number): string | null {
  if (previous === 0) {
    return null;
  }
  return percentDeltaFormatter.format((current - previous) / Math.abs(previous));
}
