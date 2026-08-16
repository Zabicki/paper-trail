import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { enumerateBuckets, formatBucketLabel } from "./range";
import type { EntriesSummary, RangeSummary, SummaryBucket } from "@/types";

interface CumulativeChartProps {
  summary: EntriesSummary;
}

const chartConfig = {
  current: { label: "Ten okres" },
  previous: { label: "Poprzedni okres" },
} satisfies ChartConfig;

function seriesLabel(name: unknown): string {
  const key = String(name);
  return key in chartConfig ? chartConfig[key as keyof typeof chartConfig].label : key;
}

// Recharts types the tooltip label as ReactNode. Here it is always the XAxis
// dataKey value — a bucketStart string — so anything else is not a date and
// gets no header rather than a stringified object.
function bucketLabel(value: unknown, bucket: SummaryBucket): string | null {
  return typeof value === "string" ? formatBucketLabel(value, bucket) : null;
}

// Running expense total per bucket, accumulated over the already-exact
// per-bucket sums entries_summary returns. No raw row is re-added here, so the
// float drift S-02 flagged never re-enters through the back door.
//
// Enumerating the buckets rather than walking `points` matters: a period with a
// spending gap must hold its running total flat across that gap, not skip it.
function cumulativeExpense(range: RangeSummary, bucket: SummaryBucket): { bucketStart: string; total: number }[] {
  const byBucket = new Map(range.points.map((point) => [point.bucketStart, point.expense]));
  let running = 0;
  return enumerateBuckets(range, bucket).map((bucketStart) => {
    running += byBucket.get(bucketStart) ?? 0;
    return { bucketStart, total: running };
  });
}

export default function CumulativeChart({ summary }: CumulativeChartProps) {
  // "Wasn't using the app yet" and "spent nothing" are different claims. A flat
  // zero line would make the second one, so an empty previous period drops the
  // series entirely rather than drawing it along the axis.
  const hasPrevious = summary.previous.points.length > 0;

  const currentSeries = cumulativeExpense(summary.current, summary.bucket);
  const previousSeries = hasPrevious ? cumulativeExpense(summary.previous, summary.bucket) : [];

  // Indexed by POSITION within the period, not by date: the two periods cover
  // different calendar days, so day 1 vs day 1 is the only comparison that
  // means anything. The axis labels come from the current period, which is the
  // subject.
  const data = currentSeries.map((point, index) => ({
    bucketStart: point.bucketStart,
    current: point.total,
    previous: previousSeries[index]?.total ?? null,
  }));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Wydatki narastająco</h2>
      <p className="text-muted-foreground text-xs">
        Porównanie z poprzednim okresem tej samej długości, licząc od jego początku.
      </p>
      <ChartContainer config={chartConfig} className="max-h-[280px] min-h-[220px] w-full">
        <LineChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucketStart"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={(value: string) => formatBucketLabel(value, summary.bucket)}
          />
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCurrencyCompact} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => bucketLabel(value, summary.bucket)}
                formatter={(value, name) => (
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">{seriesLabel(name)}</span>
                    <span className="text-foreground font-mono font-medium tabular-nums">
                      {formatCurrency(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {/* Drawn first so the current period paints over it: muted, thinner
              and dashed, because it is the reference and not the subject. */}
          {hasPrevious && (
            <Line
              dataKey="previous"
              type="monotone"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          )}
          <Line dataKey="current" type="monotone" stroke="var(--color-expense)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </section>
  );
}
