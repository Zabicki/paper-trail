import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createCategorySchema, createCategory, listCategories, DuplicateNameError } from "@/lib/services/categories";

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

  const categories = await listCategories(supabase);
  return new Response(JSON.stringify(categories), { status: 200 });
};

export const POST: APIRoute = async (context) => {
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

  const body: unknown = await context.request.json();
  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new Response(JSON.stringify({ error: issue.message, field: issue.path[0] }), { status: 400 });
  }

  try {
    const category = await createCategory(supabase, parsed.data);
    return new Response(JSON.stringify(category), { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateNameError) {
      return new Response(JSON.stringify({ error: "Kategoria o tej nazwie już istnieje", field: "name" }), {
        status: 409,
      });
    }
    throw error;
  }
};
