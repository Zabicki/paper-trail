import { cn } from "@/lib/utils";

// The board vocabulary lives here rather than in a module of its own — it is
// three consts and a type guard, and RangePicker's analogue only lives in
// range.ts because that module carries the whole preset→dates arithmetic too.
export const BOARDS = [
  { value: "overview", label: "Przegląd" },
  { value: "categories", label: "Kategorie" },
] as const;

export type Board = (typeof BOARDS)[number]["value"];

export const DEFAULT_BOARD: Board = "overview";

const BOARD_VALUES = new Set<string>(BOARDS.map((board) => board.value));

export function isBoard(value: string | null): value is Board {
  return value !== null && BOARD_VALUES.has(value);
}

interface BoardSwitcherProps {
  value: Board;
  onChange: (board: Board) => void;
}

// Hand-rolled radiogroup, the third instance of the pattern after CategoryPicker
// and RangePicker: role="radio" on plain buttons, min-h-11 tap targets, selected
// = border-foreground. shadcn's Tabs is not installed and this is not the change
// that adds it.
//
// FR-015 wants the recurring filter reachable "from any view", which is why both
// boards share one control bar rather than each carrying its own — the switcher
// is what makes that possible without duplicating the bar.
export default function BoardSwitcher({ value, onChange }: BoardSwitcherProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Widok">
      {BOARDS.map((board) => (
        <button
          key={board.value}
          type="button"
          role="radio"
          aria-checked={value === board.value}
          onClick={() => {
            onChange(board.value);
          }}
          className={cn(
            "flex min-h-11 items-center rounded-full border-2 px-4 py-2 text-sm font-medium transition-colors",
            value === board.value ? "border-foreground" : "hover:bg-accent border-transparent",
          )}
        >
          {board.label}
        </button>
      ))}
    </div>
  );
}
