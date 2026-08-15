import { useState } from "react";
import MonthCalendar from "./MonthCalendar";
import { monthOf, toLocalDateString } from "./date-utils";

export default function DayView() {
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(selectedDate));

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    const month = monthOf(date);
    if (month !== visibleMonth) {
      setVisibleMonth(month);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <MonthCalendar
        visibleMonth={visibleMonth}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        onMonthChange={setVisibleMonth}
      />
      <p className="text-muted-foreground text-sm">Formularz dodawania wydatku pojawi się tutaj.</p>
    </div>
  );
}
