import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { getCategorySummary, RangeTooLargeError, summaryQuerySchema } from "@/lib/services/reports";

// Expense sums per category over a date range — the single round trip behind
// all three of the Kategorie board's charts (FR-014), honouring the same
// recurring-cost exclusion as /api/entries/summary (FR-015).
//
// Shares summaryQuerySchema with that route unchanged: the query surface is
// identical, and only the aggregate on the other end differs. There is no
// previous-period range here — B4 is out of scope.
//
// `from` and `to` are concrete dates supplied by the caller, never derived
// here. Range presets resolve client-side because "today" must come from the
// browser's local date and Workers run UTC; see
// src/components/entries/date-utils.ts.
//
// No cache headers are set: src/middleware.ts:26-30 already applies
// `private, no-store` to any response with a signed-in user.
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

  // Validated after the auth guard, matching summary.ts and
  // entries/categories.ts: an anonymous caller should not be able to tell a
  // malformed query string from a missing session.
  const params = context.url.searchParams;
  const parsed = summaryQuerySchema.safeParse({
    from: params.get("from"),
    to: params.get("to"),
    bucket: params.get("bucket"),
    recurring: params.get("recurring") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return new Response(JSON.stringify({ error: issue.message, field: issue.path[0] }), { status: 400 });
  }

  // Lexicographic comparison is exact for zero-padded ISO dates.
  if (parsed.data.from > parsed.data.to) {
    return new Response(
      JSON.stringify({ error: "Data początkowa nie może być późniejsza niż końcowa", field: "from" }),
      { status: 400 },
    );
  }

  try {
    const summary = await getCategorySummary(supabase, parsed.data);
    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (error) {
    // Refused rather than truncated: PostgREST would cap the result at 1000
    // rows and return a partial aggregate that still looks like a valid
    // answer. A wrong number is worse than an error — and this response is
    // wider than Board A's (buckets × categories), so the cap is nearer.
    if (error instanceof RangeTooLargeError) {
      return new Response(JSON.stringify({ error: "Wybrany zakres jest zbyt duży", field: "to" }), { status: 400 });
    }
    throw error;
  }
};
