export const CATEGORY_COLORS = [
  { value: "#ef4444", label: "Czerwony" },
  { value: "#f97316", label: "Pomarańczowy" },
  { value: "#f59e0b", label: "Bursztynowy" },
  { value: "#eab308", label: "Żółty" },
  { value: "#84cc16", label: "Limonkowy" },
  { value: "#22c55e", label: "Zielony" },
  { value: "#14b8a6", label: "Morski" },
  { value: "#06b6d4", label: "Błękitny" },
  { value: "#3b82f6", label: "Niebieski" },
  { value: "#8b5cf6", label: "Fioletowy" },
  { value: "#ec4899", label: "Różowy" },
  { value: "#64748b", label: "Szary" },
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number]["value"];

export const DEFAULT_CATEGORY_COLOR: CategoryColor = "#64748b";

export interface Category {
  id: number;
  name: string;
  color: CategoryColor;
  isRecurring: boolean;
  createdAt: string;
}
