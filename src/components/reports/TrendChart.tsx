import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { formatBucketLabel } from "./range";
import type { SummaryBucket, SummaryPoint } from "@/types";

interface TrendChartProps {
  // Already zero-filled by the caller: the aggregate omits empty buckets, and
  // a bar chart drawn from its rows alone would close the gaps rather than
  // show them.
  points: SummaryPoint[];
  bucket: SummaryBucket;
}

// No `color` on either entry — see the note beside --color-expense in
// global.css. The labels are what the tooltip and legend read.
const chartConfig = {
  expense: { label: "Wydatki" },
  income: { label: "Przychody" },
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

export default function TrendChart({ points, bucket }: TrendChartProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Wydatki i przychody</h2>
      {/* Bars are GROUPED, not stacked. Expense and income are not parts of a
          whole, and stacking them would assert a relationship that does not
          exist — the same reason DayEntriesList never nets one against the
          other. */}
      <ChartContainer config={chartConfig} className="max-h-[280px] min-h-[220px] w-full">
        <BarChart accessibilityLayer data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
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
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCurrencyCompact} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => bucketLabel(value, bucket)}
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
          <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </section>
  );
}
