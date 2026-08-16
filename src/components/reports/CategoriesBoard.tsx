import { useEffect, useState } from "react";
import { toLocalDateString } from "@/components/entries/date-utils";
import CategoryRanking from "./CategoryRanking";
import { resolveDistribution } from "./distribution";
import { bucketFor, resolveRange, type RangePreset } from "./range";
import type { CategorySummary } from "@/types";

// Board B — Kategorie. The mirror of OverviewBoard: its own fetch, its own four
// branches, no data shared with Board A beyond the range and toggle it is
// handed.

interface CategoriesBoardProps {
  preset: RangePreset;
  recurringHidden: boolean;
}

interface CategoriesBodyProps {
  summary: CategorySummary | null;
  loadError: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}

// Same strict branch order as OverviewBody: error → loading → empty → content.
function CategoriesBody({ summary, loadError, expanded, onToggleExpanded }: CategoriesBodyProps) {
  if (loadError) {
    return <p className="text-destructive text-sm">{loadError}</p>;
  }

  if (summary === null) {
    return <p className="text-muted-foreground text-sm">Wczytywanie podsumowania kategorii…</p>;
  }

  // "wydatków", not "wpisów", and the difference is load-bearing: this board
  // excludes income by construction, so a range holding only income is
  // genuinely empty HERE while Board A shows data for the same range. Reusing
  // Board A's copy would read as a contradiction.
  if (summary.categories.length === 0) {
    return <p className="text-muted-foreground text-sm">Brak wydatków w tym zakresie.</p>;
  }

  // Resolved once per render of the content branch and shared by every chart on
  // the board — which is what makes a colour mean the same category in all of
  // them. Never per chart, never per bucket.
  const distribution = resolveDistribution(summary);

  return (
    <div className="flex flex-col gap-8">
      <CategoryRanking distribution={distribution} expanded={expanded} onToggleExpanded={onToggleExpanded} />
    </div>
  );
}

export default function CategoriesBoard({ preset, recurringHidden }: CategoriesBoardProps) {
  const [summary, setSummary] = useState<CategorySummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      setSummary(null);
      setLoadError(null);
      // The tail collapses again whenever the data under it changes: an
      // expanded "Pozostałe (7)" from one range says nothing about the next,
      // and leaving 20 rows open across a range change buries the head.
      setExpanded(false);

      // "Today" is a browser-local date here for the same reason it is on Board
      // A — Workers run UTC (src/components/entries/date-utils.ts).
      const range = resolveRange(preset, toLocalDateString(new Date()));
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        bucket: bucketFor(range),
        recurring: recurringHidden ? "hidden" : "shown",
      });

      try {
        const response = await fetch(`/api/entries/category-summary?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Nie udało się wczytać podsumowania kategorii.");
        }
        const data = (await response.json()) as CategorySummary;
        if (!cancelled.current) {
          setSummary(data);
        }
      } catch {
        if (!cancelled.current) {
          setLoadError("Nie udało się wczytać podsumowania kategorii.");
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [preset, recurringHidden]);

  return (
    <CategoriesBody
      summary={summary}
      loadError={loadError}
      expanded={expanded}
      onToggleExpanded={() => {
        setExpanded((current) => !current);
      }}
    />
  );
}
