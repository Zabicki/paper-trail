import { useState } from "react";
import { ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import CategoryIcon from "@/components/categories/CategoryIcon";
import type { Category } from "@/types";

interface CategoryPickerProps {
  categories: Category[];
  value: number | null;
  onChange: (id: number) => void;
  filterText: string;
  onFilterTextChange: (text: string) => void;
  // Opt-in, and only the entry form opts in: it is the tap-budgeted path, and
  // the day-list edit row and receipt review both want the flat list.
  collapsible?: boolean;
}

// Deliberately the same number as RECENCY_CHIP_COUNT in
// src/lib/services/entries.ts:391. That is where the server already cuts
// between the recency-ordered head of this list and its alphabetical tail, so
// it is the one cut that does not split the tail mid-alphabet.
const COLLAPSED_CHIP_COUNT = 5;

export default function CategoryPicker({
  categories,
  value,
  onChange,
  filterText,
  onFilterTextChange,
  collapsible = false,
}: CategoryPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const trimmedFilter = filterText.trim();
  const filtered = trimmedFilter
    ? categories.filter((category) =>
        category.name.toLocaleLowerCase("pl").includes(filterText.toLocaleLowerCase("pl")),
      )
    : categories;

  // A filter in play suspends the collapse entirely and searches the whole
  // list: it is the one-interaction escape hatch to any chip, hidden or not.
  const collapseApplies = collapsible && trimmedFilter.length === 0;

  const head = filtered.slice(0, COLLAPSED_CHIP_COUNT);
  // The selected chip is never hidden. A category created from the manager
  // dialog has no entries yet, so recency files it in the alphabetical tail —
  // and it is precisely the chip that was just selected.
  const selectedOutsideHead =
    collapseApplies && value !== null && !head.some((category) => category.id === value)
      ? (filtered.find((category) => category.id === value) ?? null)
      : null;
  const collapsedVisible = selectedOutsideHead ? [...head, selectedOutsideHead] : head;
  const collapsedIds = new Set(collapsedVisible.map((category) => category.id));
  const tail = collapseApplies ? filtered.filter((category) => !collapsedIds.has(category.id)) : [];

  // Expanding appends; it never reorders. Every chip already on screen keeps
  // its position and its colour, including a selected one pulled up out of the
  // tail — the rest simply arrive after it.
  let visible: Category[];
  if (!collapseApplies) {
    visible = filtered;
  } else if (expanded) {
    visible = [...collapsedVisible, ...tail];
  } else {
    visible = collapsedVisible;
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="text"
        value={filterText}
        onChange={(event) => {
          onFilterTextChange(event.target.value);
        }}
        placeholder="Szukaj kategorii…"
        aria-label="Szukaj kategorii"
      />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kategoria">
        {visible.map((category) => (
          <button
            key={category.id}
            type="button"
            role="radio"
            aria-checked={value === category.id}
            // Only recurring chips carry a label: the glyph is decorative, so
            // without one the chip would announce nothing about being a large
            // recurring cost. Non-recurring chips keep their text as the name.
            aria-label={category.isRecurring ? `${category.name}, duży koszt cykliczny` : undefined}
            onClick={() => {
              onChange(category.id);
            }}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-full border-2 px-3 py-2 text-sm transition-colors",
              value === category.id ? "border-foreground" : "hover:bg-accent border-transparent",
            )}
          >
            {/* size-4, not the dot's old size-3: a glyph needs the extra 4px to
                read at all, and the chip is min-h-11 so it absorbs them. */}
            <CategoryIcon name={category.icon} className="size-4 shrink-0" />
            {category.isRecurring && <Repeat className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
            {category.name}
          </button>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground text-sm">Brak pasujących kategorii.</p>}
      </div>

      {/* Outside the radiogroup on purpose — a non-radio child of one is a
          malformed group — which is also what keeps the chips above from moving
          when it is pressed. */}
      {tail.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setExpanded((current) => !current);
          }}
          aria-expanded={expanded}
          className="hover:bg-accent/40 flex min-h-11 items-center gap-1 self-start rounded-full px-3 text-sm transition-colors"
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          )}
          {expanded ? "Pokaż mniej" : `Pokaż więcej (${String(tail.length)})`}
        </button>
      )}
    </div>
  );
}
