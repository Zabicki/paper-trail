import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import CategoryPicker from "@/components/entries/CategoryPicker";
import CategoryIcon from "@/components/categories/CategoryIcon";
import { formatCurrency } from "@/lib/format";
import { sumItems, totalDelta } from "./receipt-total";
import {
  evaluateConfirmGate,
  evaluateRows,
  groupByCategory,
  isReceiptDateRejected,
  resolveSaveDate,
  seedReviewRows,
  toConfirmItems,
  wholeReceiptItem,
  type ConfirmItem,
  type ReviewRow,
} from "./review-model";
import type { Category, ParsedReceipt } from "@/types";

interface ReceiptReviewProps {
  parsed: ParsedReceipt;
  // Null only for the frame between the file being picked and the object URL
  // effect running. The thumbnail is an aid, not load-bearing.
  imageUrl: string | null;
  expenseCategories: Category[];
  // The day the calendar is showing *now*, still a live prop — but no longer
  // the date the entries land on. It is the DEFAULT for the panel's own date
  // field when the paragon has no usable printed date, and the target of the
  // revert button. The date actually saved is `saveDate` below.
  occurredOn: string;
  // Takes the panel's chosen save date as its second argument rather than
  // reading the live `occurredOn` prop, so a date the user set here is the one
  // that gets written. Rejects with a user-facing Polish message. The fetch
  // lives in the parent, which owns onBatchSaved and the return to idle.
  onConfirm: (items: ConfirmItem[], saveDate: string) => Promise<void>;
  onDiscard: () => void;
}

export default function ReceiptReview({
  parsed,
  imageUrl,
  expenseCategories,
  occurredOn,
  onConfirm,
  onDiscard,
}: ReceiptReviewProps) {
  const [rows, setRows] = useState<ReviewRow[]>(() => seedReviewRows(parsed.items));
  // A lazy initialiser, so resolveSaveDate runs once per mount (i.e. once per
  // parse) and moving the calendar mid-review cannot clobber a date already
  // chosen here. Why the printed date is preferred, and why it is never adopted
  // from the future, is documented on resolveSaveDate itself.
  const [saveDate, setSaveDate] = useState(() => resolveSaveDate(parsed.receiptDate, occurredOn));
  // Whether the initialiser REJECTED the printed date, decided once at mount for
  // the same reason: derived live, it would start claiming the date was rejected
  // simply because the user later moved the calendar backwards.
  const [receiptDateRejected] = useState(() => isReceiptDateRejected(parsed.receiptDate, occurredOn));
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
  const [photoOpen, setPhotoOpen] = useState(false);

  const evaluated = evaluateRows(rows);

  const sum = sumItems(evaluated.filter((entry) => entry.amountValid).map((entry) => ({ amount: entry.amount })));
  const delta = totalDelta(sum, parsed.total);

  // Derived ONCE and consumed by both the preview and handleConfirmItems. Two
  // reduces would be free to disagree, and the preview's entire job is to state
  // what the confirm is about to write — a requirement that happens to also be
  // the cheaper shape.
  const groups = groupByCategory(evaluated);

  const { missingCategory, invalidAmount, deltaMismatch, canConfirmItems } = evaluateConfirmGate({
    rows,
    evaluated,
    delta,
    acknowledged,
    submitting,
  });

  async function submit(items: ConfirmItem[]) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // saveDate, not the live occurredOn prop: both confirm paths file to the
      // date shown in the field above.
      await onConfirm(items, saveDate);
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
    // The SAME `groups` the preview above renders — that is the property this
    // panel exists to hold, so the fold happens exactly once and both sides read
    // it. toConfirmItems only reshapes it into the wire body.
    const items = toConfirmItems(groups);
    // hardBlocked already guarantees a non-empty result, but the batch schema's
    // .min(1) is the thing that would 400 and the check is one line.
    if (items.length === 0) return;
    void submit(items);
  }

  function handleConfirmTotal() {
    if (parsed.total === null || totalCategoryId === null || submitting) return;
    void submit(wholeReceiptItem(parsed.total, totalCategoryId));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        {imageUrl !== null && (
          // A button, not a bare <img>: at 96px square with object-cover the
          // thumbnail is a locator, not something you can read line items off.
          // Enlarging it is what makes the review panel checkable against the
          // paper when a name or an amount looks wrong.
          <button
            type="button"
            onClick={() => {
              setPhotoOpen(true);
            }}
            aria-label="Powiększ zdjęcie paragonu"
            className="focus-visible:ring-ring size-24 shrink-0 cursor-zoom-in overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
          >
            <img src={imageUrl} alt="Zdjęcie paragonu" className="size-full object-cover" />
          </button>
        )}
        {/* min-w-0 flex-1 so the date input shrinks beside the thumbnail rather
            than overflowing the panel at 360px. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <Label htmlFor="receipt-save-date">Wpisy trafią na</Label>
          {/* Editable, and pre-filled from the paragon's own date where there is
              a usable one. This softens S-06's "never an automatic date change"
              guard, so the date has to stay visible at confirm time and the
              revert below has to stay one tap. */}
          <Input
            id="receipt-save-date"
            type="date"
            value={saveDate}
            onChange={(event) => {
              setSaveDate(event.target.value);
            }}
            disabled={submitting}
            className="h-11 min-h-11"
          />
          {saveDate !== occurredOn && (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setSaveDate(occurredOn);
              }}
              // `max-w-full` is the load-bearing half: `self-start` sizes the
              // button to max-content, so beside the 96px thumbnail a long
              // label pushed the panel past the 360px viewport and the whole
              // document shifted left of a black gutter (same failure mode as
              // the top bar's email). The date is dropped from the label too —
              // it is already visible in the field right above.
              className="min-h-11 max-w-full self-start"
            >
              Ustaw obecny dzień
            </Button>
          )}
          {/* Retained only for the case the initialiser refused: a printed date
              in the future. It explains why the date was NOT adopted, rather
              than telling the user to move the calendar — the field above is
              now where a date gets changed. */}
          {receiptDateRejected && parsed.receiptDate !== null && (
            <p className="text-amber-300">
              Na paragonie widnieje data {parsed.receiptDate} — jest w przyszłości, więc jej nie użyto. Popraw datę
              powyżej, jeśli to nie pomyłka modelu.
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
                        <CategoryIcon name={category.icon} className="size-4 shrink-0" />
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

      {/* What will actually be saved. A 12-line paragon collapsing to 4 entries
          has to be a stated outcome rather than something the user discovers in
          the day list afterwards. Rendered from the same `groups` the confirm
          posts, so the two cannot disagree. */}
      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
          <span className="font-medium">Zostanie zapisanych wpisów: {groups.length}</span>
          {groups.map((group) => {
            const category = expenseCategories.find((candidate) => candidate.id === group.categoryId) ?? null;
            return (
              <div key={group.categoryId} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  {category !== null && <CategoryIcon name={category.icon} className="size-4 shrink-0" />}
                  <span className="truncate">{category?.name ?? "—"}</span>
                  {/* The line count is the whole point of the preview: it is
                      what tells the user this row is a fold of several. */}
                  <span className="text-muted-foreground shrink-0">({group.items.length})</span>
                </span>
                <span className="shrink-0 font-medium">{formatCurrency(group.amount)}</span>
              </div>
            );
          })}
        </div>
      )}

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

      {/* The enlarged photo. A dialog rather than an inline expand, because the
          review rows are what the user is comparing against and pushing them
          down the page would lose their place. Radix gives Escape, a click on
          the backdrop and a focus trap for free, and DialogContent's own close
          button is already labelled "Zamknij" — three ways back, none of which
          can be missed.

          Mounted only while open so a discarded receipt does not keep a
          full-size bitmap decoded; the object URL itself is owned by
          ReceiptCapture and is not duplicated here. */}
      {imageUrl !== null && (
        <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
          {/* Wider and taller than the default dialog: this one exists purely to
              make small print readable, so it takes as much of the viewport as
              it can get. */}
          <DialogContent className="max-h-[95dvh] gap-2 p-3 sm:max-w-3xl">
            <DialogHeader>
              {/* Not sr-only: Radix warns without a title, and naming the panel
                  is also what tells the user the review is still underneath. */}
              <DialogTitle className="text-base">Zdjęcie paragonu</DialogTitle>
              <DialogDescription>Zamknij, aby wrócić do sprawdzania pozycji.</DialogDescription>
            </DialogHeader>
            {/* Full width, height auto, scrolled vertically — NOT scaled to fit.
                A paragon is tall and narrow: fitting its whole height into the
                viewport is exactly what makes the print too small to read, which
                is the one thing this view is for. */}
            <div className="overflow-y-auto">
              <img src={imageUrl} alt="Zdjęcie paragonu, powiększone" className="h-auto w-full rounded-md" />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
