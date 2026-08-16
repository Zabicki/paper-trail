import { useEffect, useRef, useState } from "react";
import MonthCalendar from "./MonthCalendar";
import EntryForm from "./EntryForm";
import DayEntriesList from "./DayEntriesList";
import { monthOf, toLocalDateString } from "./date-utils";
import type { Category, Entry, EntryType } from "@/types";

const FORM_HEADINGS: Record<EntryType, string> = {
  expense: "Dodaj wydatek",
  income: "Dodaj przychód",
};

export default function DayView() {
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(selectedDate));
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // Lives here rather than in EntryForm because the heading above the form
  // follows it.
  const [entryType, setEntryType] = useState<EntryType>("expense");

  const [expenseCategories, setExpenseCategories] = useState<Category[] | null>(null);
  const [incomeCategories, setIncomeCategories] = useState<Category[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // Both lists up front, in parallel: switching to Przychód has to be instant.
  // Fetching the income list on first toggle would put a visible wait on the
  // one interaction income costs over an expense.
  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      try {
        const [expenseResponse, incomeResponse] = await Promise.all([
          fetch("/api/entries/categories?kind=expense"),
          fetch("/api/entries/categories?kind=income"),
        ]);
        if (!expenseResponse.ok || !incomeResponse.ok) {
          throw new Error("Nie udało się wczytać kategorii.");
        }
        const expense = await expenseResponse.json<Category[]>();
        const income = await incomeResponse.json<Category[]>();
        if (!cancelled.current) {
          setExpenseCategories(expense);
          setIncomeCategories(income);
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
        const data = await response.json<Entry[]>();
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

  // All three mutation callbacks compare against selectedDateRef rather than
  // selectedDate: a response can land after the user has moved to another day,
  // and splicing it into that day's list is the S-02 F1 regression. The
  // calendar key is bumped regardless — the *other* day's marking may have
  // changed even when this list must not.
  function handleSaved(entry: Entry) {
    if (entry.occurredOn === selectedDateRef.current) {
      setEntries((prev) => {
        // Left null while the day's GET is still in flight — appending here
        // would replace "Wczytywanie wpisów…" with a list of exactly one
        // entry and a total covering only it.
        if (prev === null) {
          return prev;
        }
        // Dedupe: a POST can commit server-side before its response lands, so
        // an intervening GET may already have returned this row. Appending it
        // again duplicates the React key and double-counts the day's total.
        return prev.some((existing) => existing.id === entry.id) ? prev : [...prev, entry];
      });
    }
    setCalendarRefreshKey((key) => key + 1);
  }

  function handleUpdated(entry: Entry) {
    if (entry.occurredOn === selectedDateRef.current) {
      // Upsert: an edit that only changed the amount replaces the row in
      // place, while one that moved an entry *onto* the day now being viewed
      // has to add it.
      setEntries((prev) => {
        if (prev === null) {
          return prev;
        }
        return prev.some((existing) => existing.id === entry.id)
          ? prev.map((existing) => (existing.id === entry.id ? entry : existing))
          : [...prev, entry];
      });
    } else {
      // Moved to a different day — it belongs to that day's list now.
      setEntries((prev) => (prev ? prev.filter((existing) => existing.id !== entry.id) : prev));
    }
    setCalendarRefreshKey((key) => key + 1);
  }

  // No date comparison needed: filtering by id is a no-op on any list that
  // does not hold the row, so a late response cannot corrupt another day.
  function handleDeleted(id: number) {
    setEntries((prev) => (prev ? prev.filter((existing) => existing.id !== id) : prev));
    setCalendarRefreshKey((key) => key + 1);
  }

  const categoriesLoaded = expenseCategories !== null && incomeCategories !== null;

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
        <h2 className="text-lg font-semibold">{FORM_HEADINGS[entryType]}</h2>
        {categoriesError && <p className="text-destructive text-sm">{categoriesError}</p>}
        {!categoriesLoaded && !categoriesError && (
          <p className="text-muted-foreground text-sm">Wczytywanie kategorii…</p>
        )}
        {categoriesLoaded && (
          <EntryForm
            expenseCategories={expenseCategories}
            incomeCategories={incomeCategories}
            type={entryType}
            onTypeChange={setEntryType}
            occurredOn={selectedDate}
            onSaved={handleSaved}
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Wpisy tego dnia</h2>
        {/* Keyed on the day so the list remounts when you navigate: its edit
            state is internal, and a half-typed correction must not survive a
            day change and come back looking like a fresh form. */}
        <DayEntriesList
          key={selectedDate}
          entries={entries}
          loadError={entriesError}
          expenseCategories={expenseCategories ?? []}
          incomeCategories={incomeCategories ?? []}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      </div>
    </div>
  );
}
