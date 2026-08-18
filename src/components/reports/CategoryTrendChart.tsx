import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import CategoryIcon from "@/components/categories/CategoryIcon";
import { formatCollapsedLabel, POZOSTALE_FILL, type Distribution } from "./distribution";
import { enumerateBuckets, formatBucketLabel, type DateRange } from "./range";
import type { CategoryBucketPoint, SummaryBucket } from "@/types";

// B3 — Kategorie w czasie.
//
// Shows *when* the spending happened per category, which is the reading that
// makes the recurring-cost filter's effect visible as a change in the stack's
// SHAPE rather than only as a smaller number on the tiles.
//
// It adds no fetch and no colours of its own: every segment's fill comes from
// the same Distribution the donut and the ranking read, which is what makes a
// colour mean the same category in all three.
//
// No <Legend>. The ranking above IS the legend, and it stays on screen while
// this chart is read.

interface CategoryTrendChartProps {
  distribution: Distribution;
  // Straight off the summary — only buckets that have expenses. Zero-filling
  // against `range` happens here rather than in the board, because the same
  // pass also has to fold the collapsed tail into one series.
  points: CategoryBucketPoint[];
  range: DateRange;
  bucket: SummaryBucket;
}

// Never a stringified category id, so the tail series cannot collide with a
// real category's dataKey or config entry.
const COLLAPSED_KEY = "pozostale";

// Every visible category plus, when there is a tail, one `Pozostałe` series —
// keyed exactly as the row fields below, because a Recharts `dataKey` is a
// string and CategoryBucketPoint.totals is string-keyed for this one reason.
interface StackRow {
  bucketStart: string;
  // A bucket with no spending in a category carries `null`, not `0`: Recharts'
  // Tooltip drops null-valued series (`filterNull`), which keeps a tooltip over
  // a single-category day to one line instead of nine — eight of them zeros.
  [seriesKey: string]: number | string | null;
}

// This chart deliberately renders the COLLAPSED set at all times, whatever the
// ranking and the donut are showing — it takes no `expanded` prop at all.
// Expanding a 22-category tail here would put 30 segments in every bar, which
// is precisely the readability failure this slice exists to prevent. The
// divergence from the donut is the point, not an oversight.
function stackRows(
  distribution: Distribution,
  points: CategoryBucketPoint[],
  range: DateRange,
  bucket: SummaryBucket,
): StackRow[] {
  const byBucket = new Map(points.map((point) => [point.bucketStart, point.totals]));

  // Enumerated rather than mapped off `points`, for the same reason Board A
  // zero-fills: the aggregate omits empty buckets, so a chart drawn from its
  // rows alone would close the gaps and slide Wednesday's bar onto Tuesday.
  return enumerateBuckets(range, bucket).map((bucketStart) => {
    const totals = byBucket.get(bucketStart);
    const row: StackRow = { bucketStart };

    for (const slice of distribution.visible) {
      const value = totals?.[String(slice.categoryId)] ?? 0;
      row[String(slice.categoryId)] = value === 0 ? null : value;
    }

    if (distribution.collapsed.length > 0) {
      const tail = distribution.collapsed.reduce((sum, slice) => sum + (totals?.[String(slice.categoryId)] ?? 0), 0);
      row[COLLAPSED_KEY] = tail === 0 ? null : tail;
    }

    return row;
  });
}

// `label` entries only. A `color` here would make shadcn's ChartStyle emit the
// self-referential `--color-<key>: var(--color-<key>)` documented beside
// --color-expense in global.css; the fills travel on the <Bar> elements.
function buildConfig(distribution: Distribution): ChartConfig {
  const entries: [string, { label: string }][] = distribution.visible.map((slice) => [
    String(slice.categoryId),
    { label: slice.name },
  ]);

  if (distribution.collapsed.length > 0) {
    entries.push([COLLAPSED_KEY, { label: formatCollapsedLabel(distribution.collapsed.length) }]);
  }

  return Object.fromEntries(entries);
}

// Resolved from the series key rather than read off Recharts' tooltip item, so
// the swatch is guaranteed to be the same value the <Bar> was given — the
// tooltip cannot drift from the segment it is describing.
function fillForSeries(distribution: Distribution, seriesKey: string): string {
  return seriesKey === COLLAPSED_KEY ? POZOSTALE_FILL : distribution.colorFor(Number(seriesKey));
}

// Resolved by series key exactly as fillForSeries is, so the glyph and the tint
// beside it can never describe two different categories. The collapsed series is
// not a category, so it takes the same neutral ellipsis the ranking's tail row
// does rather than borrowing a real category's glyph.
function iconForSeries(distribution: Distribution, seriesKey: string): string {
  if (seriesKey === COLLAPSED_KEY) {
    return "more-horizontal";
  }
  return distribution.iconFor(Number(seriesKey)) ?? "tag";
}

// Recharts types the tooltip label as ReactNode. Here it is always the XAxis
// dataKey value — a bucketStart string — so anything else gets no header rather
// than a stringified object.
function bucketLabel(value: unknown, bucket: SummaryBucket): string | null {
  return typeof value === "string" ? formatBucketLabel(value, bucket) : null;
}

export default function CategoryTrendChart({ distribution, points, range, bucket }: CategoryTrendChartProps) {
  const rows = stackRows(distribution, points, range, bucket);
  const chartConfig = buildConfig(distribution);

  const seriesLabel = (name: unknown): string => {
    const key = String(name);
    const entry = chartConfig[key] as ChartConfig[string] | undefined;
    return typeof entry?.label === "string" ? entry.label : key;
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Kategorie w czasie</h2>
      {/* STACKED, unlike A1's grouped bars — and correctly so: these segments
          really are parts of one whole (the bucket's expense total), where
          expense and income never were. */}
      <ChartContainer config={chartConfig} className="max-h-[280px] min-h-[220px] w-full">
        <BarChart accessibilityLayer data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucketStart"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            // Recharts drops ticks rather than overlapping them, which is what
            // keeps a 12-month axis readable without rotating the labels.
            minTickGap={16}
            tickFormatter={(value: string) => formatBucketLabel(value, bucket)}
          />
          {/* width="auto" rather than a number — see the note on TrendChart's
              axis. Stacked bars total the whole bucket, so these ticks run as
              high as A1's and clipped the same way. */}
          <YAxis tickLine={false} axisLine={false} width="auto" tickFormatter={formatCurrencyCompact} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => bucketLabel(value, bucket)}
                formatter={(value, name) => (
                  // Providing a formatter suppresses ChartTooltipContent's own
                  // indicator, so the swatch is rendered here — with up to nine
                  // stacked series the colour is what identifies the row.
                  <div className="flex max-w-56 flex-1 items-center gap-2 leading-none">
                    <CategoryIcon
                      name={iconForSeries(distribution, String(name))}
                      className="size-4 shrink-0"
                      style={{ color: fillForSeries(distribution, String(name)) }}
                    />
                    <span className="text-muted-foreground min-w-0 flex-1 truncate">{seriesLabel(name)}</span>
                    <span className="text-foreground shrink-0 font-mono font-medium tabular-nums">
                      {formatCurrency(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          {/* Declaration order is stack order, bottom-up: the largest category
              sits on the baseline and `Pozostałe` rides on top, matching the
              ranking's descending order and its always-last tail row. No corner
              radius — rounding every segment would read as a gap between two
              parts of the same total. */}
          {distribution.visible.map((slice) => (
            <Bar key={slice.categoryId} dataKey={String(slice.categoryId)} stackId="expense" fill={slice.fill} />
          ))}
          {distribution.collapsed.length > 0 && <Bar dataKey={COLLAPSED_KEY} stackId="expense" fill={POZOSTALE_FILL} />}
        </BarChart>
      </ChartContainer>
    </section>
  );
}
