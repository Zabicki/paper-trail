import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import CategoryPicker from "./CategoryPicker";
import { parseErrorBody, type ApiErrorBody } from "@/lib/api-error";
import type { Category, Entry } from "@/types";

interface DayEntriesListProps {
  entries: Entry[] | null;
  loadError: string | null;
  expenseCategories: Category[];
  incomeCategories: Category[];
  onUpdated: (entry: Entry) => void;
  onDeleted: (id: number) => void;
}

interface EditFormState {
  amountText: string;
  categoryId: number | null;
  occurredOn: string;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

// PostgREST hands back numeric(10,2) as a JS number, so these totals inherit
// binary-float rounding. Acceptable here because the sum is bounded to one
// day's rows; the real fix (aggregate in SQL, or carry integer minor units)
// belongs with S-04/S-05's aggregation work. Flagged forward by S-02's review
// finding F4.
function sumOf(entries: Entry[], type: Entry["type"]): number {
  return entries.filter((entry) => entry.type === type).reduce((total, entry) => total + entry.amount, 0);
}

export default function DayEntriesList({
  entries,
  loadError,
  expenseCategories,
  incomeCategories,
  onUpdated,
  onDeleted,
}: DayEntriesListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({ amountText: "", categoryId: null, occurredOn: "" });
  const [editFilterText, setEditFilterText] = useState("");
  const [editError, setEditError] = useState<ApiErrorBody | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setEditForm({
      amountText: formatAmount(entry.amount),
      categoryId: entry.category.id,
      occurredOn: entry.occurredOn,
    });
    setEditFilterText("");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(id: number) {
    const amountValue = Number(editForm.amountText.replace(",", "."));
    setSaving(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountValue,
          categoryId: editForm.categoryId,
          occurredOn: editForm.occurredOn,
        }),
      });
      if (!response.ok) {
        setEditError(await parseErrorBody(response));
        return;
      }
      const updated = (await response.json()) as Entry;
      // The parent decides what happens to the row — if the date changed, the
      // entry now belongs to a different day's list entirely.
      onUpdated(updated);
      setEditingId(null);
    } catch {
      setEditError({ error: "Nie udało się połączyć z serwerem. Spróbuj ponownie." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Usunąć ten wpis?")) {
      return;
    }
    setDeletingId(id);
    try {
      const response = await fetch(`/api/entries/${id}`, { method: "DELETE" });
      // 404 means it is already gone — deleted in another tab, most likely.
      // The user asked for it gone, and it is: drop the row rather than
      // leaving it stranded in the list behind an error.
      if (!response.ok && response.status !== 404) {
        const body = await parseErrorBody(response);
        window.alert(body.error);
        return;
      }
      onDeleted(id);
    } catch {
      window.alert("Nie udało się połączyć z serwerem. Spróbuj ponownie.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loadError) {
    return <p className="text-destructive text-sm">{loadError}</p>;
  }

  if (entries === null) {
    return <p className="text-muted-foreground text-sm">Wczytywanie wpisów…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">Brak wpisów tego dnia.</p>;
  }

  const expenseTotal = sumOf(entries, "expense");
  const incomeTotal = sumOf(entries, "income");

  const amountValue = Number(editForm.amountText.replace(",", "."));
  const editValid =
    editForm.amountText.trim().length > 0 &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    editForm.categoryId !== null &&
    editForm.occurredOn.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Two figures, never netted — "what did I spend today" is a different
          question from "what came in", and subtracting one from the other
          answers neither. */}
      <div className="text-muted-foreground flex gap-4 text-sm">
        <span>Wydatki: {formatAmount(expenseTotal)}</span>
        <span>Przychody: {formatAmount(incomeTotal)}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border px-3 py-2">
            {editingId === entry.id ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`edit-amount-${entry.id}`}>Kwota</Label>
                  {/* h-11 overrides the shared Input's h-9 for the 44px tap target. */}
                  <Input
                    id={`edit-amount-${entry.id}`}
                    inputMode="decimal"
                    value={editForm.amountText}
                    onChange={(event) => {
                      setEditForm((f) => ({ ...f, amountText: event.target.value }));
                    }}
                    aria-invalid={editError?.field === "amount"}
                    disabled={saving}
                    className="h-11 min-h-11"
                  />
                  {editError?.field === "amount" && <p className="text-destructive text-sm">{editError.error}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Kategoria</span>
                  <CategoryPicker
                    categories={entry.type === "income" ? incomeCategories : expenseCategories}
                    value={editForm.categoryId}
                    onChange={(categoryId) => {
                      setEditForm((f) => ({ ...f, categoryId }));
                    }}
                    filterText={editFilterText}
                    onFilterTextChange={setEditFilterText}
                  />
                  {editError?.field === "categoryId" && <p className="text-destructive text-sm">{editError.error}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`edit-date-${entry.id}`}>Data</Label>
                  {/* A native date input rather than the month calendar above:
                      correcting a mis-dated entry is rare enough that it does
                      not warrant reusing the tap-optimised picker. */}
                  <Input
                    id={`edit-date-${entry.id}`}
                    type="date"
                    value={editForm.occurredOn}
                    onChange={(event) => {
                      setEditForm((f) => ({ ...f, occurredOn: event.target.value }));
                    }}
                    aria-invalid={editError?.field === "occurredOn"}
                    disabled={saving}
                    className="h-11 min-h-11"
                  />
                  {editError?.field === "occurredOn" && <p className="text-destructive text-sm">{editError.error}</p>}
                </div>

                {editError && !editError.field && <p className="text-destructive text-sm">{editError.error}</p>}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      void handleSaveEdit(entry.id);
                    }}
                    disabled={saving || !editValid}
                  >
                    {saving ? "Zapisywanie…" : "Zapisz"}
                  </Button>
                  <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                    Anuluj
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.category.color }}
                  />
                  {entry.category.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className={cn("font-medium", entry.type === "income" && "text-emerald-400")}>
                    {entry.type === "income" && "+"}
                    {formatAmount(entry.amount)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    // The edit state is shared across rows, so opening a
                    // second one mid-save would land the first row's error
                    // (or its dismissal) on the wrong form.
                    disabled={saving}
                    onClick={() => {
                      startEdit(entry);
                    }}
                  >
                    Edytuj
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      void handleDelete(entry.id);
                    }}
                    disabled={deletingId === entry.id}
                  >
                    {deletingId === entry.id ? "Usuwanie…" : "Usuń"}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
