// The single place that decides which categories Board B renders individually,
// which collapse into `Pozostałe`, and what colour each one gets. Since S-09 the
// colour is DERIVED here from categoryId rather than read off a hex the user
// picked — see the note on LIGHTNESS_STEP for why the derivation keys on the id.
//
// Co-located with the feature rather than living in src/lib/, following the
// range.ts / src/components/entries/date-utils.ts precedent.
//
// All three Board B charts read ONE model, computed once per fetch over the
// range grand totals in CategorySummary.categories — never per bucket and never
// per render. That is the whole point: compute top-N or colour per bucket and a
// colour stops meaning the same category from one bar to the next
// (context/foundation/charts_analysis.md:184).

import { CATEGORY_COLORS } from "@/types";
import type { CategoryIconName, CategorySummary, CategoryTotal } from "@/types";

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
// It is deliberately OUTSIDE the de-collision walk below, because that walk is
// over real categories and keyed on their ids: a non-category has no id to
// derive from. Accepted residual: a visible Szary category can therefore read
// close to the `Pozostałe` swatch. The `(n)` count in the label, the always-last
// position, and — since S-09 — the neutral `more-horizontal` glyph on the row
// are what disambiguate.
export const POZOSTALE_FILL = "var(--muted-foreground)";

// SINCE S-09 THE USER NO LONGER PICKS A COLOUR — the icon is a category's
// identity, and a chart fill is derived here. Colour still carries one job the
// icon cannot: linking a ranking row to its arc and its stack segment.
//
// The derivation is `categoryId` → one of 12 palette hexes × one of 3 shade
// tiers, giving 36 distinct fills. Deriving from the id rather than from
// position in the descending-total list is the load-bearing choice: rank shifts
// whenever the range or the recurring filter changes, and a colour that moved
// with it would recolour the donut under a control that is supposed to change
// only the bars.
//
// Duplicates are still possible, for a narrower reason than before: ids are
// global rather than per-user, so a single user's ids can be 36 apart and land
// on the same (hex, tier) pair. The de-collision walk below handles that.
//
// Shade tiers shift lightness only: hue and saturation are what make a colour
// recognisable as "the green one".
const LIGHTNESS_STEP = 0.13;
// Bounded well short of 0 and 1 so a shifted shade never degenerates into black
// or white, which would read as a missing slice rather than a dark one.
//
// ⚠ PRECONDITION, CARRIED FORWARD FROM THE PRE-S-09 MODULE AND STILL BINDING:
// every hex in CATEGORY_COLORS must sit strictly inside this band with at least
// LIGHTNESS_STEP of room on BOTH sides. Measured across all twelve: lightness
// ranges 0.4000 (#14b8a6) to 0.6627 (#8b5cf6); the tightest headroom is 0.1773
// above (#8b5cf6) and 0.1800 below (#14b8a6), both comfortably clear of the
// 0.13 step. THREE TIERS IS WHAT THAT HEADROOM SUPPORTS — it is the reason the
// tier count is 3 and not 4. A new palette entry closer to either bound would
// collapse its lighter or darker tier back onto the unshifted hex, silently
// halving the distinct-fill count.
const MIN_LIGHTNESS = 0.22;
const MAX_LIGHTNESS = 0.84;

// 12 palette hexes × 3 tiers. Ids beyond this wrap, which is what the
// de-collision walk in resolveDistribution exists to catch.
const TIERS_PER_HEX = 3;
const SLOT_COUNT = CATEGORY_COLORS.length * TIERS_PER_HEX;

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

// A slot is one (palette hex, shade tier) pair, numbered so that +1 walks to the
// next TIER of the same hex and only moves to the next hex after exhausting all
// three. That ordering matters to the de-collision walk: a bumped category stays
// in the colour family it derived, rather than jumping to an unrelated hue.
function slotFill(slot: number): string {
  const hex = CATEGORY_COLORS[Math.floor(slot / TIERS_PER_HEX) % CATEGORY_COLORS.length].value;
  const tier = slot % TIERS_PER_HEX;

  // Tier 0 returns the hex BYTE-IDENTICAL rather than round-tripping it through
  // HSL — so the first twelve categories, and every third tier after, carry an
  // exact palette value rather than one that survived a lossy conversion.
  if (tier === 0) {
    return hex;
  }
  const [hue, saturation, lightness] = rgbToHsl(...hexToRgb(hex));

  // One step up, one step down, bounded into the band.
  //
  // The pre-S-09 walk deliberately did NOT clamp, because clamping could land
  // two same-direction occurrences on one boundary value and silently break its
  // injectivity argument. That risk is gone: there are exactly two shifted
  // tiers and they move in OPPOSITE directions, so a bound can never collapse
  // one onto the other. It can only collapse a tier onto the unshifted hex, and
  // only for a palette entry with less than LIGHTNESS_STEP of headroom — which
  // the precondition above measures as not happening for any of the twelve
  // (0.1773 and 0.1800 against a 0.13 step). So for the current palette these
  // bounds never bite; they exist so a future entry closer to the edge degrades
  // to a duller shade rather than to near-black or near-white.
  const shifted =
    tier === 1
      ? Math.min(MAX_LIGHTNESS, lightness + LIGHTNESS_STEP)
      : Math.max(MIN_LIGHTNESS, lightness - LIGHTNESS_STEP);

  return hslToHex(hue, saturation, shifted);
}

// The slot a category derives from its id alone — independent of its rank, of
// the range, of the recurring toggle, and of which other categories exist.
//
// `% CATEGORY_COLORS.length` on the hex and `% TIERS_PER_HEX` on the tier is
// what makes consecutively-created categories land on DIFFERENT hexes rather
// than on three shades of the same one: ids 1..12 spread across the palette
// before any tier repeats.
function naturalSlot(categoryId: number): number {
  const hexIndex = categoryId % CATEGORY_COLORS.length;
  const tier = Math.floor(categoryId / CATEGORY_COLORS.length) % TIERS_PER_HEX;
  return hexIndex * TIERS_PER_HEX + tier;
}

export interface DistributionSlice extends CategoryTotal {
  // The derived colour: this category's slot fill, or a bumped one if another
  // category with a lower id already held that slot. Charts read this.
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
  // Same lookup for the glyph, so the trend chart's tooltip can identify a
  // series the way the ranking rows do. Null for a key that is not a real
  // category — i.e. the collapsed series.
  iconFor: (categoryId: number) => CategoryIconName | null;
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

  // The de-collision walk. It covers the FULL list — visible and collapsed
  // together — so that expanding `Pozostałe` cannot recolour an arc already on
  // screen. Resolve over the visible subset instead and the tail's arrival would
  // reshuffle the head at the exact moment the user is reading it.
  //
  // ⚠ WALKED IN ASCENDING categoryId ORDER, NOT `categories`' DESCENDING-TOTAL
  // ORDER. This is the property that makes a category's colour stable: totals
  // reorder whenever the range changes or the recurring filter toggles, so
  // resolving collisions in total order would hand the same category a different
  // fill on a control that must not touch colour. Id order is invariant to both.
  // Sorted on a copy — `categories`' own order is the descending-total order the
  // ranking and top-N selection depend on.
  const takenSlots = new Set<number>();
  const slotFor = new Map<number, number>();
  for (const category of [...categories].sort((a, b) => a.categoryId - b.categoryId)) {
    const from = naturalSlot(category.categoryId);
    let slot = from;
    // Scans every slot once, starting at the natural one, so the lowest id in a
    // colliding pair keeps its derived colour and the later one moves — the same
    // "the duplicate is what moves, never the original" rule the pre-S-09 module
    // had, rekeyed from total order to id order.
    for (let step = 0; step < SLOT_COUNT; step++) {
      const candidate = (from + step) % SLOT_COUNT;
      if (!takenSlots.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    // Past SLOT_COUNT categories every slot is taken and the loop leaves `slot`
    // at the natural one, so fills start repeating. Deterministic, and a board
    // showing at most TOP_N + 1 rows at a time never renders 36 fills at once
    // anyway — expanding `Pozostałe` on a 40-category account is the only way to
    // see two alike.
    //
    // ⚠ KNOWN RESIDUAL, measured rather than assumed. This walk is greedy over
    // the categories PRESENT IN THE RANGE, so it is invariant to their ORDER but
    // not to their MEMBERSHIP — and range changes and the recurring toggle change
    // membership. Concretely: if two ids collide (they are congruent mod
    // SLOT_COUNT) the higher one is bumped, and if the lower one then leaves the
    // range, the bumped one falls back to the freed slot and CHANGES COLOUR.
    // Sorting by id fixes the order half of the problem, not this half.
    //
    // Verified unaffected: any account whose ids do not collide — 30 categories
    // with contiguous ids keep byte-identical fills across every reordering and
    // across a third of them dropping out. So this is unreachable until an
    // account carries ids 36 apart, i.e. past ~36 categories.
    //
    // The real fix is to resolve slots over the user's FULL category list rather
    // than the range-filtered one, which needs the reports path to know that list
    // — an API change, deferred rather than smuggled in here. Tracked alongside
    // `category-color-drop`.
    takenSlots.add(slot);
    slotFor.set(category.categoryId, slot);
  }

  const slices: DistributionSlice[] = categories.map((category) => ({
    ...category,
    fill: slotFill(slotFor.get(category.categoryId) ?? naturalSlot(category.categoryId)),
    share: shareOf(category.total),
  }));

  const fills = new Map(slices.map((slice) => [slice.categoryId, slice.fill]));
  const icons = new Map(slices.map((slice) => [slice.categoryId, slice.icon]));
  const collapsed = slices.slice(visibleCount);

  return {
    visible: slices.slice(0, visibleCount),
    collapsed,
    collapsedTotal: collapsed.reduce((sum, slice) => sum + slice.total, 0),
    colorFor: (categoryId) => fills.get(categoryId) ?? POZOSTALE_FILL,
    iconFor: (categoryId) => icons.get(categoryId) ?? null,
    total,
  };
}

export function formatCollapsedLabel(count: number): string {
  return `Pozostałe (${count})`;
}
