import { useEffect, useState } from "react";
import { toLocalDateString } from "@/components/entries/date-utils";
import CumulativeChart from "./CumulativeChart";
import KpiTiles from "./KpiTiles";
import RangePicker from "./RangePicker";
import RecurringToggle from "./RecurringToggle";
import TrendChart from "./TrendChart";
import {
  bucketFor,
  DEFAULT_RANGE_PRESET,
  enumerateBuckets,
  isRangePreset,
  resolveRange,
  type RangePreset,
} from "./range";
import type { EntriesSummary, RangeSummary, SummaryBucket, SummaryPoint } from "@/types";

interface ViewState {
  preset: RangePreset;
  recurringHidden: boolean;
}

const DEFAULT_VIEW_STATE: ViewState = { preset: DEFAULT_RANGE_PRESET, recurringHidden: false };

// Both controls live in the URL, so /reports?range=ytd&recurring=hidden is a
// linkable, reloadable, back-navigable view rather than a transient widget
// state. An absent or unrecognised value falls back to the default instead of
// erroring — a hand-typed URL should land somewhere sensible.
function fromSearch(search: string): ViewState {
  const params = new URLSearchParams(search);
  const range = params.get("range");
  return {
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

interface ReportsBodyProps {
  summary: EntriesSummary | null;
  loadError: string | null;
}

// The aggregate returns only buckets that actually have entries, so a bar chart
// fed straight from its rows would close every gap — putting Tuesday's bar
// where Wednesday belongs and asserting a continuity the data doesn't have.
// Filling against the full bucket sequence makes an empty day render as the
// zero it is.
function zeroFilledPoints(range: RangeSummary, bucket: SummaryBucket): SummaryPoint[] {
  const byBucket = new Map(range.points.map((point) => [point.bucketStart, point]));
  return enumerateBuckets(range, bucket).map(
    (bucketStart) => byBucket.get(bucketStart) ?? { bucketStart, expense: 0, income: 0 },
  );
}

// The strict three-branch early return the codebase uses (error → loading →
// empty → content), per DayEntriesList. It is a child rather than inline
// branching so the control bar above it stays mounted in every branch: a
// failed or empty load must never trap the user on a page with no way out.
function ReportsBody({ summary, loadError }: ReportsBodyProps) {
  if (loadError) {
    return <p className="text-destructive text-sm">{loadError}</p>;
  }

  if (summary === null) {
    return <p className="text-muted-foreground text-sm">Wczytywanie podsumowania…</p>;
  }

  // `points` only carries buckets that have entries, so an empty list is an
  // exact "nothing in this range" — not a total that happens to be zero.
  if (summary.current.points.length === 0) {
    return <p className="text-muted-foreground text-sm">Brak wpisów w tym zakresie.</p>;
  }

  // Both charts read the summary already in hand — neither fetches, and neither
  // carries its own loading or error state, because the three branches above
  // already cover every case they could be in.
  return (
    <div className="flex flex-col gap-8">
      <KpiTiles summary={summary} />
      <TrendChart points={zeroFilledPoints(summary.current, summary.bucket)} bucket={summary.bucket} />
      <CumulativeChart summary={summary} />
    </div>
  );
}

export default function ReportsView() {
  const [view, setView] = useState<ViewState>(initialViewState);
  const [summary, setSummary] = useState<EntriesSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      setSummary(null);
      setLoadError(null);

      // Resolved here and not on the server: Workers run UTC, and a user
      // logging at 23:30 CEST would get yesterday out of a server-derived
      // "today". The endpoint validates concrete dates, never derives them.
      const range = resolveRange(view.preset, toLocalDateString(new Date()));
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        bucket: bucketFor(range),
        recurring: view.recurringHidden ? "hidden" : "shown",
      });

      try {
        const response = await fetch(`/api/entries/summary?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Nie udało się wczytać podsumowania.");
        }
        const data = await response.json<EntriesSummary>();
        if (!cancelled.current) {
          setSummary(data);
        }
      } catch {
        if (!cancelled.current) {
          setLoadError("Nie udało się wczytać podsumowania.");
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [view]);

  function applyView(next: ViewState) {
    setView(next);
    const params = new URLSearchParams({
      range: next.preset,
      recurring: next.recurringHidden ? "hidden" : "shown",
    });
    // pushState rather than replaceState: each control change is a step the
    // back button should undo.
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky so the recurring filter stays legible while scrolling. A filter
          silently in effect somewhere off-screen would make every figure below
          it quietly wrong. */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-col gap-3 rounded-xl border border-white/10 p-4 backdrop-blur-md">
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

      {summary && (
        <p className="text-muted-foreground text-xs tabular-nums">
          {summary.current.from} – {summary.current.to}
        </p>
      )}

      <ReportsBody summary={summary} loadError={loadError} />
    </div>
  );
}
