// The repo's single source of number formatting. Constructing an
// Intl.NumberFormat is the expensive part, so the three instances live at
// module scope rather than being rebuilt on every render.

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

const percentDeltaFormatter = new Intl.NumberFormat("pl-PL", {
  style: "percent",
  signDisplay: "exceptZero",
  maximumFractionDigits: 1,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function formatCurrencyCompact(amount: number): string {
  return compactFormatter.format(amount);
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
