import { useEffect, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { parseErrorBody, type ApiErrorBody } from "@/lib/api-error";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR, type Category, type CategoryColor, type CategoryKind } from "@/types";

interface FormState {
  name: string;
  color: CategoryColor;
  isRecurring: boolean;
  kind: CategoryKind;
}

const EMPTY_FORM: FormState = {
  name: "",
  color: DEFAULT_CATEGORY_COLOR,
  isRecurring: false,
  kind: "expense",
};

const KINDS: CategoryKind[] = ["expense", "income"];

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: "Wydatki",
  income: "Przychody",
};

const KIND_DESCRIPTIONS: Record<CategoryKind, string> = {
  expense: "Kategoria wydatków",
  income: "Kategoria przychodów",
};

// The list is grouped rather than flat: an income source and a spending
// category answer different questions, and mixing them makes neither list
// scannable.
const CATEGORY_GROUPS: { kind: CategoryKind; heading: string; empty: string }[] = [
  {
    kind: "expense",
    heading: "Kategorie wydatków",
    empty: "Nie masz jeszcze kategorii wydatków. Dodaj pierwszą powyżej, aby zacząć śledzić wydatki.",
  },
  {
    kind: "income",
    heading: "Kategorie przychodów",
    empty: "Nie masz jeszcze kategorii przychodów. Dodaj pierwszą powyżej, aby zapisywać przychody.",
  },
];

function sortByName(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

// Only ever rendered on the add form. Kind is fixed at creation — see the
// `.omit({ kind: true })` on updateCategorySchema — so the edit form shows it
// as text instead.
function KindPicker({
  value,
  onChange,
  disabled,
}: {
  value: CategoryKind;
  onChange: (kind: CategoryKind) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Rodzaj kategorii">
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          disabled={disabled}
          onClick={() => {
            onChange(kind);
          }}
          className={cn(
            "min-h-11 flex-1 rounded-md border-2 px-3 py-2 text-sm transition-colors",
            value === kind ? "border-foreground" : "border-input hover:bg-accent",
          )}
        >
          {KIND_LABELS[kind]}
        </button>
      ))}
    </div>
  );
}

function ColorSwatchPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: CategoryColor;
  onChange: (color: CategoryColor) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kolor kategorii">
      {CATEGORY_COLORS.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          role="radio"
          aria-checked={value === swatch.value}
          aria-label={swatch.label}
          title={swatch.label}
          id={`${idPrefix}-${swatch.value}`}
          onClick={() => {
            onChange(swatch.value);
          }}
          className={cn(
            "size-6 rounded-full border-2 transition-transform",
            value === swatch.value ? "border-foreground scale-110" : "border-transparent",
          )}
          style={{ backgroundColor: swatch.value }}
        />
      ))}
    </div>
  );
}

interface CategoriesManagerProps {
  // Both optional so the component still renders standalone. They only report
  // what already happened — nothing about this component's own behaviour
  // depends on them.
  onCreated?: (category: Category) => void;
  onChanged?: () => void;
}

export default function CategoriesManager({ onCreated, onChanged }: CategoriesManagerProps) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [addError, setAddError] = useState<ApiErrorBody | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editError, setEditError] = useState<ApiErrorBody | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    const cancelled = { current: false };

    void (async () => {
      try {
        const response = await fetch("/api/categories");
        if (!response.ok) {
          const body = await parseErrorBody(response);
          throw new Error(body.error);
        }
        const data = await response.json<Category[]>();
        if (!cancelled.current) {
          setCategories(data);
        }
      } catch (error) {
        if (!cancelled.current) {
          setLoadError(error instanceof Error ? error.message : "Nie udało się wczytać kategorii.");
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, []);

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!response.ok) {
        setAddError(await parseErrorBody(response));
        return;
      }
      const created = await response.json<Category>();
      setCategories((prev) => sortByName([...(prev ?? []), created]));
      setAddForm(EMPTY_FORM);
      onCreated?.(created);
    } catch {
      setAddError({ error: "Nie udało się połączyć z serwerem. Spróbuj ponownie." });
    } finally {
      setAdding(false);
    }
  }

  function startEdit(category: Category) {
    setEditingId(category.id);
    setEditForm({
      name: category.name,
      color: category.color,
      isRecurring: category.isRecurring,
      kind: category.kind,
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(id: number) {
    setSaving(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Spelled out rather than sending editForm wholesale: kind is not
        // part of the update contract and must not travel with the request.
        body: JSON.stringify({
          name: editForm.name,
          color: editForm.color,
          isRecurring: editForm.isRecurring,
        }),
      });
      if (!response.ok) {
        setEditError(await parseErrorBody(response));
        return;
      }
      const updated = await response.json<Category>();
      setCategories((prev) => (prev ? sortByName(prev.map((c) => (c.id === id ? updated : c))) : prev));
      setEditingId(null);
      onChanged?.();
    } catch {
      setEditError({ error: "Nie udało się połączyć z serwerem. Spróbuj ponownie." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Usunąć tę kategorię?")) {
      return;
    }
    setDeletingId(id);
    try {
      const response = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      // 404 means it is already gone — deleted in another tab, most likely.
      // Drop the row rather than leaving it stranded behind an error.
      if (!response.ok && response.status !== 404) {
        const body = await parseErrorBody(response);
        window.alert(body.error);
        return;
      }
      setCategories((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      // Fires on the 404 path too: the row is gone either way, so a parent
      // holding a stale copy of it needs to refresh regardless.
      onChanged?.();
    } catch {
      window.alert("Nie udało się połączyć z serwerem. Spróbuj ponownie.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loadError) {
    return <p className="text-destructive">{loadError}</p>;
  }

  if (categories === null) {
    return <p className="text-muted-foreground">Wczytywanie kategorii…</p>;
  }

  const groupedCategories: Record<CategoryKind, Category[]> = {
    expense: sortByName(categories.filter((category) => category.kind === "expense")),
    income: sortByName(categories.filter((category) => category.kind === "income")),
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Dodaj kategorię</h2>
        <form
          onSubmit={(event) => {
            void handleAdd(event);
          }}
          className="flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-category-name">Nazwa</Label>
            <Input
              id="new-category-name"
              value={addForm.name}
              onChange={(event) => {
                setAddForm((f) => ({ ...f, name: event.target.value }));
              }}
              aria-invalid={addError?.field === "name"}
              disabled={adding}
            />
            {addError?.field === "name" && <p className="text-destructive text-sm">{addError.error}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Rodzaj</span>
            <KindPicker
              value={addForm.kind}
              onChange={(kind) => {
                setAddForm((f) => ({ ...f, kind }));
              }}
              disabled={adding}
            />
            <p className="text-muted-foreground text-sm">Rodzaju nie można zmienić po utworzeniu kategorii.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Kolor</span>
            <ColorSwatchPicker
              idPrefix="new-category-color"
              value={addForm.color}
              onChange={(color) => {
                setAddForm((f) => ({ ...f, color }));
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="new-category-recurring"
              checked={addForm.isRecurring}
              onCheckedChange={(checked) => {
                setAddForm((f) => ({ ...f, isRecurring: checked === true }));
              }}
              disabled={adding}
            />
            <Label htmlFor="new-category-recurring">Duży koszt cykliczny</Label>
          </div>
          {addError && !addError.field && <p className="text-destructive text-sm">{addError.error}</p>}
          <Button type="submit" disabled={adding || addForm.name.trim().length === 0}>
            {adding ? "Dodawanie…" : "Dodaj kategorię"}
          </Button>
        </form>
      </section>

      {CATEGORY_GROUPS.map((group) => (
        <section key={group.kind}>
          <h2 className="mb-3 text-lg font-semibold">{group.heading}</h2>
          {groupedCategories[group.kind].length === 0 ? (
            <p className="text-muted-foreground">{group.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {groupedCategories[group.kind].map((category) => (
                <li key={category.id} className="rounded-lg border p-3">
                  {editingId === category.id ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`edit-name-${category.id}`}>Nazwa</Label>
                        <Input
                          id={`edit-name-${category.id}`}
                          value={editForm.name}
                          onChange={(event) => {
                            setEditForm((f) => ({ ...f, name: event.target.value }));
                          }}
                          aria-invalid={editError?.field === "name"}
                          disabled={saving}
                        />
                        {editError?.field === "name" && <p className="text-destructive text-sm">{editError.error}</p>}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">Rodzaj</span>
                        <p className="text-muted-foreground text-sm">
                          {KIND_DESCRIPTIONS[category.kind]} — rodzaju nie można zmienić.
                        </p>
                      </div>
                      <ColorSwatchPicker
                        idPrefix={`edit-color-${category.id}`}
                        value={editForm.color}
                        onChange={(color) => {
                          setEditForm((f) => ({ ...f, color }));
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`edit-recurring-${category.id}`}
                          checked={editForm.isRecurring}
                          onCheckedChange={(checked) => {
                            setEditForm((f) => ({ ...f, isRecurring: checked === true }));
                          }}
                          disabled={saving}
                        />
                        <Label htmlFor={`edit-recurring-${category.id}`}>Duży koszt cykliczny</Label>
                      </div>
                      {editError && !editError.field && <p className="text-destructive text-sm">{editError.error}</p>}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={() => {
                            void handleSaveEdit(category.id);
                          }}
                          disabled={saving || editForm.name.trim().length === 0}
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
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-4 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="font-medium">{category.name}</span>
                        {category.isRecurring && (
                          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                            cykliczny
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            startEdit(category);
                          }}
                        >
                          Edytuj
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            void handleDelete(category.id);
                          }}
                          disabled={deletingId === category.id}
                        >
                          {deletingId === category.id ? "Usuwanie…" : "Usuń"}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
