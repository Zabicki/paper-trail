import { describe, expect, it, vi } from "vitest";

import { createSupabaseFake, type FakeResponse } from "@/lib/services/__fixtures__/supabase-fake";
import type { createClient } from "@/lib/supabase";

// Board A's endpoint, asserted at its own boundary: an HTTP request in, an HTTP
// response out. `src/lib/services/reports.test.ts` pins what the service
// refuses to issue and refuses to return; this file pins what the caller is
// TOLD when a figure is correctly absent — which status, which body, which
// field name.
//
// WHY THAT IS NOT A FORMALITY. `context/foundation/test-plan.md` §2 risk #2 is
// a figure that reads plausibly but is wrong, and the service's answer to it is
// to throw rather than return a partial aggregate. That is only half an answer:
// a `RangeTooLargeError` the route fails to map becomes a 500 with a non-JSON
// body, which `src/lib/api-error.ts:9-11` degrades to the generic
// "Coś poszło nie tak" — indistinguishable, from the user's seat, from the
// truncation the guard exists to prevent. The `instanceof` branch is exactly
// the wiring a refactor breaks without a single service test going red.
//
// Oracles, all external to this file:
//
// 1. `src/pages/api/entries/summary.ts` read as a contract, plus the two Polish
//    strings it hand-writes at `:48` and `:61`. Those are user-facing copy.
// 2. `src/lib/services/reports.ts`'s `summaryQuerySchema` messages, forwarded
//    verbatim as `error` with `issue.path[0]` as `field`.
// 3. The calendar, for the `2026-02-30` case. Nothing in this repository is
//    consulted to know February 2026 ends on the 28th.
// 4. The impl-review's worked bucket arithmetic — `2026-01-01 … 2027-02-05` is
//    401 inclusive days, one past `MAX_BUCKETS`.
//
// WHY THIS FILE IS REACHABLE AT ALL. `summary.ts:2` value-imports
// `@/lib/supabase`, which value-imports `astro:env/server`, and
// `vitest.config.ts` cannot resolve `astro:*` (see `test-plan.md` §6.1). The
// `vi.mock` below replaces the module BEFORE it is ever evaluated, so the
// virtual module is never resolved. `Request`/`Response`/`URL` are native in
// Node 22, so this runs on the default `node` environment with no jsdom.
//
// The route is driven against the REAL service and the recording fake rather
// than a mocked service, so every mapping below proves actual wiring: that
// `getEntriesSummary` throwing really does surface as a 400 with that body, not
// merely that the route could build one.
//
// NOT §6.4. This borrows the proven `vi.mock` shape from
// `src/pages/api/receipts/entries.test.ts`; §6.4's ownership pattern — request
// as user A for user B's resource, assert refusal, assert cache headers —
// remains §3 Phase 4's deliverable and is not attempted here.

// The `vi.mock` factory is hoisted above every import, so it must not close
// over a binding initialised later. A module-scope mutable holder plus a
// dynamic `import()` AFTER it is what makes the factory body run at import time
// rather than at hoist time.
type MaybeClient = ReturnType<typeof createClient>;
const holder: { client: MaybeClient } = { client: null };

vi.mock("@/lib/supabase", () => ({
  createClient: () => holder.client,
}));

const { GET } = await import("./summary");

type RouteContext = Parameters<typeof GET>[0];

const SIGNED_IN = { id: "00000000-0000-4000-8000-000000000001" };

/**
 * The recording fake plus the `auth.getUser` surface the route checks before it
 * touches the service.
 *
 * Only `rpc` is carried across: it is the single method `getEntriesSummary`
 * calls on the client, and copying the whole fake would drag its `then` along
 * and make the client itself thenable.
 */
function fakeClient(responses: FakeResponse[], user: { id: string } | null) {
  const fake = createSupabaseFake(responses);
  const client = {
    rpc: fake.client.rpc,
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
  };
  return { client: client as unknown as NonNullable<MaybeClient>, calls: fake.calls };
}

function getRequest(search: string): RouteContext {
  const url = new URL(`https://papertrail.test/api/entries/summary${search}`);
  const request = new Request(url, { method: "GET" });
  // The route reads exactly three things off the context — `url`, `request`
  // and `cookies`, the latter two only to hand to `createClient`, which is
  // mocked. A full APIContext would be several hundred lines of Astro
  // internals for no added signal.
  return { request, cookies: {}, url } as unknown as RouteContext;
}

/** A well-formed query; individual tests override one parameter at a time. */
function search(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({ from: "2026-08-01", to: "2026-08-03", bucket: "day", ...overrides });
  return `?${params.toString()}`;
}

describe("GET /api/entries/summary", () => {
  it("answers 500 when Supabase is not configured", async () => {
    // `createClient` returns null when either env var is missing — they are
    // `optional: true` by design (CLAUDE.md flags this trap three times). The
    // branch exists so the failure is a JSON 500 rather than a TypeError.
    holder.client = null;

    const response = await GET(getRequest(search()));

    expect(response.status).toBe(500);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Supabase is not configured" });
  });

  it("answers 401 for an anonymous caller, before validating the query", async () => {
    // Not auth MECHANICS — §7 excludes those. This asserts what auth GATES, and
    // the ORDER is the assertion: the query string here is malformed, and the
    // answer is still 401. An anonymous caller must not be able to tell a bad
    // query from a missing session, because the difference is a probe oracle.
    const fake = fakeClient([], null);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ from: "nonsense" })));

    expect(response.status).toBe(401);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Unauthorized" });
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers 200 with the summary body", async () => {
    // Two queued responses: getEntriesSummary issues the current and previous
    // ranges inside one `Promise.all`, consumed in array order (see the `rpc`
    // note in the fake's header). The previous range is 2026-07-29 … 2026-07-31
    // — three inclusive days ending the day before `from`, hand-counted.
    const fake = fakeClient(
      [
        {
          data: [
            { bucket_start: "2026-08-01", entry_type: "expense", total: 40 },
            { bucket_start: "2026-08-02", entry_type: "expense", total: 25 },
            { bucket_start: null, entry_type: "expense", total: 65 },
            { bucket_start: null, entry_type: "income", total: 1000 },
          ],
          error: null,
        },
        { data: [{ bucket_start: null, entry_type: "expense", total: 50 }], error: null },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await GET(getRequest(search()));

    expect(response.status).toBe(200);
    // The DTO the boards render, in full: 40 + 25 = 65 hand-added, and the
    // previous range present with `income: 0` rather than an absent key, since
    // the KPI deltas read both without a presence check.
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      bucket: "day",
      current: {
        from: "2026-08-01",
        to: "2026-08-03",
        points: [
          { bucketStart: "2026-08-01", expense: 40, income: 0 },
          { bucketStart: "2026-08-02", expense: 25, income: 0 },
        ],
        totals: { expense: 65, income: 1000 },
      },
      previous: {
        from: "2026-07-29",
        to: "2026-07-31",
        points: [],
        totals: { expense: 50, income: 0 },
      },
    });
  });

  it("answers 400 'Wybrany zakres jest zbyt duży' when the bucket ceiling trips", async () => {
    // 2026-01-01 … 2027-02-05 is 401 inclusive days, one past MAX_BUCKETS at
    // `bucket: "day"`. The guard is PRE-FLIGHT, so nothing is issued — asserted
    // below, because a guard that fires after PostgREST has already truncated
    // is a guard against nothing.
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

  it("answers 400 when the start date is after the end date", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await GET(getRequest(search({ from: "2026-08-03", to: "2026-08-01" })));

    expect(response.status).toBe(400);
    // Verbatim: hand-written at `summary.ts:48` and shown to the user. `field`
    // is "from" rather than "to" because the range picker highlights the
    // control the user most likely got wrong.
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Data początkowa nie może być późniejsza niż końcowa",
      field: "from",
    });
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers 400 naming `from` for a date that is not a real calendar day", async () => {
    // The Phase 4 fix, at the boundary. Before `z.iso.date()`, `2026-02-30`
    // passed the shape regex; `bucketCountUpperBound` then sized the ceiling
    // guard against 2026-03-02 while Postgres was handed the literal string and
    // refused the cast — a 500 with a non-JSON body, where the user needed to
    // be told which field was wrong.
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

  it("forwards the recurring filter to both ranges", async () => {
    // FR-015. The caption the user reads is driven by the same parameter; if it
    // did not reach the query, the caption and the figures would describe
    // different populations — the other half of risk #2.
    const fake = fakeClient(
      [
        { data: [], error: null },
        { data: [], error: null },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await GET(getRequest(search({ recurring: "hidden" })));

    expect(response.status).toBe(200);
    expect(
      fake.calls.map((call) => (call.args[1] as { p_exclude_recurring: boolean }).p_exclude_recurring),
    ).toStrictEqual([true, true]);
  });
});
