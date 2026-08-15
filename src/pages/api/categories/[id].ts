import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  updateCategorySchema,
  updateCategory,
  softDeleteCategory,
  DuplicateNameError,
  NotFoundError,
} from "@/lib/services/categories";

function parseId(param: string | undefined): number | null {
  if (!param) {
    return null;
  }
  const id = Number(param);
  return Number.isInteger(id) ? id : null;
}

export const PATCH: APIRoute = async (context) => {
  const id = parseId(context.params.id);
  if (id === null) {
    return new Response(JSON.stringify({ error: "Invalid category id" }), { status: 400 });
  }

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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new Response(JSON.stringify({ error: issue.message, field: issue.path[0] }), { status: 400 });
  }

  try {
    const category = await updateCategory(supabase, id, parsed.data);
    return new Response(JSON.stringify(category), { status: 200 });
  } catch (error) {
    if (error instanceof DuplicateNameError) {
      return new Response(JSON.stringify({ error: "Kategoria o tej nazwie już istnieje", field: "name" }), {
        status: 409,
      });
    }
    if (error instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono kategorii" }), { status: 404 });
    }
    throw error;
  }
};

export const DELETE: APIRoute = async (context) => {
  const id = parseId(context.params.id);
  if (id === null) {
    return new Response(JSON.stringify({ error: "Invalid category id" }), { status: 400 });
  }

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

  try {
    await softDeleteCategory(supabase, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono kategorii" }), { status: 404 });
    }
    throw error;
  }
};
