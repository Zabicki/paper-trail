import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import CategoryPicker from "@/components/entries/CategoryPicker";
import { formatCurrency } from "@/lib/format";
import { roundToCents } from "@/lib/money";
import { sumItems, totalDelta } from "./receipt-total";
import type { Category, ParsedReceipt } from "@/types";

// The wire shape of one confirmed line, matching createEntriesBatchSchema's
// item. `type` is absent on purpose: receipt items are always expenses.
export interface ConfirmItem {
  amount: number;
  categoryId: number;
  description: string | null;
}

interface ReceiptReviewProps {
  parsed: ParsedReceipt;
  // Null only for the frame between the file being picked and the object URL
  // effect running. The thumbnail is an aid, not load-bearing.
  imageUrl: string | null;
  expenseCategories: Category[];
  // The day the calendar is showing *now*. A live prop rather than a value
  // captured at parse time: the user can move the calendar mid-review, and the
  // entries belong wherever it points at the moment of the confirm click.
  occurredOn: string;
  // Rejects with a user-facing Polish message. The fetch lives in the parent,
  // which owns onBatchSaved and the return to idle.
  onConfirm: (items: ConfirmItem[]) => Promise<void>;
  onDiscard: () => void;
}

interface ReviewRow {
  // Assigned once from the parse order and never reused. Not the index: rows
  // can be removed, and an index key would make React reuse a removed row's
  // input state for its successor.
  key: number;
  name: string;
  amountText: string;
  categoryId: number | null;
}

export default function ReceiptReview({
  parsed,
  imageUrl,
  expenseCategories,
  occurredOn,
  onConfirm,
  onDiscard,
}: ReceiptReviewProps) {
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    parsed.items.map((item, index) => ({
      key: index,
      name: item.name,
      // Seeds a text input, so a bare number — formatCurrency's "12,50 zł"
      // would land in the field and fail the amount parse, exactly as
      // DayEntriesList's startEdit notes.
      amountText: item.amount.toFixed(2),
      categoryId: item.categoryId,
    })),
  );
  // Only one picker is open at a time: expanding several at once turns the
  // panel into a wall of chips with no visible line items left.
  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [totalPickerOpen, setTotalPickerOpen] = useState(false);
  const [totalCategoryId, setTotalCategoryId] = useState<number | null>(null);
  const [totalFilterText, setTotalFilterText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const evaluated = rows.map((row) => {
    const amount = Number(row.amountText.replace(",", "."));
    return {
      row,
      amount,
      amountValid: row.amountText.trim().length > 0 && Number.isFinite(amount) && amount > 0,
    };
  });

  const sum = sumItems(evaluated.filter((entry) => entry.amountValid).map((entry) => ({ amount: entry.amount })));
  const delta = totalDelta(sum, parsed.total);

  const missingCategory = rows.some((row) => row.categoryId === null);
  const invalidAmount = evaluated.some((entry) => !entry.amountValid);

  // Two structurally different blocks, and conflating them would be wrong.
  //
  // Hard: entries.category_id is NOT NULL and amount is `check (amount > 0)`.
  // There is nothing to acknowledge — the row literally cannot be stored.
  const hardBlocked = rows.length === 0 || missingCategory || invalidAmount;
  // Soft: a sum that disagrees with the paragon is suspicious, not impossible.
  // The checkbox is what turns bad data into a deliberate choice rather than
  // an accident.
  const deltaMismatch = delta !== null && delta !== 0;
  const canConfirmItems = !hardBlocked && !(deltaMismatch && !acknowledged) && !submitting;

  async function submit(items: ConfirmItem[]) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(items);
      // No setSubmitting(false) on success: a successful confirm unmounts this
      // panel from the parent, and the button must stay disabled until it goes.
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "Coś poszło nie tak. Spróbuj ponownie.");
      setSubmitting(false);
    }
  }

  function updateRow(key: number, patch: Partial<ReviewRow>) {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    // Any edit moves the sum, so an acknowledgement given against the previous
    // delta is stale. Re-ticking it is one tap; saving a mismatch the user
    // never saw is not recoverable.
    setAcknowledged(false);
  }

  function removeRow(key: number) {
    setRows((previous) => previous.filter((row) => row.key !== key));
    setExpandedKey(null);
    setAcknowledged(false);
  }

  function handleConfirmItems() {
    if (!canConfirmItems) return;
    const items: ConfirmItem[] = [];
    for (const { row, amount } of evaluated) {
      // Narrowing rather than an assertion — hardBlocked already guarantees
      // this, but the compiler is the one that has to be convinced.
      if (row.categoryId === null) return;
      items.push({
        amount: roundToCents(amount),
        categoryId: row.categoryId,
        description: row.name.trim() === "" ? null : row.name.trim(),
      });
    }
    void submit(items);
  }

  function handleConfirmTotal() {
    if (parsed.total === null || totalCategoryId === null || submitting) return;
    void submit([
      {
        amount: roundToCents(parsed.total),
        categoryId: totalCategoryId,
        // An honest name for what this row is. The column exists so a wrong
        // categorisation stays diagnosable, and "one entry for a whole
        // receipt" is precisely the thing worth being able to recognise later.
        description: "Paragon",
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        {imageUrl !== null && (
          <img src={imageUrl} alt="Zdjęcie paragonu" className="size-24 shrink-0 rounded-md border object-cover" />
        )}
        <div className="flex flex-col gap-1 text-sm">
          <p>
            Wpisy trafią na: <span className="font-semibold">{occurredOn}</span>
          </p>
          {/* A hint, never an automatic date change. Filing a whole receipt to
              the wrong day is the one high-cost mistake this placement makes
              possible, and the model reads dates far more reliably than line
              items — so the hint is nearly free insurance. */}
          {parsed.receiptDate !== null && parsed.receiptDate !== occurredOn && (
            <p className="text-amber-300">
              Na paragonie widnieje data {parsed.receiptDate}. Zmień dzień w kalendarzu, jeśli to pomyłka.
            </p>
          )}
          {parsed.droppedItems > 0 && (
            <p className="text-muted-foreground">Pominięte linie: {parsed.droppedItems} (rabaty lub zerowe kwoty).</p>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nie odczytano żadnych pozycji z tego paragonu.
          {parsed.total !== null && " Możesz zapisać go jako jeden wpis."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {evaluated.map(({ row, amountValid }) => {
            const category = expenseCategories.find((candidate) => candidate.id === row.categoryId) ?? null;
            return (
              <li
                key={row.key}
                className={cn("rounded-lg border px-3 py-2", row.categoryId === null && "border-destructive")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {/* Read-only: FR-012 asks for the category and the amount to
                      be correctable, not the name. It is an aid for deciding
                      the other two. */}
                  <span className="min-w-32 flex-1 truncate text-sm">{row.name}</span>
                  <Input
                    inputMode="decimal"
                    aria-label={`Kwota: ${row.name}`}
                    value={row.amountText}
                    onChange={(event) => {
                      updateRow(row.key, { amountText: event.target.value });
                    }}
                    aria-invalid={!amountValid}
                    disabled={submitting}
                    className="h-11 min-h-11 w-24"
                  />
                  <button
                    type="button"
                    aria-expanded={expandedKey === row.key}
                    disabled={submitting}
                    onClick={() => {
                      setExpandedKey(expandedKey === row.key ? null : row.key);
                      setFilterText("");
                    }}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-full border-2 px-3 py-2 text-sm transition-colors",
                      category === null ? "border-destructive" : "hover:bg-accent border-transparent",
                    )}
                  >
                    {category === null ? (
                      "Wybierz kategorię"
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        {category.name}
                      </>
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-touch"
                    disabled={submitting}
                    aria-label="Usuń pozycję"
                    onClick={() => {
                      removeRow(row.key);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>

                {expandedKey === row.key && (
                  <div className="mt-2">
                    <CategoryPicker
                      categories={expenseCategories}
                      value={row.categoryId}
                      onChange={(categoryId) => {
                        updateRow(row.key, { categoryId });
                        setExpandedKey(null);
                      }}
                      filterText={filterText}
                      onFilterTextChange={setFilterText}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Suma pozycji</span>
          <span className="font-medium">{formatCurrency(sum)}</span>
        </div>
        {parsed.total !== null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Na paragonie</span>
            <span className={cn("font-medium", deltaMismatch ? "text-destructive" : "text-emerald-400")}>
              {formatCurrency(parsed.total)}
              {delta !== null && delta !== 0 && ` (${delta > 0 ? "+" : ""}${formatCurrency(delta)})`}
            </span>
          </div>
        )}
      </div>

      {missingCategory && <p className="text-destructive text-sm">Każda pozycja musi mieć kategorię.</p>}
      {invalidAmount && <p className="text-destructive text-sm">Każda kwota musi być liczbą większą od zera.</p>}

      {deltaMismatch && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={acknowledged}
            disabled={submitting}
            onCheckedChange={(checked) => {
              setAcknowledged(checked === true);
            }}
            className="mt-0.5"
          />
          <span>Suma pozycji nie zgadza się z paragonem. Zapisz mimo to.</span>
        </label>
      )}

      {submitError !== null && <p className="text-destructive text-sm">{submitError}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleConfirmItems} disabled={!canConfirmItems} className="min-h-11">
          {submitting ? "Zapisywanie…" : "Zapisz pozycje"}
        </Button>
        {/* Always available, never gated on the sum check — it is the exit
            from a blocked confirm, which is what keeps the user from ever
            being left without a way forward. */}
        {parsed.total !== null && (
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => {
              setTotalPickerOpen((open) => !open);
            }}
            className="min-h-11"
          >
            Zapisz jako jeden wpis ({formatCurrency(parsed.total)})
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onDiscard} disabled={submitting} className="min-h-11">
          Odrzuć
        </Button>
      </div>

      {totalPickerOpen && parsed.total !== null && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <span className="text-sm font-medium">Kategoria dla całego paragonu</span>
          <CategoryPicker
            categories={expenseCategories}
            value={totalCategoryId}
            onChange={setTotalCategoryId}
            filterText={totalFilterText}
            onFilterTextChange={setTotalFilterText}
          />
          <Button
            type="button"
            onClick={handleConfirmTotal}
            disabled={totalCategoryId === null || submitting}
            className="min-h-11"
          >
            {submitting ? "Zapisywanie…" : `Zapisz jeden wpis (${formatCurrency(parsed.total)})`}
          </Button>
        </div>
      )}
    </div>
  );
}
