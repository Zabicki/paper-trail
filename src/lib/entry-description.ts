// The item separator for a multi-item entry description, and the split that
// reads one back apart. Lives in src/lib/ rather than beside either component
// because both sides consume it: the receipt review panel composes a grouped
// description, and the day list splits one to clamp the display to three items.
// One definition, because duplicated arithmetic in this repo has drifted apart
// before (S-04 F4, S-06 F10).
//
// A manual, free-text description that happens to contain " · " verbatim will be
// read as several items. That is accepted and harmless — it clamps and offers an
// expand, which loses nothing — and is cheaper to state here than to defend
// against with an escaping scheme.
export const DESCRIPTION_ITEM_SEPARATOR = " · ";

// A description with no separator yields a single-element array, which is what
// keeps the day list's clamp inert for manual entries.
export function splitDescriptionItems(description: string): string[] {
  return description
    .split(DESCRIPTION_ITEM_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
