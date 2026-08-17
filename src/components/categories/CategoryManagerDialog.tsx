import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CategoriesManager from "./CategoriesManager";
import type { Category } from "@/types";

interface CategoryManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: Category) => void;
  onChanged: () => void;
}

// A thin shell only: the manager stays a standalone component so it can be
// reused outside a modal, and everything the dashboard needs to know about a
// mutation travels through the two callbacks it already exposes.
export default function CategoryManagerDialog({
  open,
  onOpenChange,
  onCreated,
  onChanged,
}: CategoryManagerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kategorie</DialogTitle>
          <DialogDescription>
            Dodawaj, zmieniaj nazwy i kolory oraz usuwaj kategorie wydatków i przychodów.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted with the dialog, so opening it is what triggers the
            manager's own GET /api/categories. */}
        <CategoriesManager onCreated={onCreated} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}
