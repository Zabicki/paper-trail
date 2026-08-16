import { useEffect, useState } from "react";
import { toLocalDateString } from "@/components/entries/date-utils";
import BoardSwitcher, { DEFAULT_BOARD, isBoard, type Board } from "./BoardSwitcher";
import CategoriesBoard from "./CategoriesBoard";
import OverviewBoard from "./OverviewBoard";
import RangePicker from "./RangePicker";
import RecurringToggle from "./RecurringToggle";
import { DEFAULT_RANGE_PRESET, isRangePreset, resolveRange, type RangePreset } from "./range";

// A state-and-controls shell, not a data component. Each board owns its own
// fetch (OverviewBoard, CategoriesBoard); what lives here is the view state,
// its URL sync, and the one control bar both boards share — which is what
// FR-015's "from any view" requirement needs, and why the recurring toggle is
// not duplicated per board.

interface ViewState {
  board: Board;
  preset: RangePreset;
  recurringHidden: boolean;
}

const DEFAULT_VIEW_STATE: ViewState = {
  board: DEFAULT_BOARD,
  preset: DEFAULT_RANGE_PRESET,
  recurringHidden: false,
};

// All three controls live in the URL, so
// /reports?board=categories&range=ytd&recurring=hidden is a linkable,
// reloadable, back-navigable view rather than a transient widget state. An
// absent or unrecognised value falls back to the default instead of erroring —
// a hand-typed URL should land somewhere sensible.
function fromSearch(search: string): ViewState {
  const params = new URLSearchParams(search);
  const board = params.get("board");
  const range = params.get("range");
  return {
    board: isBoard(board) ? board : DEFAULT_BOARD,
    preset: isRangePreset(range) ? range : DEFAULT_RANGE_PRESET,
    recurringHidden: params.get("recurring") === "hidden",
  };
}

function initialViewState(): ViewState {
  // The island is server-rendered before it hydrates and there is no `window`
  // there. A deep link therefore paints the default range for one frame before
  // hydration corrects it — the same trade DayView already makes to keep
  // "today" a browser-local date.
  return typeof window === "undefined" ? DEFAULT_VIEW_STATE : fromSearch(window.location.search);
}

export default function ReportsView() {
  const [view, setView] = useState<ViewState>(initialViewState);
  // Captured once rather than read during render: resolveRange needs a "today"
  // and the boards derive theirs inside their fetch effects, but the caption
  // below is rendered — and calling new Date() in a render body is exactly the
  // impurity react-compiler exists to catch.
  const [today] = useState(() => toLocalDateString(new Date()));

  // The other direction of the URL sync: pushState below writes history
  // entries, this reads them back when the user walks the back button.
  useEffect(() => {
    function handlePopState() {
      setView(fromSearch(window.location.search));
    }
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  function applyView(next: ViewState) {
    setView(next);
    const params = new URLSearchParams({
      board: next.board,
      range: next.preset,
      recurring: next.recurringHidden ? "hidden" : "shown",
    });
    // pushState rather than replaceState: each control change — board included
    // — is a step the back button should undo.
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  // Both boards resolve the same range from the same preset, so the caption can
  // be derived here instead of being lifted out of whichever board happens to
  // have loaded. It now shows during loading too, where previously it waited
  // for the summary — the dates are identical either way, the endpoint just
  // echoes back what it was given.
  const range = resolveRange(view.preset, today);

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky so the recurring filter stays legible while scrolling. A filter
          silently in effect somewhere off-screen would make every figure below
          it quietly wrong. */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-col gap-3 rounded-xl border border-white/10 p-4 backdrop-blur-md">
        <BoardSwitcher
          value={view.board}
          onChange={(board) => {
            applyView({ ...view, board });
          }}
        />
        <RangePicker
          value={view.preset}
          onChange={(preset) => {
            applyView({ ...view, preset });
          }}
        />
        <RecurringToggle
          checked={view.recurringHidden}
          onChange={(recurringHidden) => {
            applyView({ ...view, recurringHidden });
          }}
        />
      </div>

      <p className="text-muted-foreground text-xs tabular-nums">
        {range.from} – {range.to}
      </p>

      {view.board === "categories" ? (
        <CategoriesBoard preset={view.preset} recurringHidden={view.recurringHidden} />
      ) : (
        <OverviewBoard preset={view.preset} recurringHidden={view.recurringHidden} />
      )}
    </div>
  );
}
