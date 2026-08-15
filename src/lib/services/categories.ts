import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import { CATEGORY_COLORS, DEFAULT_CATEGORY_COLOR, type Category, type CategoryColor } from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const categoryColorValues = CATEGORY_COLORS.map((entry) => entry.value) as [CategoryColor, ...CategoryColor[]];

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nazwa jest wymagana").max(100, "Nazwa może mieć maksymalnie 100 znaków"),
  color: z.enum(categoryColorValues).default(DEFAULT_CATEGORY_COLOR),
  isRecurring: z.boolean().default(false),
});

export const updateCategorySchema = createCategorySchema;

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export class DuplicateNameError extends Error {
  constructor() {
    super("A category with this name already exists");
    this.name = "DuplicateNameError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("Category not found");
    this.name = "NotFoundError";
  }
}

interface CategoryRow {
  id: number;
  name: string;
  color: CategoryColor;
  is_recurring: boolean;
  created_at: string;
}

const SELECT_COLUMNS = "id, name, color, is_recurring, created_at";

function toDto(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isRecurring: row.is_recurring,
    createdAt: row.created_at,
  };
}

export async function listCategories(supabase: SupabaseClient): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select(SELECT_COLUMNS)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }
  return (data as CategoryRow[]).map(toDto);
}

export async function createCategory(supabase: SupabaseClient, input: CreateCategoryInput): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .insert({ name: input.name, color: input.color, is_recurring: input.isRecurring })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    // Postgres unique-violation — see plan's Critical Implementation Details.
    if (error.code === "23505") {
      throw new DuplicateNameError();
    }
    throw error;
  }
  return toDto(data);
}

export async function updateCategory(
  supabase: SupabaseClient,
  id: number,
  input: UpdateCategoryInput,
): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .update({ name: input.name, color: input.color, is_recurring: input.isRecurring })
    .eq("id", id)
    .is("deleted_at", null)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new DuplicateNameError();
    }
    // PGRST116: PostgREST's "no rows returned" for .single() — wrong id,
    // someone else's row (RLS-filtered), or already soft-deleted.
    if (error.code === "PGRST116") {
      throw new NotFoundError();
    }
    throw error;
  }
  return toDto(data);
}

export async function softDeleteCategory(supabase: SupabaseClient, id: number): Promise<void> {
  const { data, error } = await supabase
    .from("categories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    throw error;
  }
  if (data.length === 0) {
    throw new NotFoundError();
  }
}
