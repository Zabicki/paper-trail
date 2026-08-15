import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createEntrySchema, createEntry, listEntriesForDay, CategoryNotFoundError } from "@/lib/services/entries";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const GET: APIRoute = async (context) => {
  const date = context.url.searchParams.get("date");
  if (!date || !DATE_PATTERN.test(date)) {
    return new Response(JSON.stringify({ error: "Nieprawidłowa data" }), { status: 400 });
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

  const entries = await listEntriesForDay(supabase, date);
  return new Response(JSON.stringify(entries), { status: 200 });
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

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const parsed = createEntrySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new Response(JSON.stringify({ error: issue.message, field: issue.path[0] }), { status: 400 });
  }

  try {
    const entry = await createEntry(supabase, parsed.data);
    return new Response(JSON.stringify(entry), { status: 201 });
  } catch (error) {
    // Framed as "not found," never "not yours" — confirming another user's
    // category id exists would itself be a cross-user information leak.
    if (error instanceof CategoryNotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono kategorii", field: "categoryId" }), {
        status: 404,
      });
    }
    throw error;
  }
};
