import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import type { Category, CategoryColor, Entry } from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export const createEntrySchema = z.object({
  amount: z.number().positive().max(999999.99),
  categoryId: z.number().int().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Category not found");
    this.name = "CategoryNotFoundError";
  }
}

interface EntryRow {
  id: number;
  amount: number;
  occurred_on: string;
  type: "expense" | "income";
  created_at: string;
  category: { id: number; name: string; color: CategoryColor };
}

const SELECT_COLUMNS = "id, amount, occurred_on, type, created_at, category:categories(id, name, color)";

function toDto(row: EntryRow): Entry {
  return {
    id: row.id,
    amount: row.amount,
    occurredOn: row.occurred_on,
    type: row.type,
    category: row.category,
    createdAt: row.created_at,
  };
}

export async function createEntry(supabase: SupabaseClient, input: CreateEntryInput): Promise<Entry> {
  // The FK on entries.category_id checks row existence only, not ownership
  // (Postgres FK constraints are not subject to RLS on the referenced
  // table) — this select is RLS-scoped and is what actually prevents
  // attaching an entry to another user's category. See plan's Critical
  // Implementation Details.
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id")
    .eq("id", input.categoryId)
    .is("deleted_at", null)
    .maybeSingle();

  if (categoryError) {
    throw categoryError;
  }
  if (!category) {
    throw new CategoryNotFoundError();
  }

  const { data, error } = await supabase
    .from("entries")
    .insert({
      amount: input.amount,
      category_id: input.categoryId,
      occurred_on: input.occurredOn,
      type: "expense",
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw error;
  }
  return toDto(data as unknown as EntryRow);
}

export async function listEntriesForDay(supabase: SupabaseClient, occurredOn: string): Promise<Entry[]> {
  const { data, error } = await supabase
    .from("entries")
    .select(SELECT_COLUMNS)
    .eq("occurred_on", occurredOn)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }
  return (data as unknown as EntryRow[]).map(toDto);
}

export async function listEntryDaysForMonth(
  supabase: SupabaseClient,
  monthStart: string,
  monthEnd: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("entries")
    .select("occurred_on")
    .gte("occurred_on", monthStart)
    .lte("occurred_on", monthEnd);

  if (error) {
    throw error;
  }
  return [...new Set((data as { occurred_on: string }[]).map((row) => row.occurred_on))];
}

const RECENCY_LOOKBACK = 50;
const RECENCY_CHIP_COUNT = 5;

export async function listCategoriesForEntryForm(supabase: SupabaseClient): Promise<Category[]> {
  const [{ data: categoriesData, error: categoriesError }, { data: recentEntries, error: recentError }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, color, is_recurring, created_at")
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      supabase
        .from("entries")
        .select("category_id, created_at")
        .order("created_at", { ascending: false })
        .limit(RECENCY_LOOKBACK),
    ]);

  if (categoriesError) {
    throw categoriesError;
  }
  if (recentError) {
    throw recentError;
  }

  const categories: Category[] = (
    categoriesData as { id: number; name: string; color: CategoryColor; is_recurring: boolean; created_at: string }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isRecurring: row.is_recurring,
    createdAt: row.created_at,
  }));

  const recentCategoryIds: number[] = [];
  for (const row of recentEntries as { category_id: number }[]) {
    if (!recentCategoryIds.includes(row.category_id)) {
      recentCategoryIds.push(row.category_id);
    }
    if (recentCategoryIds.length === RECENCY_CHIP_COUNT) {
      break;
    }
  }

  const byId = new Map(categories.map((category) => [category.id, category]));
  const recent = recentCategoryIds.map((id) => byId.get(id)).filter((category): category is Category => !!category);
  const recentIds = new Set(recent.map((category) => category.id));
  const rest = categories.filter((category) => !recentIds.has(category.id));

  return [...recent, ...rest];
}
