import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";
import CategoryIcon from "@/components/categories/CategoryIcon";
import { formatCollapsedLabel, POZOSTALE_FILL, type Distribution } from "./distribution";

// B2 — Ranking kategorii.
//
// The form that actually degrades gracefully to any category count: it just
// gets taller. It is always rendered and never behind a toggle, so FR-014's
// readability guarantee never depends on the user finding a control — and it
// stays the readable text-equivalent of the donut Phase 4 adds above it.

interface CategoryRankingProps {
  distribution: Distribution;
  expanded: boolean;
  onToggleExpanded: () => void;
}

interface RankingRowProps {
  name: string;
  // The category's own glyph — its identity. `fill` is a different job: it links
  // this row to its donut arc and its stack segment. Since S-09 the two coexist
  // on the row as a TINTED glyph, so the shape says which category and the tint
  // says which arc.
  icon: string;
  fill: string;
  total: number;
  share: number;
  // The largest share on screen. Bars are scaled against it rather than against
  // 100%, because with 30 categories the leader can sit at 17% and every bar
  // would be a stub — the ranking's bar answers "how do these compare to each
  // other", and the exact share of the total is printed beside it as text.
  maxShare: number;
  leading?: React.ReactNode;
  indented?: boolean;
}

function RankingRow({ name, icon, fill, total, share, maxShare, leading, indented = false }: RankingRowProps) {
  return (
    <div className={cn("flex w-full flex-col gap-1.5", indented && "pl-6")}>
      <div className="flex items-center gap-2">
        {leading}
        {/* `color`, not `backgroundColor`: the glyph is strokes, not a filled
            box, so the tint has to land on the stroke colour. CategoryIcon sets
            aria-hidden itself — the name beside it already identifies the row. */}
        <CategoryIcon name={icon} className="size-4 shrink-0" style={{ color: fill }} />
        {/* min-w-0 is what lets truncate actually bite inside a flex row: a
            category name can be 100 characters (createCategorySchema), and
            without it the name would push the amount off a narrow viewport. */}
        <span className="min-w-0 flex-1 truncate text-left text-sm">{name}</span>
        <span className="shrink-0 text-sm font-medium tabular-nums">{formatCurrency(total)}</span>
        <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
          {formatShare(share)}
        </span>
      </div>
      <div className="bg-muted/30 h-1.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (share / maxShare) * 100)}%`, backgroundColor: fill }}
        />
      </div>
    </div>
  );
}

export default function CategoryRanking({ distribution, expanded, onToggleExpanded }: CategoryRankingProps) {
  const { visible, collapsed, collapsedTotal, total } = distribution;

  const collapsedShare = total > 0 ? collapsedTotal / total : 0;
  // Number.EPSILON keeps the divisor non-zero when every share is zero, and
  // covers the spread of an empty `visible` — Math.max() over nothing is
  // -Infinity, which would turn every bar width into NaN.
  const maxShare = Math.max(...visible.map((slice) => slice.share), collapsedShare, Number.EPSILON);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Ranking kategorii</h2>
      <ul className="flex flex-col gap-3">
        {visible.map((slice) => (
          <li key={slice.categoryId}>
            <RankingRow
              name={slice.name}
              icon={slice.icon}
              fill={slice.fill}
              total={slice.total}
              share={slice.share}
              maxShare={maxShare}
            />
          </li>
        ))}

        {collapsed.length > 0 && (
          <li className="flex flex-col gap-3">
            {/* A real button, not a clickable div: this is the only interactive
                element on the board, and it has to be reachable by keyboard and
                announce its state. */}
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              className="hover:bg-accent/40 flex min-h-11 w-full items-center rounded-lg px-1 transition-colors"
            >
              <RankingRow
                name={formatCollapsedLabel(collapsed.length)}
                // Not a category, so it has no icon of its own. The neutral
                // ellipsis reads as "the rest" rather than borrowing a real
                // category's glyph, and the chevron in `leading` coexists with
                // it — one says "expandable", the other says "not a category".
                icon="more-horizontal"
                fill={POZOSTALE_FILL}
                total={collapsedTotal}
                share={collapsedShare}
                maxShare={maxShare}
                leading={
                  expanded ? (
                    <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                  )
                }
              />
            </button>

            {/* Expanded IN PLACE, beneath the row that summarises them — nothing
                above moves and nothing above is recoloured, because the colours
                were resolved over the full list before the split. */}
            {expanded && (
              <ul className="flex flex-col gap-2">
                {collapsed.map((slice) => (
                  <li key={slice.categoryId}>
                    <RankingRow
                      name={slice.name}
                      icon={slice.icon}
                      fill={slice.fill}
                      total={slice.total}
                      share={slice.share}
                      maxShare={maxShare}
                      indented
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}
