import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import type { Category, CategoryColor, CategoryKind, Entry, EntryType } from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors the `char_length(description) <= 200` check added by
// 20260816140000_add_entry_description.sql. Both bounds exist on purpose: the
// database's is the hallucination backstop, this one is what turns an
// over-long value into a 400 instead of a 500.
const DESCRIPTION_MAX = 200;

export const createEntrySchema = z.object({
  amount: z.number().positive().max(999999.99),
  categoryId: z.number().int().positive(),
  occurredOn: z.string().regex(DATE_PATTERN),
  type: z.enum(["expense", "income"]).default("expense"),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullish(),
});

// An entry's type is fixed at creation: changing it would also have to change
// the category (kinds must match), which is a different entry, not an edit.
// Delete and re-add instead. Everything else about an entry is correctable.
//
// description is omitted for a different reason: it records where the entry
// came from, not what it is. Editing an amount or a category must leave it
// alone. Omitting it here rather than ignoring it in updateEntry is what stops
// PATCH silently accepting a field nothing ever writes.
export const updateEntrySchema = createEntrySchema.omit({ type: true, description: true });

// One shared occurredOn for the whole receipt, and no `type` parameter at all:
// receipt items are always expenses (see the plan's "No income receipts").
// The 100-item cap matches the service-layer cap in the receipts parser — a
// paragon longer than that is a garbled parse, not a big shop.
export const createEntriesBatchSchema = z.object({
  occurredOn: z.string().regex(DATE_PATTERN),
  items: z
    .array(
      z.object({
        amount: z.number().positive().max(999999.99),
        categoryId: z.number().int().positive(),
        description: z.string().trim().min(1).max(DESCRIPTION_MAX).nullish(),
      }),
    )
    .min(1)
    .max(100),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type CreateEntriesBatchInput = z.infer<typeof createEntriesBatchSchema>;

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
  description: string | null;
  category: { id: number; name: string; color: CategoryColor };
}

const SELECT_COLUMNS = "id, amount, occurred_on, type, created_at, description, category:categories(id, name, color)";

function toDto(row: EntryRow): Entry {
  return {
    id: row.id,
    amount: row.amount,
    occurredOn: row.occurred_on,
    type: row.type,
    category: row.category,
    createdAt: row.created_at,
    description: row.description,
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
async function assertCategoryUsable(
  supabase: SupabaseClient,
  categoryId: number,
  type: EntryType,
  currentCategoryId?: number,
): Promise<void> {
  const query = supabase.from("categories").select("id, kind").eq("id", categoryId);

  // A soft-deleted category stays usable for the entry already filed under
  // it. Rejecting it would freeze that entry permanently: the edit form's
  // chip picker only lists live categories, so it would come up with nothing
  // selected, and even an amount-only correction would 404 until the user
  // re-filed the entry somewhere else. Deleting a category hides it from
  // *new* entries; it must not make history uncorrectable.
  const { data, error } =
    categoryId === currentCategoryId ? await query.maybeSingle() : await query.is("deleted_at", null).maybeSingle();

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
      description: input.description ?? null,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    throw error;
  }
  return toDto(data as unknown as EntryRow);
}

// The receipt-confirm write path. Two round trips regardless of item count,
// which is the whole point: a loop over createEntry would cost 2N of them and
// would not be atomic — a failure halfway through would leave a half-filed
// receipt with no way to tell which lines landed.
//
// It re-implements the two app-layer-only invariants that assertCategoryUsable
// guards on the single-entry path (see the comment at that function). Neither
// is provable by pgTAP — it drives raw SQL and cannot reach TypeScript — so
// both are named in the plan's Testing Strategy as permanently manual-only:
//
//   1. Ownership. The FK on entries.category_id checks row existence only;
//      Postgres FK constraints are not subject to RLS on the referenced table.
//      The select below IS RLS-scoped, so it is what actually stops a receipt
//      attaching to another user's category.
//   2. type ↔ kind. Nothing in the schema ties the columns together. Every row
//      written here is an expense, so every category must be kind 'expense'.
//
// Plus a third, specific to this path: soft-deleted categories are EXCLUDED.
// assertCategoryUsable deliberately admits them when correcting an entry
// already filed under one, but a receipt confirm creates new entries — filing
// a fresh purchase into a category the user has deleted would resurrect it in
// every report with no way to have chosen it.
//
// Any future change here must re-verify all three by hand.
export async function createEntriesBatch(supabase: SupabaseClient, input: CreateEntriesBatchInput): Promise<Entry[]> {
  const requestedIds = [...new Set(input.items.map((item) => item.categoryId))];

  const { data, error } = await supabase
    .from("categories")
    .select("id, kind")
    .in("id", requestedIds)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  const usable = data as { id: number; kind: CategoryKind }[];
  // Fewer rows back than ids asked for means at least one id is absent,
  // soft-deleted, or someone else's — indistinguishable on purpose, exactly as
  // assertCategoryUsable's single 404 is.
  if (usable.length < requestedIds.length) {
    throw new CategoryNotFoundError();
  }
  if (usable.some((category) => category.kind !== "expense")) {
    throw new CategoryKindMismatchError();
  }

  // One statement, therefore one transaction: either every line of the receipt
  // lands or none does. No .single() — the whole point is N rows.
  const { data: inserted, error: insertError } = await supabase
    .from("entries")
    .insert(
      input.items.map((item) => ({
        amount: item.amount,
        category_id: item.categoryId,
        occurred_on: input.occurredOn,
        type: "expense",
        description: item.description ?? null,
      })),
    )
    .select(SELECT_COLUMNS);

  if (insertError) {
    throw insertError;
  }
  return (inserted as unknown as EntryRow[]).map(toDto);
}

export async function updateEntry(supabase: SupabaseClient, id: number, input: UpdateEntryInput): Promise<Entry> {
  // The entry's own type is immutable and not in the input, but it is what
  // the incoming category has to match — so read it first. Costs a second
  // round trip; folding it into one statement would push the invariant into
  // SQL, where the service layer could no longer own it.
  const { data: existing, error: existingError } = await supabase
    .from("entries")
    .select("type, category_id")
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

  await assertCategoryUsable(supabase, input.categoryId, toEntryType(existing.type), Number(existing.category_id));

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
