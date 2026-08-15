import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  updateEntrySchema,
  updateEntry,
  deleteEntry,
  CategoryNotFoundError,
  CategoryKindMismatchError,
  NotFoundError,
} from "@/lib/services/entries";

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
    return new Response(JSON.stringify({ error: "Invalid entry id" }), { status: 400 });
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

  const parsed = updateEntrySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new Response(JSON.stringify({ error: issue.message, field: issue.path[0] }), { status: 400 });
  }

  try {
    const entry = await updateEntry(supabase, id, parsed.data);
    return new Response(JSON.stringify(entry), { status: 200 });
  } catch (error) {
    // 404 whether the entry is missing or belongs to someone else — RLS
    // filtered it out and the caller learns nothing either way.
    if (error instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono wpisu" }), { status: 404 });
    }
    if (error instanceof CategoryNotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono kategorii", field: "categoryId" }), {
        status: 404,
      });
    }
    if (error instanceof CategoryKindMismatchError) {
      return new Response(JSON.stringify({ error: "Kategoria nie pasuje do typu wpisu", field: "categoryId" }), {
        status: 400,
      });
    }
    throw error;
  }
};

export const DELETE: APIRoute = async (context) => {
  const id = parseId(context.params.id);
  if (id === null) {
    return new Response(JSON.stringify({ error: "Invalid entry id" }), { status: 400 });
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
    await deleteEntry(supabase, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono wpisu" }), { status: 404 });
    }
    throw error;
  }
};
