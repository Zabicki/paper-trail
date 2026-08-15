import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import type { Category, CategoryColor, CategoryKind, Entry, EntryType } from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export const createEntrySchema = z.object({
  amount: z.number().positive().max(999999.99),
  categoryId: z.number().int().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["expense", "income"]).default("expense"),
});

// An entry's type is fixed at creation: changing it would also have to change
// the category (kinds must match), which is a different entry, not an edit.
// Delete and re-add instead. Everything else about an entry is correctable.
export const updateEntrySchema = createEntrySchema.omit({ type: true });

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

export class CategoryNotFoundError extends Error {
  constructor() {
    super("Category not found");
    this.name = "CategoryNotFoundError";
  }
}

// Distinct from CategoryNotFoundError on purpose. "Not found" has to stay
// ambiguous — saying "that category is not yours" would confirm another
// user's id exists. A kind mismatch is a plain client bug against a category
// the caller does own, so it can afford an honest message.
export class CategoryKindMismatchError extends Error {
  constructor() {
    super("Category kind does not match entry type");
    this.name = "CategoryKindMismatchError";
  }
}

// Declared here rather than imported from the categories service so the two
// modules stay independent — same name, same shape, different subject.
export class NotFoundError extends Error {
  constructor() {
    super("Entry not found");
    this.name = "NotFoundError";
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

// The Supabase client is untyped, so PostgREST hands back rows whose columns
// are `any` ({ type: any }, { kind: any }). Narrowing the discriminant through
// its own two check-constraint values keeps that `any` from leaking into a
// typed parameter, without an assertion that claims more than we know.
function toEntryType(value: unknown): EntryType {
  return value === "income" ? "income" : "expense";
}

// Guards both write paths. Two app-layer-only invariants live in this one
// function, and neither is provable by pgTAP (it drives raw SQL and cannot
// reach TypeScript) — see context/foundation/lessons.md:
//
//   1. Ownership. The FK on entries.category_id checks row existence only,
//      not ownership: Postgres FK constraints are not subject to RLS on the
//      referenced table. This select IS RLS-scoped, so it is what actually
//      stops an entry attaching to another user's category.
//   2. type ↔ kind. Nothing in the schema ties the two columns together; a
//      raw SQL insert can still pair an income with an expense category.
//
// Any future change here must re-verify both by hand.
async function assertCategoryUsable(supabase: SupabaseClient, categoryId: number, type: EntryType): Promise<void> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, kind")
    .eq("id", categoryId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw error;
  }
  const category = data;
  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.kind !== type) {
    throw new CategoryKindMismatchError();
  }
}

export async function createEntry(supabase: SupabaseClient, input: CreateEntryInput): Promise<Entry> {
  await assertCategoryUsable(supabase, input.categoryId, input.type);

  const { data, error } = await supabase
    .from("entries")
    .insert({
      amount: input.amount,
      category_id: input.categoryId,
      occurred_on: input.occurredOn,
      type: input.type,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw error;
  }
  return toDto(data as unknown as EntryRow);
}

export async function updateEntry(supabase: SupabaseClient, id: number, input: UpdateEntryInput): Promise<Entry> {
  // The entry's own type is immutable and not in the input, but it is what
  // the incoming category has to match — so read it first. Costs a second
  // round trip; folding it into one statement would push the invariant into
  // SQL, where the service layer could no longer own it.
  const { data: existing, error: existingError } = await supabase
    .from("entries")
    .select("type")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }
  // Absent, or RLS-filtered because it belongs to someone else — the caller
  // gets the same 404 either way.
  if (!existing) {
    throw new NotFoundError();
  }

  await assertCategoryUsable(supabase, input.categoryId, toEntryType(existing.type));

  const { data, error } = await supabase
    .from("entries")
    .update({
      amount: input.amount,
      category_id: input.categoryId,
      occurred_on: input.occurredOn,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    // PGRST116: PostgREST's "no rows returned" for .single() — the row went
    // away between the read above and this update.
    if (error.code === "PGRST116") {
      throw new NotFoundError();
    }
    throw error;
  }
  return toDto(data as unknown as EntryRow);
}

// Hard delete: entries are leaves, so the referential reason categories are
// soft-deleted does not apply here. The confirm dialog in the UI is the only
// guard — there is no undo.
export async function deleteEntry(supabase: SupabaseClient, id: number): Promise<void> {
  const { data, error } = await supabase.from("entries").delete().eq("id", id).select("id");

  if (error) {
    throw error;
  }
  // Empty means the row was absent or RLS-filtered — never "not yours".
  if (data.length === 0) {
    throw new NotFoundError();
  }
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

// Expenses only, and that is a product rule rather than an optimisation: the
// calendar's red marking asks "did you log your spending that day?". Income
// has a different rhythm — a payday landing on an otherwise unlogged day must
// not certify it as done.
export async function listEntryDaysForMonth(
  supabase: SupabaseClient,
  monthStart: string,
  monthEnd: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("entries")
    .select("occurred_on")
    .eq("type", "expense")
    .gte("occurred_on", monthStart)
    .lte("occurred_on", monthEnd);

  if (error) {
    throw error;
  }
  return [...new Set((data as { occurred_on: string }[]).map((row) => row.occurred_on))];
}

const RECENCY_LOOKBACK = 50;
const RECENCY_CHIP_COUNT = 5;

// Scoped to a single kind: the chip picker only ever shows the categories for
// the type being logged. The recency lookback is filtered to the matching
// entry type too, so a burst of income entries never reorders the expense
// chips — which are the ones on the tap-budgeted path.
export async function listCategoriesForEntryForm(supabase: SupabaseClient, kind: CategoryKind): Promise<Category[]> {
  const [{ data: categoriesData, error: categoriesError }, { data: recentEntries, error: recentError }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, color, is_recurring, kind, created_at")
        .eq("kind", kind)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      supabase
        .from("entries")
        .select("category_id, created_at")
        .eq("type", kind)
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
    categoriesData as {
      id: number;
      name: string;
      color: CategoryColor;
      is_recurring: boolean;
      kind: CategoryKind;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isRecurring: row.is_recurring,
    kind: row.kind,
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
