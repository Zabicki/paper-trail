import { formatCurrency, formatPercentDelta } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inclusiveDayCount } from "./range";
import type { EntriesSummary } from "@/types";

interface KpiTilesProps {
  summary: EntriesSummary;
}

interface TileProps {
  label: string;
  value: number;
  previous: number;
  caption?: string;
  className?: string;
  valueClassName?: string;
}

function Tile({ label, value, previous, caption, className, valueClassName }: TileProps) {
  // null means the previous period was zero, where a percentage change is
  // undefined rather than infinite. A dash is the honest answer; this is the
  // ordinary case in the product's first weeks, not an edge case.
  const delta = formatPercentDelta(value, previous);

  return (
    <div className={cn("flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 p-4", className)}>
      <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums", valueClassName)}>{formatCurrency(value)}</span>
      {/* Deltas stay a neutral grey on purpose. A rise in Wydatki and a rise in
          Przychody are not the same news, and colouring both green would say
          they are. */}
      <span className="text-muted-foreground text-xs">
        <span className="tabular-nums">{delta ?? "—"}</span> vs. poprzedni okres
      </span>
      {caption && <span className="text-muted-foreground/70 text-xs">{caption}</span>}
    </div>
  );
}

export default function KpiTiles({ summary }: KpiTilesProps) {
  const { current, previous } = summary;

  const currentBalance = current.totals.income - current.totals.expense;
  const previousBalance = previous.totals.income - previous.totals.expense;

  // Both ranges cover the same number of inclusive days by construction, but
  // the average is computed from each range's own length rather than assuming
  // it — the endpoint owns that derivation, and this tile should not silently
  // disagree with it if it ever changes.
  const currentDailyAverage = current.totals.expense / inclusiveDayCount(current);
  const previousDailyAverage = previous.totals.expense / inclusiveDayCount(previous);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Wydatki" value={current.totals.expense} previous={previous.totals.expense} />
        <Tile label="Przychody" value={current.totals.income} previous={previous.totals.income} />
        <Tile label="Średnia dzienna" value={currentDailyAverage} previous={previousDailyAverage} />
      </div>

      {/* Set apart deliberately. DayEntriesList never nets income against
          expense for a day ("Two figures, never netted") because the two answer
          different questions; a netted range total is a third, different claim,
          and it must not read as one more gross figure in the same row. Hence
          its own row, a dashed border, and the subtraction written out. */}
      <Tile
        label="Bilans"
        value={currentBalance}
        previous={previousBalance}
        caption="Przychody − Wydatki"
        className="border-dashed border-white/25 bg-transparent"
        valueClassName={currentBalance < 0 ? "text-destructive" : "text-emerald-400"}
      />
    </div>
  );
}
