import type { Entry } from "@/types";

interface DayEntriesListProps {
  entries: Entry[] | null;
  loadError: string | null;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

export default function DayEntriesList({ entries, loadError }: DayEntriesListProps) {
  if (loadError) {
    return <p className="text-destructive text-sm">{loadError}</p>;
  }

  if (entries === null) {
    return <p className="text-muted-foreground text-sm">Wczytywanie wpisów…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">Brak wpisów tego dnia.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.category.color }}
            />
            {entry.category.name}
          </span>
          <span className="font-medium">{formatAmount(entry.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
