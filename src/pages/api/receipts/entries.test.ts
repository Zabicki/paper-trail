import { describe, expect, it, vi } from "vitest";

import { createRouteClient, routeContext, USER_A, type Identity } from "@/lib/services/__fixtures__/route-context";
import type { FakeResponse } from "@/lib/services/__fixtures__/supabase-fake";
import type { createClient } from "@/lib/supabase";

// The receipt-confirm route, asserted at its own boundary: an HTTP request in,
// an HTTP response out. Risk #1 in `context/foundation/test-plan.md` §2 is that
// confirming persists something other than what was reviewed;
// `src/lib/services/entries.test.ts` pins the row array, and this file pins what
// the user is TOLD happened — which status, which body, which field name the
// panel highlights.
//
// Oracles, all external to this code:
//
// 1. `src/pages/api/receipts/entries.ts` read as a contract, plus the two Polish
//    strings it hand-writes. Those are user-facing copy: a change to either is a
//    change to what the panel renders at `ReceiptReview.tsx:453`.
// 2. The calendar, for the F1 cases below. `2026-02-30` does not exist; nothing
//    in the codebase is consulted to know that.
// 3. `20260815164539_create_entries_table.sql:12` — `occurred_on date not null`,
//    the constraint that F1's fix stops the request ever reaching.
//
// WHY THIS FILE IS REACHABLE AT ALL. `src/pages/api/receipts/entries.ts:2`
// value-imports `@/lib/supabase`, which value-imports `astro:env/server`, and
// `vitest.config.ts` cannot resolve `astro:*` (see `test-plan.md` §6.1). The
// `vi.mock` below replaces the module BEFORE it is ever evaluated, so the
// virtual module is never resolved — a third option beside "extract the pure
// logic" and "alias-stub the module". `Request` and `Response` are native in
// Node 22, so this runs on the default `node` environment with no jsdom.
//
// The route is driven against the REAL service and the recording fake rather
// than a mocked service, so the two error mappings below prove actual wiring:
// that `createEntriesBatch` throwing `CategoryNotFoundError` really does surface
// as a 404, not merely that the route can build one.

// The `vi.mock` factory is hoisted above every import, so it must not close over
// a binding that is initialised later. A module-scope mutable holder plus a
// dynamic `import()` AFTER it is what makes the factory body run at import time
// instead of at hoist time.
type MaybeClient = ReturnType<typeof createClient>;
const holder: { client: MaybeClient } = { client: null };

vi.mock("@/lib/supabase", () => ({
  createClient: () => holder.client,
}));

const { POST } = await import("./entries");

type RouteContext = Parameters<typeof POST>[0];

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const FOOD = 7;
const TRANSPORT = 9;

/** A well-formed confirm body; individual tests override one field at a time. */
function confirmBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    occurredOn: "2026-08-14",
    batchId: BATCH_ID,
    items: [{ amount: 12.5, categoryId: FOOD, description: "Chleb 4,50" }],
    ...overrides,
  };
}

/** A stored row exactly as PostgREST hands it back, with the joined category. */
function storedRow(id: number, amount: number, description: string | null) {
  return {
    id,
    amount,
    occurred_on: "2026-08-14",
    type: "expense",
    created_at: "2026-08-14T10:00:00.000Z",
    description,
    category: { id: FOOD, name: "Jedzenie", icon: "tag" },
  };
}

/**
 * The recording fake plus the `auth.getUser` surface the route checks before it
 * touches the service.
 *
 * The `from`-only method selection stays LOCAL: it is the single method the
 * service calls on the top-level client, and it is a property of this route
 * rather than of the shared helper. Carrying methods across selectively is what
 * keeps the fake's `then` off the client and stops the client itself being
 * thenable.
 */
function fakeClient(responses: FakeResponse[], user: Identity | null) {
  return createRouteClient(["from"], responses, user);
}

function postRequest(body: unknown): RouteContext {
  return routeContext({
    url: "https://papertrail.test/api/receipts/entries",
    method: "POST",
    body,
  }) as unknown as RouteContext;
}

const SIGNED_IN = USER_A;

describe("POST /api/receipts/entries", () => {
  it("answers 500 when Supabase is not configured", async () => {
    // `createClient` returns null when either env var is missing — they are
    // `optional: true` by design (CLAUDE.md flags this trap three times). The
    // branch exists so the failure is a JSON 500 rather than a TypeError.
    holder.client = null;

    const response = await POST(postRequest(confirmBody()));

    expect(response.status).toBe(500);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Supabase is not configured" });
  });

  it("answers 401 when no user is signed in", async () => {
    // Not auth MECHANICS — §7 excludes those. This asserts what auth GATES: the
    // route self-guards rather than relying on PROTECTED_ROUTES, so nothing in
    // `src/middleware.ts` stops an anonymous POST from reaching the service.
    const fake = fakeClient([], null);
    holder.client = fake.client;

    const response = await POST(postRequest(confirmBody()));

    expect(response.status).toBe(401);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Unauthorized" });
    // The guard is before the write, not beside it.
    expect(fake.calls).toStrictEqual([]);
  });

  it("answers 201 with the stored entries as the body", async () => {
    const fake = fakeClient(
      [
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [storedRow(101, 12.5, "Chleb 4,50")], error: null },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await POST(postRequest(confirmBody()));

    expect(response.status).toBe(201);
    // The DTO shape, not the row shape: camelCase keys and the joined category
    // inlined. `ReceiptCapture.tsx:277` counts this array to tell the user how
    // many entries were saved.
    await expect(response.json<unknown>()).resolves.toStrictEqual([
      {
        id: 101,
        amount: 12.5,
        occurredOn: "2026-08-14",
        type: "expense",
        category: { id: 7, name: "Jedzenie", icon: "tag" },
        createdAt: "2026-08-14T10:00:00.000Z",
        description: "Chleb 4,50",
      },
    ]);
  });

  it("answers 404 'Nie znaleziono kategorii' when a category id is not usable", async () => {
    const fake = fakeClient(
      // Two ids asked for, one row back — absent, soft-deleted, or another
      // user's.
      [{ data: [{ id: FOOD, kind: "expense" }], error: null }],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await POST(
      postRequest(
        confirmBody({
          items: [
            { amount: 12.5, categoryId: FOOD },
            { amount: 30, categoryId: TRANSPORT },
          ],
        }),
      ),
    );

    expect(response.status).toBe(404);
    // Verbatim, and deliberately NOT "that category is not yours". The three
    // causes are indistinguishable on purpose: naming the ownership one would
    // confirm that another user's category id exists, which is itself the
    // cross-user leak the wording avoids (`entries.ts:45-48`). Changing this
    // string is a security decision, not a copy edit.
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Nie znaleziono kategorii",
      field: "categoryId",
    });
  });

  it("answers 400 'Kategoria nie pasuje do typu wpisu' for an income category", async () => {
    const fake = fakeClient([{ data: [{ id: FOOD, kind: "income" }], error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await POST(postRequest(confirmBody()));

    // 400 rather than 404, and an honest message: the caller demonstrably owns
    // this category, so naming the problem leaks nothing. Receipt items are
    // always expenses, so this can only mean an income category.
    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Kategoria nie pasuje do typu wpisu",
      field: "categoryId",
    });
  });

  it("answers 400 naming the offending field when the body fails validation", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const { batchId: _omitted, ...withoutBatchId } = confirmBody();
    const response = await POST(postRequest(withoutBatchId));

    expect(response.status).toBe(400);
    // `field` is what the panel needs; the message is zod's own and arrives in
    // English inside a Polish UI (research finding F3, recorded and out of scope
    // — see the plan's "What We're NOT Doing"). Asserting `field` alone also
    // keeps this case off zod's internal wording, which is not a contract.
    const body = await response.json<{ error: string; field: string }>();
    expect(body.field).toBe("batchId");
    expect(body.error.length).toBeGreaterThan(0);
    // Nothing reached the database.
    expect(fake.calls).toStrictEqual([]);
  });

  // F1. Before `z.iso.date()`, a shape-valid impossible date passed validation,
  // reached Postgres, was rejected by `occurred_on date not null`, and the
  // resulting error — neither CategoryNotFoundError nor
  // CategoryKindMismatchError — was rethrown at `entries.ts:59` into an Astro
  // error page: a 500 with a non-JSON body that `parseErrorBody` degrades to the
  // generic "Coś poszło nie tak" (`src/lib/api-error.ts:9-11`). The user got no
  // way to tell that the printed date was the problem.
  //
  // Reachable in production because the receipt parser's own date check is
  // shape-only too (`services/receipts.ts:57`), so a model-misread date reaches
  // the panel and is adopted as the save date: `"2026-02-30" <= "2026-08-21"`
  // is true, so it is not even flagged as being in the future.
  it("answers 400 for a printed date that is not a real calendar day", async () => {
    const fake = fakeClient([], SIGNED_IN);
    holder.client = fake.client;

    const response = await POST(postRequest(confirmBody({ occurredOn: "2026-02-30" })));

    expect(response.status).toBe(400);
    const body = await response.json<{ field: string }>();
    expect(body.field).toBe("occurredOn");
    // Fails before the write, so the batch id stays unspent and a corrected
    // retry still lands under the same idempotency key.
    expect(fake.calls).toStrictEqual([]);
  });
});
