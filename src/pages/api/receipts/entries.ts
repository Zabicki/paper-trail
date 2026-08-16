import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  createEntriesBatchSchema,
  createEntriesBatch,
  CategoryNotFoundError,
  CategoryKindMismatchError,
} from "@/lib/services/entries";

// A route of its own rather than an array branch on POST /api/entries. That
// endpoint's contract is one object in, one object out; overloading it on the
// shape of the body would make one endpoint two, each with its own status
// codes. Self-guards with getUser() below, so PROTECTED_ROUTES is untouched —
// see the convention comment in src/middleware.ts.
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

  const parsed = createEntriesBatchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new Response(JSON.stringify({ error: issue.message, field: issue.path[0] }), { status: 400 });
  }

  try {
    const entries = await createEntriesBatch(supabase, parsed.data);
    return new Response(JSON.stringify(entries), { status: 201 });
  } catch (error) {
    // Framed as "not found," never "not yours" — confirming another user's
    // category id exists would itself be a cross-user information leak.
    if (error instanceof CategoryNotFoundError) {
      return new Response(JSON.stringify({ error: "Nie znaleziono kategorii", field: "categoryId" }), {
        status: 404,
      });
    }
    // A category the caller does own, but of the wrong kind — safe to name.
    // Receipt items are always expenses, so this means an income category.
    if (error instanceof CategoryKindMismatchError) {
      return new Response(JSON.stringify({ error: "Kategoria nie pasuje do typu wpisu", field: "categoryId" }), {
        status: 400,
      });
    }
    throw error;
  }
};
