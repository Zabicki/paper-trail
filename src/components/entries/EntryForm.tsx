import { useEffect, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import CategoryPicker from "./CategoryPicker";
import { parseErrorBody, type ApiErrorBody } from "@/lib/api-error";
import type { Category, Entry, EntryType } from "@/types";

interface EntryFormProps {
  expenseCategories: Category[];
  incomeCategories: Category[];
  type: EntryType;
  onTypeChange: (type: EntryType) => void;
  occurredOn: string;
  onSaved: (entry: Entry) => void;
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
}: EntryFormProps) {
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

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

  const amountValue = Number(amountText.replace(",", "."));
  const amountValid = amountText.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0;
  const canSubmit = amountValid && categoryId !== null && !submitting;

  // The chip list underneath changes wholesale, so any selection made against
  // the previous one is meaningless.
  function handleTypeChange(next: EntryType) {
    onTypeChange(next);
    setCategoryId(null);
    setFilterText("");
    setError(null);
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
        body: JSON.stringify({ amount: amountValue, categoryId, occurredOn, type }),
      });
      if (!response.ok) {
        setError(await parseErrorBody(response));
        return;
      }
      const entry = (await response.json()) as Entry;
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
          <a href="/categories" className="text-purple-300 hover:underline">
            Dodaj kategorię
          </a>
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
            <span className="text-sm font-medium">Kategoria</span>
            <CategoryPicker
              categories={categories}
              value={categoryId}
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
  );
}
