// Text truncation that is safe to store.
//
// `String.prototype.slice` cuts by UTF-16 code UNIT, so a cut landing between
// the two halves of a surrogate pair emits a lone surrogate. PostgREST cannot
// store that, and because the receipt confirm is one atomic statement, a single
// bad name fails the WHOLE batch — the user loses the entire receipt rather than
// one line. That was an open defect in the parser (`name.slice(0, NAME_MAX)`)
// and it becomes far easier to reach once several names are joined into one
// 200-character description.

// The one spread in this module, so the lint exemption is justified once.
//
// no-misused-spread wants Intl.Segmenter for locale-aware grapheme clusters.
// That is the wrong unit here and would reintroduce the bug: Postgres'
// `char_length()`, which backs `check (char_length(description) <= 200)`, counts
// code points. Segmenting by cluster would count a flag or a ZWJ emoji as one,
// UNDER-count against the database's bound, and let an over-long value through to
// the 500 this exists to prevent. Decomposing a complex emoji is the acceptable
// cost; a rejected batch is not.
//
// eslint-disable-next-line @typescript-eslint/no-misused-spread
const toCodePoints = (value: string): string[] => [...value];

/** How many code points `value` is, in the unit Postgres' `char_length()` counts. */
export function countCodePoints(value: string): number {
  return toCodePoints(value).length;
}

/**
 * The first `maxCodePoints` code points of `value`, or `value` unchanged when it
 * already fits.
 *
 * Iterating by code point is the whole point: it can never split a surrogate
 * pair, so the result is always a string the database will accept.
 */
export function truncateCodePoints(value: string, maxCodePoints: number): string {
  const codePoints = toCodePoints(value);
  if (codePoints.length <= maxCodePoints) {
    return value;
  }
  return codePoints.slice(0, maxCodePoints).join("");
}
