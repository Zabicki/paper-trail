import { useEffect, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import CategoryPicker from "./CategoryPicker";
import type { Category, Entry } from "@/types";

interface ApiErrorBody {
  error: string;
  field?: string;
}

interface EntryFormProps {
  categories: Category[];
  occurredOn: string;
  onSaved: (entry: Entry) => void;
}

const CONFIRMATION_DISPLAY_MS = 2500;

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return { error: "Coś poszło nie tak. Spróbuj ponownie." };
  }
}

export default function EntryForm({ categories, occurredOn, onSaved }: EntryFormProps) {
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

  if (categories.length === 0) {
    return (
      <p className="text-sm text-blue-100/80">
        Nie masz jeszcze żadnej kategorii.{" "}
        <a href="/categories" className="text-purple-300 hover:underline">
          Dodaj kategorię
        </a>
        , aby zacząć dodawać wydatki.
      </p>
    );
  }

  const amountValue = Number(amountText.replace(",", "."));
  const amountValid = amountText.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0;
  const canSubmit = amountValid && categoryId !== null && !submitting;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountValue, categoryId, occurredOn }),
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entry-amount">Kwota</Label>
        <input
          id="entry-amount"
          inputMode="decimal"
          value={amountText}
          onChange={(event) => {
            setAmountText(event.target.value);
          }}
          placeholder="0.00"
          aria-invalid={error?.field === "amount"}
          disabled={submitting}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-11 min-h-11 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px]"
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
        {submitting ? "Zapisywanie…" : "Zapisz wydatek"}
      </Button>
    </form>
  );
}
