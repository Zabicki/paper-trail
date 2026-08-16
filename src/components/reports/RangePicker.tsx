import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type RangePreset } from "./range";

interface RangePickerProps {
  value: RangePreset;
  onChange: (preset: RangePreset) => void;
}

// Hand-rolled radiogroup rather than a shadcn Select or Tabs: neither is
// installed, and CategoryPicker already established this shape (role="radio"
// on plain buttons, min-h-11 tap targets, selected = border-foreground). One
// pattern for one kind of control.
export default function RangePicker({ value, onChange }: RangePickerProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Zakres dat">
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          role="radio"
          aria-checked={value === preset.value}
          onClick={() => {
            onChange(preset.value);
          }}
          className={cn(
            "flex min-h-11 items-center rounded-full border-2 px-3 py-2 text-sm transition-colors",
            value === preset.value ? "border-foreground" : "hover:bg-accent border-transparent",
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
