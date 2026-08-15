import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { listCategoriesForEntryForm } from "@/lib/services/entries";
import type { CategoryKind } from "@/types";

const KINDS: CategoryKind[] = ["expense", "income"];

// Separate route from GET /api/categories (S-01's alphabetical contract) —
// this list is recency-ordered for the entry form's chip picker, so it gets
// its own endpoint rather than a parameter on the existing one.
//
// ?kind= defaults to expense when absent, which keeps the endpoint answering
// the pre-S-03 client correctly during the window where CI has deployed the
// schema but the old Worker is still serving.
export const GET: APIRoute = async (context) => {
  const kindParam = context.url.searchParams.get("kind");
  if (kindParam !== null && !KINDS.includes(kindParam as CategoryKind)) {
    return new Response(JSON.stringify({ error: "Nieprawidłowy rodzaj kategorii" }), { status: 400 });
  }
  const kind: CategoryKind = (kindParam as CategoryKind | null) ?? "expense";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const categories = await listCategoriesForEntryForm(supabase, kind);
  return new Response(JSON.stringify(categories), { status: 200 });
};
