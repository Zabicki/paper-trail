import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import {
  CATEGORY_ICON_NAMES,
  DEFAULT_CATEGORY_ICON,
  type Category,
  type CategoryIconName,
  type CategoryKind,
} from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

// The ONLY guard on the allowed icon set. The column carries no CHECK
// constraint by decision (see 20260818090000_add_category_icon.sql), so this
// enum is where an off-list name is rejected — and, per
// context/foundation/lessons.md, that makes the invariant app-layer-only and
// unprovable by pgTAP. Manual re-verification is required for any future change
// to this schema or this file.
const categoryIconValues = CATEGORY_ICON_NAMES as unknown as [CategoryIconName, ...CategoryIconName[]];

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nazwa jest wymagana").max(100, "Nazwa może mieć maksymalnie 100 znaków"),
  icon: z.enum(categoryIconValues).default(DEFAULT_CATEGORY_ICON),
  isRecurring: z.boolean().default(false),
  kind: z.enum(["expense", "income"]).default("expense"),
});

// PATCH is full-replace, not a true partial update: icon/isRecurring carry
// defaults, so a caller must always send the full {name, icon, isRecurring}
// triple or those fields silently reset. Matches the only current caller
// (CategoriesManager.tsx), which always submits all three.
//
// `kind` is deliberately omitted rather than inherited. This is the single
// line that makes kind immutable: an entry's type must match its category's
// kind, so a PATCH that flipped kind would silently invalidate every entry
// already filed under it. The database has no such constraint — strip this
// `.omit()` and a stray `kind` in a request body starts taking effect.
export const updateCategorySchema = createCategorySchema.omit({ kind: true });

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
  icon: CategoryIconName;
  is_recurring: boolean;
  kind: CategoryKind;
  created_at: string;
}

const SELECT_COLUMNS = "id, name, icon, is_recurring, kind, created_at";

function toDto(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    isRecurring: row.is_recurring,
    kind: row.kind,
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
    // `color` is no longer written: the user does not pick one. The column is
    // still `not null` this deploy, so the insert relies on its '#64748b'
    // default until `category-color-drop` removes it.
    .insert({ name: input.name, icon: input.icon, is_recurring: input.isRecurring, kind: input.kind })
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
    .update({ name: input.name, icon: input.icon, is_recurring: input.isRecurring })
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
