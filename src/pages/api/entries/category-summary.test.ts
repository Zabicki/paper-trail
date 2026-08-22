import { describe, expect, it, vi } from "vitest";

import { createSupabaseFake, type FakeResponse } from "@/lib/services/__fixtures__/supabase-fake";
import type { createClient } from "@/lib/supabase";

// Board B's endpoint, asserted at its own boundary. The twin of
// `src/pages/api/entries/summary.test.ts` — same route shape, same schema, same
// `instanceof RangeTooLargeError` mapping — with one case that has no
// counterpart there: this endpoint carries a SECOND path to the same 400.
//
// Board A's ceiling guard is pre-flight only, because `entries_summary` returns
// at most two rows per bucket and 400 buckets is ~802 rows. Board B's width is
// the user's category count, which nothing in the service can see, so
// `getCategorySummary` also carries an exact post-flight truncation check
// (`reports.ts:381`). Both raise the same error, and this file asserts that
// both therefore reach the user as the same 400 — because the alternative,
// PostgREST silently capping the response at `max_rows`, is the archived defect
// this whole rollout phase is named after
// (`context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:54-78`).
//
// Oracles, all external to this file:
//
// 1. `src/pages/api/entries/category-summary.ts` read as a contract, plus the
//    two Polish strings it hand-writes at `:51` and `:65`.
// 2. `summaryQuerySchema`'s messages, forwarded verbatim as `error` with
//    `issue.path[0]` as `field`.
// 3. `supabase/config.toml:18` — `max_rows = 1000` — and PostgREST's documented
//    behaviour of TRUNCATING rather than erroring at that cap.
// 4. The calendar, for the impossible-date case.
//
// Reachability, the `vi.mock` shape, and the "real service, faked client"
// decision are all as in the summary twin; see its header for why. §6.4's
// ownership pattern is likewise not attempted here.

type MaybeClient = ReturnType<typeof createClient>;
const holder: { client: MaybeClient } = { client: null };

vi.mock("@/lib/supabase", () => ({
  createClient: () => holder.client,
}));

const { GET } = await import("./category-summary");

type RouteContext = Parameters<typeof GET>[0];

const SIGNED_IN = { id: "00000000-0000-4000-8000-000000000001" };

/** The recording fake plus the `auth.getUser` surface the route checks first. */
function fakeClient(responses: FakeResponse[], user: { id: string } | null) {
  const fake = createSupabaseFake(responses);
  const client = {
    rpc: fake.client.rpc,
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
  };
  return { client: client as unknown as NonNullable<MaybeClient>, calls: fake.calls };
}

function getRequest(search: string): RouteContext {
  const url = new URL(`https://papertrail.test/api/entries/category-summary${search}`);
  const request = new Request(url, { method: "GET" });
  return { request, cookies: {}, url } as unknown as RouteContext;
}

function search(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({ from: "2026-08-01", to: "2026-08-03", bucket: "day", ...overrides });
  return `?${params.toString()}`;
}

/** Board B's row shape, as PostgREST hands it back. */
interface FakeCategoryRow {
  bucket_start: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  total: number | string;
}

function categoryRow(
  bucketStart: string | null,
  categoryId: number | null,
  name: string | null,
  total: number,
): FakeCategoryRow {
  return {
    bucket_start: bucketStart,
    category_id: categoryId,
    category_name: name,
    category_color: "slate",
    category_icon: "tag",
    total,
  };
}

describe("GET /api/entries/category-summary", () => {
  it("answers 500 when Supabase is not configured", async () => {
    holder.client = null;

    const response = await GET(getRequest(search()));

    expect(response.status).toBe(500);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Supabase is not configured" });
  });

  it("answers 401 for an anonymous caller, before validating the query", async () => {
    // The query string is deliberately malformed and the answer is still 401:
    // a bad query must not be distinguishable from a missing session.
    const fake = fakeClient([], null);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ bucket: "fortnight" })));

    expect(response.status).toBe(401);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Unauthorized" });
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers 200 with the category summary body", async () => {
    // One population, hand-projected into the `((bucket, cat), (cat), ())`
    // grouping sets: Jedzenie 40 on 08-01 and 25 on 08-02 (65 in the range),
    // Transport 10 on 08-01. Grand total 65 + 10 = 75, hand-added.
    const fake = fakeClient(
      [
        {
          data: [
            categoryRow("2026-08-01", 7, "Jedzenie", 40),
            categoryRow("2026-08-01", 9, "Transport", 10),
            categoryRow("2026-08-02", 7, "Jedzenie", 25),
            categoryRow(null, 7, "Jedzenie", 65),
            categoryRow(null, 9, "Transport", 10),
            categoryRow(null, null, null, 75),
          ],
          error: null,
        },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await GET(getRequest(search()));

    expect(response.status).toBe(200);
    // `total` is the `()` row, never a JavaScript sum of `categories[]` — the
    // DTO contract at `src/types.ts:273-276`, and the denominator every
    // percentage on this board divides by.
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      bucket: "day",
      from: "2026-08-01",
      to: "2026-08-03",
      categories: [
        { categoryId: 7, name: "Jedzenie", icon: "tag", total: 65 },
        { categoryId: 9, name: "Transport", icon: "tag", total: 10 },
      ],
      points: [
        { bucketStart: "2026-08-01", totals: { "7": 40, "9": 10 } },
        { bucketStart: "2026-08-02", totals: { "7": 25 } },
      ],
      total: 75,
    });
  });

  it("answers 400 'Wybrany zakres jest zbyt duży' when the bucket ceiling trips", async () => {
    // Pre-flight, 401 inclusive days at `bucket: "day"`.
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ from: "2026-01-01", to: "2027-02-05" })));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Wybrany zakres jest zbyt duży",
      field: "to",
    });
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers the same 400 when the response comes back at max_rows", async () => {
    // THE CASE WITH NO COUNTERPART ON BOARD A, and the one the archived defect
    // produced. The range is small enough that the bucket guard never fires, so
    // this 400 can only come from the post-flight truncation check — the
    // response arrived at exactly `max_rows`, PostgREST gives no way to tell a
    // complete 1000-row result from a cut one, and the row most likely dropped
    // is the `()` grand total, which would leave `total` at 0 and print 0%
    // beside real złoty amounts.
    //
    // 36 days × 27 categories + 27 category totals + 1 grand total = 1000,
    // hand-checked. The range below is 2026-01-01 … 2026-02-05, 36 inclusive
    // days.
    const rows: FakeCategoryRow[] = [];
    for (let category = 1; category <= 27; category += 1) {
      for (let day = 1; day <= 36; day += 1) {
        const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
        rows.push(categoryRow(date, category, `Kategoria ${String(category)}`, 1));
      }
      rows.push(categoryRow(null, category, `Kategoria ${String(category)}`, 36));
    }
    rows.push(categoryRow(null, null, null, 972));
    expect(rows).toHaveLength(1000);

    const fake = fakeClient([{ data: rows, error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ from: "2026-01-01", to: "2026-02-05" })));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Wybrany zakres jest zbyt duży",
      field: "to",
    });
    // The request WAS issued this time — that is the difference between the two
    // guards, and it is why this one needs an exact row-count check rather than
    // a bucket estimate.
    expect(fake.calls).toHaveLength(1);
  });

  it("answers 400 when the start date is after the end date", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ from: "2026-08-03", to: "2026-08-01" })));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Data początkowa nie może być późniejsza niż końcowa",
      field: "from",
    });
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers 400 naming `from` for a date that is not a real calendar day", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ from: "2026-02-30", to: "2026-03-01" })));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Nieprawidłowa data początkowa",
      field: "from",
    });
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers 400 naming `to` for an impossible end date", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ to: "2026-04-31" })));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Nieprawidłowa data końcowa",
      field: "to",
    });
  });

  it("answers 400 naming `bucket` for an unsupported granularity", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ bucket: "fortnight" })));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Nieprawidłowy podział zakresu",
      field: "bucket",
    });
  });

  it("forwards the recurring filter to the single query it issues", async () => {
    // One call, not two: there is no previous-period comparison on this board.
    const fake = fakeClient([{ data: [], error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ recurring: "hidden" })));

    expect(response.status).toBe(200);
    expect(fake.calls).toStrictEqual([
      {
        method: "rpc",
        args: [
          "entries_category_summary",
          { p_from: "2026-08-01", p_to: "2026-08-03", p_bucket: "day", p_exclude_recurring: true },
        ],
      },
    ]);
  });
});
