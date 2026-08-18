import { useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import CategoryPicker from "./CategoryPicker";
import CategoryIcon from "@/components/categories/CategoryIcon";
import { parseErrorBody, type ApiErrorBody } from "@/lib/api-error";
import {
  DESCRIPTION_ITEM_SEPARATOR,
  DESCRIPTION_MAX_CODE_POINTS,
  splitDescriptionItems,
} from "@/lib/entry-description";
import { formatCurrency } from "@/lib/format";
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
  descriptionText: string;
}

// PostgREST hands back numeric(10,2) as a JS number, so these totals inherit
// binary-float rounding. Acceptable here because the sum is bounded to one
// day's rows. The range case this originally flagged forward (S-02 review
// finding F4) is now summed in Postgres by public.entries_summary, so no
// unbounded chain of JS float additions exists in the data path.
function sumOf(entries: Entry[], type: Entry["type"]): number {
  return entries.filter((entry) => entry.type === type).reduce((total, entry) => total + entry.amount, 0);
}

// Three items before the clamp. A grouped receipt description routinely carries
// more; a manual one almost never splits at all, which is what keeps this inert
// for hand-written entries.
const DESCRIPTION_PREVIEW_ITEMS = 3;

// The second line of a row. Renders nothing at all when the description has no
// items, so a descriptionless row keeps exactly today's single-line height.
function EntryDescription({
  description,
  expanded,
  onToggle,
}: {
  description: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const items = splitDescriptionItems(description);
  if (items.length === 0) {
    return null;
  }

  const hiddenCount = items.length - DESCRIPTION_PREVIEW_ITEMS;
  const shown = expanded || hiddenCount <= 0 ? items : items.slice(0, DESCRIPTION_PREVIEW_ITEMS);

  return (
    // break-words rather than a truncate: at 360px a long single-item
    // description has to wrap inside the left column, not widen it and push the
    // amount and the two action buttons off-screen.
    <span className="text-muted-foreground text-xs break-words">
      {shown.join(DESCRIPTION_ITEM_SEPARATOR)}
      {/* Mirrors CategoryPicker's collapse rule: rendered only when there is
          something to hide, and kept rendered while expanded so the row can be
          collapsed again. Deliberately not a 44px control — it is a third
          affordance in a row that already has Edytuj and Usuń, and making it
          their size would compete with them. */}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Zwiń opis wpisu" : `Pokaż pozostałe pozycje opisu (${String(hiddenCount)})`}
          className="text-foreground ml-1 underline underline-offset-2"
        >
          {expanded ? "Zwiń" : `+${String(hiddenCount)}`}
        </button>
      )}
    </span>
  );
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
  const [editForm, setEditForm] = useState<EditFormState>({
    amountText: "",
    categoryId: null,
    occurredOn: "",
    descriptionText: "",
  });
  const [editFilterText, setEditFilterText] = useState("");
  const [editError, setEditError] = useState<ApiErrorBody | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // A set, not a single id like editingId: two rows can be expanded at once
  // without conflict, because unlike editing there is no shared error state to
  // land on the wrong row. DayView keys this component on selectedDate, so
  // navigating days clears it via remount rather than via an effect.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());

  function toggleExpanded(id: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setEditForm({
      // Seeds a text input, so this stays a bare number — formatCurrency's
      // "12,50 zł" would land in the field and fail the amount parse.
      amountText: entry.amount.toFixed(2),
      categoryId: entry.category.id,
      occurredOn: entry.occurredOn,
      descriptionText: entry.description ?? "",
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
          // ALWAYS sent, never conditionally: PATCH is a full replace, so
          // omitting the key would be a 400 (updateEntrySchema requires it) and
          // conditionally omitting it would be the silent wipe that requirement
          // exists to prevent. Cleared means an explicit null.
          description: editForm.descriptionText.trim() || null,
        }),
      });
      if (!response.ok) {
        setEditError(await parseErrorBody(response));
        return;
      }
      const updated = await response.json<Entry>();
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
        <span>Wydatki: {formatCurrency(expenseTotal)}</span>
        <span>Przychody: {formatCurrency(incomeTotal)}</span>
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

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`edit-description-${entry.id}`}>Opis</Label>
                  {/* Clearing this field is how a receipt-generated description
                      gets removed, so an empty value is valid — editValid does
                      not look at it. */}
                  <Input
                    id={`edit-description-${entry.id}`}
                    value={editForm.descriptionText}
                    onChange={(event) => {
                      setEditForm((f) => ({ ...f, descriptionText: event.target.value }));
                    }}
                    placeholder="Opcjonalnie"
                    maxLength={DESCRIPTION_MAX_CODE_POINTS}
                    aria-invalid={editError?.field === "description"}
                    disabled={saving}
                    className="h-11 min-h-11"
                  />
                  {editError?.field === "description" && <p className="text-destructive text-sm">{editError.error}</p>}
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
                {/* Two lines now, so min-w-0 is load-bearing: without it a long
                    description makes this column refuse to shrink and the
                    amount and buttons leave the viewport at 360px. */}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <CategoryIcon name={entry.category.icon} className="size-4 shrink-0" />
                    {entry.category.name}
                  </span>
                  {entry.description !== null && (
                    <EntryDescription
                      description={entry.description}
                      expanded={expandedIds.has(entry.id)}
                      onToggle={() => {
                        toggleExpanded(entry.id);
                      }}
                    />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Signed and coloured on BOTH sides, so direction is carried
                      twice over — colour alone fails for the ~8% of men with a
                      red/green deficiency, and the sign alone is easy to skim
                      past. Scoped to this list on purpose: the `Wydatki` total
                      above and every reports surface stay unsigned, where the
                      surrounding label already says which direction it is.

                      U+2212 MINUS SIGN, not an ASCII hyphen: it is drawn to the
                      same width and height as the "+" it has to line up with in
                      the column above and below. */}
                  <span className={cn("font-medium", entry.type === "income" ? "text-emerald-400" : "text-red-400")}>
                    {entry.type === "income" ? "+" : "−"}
                    {formatCurrency(entry.amount)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-touch"
                    // The edit state is shared across rows, so opening a
                    // second one mid-save would land the first row's error
                    // (or its dismissal) on the wrong form.
                    disabled={saving}
                    aria-label="Edytuj"
                    onClick={() => {
                      startEdit(entry);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-touch"
                    onClick={() => {
                      void handleDelete(entry.id);
                    }}
                    disabled={deletingId === entry.id}
                    aria-label="Usuń"
                    // With no label left to swap to "Usuwanie…", the spinner is
                    // the only in-flight signal a slow delete has.
                    aria-busy={deletingId === entry.id}
                  >
                    {deletingId === entry.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
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
