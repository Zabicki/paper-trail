import { useEffect, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import CategoryPicker from "./CategoryPicker";
import CategoryManagerDialog from "@/components/categories/CategoryManagerDialog";
import { parseErrorBody, type ApiErrorBody } from "@/lib/api-error";
import type { Category, Entry, EntryType } from "@/types";

interface EntryFormProps {
  expenseCategories: Category[];
  incomeCategories: Category[];
  type: EntryType;
  onTypeChange: (type: EntryType) => void;
  occurredOn: string;
  onSaved: (entry: Entry) => void;
  onCategoryCreated: (category: Category) => void;
  onCategoriesChanged: () => void;
}

const CONFIRMATION_DISPLAY_MS = 2500;

const TYPES: EntryType[] = ["expense", "income"];

const TYPE_LABELS: Record<EntryType, string> = {
  expense: "Wydatek",
  income: "Przychód",
};

const SUBMIT_LABELS: Record<EntryType, string> = {
  expense: "Zapisz wydatek",
  income: "Zapisz przychód",
};

// Deliberately quiet, and deliberately always defaulted to Wydatek: the
// expense path is the tap-budgeted one (≤4 interactions), so the toggle has to
// cost it nothing. Income pays exactly one tap.
function TypeToggle({
  value,
  onChange,
  disabled,
}: {
  value: EntryType;
  onChange: (type: EntryType) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Typ wpisu">
      {TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          disabled={disabled}
          onClick={() => {
            onChange(type);
          }}
          className={cn(
            "min-h-11 flex-1 rounded-md border-2 px-3 py-2 text-sm transition-colors",
            value === type ? "border-foreground" : "border-input hover:bg-accent",
          )}
        >
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}

export default function EntryForm({
  expenseCategories,
  incomeCategories,
  type,
  onTypeChange,
  occurredOn,
  onSaved,
  onCategoryCreated,
  onCategoriesChanged,
}: EntryFormProps) {
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // The dialog is owned here, not in DayView, because creating a category has
  // to write to this component's selection.
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => {
      setJustSaved(false);
    }, CONFIRMATION_DISPLAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [justSaved]);

  const categories = type === "income" ? incomeCategories : expenseCategories;

  // Derived rather than reset in an effect: a category deleted from the manager
  // dialog vanishes from `categories`, and the form must not be able to submit
  // an id the picker no longer offers — not even for the one render an effect
  // would take to clear it.
  const selectedCategoryId = categoryId !== null && categories.some((c) => c.id === categoryId) ? categoryId : null;

  const amountValue = Number(amountText.replace(",", "."));
  const amountValid = amountText.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0;
  const canSubmit = amountValid && selectedCategoryId !== null && !submitting;

  // The chip list underneath changes wholesale, so any selection made against
  // the previous one is meaningless.
  function handleTypeChange(next: EntryType) {
    onTypeChange(next);
    setCategoryId(null);
    setFilterText("");
    setError(null);
  }

  // Closes the dialog, because a just-created category is almost always the one
  // being reached for. Selecting it only makes sense when it can be this
  // entry's category — a category of the other kind cannot.
  function handleCategoryCreated(created: Category) {
    setManagerOpen(false);
    onCategoryCreated(created);
    if (created.kind === type) {
      setCategoryId(created.id);
      // A stale filter would otherwise hide the chip we just selected.
      setFilterText("");
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountValue, categoryId: selectedCategoryId, occurredOn, type }),
      });
      if (!response.ok) {
        setError(await parseErrorBody(response));
        return;
      }
      const entry = await response.json<Entry>();
      onSaved(entry);
      setAmountText("");
      setCategoryId(null);
      setFilterText("");
      // Back to the default for the next entry in this sitting — a one-off
      // income must not leave the form primed for another.
      onTypeChange("expense");
      setJustSaved(true);
    } catch {
      setError({ error: "Nie udało się połączyć z serwerem. Spróbuj ponownie." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Fragment root so the dialog is a sibling of the form, not a descendant:
    // the manager renders its own <form>, and nesting one inside this one would
    // be invalid HTML if Radix ever stopped portalling to document.body.
    <>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="flex flex-col gap-3"
      >
        <TypeToggle value={type} onChange={handleTypeChange} disabled={submitting} />

        {categories.length === 0 ? (
          // Rendered below the toggle, never in place of it — otherwise having
          // no income categories would trap the user on the income side.
          <p className="text-sm text-blue-100/80">
            {type === "income"
              ? "Nie masz jeszcze żadnej kategorii przychodów. "
              : "Nie masz jeszcze żadnej kategorii wydatków. "}
            {/* type="button": this sits inside the entry form, and a
                default-type button would submit it. */}
            <button
              type="button"
              className="text-purple-300 hover:underline"
              onClick={() => {
                setManagerOpen(true);
              }}
            >
              Dodaj kategorię
            </button>
            {type === "income" ? ", aby zapisywać przychody." : ", aby zacząć dodawać wydatki."}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entry-amount">Kwota</Label>
              {/* h-11 overrides the shared Input's h-9: 44px is the minimum
                comfortable tap target, and this form is the tap-budgeted one. */}
              <Input
                id="entry-amount"
                inputMode="decimal"
                value={amountText}
                onChange={(event) => {
                  setAmountText(event.target.value);
                }}
                placeholder="0.00"
                aria-invalid={error?.field === "amount"}
                disabled={submitting}
                className="h-11 min-h-11"
              />
              {error?.field === "amount" && <p className="text-destructive text-sm">{error.error}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              {/* The label becomes a row so category management sits where the
                  need for it arises. size="sm" keeps the row close to the
                  bare label's height. */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Kategoria</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setManagerOpen(true);
                  }}
                >
                  Zarządzaj
                </Button>
              </div>
              <CategoryPicker
                categories={categories}
                value={selectedCategoryId}
                onChange={setCategoryId}
                filterText={filterText}
                onFilterTextChange={setFilterText}
              />
              {error?.field === "categoryId" && <p className="text-destructive text-sm">{error.error}</p>}
            </div>

            {error && !error.field && <p className="text-destructive text-sm">{error.error}</p>}
            {justSaved && <p className="text-sm text-emerald-400">Zapisano!</p>}

            <Button type="submit" disabled={!canSubmit} className="min-h-11">
              {submitting ? "Zapisywanie…" : SUBMIT_LABELS[type]}
            </Button>
          </>
        )}
      </form>

      <CategoryManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onCreated={handleCategoryCreated}
        // Rename, recolour, recurring, delete: refresh the dashboard but leave
        // the dialog open — the manager's own rhythm is several edits in a row.
        onChanged={onCategoriesChanged}
      />
    </>
  );
}
