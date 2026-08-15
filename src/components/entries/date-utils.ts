// "Today" must come from the browser's local date, never UTC or a server
// computation — see plan's Critical Implementation Details. Every helper
// here operates on the visitor's local calendar, not UTC.

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalMonthString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function monthOf(dateString: string): string {
  return dateString.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [year, monthNum] = month.split("-").map(Number);
  return new Date(year, monthNum, 0).getDate();
}

// Monday-first weekday index (0 = Monday .. 6 = Sunday) for the 1st of month.
export function firstWeekdayOfMonth(month: string): number {
  const [year, monthNum] = month.split("-").map(Number);
  return (new Date(year, monthNum - 1, 1).getDay() + 6) % 7;
}

export function addMonths(month: string, delta: number): string {
  const [year, monthNum] = month.split("-").map(Number);
  const date = new Date(year, monthNum - 1 + delta, 1);
  return toLocalMonthString(date);
}

export const POLISH_MONTH_NAMES = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

export const POLISH_WEEKDAY_LABELS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"];

export function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  return `${POLISH_MONTH_NAMES[monthNum - 1]} ${year}`;
}
