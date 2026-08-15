import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { listCategoriesForEntryForm } from "@/lib/services/entries";

// Defaults to expense when the param is absent, which keeps the endpoint
// answering the pre-S-03 client correctly during the window where CI has
// pushed the schema but the old Worker is still serving.
const kindSchema = z.enum(["expense", "income"]).default("expense");

// Separate route from GET /api/categories (S-01's alphabetical contract) —
// this list is recency-ordered for the entry form's chip picker, so it gets
// its own endpoint rather than a parameter on the existing one.
export const GET: APIRoute = async (context) => {
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

  // Validated after the auth guard: an anonymous caller should not be able to
  // tell a malformed query string from a missing session.
  const parsed = kindSchema.safeParse(context.url.searchParams.get("kind") ?? undefined);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Nieprawidłowy rodzaj kategorii", field: "kind" }), { status: 400 });
  }

  const categories = await listCategoriesForEntryForm(supabase, parsed.data);
  return new Response(JSON.stringify(categories), { status: 200 });
};
