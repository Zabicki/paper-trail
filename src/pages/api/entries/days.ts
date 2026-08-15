import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { listEntryDaysForMonth } from "@/lib/services/entries";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function toDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDaysUTC(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function monthBounds(month: string): { start: string; end: string } {
  const [year, monthNum] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(lastDay)}` };
}

// Missing-day marking is clamped to [account creation, yesterday] so that
// paging into a pre-signup month renders nothing red instead of everything
// red, and today/future days are never flagged as "missing" — see plan's
// Critical Implementation Details. Month navigation itself has no such
// bound; this clamp only affects which dates this endpoint reports back.
export const GET: APIRoute = async (context) => {
  const month = context.url.searchParams.get("month");
  if (!month || !MONTH_PATTERN.test(month)) {
    return new Response(JSON.stringify({ error: "Nieprawidłowy miesiąc" }), { status: 400 });
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

  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const accountCreatedDate = user.created_at.slice(0, 10);
  const yesterday = addDaysUTC(toDateString(new Date()), -1);

  const rangeStart = monthStart > accountCreatedDate ? monthStart : accountCreatedDate;
  const rangeEnd = monthEnd < yesterday ? monthEnd : yesterday;

  if (rangeStart > rangeEnd) {
    return new Response(JSON.stringify({ dates: [] }), { status: 200 });
  }

  const presentDates = new Set(await listEntryDaysForMonth(supabase, rangeStart, rangeEnd));

  const missing: string[] = [];
  for (let cursor = rangeStart; cursor <= rangeEnd; cursor = addDaysUTC(cursor, 1)) {
    if (!presentDates.has(cursor)) {
      missing.push(cursor);
    }
  }

  return new Response(JSON.stringify({ dates: missing }), { status: 200 });
};
