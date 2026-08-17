import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addMonths,
  daysInMonth,
  firstWeekdayOfMonth,
  formatMonthLabel,
  POLISH_WEEKDAY_LABELS,
  toLocalDateString,
} from "./date-utils";

interface MonthCalendarProps {
  visibleMonth: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onMonthChange: (month: string) => void;
  refreshKey?: number;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export default function MonthCalendar({
  visibleMonth,
  selectedDate,
  onSelectDate,
  onMonthChange,
  refreshKey,
}: MonthCalendarProps) {
  const [missingDates, setMissingDates] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      setLoadError(null);
      try {
        const response = await fetch(`/api/entries/days?month=${visibleMonth}`);
        if (!response.ok) {
          throw new Error("Nie udało się wczytać kalendarza.");
        }
        const body = await response.json<{ dates: string[] }>();
        if (!cancelled.current) {
          setMissingDates(new Set(body.dates));
        }
      } catch {
        if (!cancelled.current) {
          setLoadError("Nie udało się wczytać kalendarza.");
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [visibleMonth, refreshKey]);

  const today = toLocalDateString(new Date());
  const totalDays = daysInMonth(visibleMonth);
  const leadingBlanks = firstWeekdayOfMonth(visibleMonth);
  const cells: { date: string; day: number }[] = [];
  for (let day = 1; day <= totalDays; day++) {
    cells.push({ date: `${visibleMonth}-${pad(day)}`, day });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Poprzedni miesiąc"
          onClick={() => {
            onMonthChange(addMonths(visibleMonth, -1));
          }}
        >
          ‹
        </Button>
        <span className="text-sm font-medium">{formatMonthLabel(visibleMonth)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Następny miesiąc"
          onClick={() => {
            onMonthChange(addMonths(visibleMonth, 1));
          }}
        >
          ›
        </Button>
      </div>

      {loadError && <p className="text-destructive text-sm">{loadError}</p>}

      <div className="text-muted-foreground grid grid-cols-7 gap-1 text-center text-xs">
        {POLISH_WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 place-items-center gap-1">
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" />
        ))}
        {cells.map(({ date, day }) => {
          const isMissing = missingDates.has(date);
          const isSelected = date === selectedDate;
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              aria-label={`${day}${isMissing ? ", brak wpisów" : ""}${isToday ? ", dziś" : ""}`}
              onClick={() => {
                onSelectDate(date);
              }}
              className={cn(
                "flex size-11 max-w-full items-center justify-center rounded-full text-sm transition-colors",
                isSelected ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                !isSelected && isMissing && "text-destructive ring-destructive/60 ring-1",
                !isSelected && isToday && "font-semibold",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
