// The single place that decides which categories Board B renders individually,
// which collapse into `Pozostałe`, and what colour each one gets.
//
// Co-located with the feature rather than living in src/lib/, following the
// range.ts / src/components/entries/date-utils.ts precedent.
//
// All three Board B charts read ONE model, computed once per fetch over the
// range grand totals in CategorySummary.categories — never per bucket and never
// per render. That is the whole point: compute top-N or colour per bucket and a
// colour stops meaning the same category from one bar to the next
// (context/foundation/charts_analysis.md:184).

import type { CategorySummary, CategoryTotal } from "@/types";

// Eight is about where a donut stops being readable at mobile width, and 2% is
// about where a slice stops being distinguishable from the ring edge. Whichever
// rule yields FEWER individual slices wins: top-N never pads (a user with three
// categories sees three), and the share floor stops eight indistinguishable
// slivers from qualifying just because there are at least eight of them.
export const TOP_N = 8;
export const MIN_SHARE = 0.02;

// `Pozostałe` is not a category, so it gets a theme token rather than a palette
// hex — --muted-foreground stays correct in dark mode where a fixed #64748b
// would not, and it reads as "not one of your categories" rather than as the
// Szary palette entry.
//
// It is deliberately OUTSIDE the duplicate-shift walk below, because that walk
// is over real categories: folding a non-category into it would let the SIZE of
// the tail change a real category's colour. Accepted residual: a visible Szary
// category can therefore read close to the `Pozostałe` swatch. The `(n)` count
// in the label and the always-last position are what disambiguate.
export const POZOSTALE_FILL = "var(--muted-foreground)";

// CATEGORY_COLORS is 12 fixed hexes with no per-user uniqueness constraint
// (src/types.ts:1-14), so a user with more than 12 categories necessarily
// repeats one — and two arcs sharing a fill is a misread, not a cosmetic issue.
// Duplicates are separated by shifting lightness only: hue and saturation are
// what make a colour recognisable as "the green one", and the shifted shade has
// to stay readable as a variant of the dot shown on /categories.
// The step the walk PREFERS. It shrinks when a hex has enough categories on it
// that the full step would not fit — see shiftedFill.
const LIGHTNESS_STEP = 0.13;
// Bounded well short of 0 and 1 so a shifted shade never degenerates into black
// or white, which would read as a missing slice rather than a dark one.
//
// ⚠ PRECONDITION for the injectivity argument in shiftedFill: every hex in
// CATEGORY_COLORS must sit strictly inside this band, with room on BOTH sides.
// Measured across all twelve: lightness ranges 0.4000 (#14b8a6) to 0.6627
// (#8b5cf6); the tightest headroom is 0.1773 above (#8b5cf6) and 0.1800 below
// (#14b8a6). A new palette entry at or past either bound would give that side a
// step of 0 and silently collapse its occurrences back onto the unshifted hex.
const MIN_LIGHTNESS = 0.22;
const MAX_LIGHTNESS = 0.84;

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return [0, 0, lightness];
  }

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) {
    hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2;
  } else {
    hue = (rn - gn) / delta + 4;
  }
  return [hue / 6, saturation, lightness];
}

function hueToChannel(p: number, q: number, offset: number): number {
  let t = offset;
  if (t < 0) {
    t += 1;
  }
  if (t > 1) {
    t -= 1;
  }
  if (t < 1 / 6) {
    return p + (q - p) * 6 * t;
  }
  if (t < 1 / 2) {
    return q;
  }
  if (t < 2 / 3) {
    return p + (q - p) * (2 / 3 - t) * 6;
  }
  return p;
}

function toHex(channel: number): string {
  return Math.round(channel * 255)
    .toString(16)
    .padStart(2, "0");
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  if (saturation === 0) {
    const grey = toHex(lightness);
    return `#${grey}${grey}${grey}`;
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return `#${toHex(hueToChannel(p, q, hue + 1 / 3))}${toHex(hueToChannel(p, q, hue))}${toHex(hueToChannel(p, q, hue - 1 / 3))}`;
}

// `occurrence` is how many earlier categories in the sorted list already used
// this hex. Zero returns the hex BYTE-IDENTICAL, so the largest category on a
// colour always matches its dot on /categories exactly — the duplicate is what
// moves, never the original.
//
// `count` is how many categories share this hex in total, and it is why the
// caller needs a pre-pass. FITTING THE WALK TO THE BAND, RATHER THAN CLAMPING
// INTO IT, is what makes the mapping injective (review finding F6). With a fixed
// LIGHTNESS_STEP the shift saturated at four categories on one hex, and every
// further same-direction occurrence then landed on the SAME boundary value:
// #3b82f6's occurrences 3 and 5 both resolved to lightness 0.84 and returned
// byte-identical hex, so two arcs, two ranking swatches and two stack segments
// were indistinguishable — the exact misread this mechanism exists to prevent,
// failing silently. Shrinking the step so the OUTERMOST occurrence lands exactly
// on the boundary means no two ever coincide, at any count.
//
// Accepted consequence: a category's shade now depends on how many siblings
// share its hex, so adding a thirteenth category can re-shade an existing one.
// Still fully deterministic for a given category list, and the alternative was a
// silent collision.
//
// Known limit, inherent rather than a defect here: injective is not the same as
// distinguishable. At six categories on #3b82f6 the steps are ~0.08 of
// lightness; well beyond that they are visibly close. Separating them further
// would mean rotating hue, which stops the swatch reading as "a shade of the
// colour the user picked" — the link manual criterion 3.8 checks against
// /categories.
function shiftedFill(hex: string, occurrence: number, count: number): string {
  if (occurrence === 0) {
    return hex;
  }
  const [hue, saturation, lightness] = rgbToHsl(...hexToRgb(hex));

  // Alternating lighter/darker keeps consecutive duplicates on opposite sides of
  // the original rather than marching in one direction. Odd occurrences go
  // lighter, even ones darker, so these are how far each side has to reach.
  const upSteps = Math.ceil((count - 1) / 2);
  const downSteps = Math.floor((count - 1) / 2);

  // Per-direction rather than one symmetric band, because no palette hex sits at
  // the centre of it — #8b5cf6 has 0.177 of room above and 0.443 below, so a
  // symmetric step would waste the wide side to fit the narrow one.
  const stepUp = upSteps > 0 ? Math.min(LIGHTNESS_STEP, (MAX_LIGHTNESS - lightness) / upSteps) : 0;
  const stepDown = downSteps > 0 ? Math.min(LIGHTNESS_STEP, (lightness - MIN_LIGHTNESS) / downSteps) : 0;

  // No clamp: by construction the furthest step lands exactly on the boundary,
  // which is the whole point. A clamp here would silently hide a broken step
  // calculation instead of letting the precondition above be the thing that
  // holds.
  const shifted =
    occurrence % 2 === 1 ? lightness + Math.ceil(occurrence / 2) * stepUp : lightness - (occurrence / 2) * stepDown;

  return hslToHex(hue, saturation, shifted);
}

export interface DistributionSlice extends CategoryTotal {
  // The resolved colour, which is `color` for a first occurrence and a shifted
  // shade of it otherwise. Charts read this, never `color`.
  fill: string;
  // Of the range total, not of the visible subset.
  share: number;
}

export interface Distribution {
  visible: DistributionSlice[];
  collapsed: DistributionSlice[];
  // The `Pozostałe` amount, summed once here rather than re-derived by each
  // chart that renders the tail (review finding F10). It was independently
  // recomputed in CategoryRanking, CategoryDonut and CategoryTrendChart — three
  // JavaScript float sums of the same numbers, in a module whose doctrine is
  // that totals come from Postgres `numeric`. Three copies of a float sum is
  // three chances for the charts to disagree about one number.
  collapsedTotal: number;
  // For the stacked chart, which addresses categories by id rather than by
  // walking a slice list.
  colorFor: (categoryId: number) => string;
  total: number;
}

export function resolveDistribution(summary: CategorySummary): Distribution {
  const { categories, total } = summary;

  // The board renders its empty state before this can be reached with a zero
  // total, but the guard is explicit rather than trusted: a bare division would
  // hand every chart NaN shares instead of failing, and NaN renders as a blank
  // slice rather than as an error. With no total to measure against, the share
  // floor cannot apply and selection degrades to top-N alone.
  const shareOf = (value: number) => (total > 0 ? value / total : 0);

  const aboveMinShare =
    total > 0 ? categories.filter((category) => shareOf(category.total) > MIN_SHARE).length : categories.length;
  const visibleCount = Math.min(TOP_N, aboveMinShare);

  // Both passes below walk the FULL sorted list — visible and collapsed together
  // — so that expanding `Pozostałe` cannot recolour an arc already on screen.
  // Resolve over the visible subset instead and the tail's arrival would
  // reshuffle the head at the exact moment the user is reading it.
  //
  // The count has to be known before the first fill is assigned, because
  // shiftedFill sizes its step from it — hence a pre-pass rather than one walk.
  const duplicateCounts = new Map<string, number>();
  for (const category of categories) {
    duplicateCounts.set(category.color, (duplicateCounts.get(category.color) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const slices: DistributionSlice[] = categories.map((category) => {
    const occurrence = seen.get(category.color) ?? 0;
    seen.set(category.color, occurrence + 1);
    return {
      ...category,
      fill: shiftedFill(category.color, occurrence, duplicateCounts.get(category.color) ?? 1),
      share: shareOf(category.total),
    };
  });

  const fills = new Map(slices.map((slice) => [slice.categoryId, slice.fill]));
  const collapsed = slices.slice(visibleCount);

  return {
    visible: slices.slice(0, visibleCount),
    collapsed,
    collapsedTotal: collapsed.reduce((sum, slice) => sum + slice.total, 0),
    colorFor: (categoryId) => fills.get(categoryId) ?? POZOSTALE_FILL,
    total,
  };
}

export function formatCollapsedLabel(count: number): string {
  return `Pozostałe (${count})`;
}
