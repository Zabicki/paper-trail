import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { firstExpenseDate, listEntryDaysForMonth } from "@/lib/services/entries";

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

// Missing-day marking is clamped to [floor, yesterday] so that paging into a
// month the user has no history in renders nothing red instead of everything
// red, and today/future days are never flagged as "missing" — see plan's
// Critical Implementation Details. Month navigation itself has no such bound;
// this clamp only affects which dates this endpoint reports back.
//
// The floor is the EARLIER of account creation and the user's first EXPENSE,
// not account creation alone. Back-dating is a headline feature, so a user who
// signs up today and files last month's receipts genuinely has history before
// signup — and flooring on signup would silently mark none of those gaps.
// Taking the earlier of the two keeps the original guarantee intact for the
// case it was written for: a user with no back-dated data has no expense
// earlier than signup, so their pre-signup months still render clean.
//
// Scoped to expenses on purpose, NOT reports.ts's getFirstEntryDate, which
// deliberately ignores `type` so the reports X-axis agrees with the summary
// functions. This floor must instead agree with what the marker itself
// measures — listEntryDaysForMonth's `type = 'expense'`. Flooring on any entry
// type would let one back-dated income row from January turn every expenseless
// day since into a red circle, which is the "everything red" outcome this
// clamp exists to prevent.
//
// This is also what makes the demo account work. 20260816120000's
// insert stamps its created_at as now() while seeding entries from 2026-05-16,
// so account creation postdates every one of its own rows — with a
// signup-only floor, rangeStart lands past rangeEnd and the endpoint returns
// an empty list for EVERY month, marking nothing anywhere.
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
  // Null for a user with no expenses at all, which leaves the floor at signup.
  const firstExpense = await firstExpenseDate(supabase);
  const historyStart = firstExpense !== null && firstExpense < accountCreatedDate ? firstExpense : accountCreatedDate;
  const yesterday = addDaysUTC(toDateString(new Date()), -1);

  const rangeStart = monthStart > historyStart ? monthStart : historyStart;
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
