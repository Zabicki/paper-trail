// The item separator for a multi-item entry description, the composition that
// builds one from a category group, and the split that reads one back apart.
// Lives in src/lib/ rather than beside either component because both sides
// consume it: the receipt review panel composes, and the day list splits to
// clamp the display to three items. One definition, because duplicated
// arithmetic in this repo has drifted apart before (S-04 F4, S-06 F10).
//
// A manual, free-text description that happens to contain " · " verbatim will be
// read as several items. That is accepted and harmless — it clamps and offers an
// expand, which loses nothing — and is cheaper to state here than to defend
// against with an escaping scheme.
import { formatAmountPlain } from "@/lib/format";
import { countCodePoints, truncateCodePoints } from "@/lib/text";

export const DESCRIPTION_ITEM_SEPARATOR = " · ";

// Mirrors the zod bound in src/lib/services/entries.ts and the `check
// (char_length(description) <= 200)` constraint that migration 20260816140000
// added. Owned here so the composer and both input fields count against one
// number instead of four copies of it — the drift shape S-04 F4 named. The
// server keeps its own literal on purpose: importing it from a service module
// would pull zod and the Supabase client into the browser bundle.
export const DESCRIPTION_MAX_CODE_POINTS = 200;

// A description with no separator yields a single-element array, which is what
// keeps the day list's clamp inert for manual entries.
export function splitDescriptionItems(description: string): string[] {
  return description
    .split(DESCRIPTION_ITEM_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// The middle dot goes entirely, not just the " · " sequence: a name ending in a
// space next to one starting with "· " would otherwise reconstruct a boundary
// once joined. A `·` inside a product name is vanishingly rare and losing it
// costs nothing, whereas a faked boundary makes the split lie about the group.
function cleanItemName(name: string): string {
  return name.replaceAll("·", " ").replace(/\s+/g, " ").trim();
}

function renderItem(name: string, amount: number): string {
  const amountText = formatAmountPlain(amount);
  return name === "" ? amountText : `${name} ${amountText}`;
}

/**
 * One description for a category group, carrying each line's name and amount.
 *
 * Returns `null` when the group has no items or every name is blank — a nameless
 * group stores NULL rather than a string of bare amounts, which would say
 * nothing the row's own figure does not already say.
 *
 * Over-long groups drop WHOLE items from the tail and record how many with a
 * `+N` marker. That rule is the non-obvious one and it is a correctness
 * requirement, not tidiness: cutting mid-item would store `"Mleko 3,4"` and read
 * as a wrong price, which is worse than storing fewer items. Only when a single
 * item cannot fit on its own is anything cut, and then it is the NAME that is
 * truncated — by code point, via truncateCodePoints — with the amount kept whole.
 */
export function composeGroupedDescription(items: { name: string; amount: number }[]): string | null {
  if (items.length === 0) {
    return null;
  }

  const cleaned = items.map((item) => ({ name: cleanItemName(item.name), amount: item.amount }));
  if (cleaned.every((item) => item.name === "")) {
    return null;
  }

  const rendered = cleaned.map((item) => renderItem(item.name, item.amount));

  // Drop from the tail until it fits. Each step removes a whole item, which is
  // always longer than the `+N` marker's growth, so this converges.
  for (let count = rendered.length; count > 0; count -= 1) {
    const dropped = rendered.length - count;
    const parts = rendered.slice(0, count);
    if (dropped > 0) {
      parts.push(`+${String(dropped)}`);
    }
    const candidate = parts.join(DESCRIPTION_ITEM_SEPARATOR);
    if (countCodePoints(candidate) <= DESCRIPTION_MAX_CODE_POINTS) {
      return candidate;
    }
  }

  // Not even the first item fits by itself. Reserve room for its amount and the
  // marker, then cut only the name.
  const first = cleaned[0];
  const dropped = cleaned.length - 1;
  const suffix = dropped > 0 ? `${DESCRIPTION_ITEM_SEPARATOR}+${String(dropped)}` : "";
  // -1 for the space renderItem puts between the name and the amount.
  const budget = DESCRIPTION_MAX_CODE_POINTS - countCodePoints(formatAmountPlain(first.amount)) - 1 - suffix.length;
  const name = budget > 0 ? truncateCodePoints(first.name, budget).trim() : "";
  return `${renderItem(name, first.amount)}${suffix}`;
}
