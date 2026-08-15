import { useEffect, useState } from "react";
import MonthCalendar from "./MonthCalendar";
import EntryForm from "./EntryForm";
import DayEntriesList from "./DayEntriesList";
import { monthOf, toLocalDateString } from "./date-utils";
import type { Category, Entry } from "@/types";

export default function DayView() {
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(selectedDate));
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      try {
        const response = await fetch("/api/entries/categories");
        if (!response.ok) {
          throw new Error("Nie udało się wczytać kategorii.");
        }
        const data = (await response.json()) as Category[];
        if (!cancelled.current) {
          setCategories(data);
        }
      } catch {
        if (!cancelled.current) {
          setCategoriesError("Nie udało się wczytać kategorii.");
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      setEntries(null);
      setEntriesError(null);
      try {
        const response = await fetch(`/api/entries?date=${selectedDate}`);
        if (!response.ok) {
          throw new Error("Nie udało się wczytać wpisów dnia.");
        }
        const data = (await response.json()) as Entry[];
        if (!cancelled.current) {
          setEntries(data);
        }
      } catch {
        if (!cancelled.current) {
          setEntriesError("Nie udało się wczytać wpisów dnia.");
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [selectedDate]);

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    const month = monthOf(date);
    if (month !== visibleMonth) {
      setVisibleMonth(month);
    }
  }

  function handleSaved(entry: Entry) {
    setEntries((prev) => [...(prev ?? []), entry]);
    setCalendarRefreshKey((key) => key + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <MonthCalendar
        visibleMonth={visibleMonth}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        onMonthChange={setVisibleMonth}
        refreshKey={calendarRefreshKey}
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Dodaj wydatek</h2>
        {categoriesError && <p className="text-destructive text-sm">{categoriesError}</p>}
        {categories === null && !categoriesError && (
          <p className="text-muted-foreground text-sm">Wczytywanie kategorii…</p>
        )}
        {categories !== null && <EntryForm categories={categories} occurredOn={selectedDate} onSaved={handleSaved} />}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Wpisy tego dnia</h2>
        <DayEntriesList entries={entries} loadError={entriesError} />
      </div>
    </div>
  );
}
