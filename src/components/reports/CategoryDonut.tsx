import { Label, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCurrency, formatShare } from "@/lib/format";
import { formatCollapsedLabel, POZOSTALE_FILL, type Distribution } from "./distribution";

// B1 — Rozkład wydatków.
//
// Answers "what dominates my spending" at a glance, which the ranking beneath
// it only answers after reading several rows. It adds no data and no fetch: it
// reads the same Distribution CategoryRanking does, which is what makes an arc
// and a swatch the same colour for the same category.
//
// No <Legend>. The ranking directly beneath IS the legend — and the readable
// text-equivalent of this chart — so duplicating it would double the board's
// vertical cost on mobile for nothing.

interface CategoryDonutProps {
  distribution: Distribution;
  expanded: boolean;
}

// Never a stringified category id, so the synthetic slice cannot collide with a
// real one in the config or in a tooltip lookup.
const COLLAPSED_KEY = "pozostale";

interface DonutDatum {
  // The ChartConfig key. Stringified categoryId for a real category.
  key: string;
  name: string;
  total: number;
  share: number;
  // Per-slice colour travels on the datum, not via <Cell> (superseded in
  // Recharts 3.x) and not via ChartConfig (a `color` entry there would make
  // shadcn's ChartStyle emit a self-referential custom property — see the note
  // beside --color-expense in global.css). Recharts' own colour resolution
  // falls back to `entry.fill`, and the same field is what the tooltip below
  // reads for its swatch.
  fill: string;
}

// The donut follows the `Pozostałe` expansion state so it and the ranking
// always show the same set — unlike B3, which deliberately stays collapsed.
function donutData(distribution: Distribution, expanded: boolean): DonutDatum[] {
  const { visible, collapsed, collapsedTotal, total } = distribution;

  const slices = (expanded ? [...visible, ...collapsed] : visible).map((slice) => ({
    key: String(slice.categoryId),
    name: slice.name,
    total: slice.total,
    share: slice.share,
    fill: slice.fill,
  }));

  if (expanded || collapsed.length === 0) {
    return slices;
  }

  return [
    ...slices,
    {
      key: COLLAPSED_KEY,
      name: formatCollapsedLabel(collapsed.length),
      total: collapsedTotal,
      // Guarded for the same reason resolveDistribution guards its shares: the
      // board renders its empty state before a zero total can reach here, but a
      // bare division would hand the tooltip NaN rather than fail.
      share: total > 0 ? collapsedTotal / total : 0,
      fill: POZOSTALE_FILL,
    },
  ];
}

// Recharts types a tooltip item's `payload` as `any`, so the datum is narrowed
// back out of it rather than trusted — the same shape of guard chart.tsx's
// fillOf() uses. Reading the datum directly is what keeps the tooltip's amount
// and swatch exact instead of re-deriving them from the formatted value.
function donutDatum(payload: unknown): DonutDatum | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const { key, name, total, share, fill } = payload as Partial<DonutDatum>;
  if (typeof key !== "string" || typeof name !== "string" || typeof fill !== "string") {
    return null;
  }
  if (typeof total !== "number" || typeof share !== "number") {
    return null;
  }
  return { key, name, total, share, fill };
}

export default function CategoryDonut({ distribution, expanded }: CategoryDonutProps) {
  const data = donutData(distribution, expanded);

  // `label` entries only — see the note on DonutDatum.fill.
  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((datum): [string, { label: string }] => [datum.key, { label: datum.name }]),
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Rozkład wydatków</h2>
      <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[260px] w-full">
        <PieChart accessibilityLayer>
          <ChartTooltip
            content={
              <ChartTooltipContent
                // One slice per tooltip, and the row below already names it —
                // a header would just repeat the category name above itself.
                hideLabel
                formatter={(_value, _name, item) => {
                  const datum = donutDatum(item.payload);
                  if (datum === null) {
                    return null;
                  }
                  return (
                    // Providing a formatter suppresses ChartTooltipContent's own
                    // indicator, so the swatch is rendered here — without it the
                    // tooltip could not say WHICH arc it is describing.
                    <div className="flex max-w-56 flex-1 items-center gap-2 leading-none">
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: datum.fill }}
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">{datum.name}</span>
                      <span className="text-foreground shrink-0 font-mono font-medium tabular-nums">
                        {formatCurrency(datum.total)}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">{formatShare(datum.share)}</span>
                    </div>
                  );
                }}
              />
            }
          />
          <Pie
            data={data}
            dataKey="total"
            nameKey="key"
            // A ring rather than a pie: the hole is what makes room for the
            // range total, which is the number the board is actually about.
            innerRadius="58%"
            outerRadius="85%"
            // Largest arc starting at twelve o'clock and running clockwise, so
            // arc order reads the same direction as the ranking beneath.
            startAngle={90}
            endAngle={-270}
            // Recharts' default sector stroke is #fff, which ChartContainer
            // rewrites to transparent — leaving adjacent arcs with no seam. A
            // hairline in the page background separates them in both themes,
            // and stays thin enough not to swallow a tail arc when expanded.
            stroke="var(--background)"
            strokeWidth={1}
          >
            <Label position="center" dy={-10} className="fill-muted-foreground text-xs">
              Wydatki
            </Label>
            <Label position="center" dy={9} className="fill-foreground text-base font-medium">
              {formatCurrency(distribution.total)}
            </Label>
          </Pie>
        </PieChart>
      </ChartContainer>
    </section>
  );
}
