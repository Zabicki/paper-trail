import { useEffect, useState } from "react";
import { toLocalDateString } from "@/components/entries/date-utils";
import CumulativeChart from "./CumulativeChart";
import KpiTiles from "./KpiTiles";
import TrendChart from "./TrendChart";
import { bucketFor, enumerateBuckets, resolveRange, type DateRange, type RangePreset } from "./range";
import type { EntriesSummary, RangeSummary, SummaryBucket, SummaryPoint } from "@/types";

// Board A, lifted out of ReportsView unchanged when S-05 added a second board.
// Each board owns its own fetch so switching does not load data the user is not
// looking at, and so ReportsView stays a state-and-controls shell rather than a
// router with two data paths hanging off it.

interface OverviewBoardProps {
  preset: RangePreset;
  recurringHidden: boolean;
  // Server-resolved start for "Cały okres" — see ReportsView's own prop. Passed
  // down rather than fetched here because both boards resolve their own range.
  allTimeStart: string;
  // Reported back so ReportsView's caption shows the range this board actually
  // fetched, rather than one re-derived from a separate "today". See the comment
  // on ReportsView's `range` state.
  onRangeResolved: (range: DateRange) => void;
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

interface OverviewBodyProps {
  summary: EntriesSummary | null;
  loadError: string | null;
}

// The strict three-branch early return the codebase uses (error → loading →
// empty → content), per DayEntriesList. It is a child rather than inline
// branching so the control bar above it stays mounted in every branch: a
// failed or empty load must never trap the user on a page with no way out.
function OverviewBody({ summary, loadError }: OverviewBodyProps) {
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

export default function OverviewBoard({ preset, recurringHidden, allTimeStart, onRangeResolved }: OverviewBoardProps) {
  const [summary, setSummary] = useState<EntriesSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      setSummary(null);
      setLoadError(null);

      // Resolved here and not on the server: Workers run UTC, and a user
      // logging at 23:30 CEST would get yesterday out of a server-derived
      // "today". The endpoint validates concrete dates, never derives them.
      const range = resolveRange(preset, toLocalDateString(new Date()), allTimeStart);
      // Published before the await, so the caption is correct while this board
      // is still loading — and published from the same `range` the request below
      // is built from, which is what makes the label and the money agree.
      onRangeResolved(range);
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        bucket: bucketFor(range),
        recurring: recurringHidden ? "hidden" : "shown",
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
  }, [preset, recurringHidden, allTimeStart, onRangeResolved]);

  return <OverviewBody summary={summary} loadError={loadError} />;
}
