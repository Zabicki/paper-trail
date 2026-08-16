import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface RecurringToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

// FR-015. The PRD's complaint about existing tools is that they *bury* this
// option, so its prominence is a requirement rather than styling — hence the
// size-5 box, the 44px row and the caption that spells out what is happening
// while it is on. The failure mode being designed against is a filter silently
// in effect, which would make every figure on the page quietly wrong.
export default function RecurringToggle({ checked, onChange }: RecurringToggleProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center gap-3">
        <Checkbox
          id="recurring-toggle"
          checked={checked}
          onCheckedChange={(next) => {
            // Radix models a third, indeterminate state this toggle never uses.
            onChange(next === true);
          }}
          className="size-5"
        />
        <Label htmlFor="recurring-toggle" className="cursor-pointer text-sm font-medium">
          Ukryj duże koszty cykliczne
        </Label>
      </div>
      {checked && (
        <p className="text-muted-foreground pl-8 text-xs">Wpisy z kategorii oznaczonych jako cykliczne są pominięte.</p>
      )}
    </div>
  );
}
