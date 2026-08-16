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
import { addDays, enumerateBuckets, formatBucketLabel, inclusiveDayCount } from "./range";
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

interface CumulativePoint {
  bucketStart: string;
  // Days elapsed from the range's `from` to the last day this running total
  // covers. This — not the bucket index — is what makes the two periods
  // comparable; see the note above `sampleAt`.
  elapsedDays: number;
  total: number;
}

// Running expense total per bucket, accumulated over the already-exact
// per-bucket sums entries_summary returns. No raw row is re-added here, so the
// float drift S-02 flagged never re-enters through the back door.
//
// Enumerating the buckets rather than walking `points` matters: a period with a
// spending gap must hold its running total flat across that gap, not skip it.
function cumulativeExpense(range: RangeSummary, bucket: SummaryBucket): CumulativePoint[] {
  const byBucket = new Map(range.points.map((point) => [point.bucketStart, point.expense]));
  const starts = enumerateBuckets(range, bucket);
  let running = 0;

  return starts.map((bucketStart, index) => {
    running += byBucket.get(bucketStart) ?? 0;
    // The day this bucket's total is complete: the day before the next bucket
    // opens, or the range's own last day for the final (often partial) one.
    const coveredThrough = index + 1 < starts.length ? addDays(starts[index + 1], -1) : range.to;
    return {
      bucketStart,
      elapsedDays: inclusiveDayCount({ from: range.from, to: coveredThrough }) - 1,
      total: running,
    };
  });
}

// The running total the series had reached `elapsedDays` into its period.
//
// Indexing the comparison by bucket POSITION looks equivalent and is not: the
// two ranges are equal in days, not in buckets, because shifting back by N days
// re-aligns the range against Monday and first-of-month boundaries. Sweeping
// 2026, "Poprzedni miesiąc" disagrees on bucket count 91 days out of 365 — on
// 2026-08-16 the current range holds 5 week-buckets and the previous holds 6.
// Position indexing therefore silently dropped the previous period's last
// bucket (understating it) or ran off the end of a shorter one.
//
// null means the previous period had not closed its first bucket yet at that
// offset. Its spend there is genuinely unknown at this granularity, so the line
// starts later rather than claiming a zero.
function sampleAt(series: CumulativePoint[], elapsedDays: number): number | null {
  let total: number | null = null;
  for (const point of series) {
    if (point.elapsedDays > elapsedDays) {
      break;
    }
    total = point.total;
  }
  return total;
}

// Recharts hands the raw datum to the tooltip formatter, so a gap in the
// previous-period series arrives as null — and Number(null) is 0, which would
// render "0,00 zł" and assert the period spent nothing. Takes `unknown` so the
// null check is honest rather than a condition TypeScript thinks is dead.
function tooltipAmount(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? formatCurrency(amount) : null;
}

export default function CumulativeChart({ summary }: CumulativeChartProps) {
  // "Wasn't using the app yet" and "spent nothing" are different claims. A flat
  // zero line would make the second one, so an empty previous period drops the
  // series entirely rather than drawing it along the axis.
  const hasPrevious = summary.previous.points.length > 0;

  const currentSeries = cumulativeExpense(summary.current, summary.bucket);
  const previousSeries = hasPrevious ? cumulativeExpense(summary.previous, summary.bucket) : [];

  // Indexed by elapsed days into each period, not by date and not by bucket
  // index: the two periods cover different calendar days, so "the same distance
  // into the period" is the only comparison that means anything. The axis
  // labels come from the current period, which is the subject.
  const data = currentSeries.map((point) => ({
    bucketStart: point.bucketStart,
    current: point.total,
    previous: hasPrevious ? sampleAt(previousSeries, point.elapsedDays) : null,
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
                formatter={(value, name) => {
                  const amount = tooltipAmount(value);
                  if (amount === null) {
                    return null;
                  }
                  return (
                    <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                      <span className="text-muted-foreground">{seriesLabel(name)}</span>
                      <span className="text-foreground font-mono font-medium tabular-nums">{amount}</span>
                    </div>
                  );
                }}
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
