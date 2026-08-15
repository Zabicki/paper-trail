import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { Category } from "@/types";

interface CategoryPickerProps {
  categories: Category[];
  value: number | null;
  onChange: (id: number) => void;
  filterText: string;
  onFilterTextChange: (text: string) => void;
}

export default function CategoryPicker({
  categories,
  value,
  onChange,
  filterText,
  onFilterTextChange,
}: CategoryPickerProps) {
  const filtered = filterText.trim()
    ? categories.filter((category) =>
        category.name.toLocaleLowerCase("pl").includes(filterText.toLocaleLowerCase("pl")),
      )
    : categories;

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="text"
        value={filterText}
        onChange={(event) => {
          onFilterTextChange(event.target.value);
        }}
        placeholder="Szukaj kategorii…"
        aria-label="Szukaj kategorii"
      />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kategoria">
        {filtered.map((category) => (
          <button
            key={category.id}
            type="button"
            role="radio"
            aria-checked={value === category.id}
            onClick={() => {
              onChange(category.id);
            }}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-full border-2 px-3 py-2 text-sm transition-colors",
              value === category.id ? "border-foreground" : "hover:bg-accent border-transparent",
            )}
          >
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: category.color }}
            />
            {category.name}
          </button>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground text-sm">Brak pasujących kategorii.</p>}
      </div>
    </div>
  );
}
