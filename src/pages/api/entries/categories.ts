import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { listCategoriesForEntryForm } from "@/lib/services/entries";

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

  const categories = await listCategoriesForEntryForm(supabase);
  return new Response(JSON.stringify(categories), { status: 200 });
};
