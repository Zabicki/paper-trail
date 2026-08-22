import { describe, expect, it, vi } from "vitest";

import {
  createRouteClient,
  routeContext,
  USER_A,
  USER_B,
  type Identity,
} from "@/lib/services/__fixtures__/route-context";
import type { FakeResponse } from "@/lib/services/__fixtures__/supabase-fake";
import type { createClient } from "@/lib/supabase";

// Category ownership at the route boundary: user A naming user B's category id
// and being refused. Risk #3 in `context/foundation/test-plan.md` §2 — one
// user's financial data becoming reachable by another.
//
// WHAT THIS FILE DOES NOT PROVE, AND IT MATTERS MORE THAN WHAT IT DOES. It does
// NOT prove that RLS works. The Supabase fake has no caller identity and no row
// store, so it cannot express "this row belongs to B" — it resolves queued
// responses in call order, whoever is asking. `USER_B` here documents which
// actor the test speaks as; it enforces nothing. The honest claim is: *given a
// client that returns nothing for B's id, A gets a 404 whose body does not
// confirm B's row exists.* Proving that RLS actually returns nothing is pgTAP's
// job and is already done — `supabase/tests/categories_rls_test.sql`.
//
// TWO VERBS, TWO MECHANISMS, therefore two tests that cannot be merged. PATCH
// refuses on PostgREST's `PGRST116` from `.single()`
// (`src/lib/services/categories.ts:131-133`); DELETE refuses on a zero-length
// `.select("id")` result (`:150-152`). The DELETE case is the one that would go
// silently wrong: without the length check the route answers a cheerful 204 for
// a row it never touched.
//
// Oracles, all external to this code:
//
// 1. `src/pages/api/categories/[id].ts` read as a contract, plus the Polish
//    string it hand-writes at `:60` and `:89`.
// 2. `src/lib/services/categories.ts` for which PostgREST result each refusal
//    keys on.
// 3. `supabase/seed.sql` for the two identities.
//
// Closes the hand-run `curl` verification archived at
// `context/archive/2026-08-15-custom-categories/plan.md:308` — "`PATCH`/`DELETE`
// on another user's id returns `404`" — which was checked once, by hand, at ship
// time and left no regression guard behind.
//
// WHY THIS FILE IS REACHABLE AT ALL. `[id].ts:2` value-imports `@/lib/supabase`,
// which value-imports `astro:env/server`, and `vitest.config.ts` cannot resolve
// `astro:*` (see `test-plan.md` §6.1). The `vi.mock` below replaces the module
// BEFORE it is ever evaluated, so the virtual module is never resolved.
// `Request`/`Response` are native in Node 22 — default `node` environment, no
// jsdom.

// The `vi.mock` factory is hoisted above every import, so it must not close over
// a binding initialised later. A module-scope mutable holder plus a dynamic
// `import()` AFTER it is what makes the factory body run at import time rather
// than at hoist time.
type MaybeClient = ReturnType<typeof createClient>;
const holder: { client: MaybeClient } = { client: null };

vi.mock("@/lib/supabase", () => ({
  createClient: () => holder.client,
}));

const { PATCH, DELETE } = await import("./[id]");

type PatchContext = Parameters<typeof PATCH>[0];
type DeleteContext = Parameters<typeof DELETE>[0];

/** A category A owns. */
const OWN_ID = 7;
/** A category B owns. A never learns whether this id exists. */
const FOREIGN_ID = 4242;

const SIGNED_IN = USER_A;

/**
 * The recording fake plus the `auth.getUser` surface the route checks before it
 * touches the service.
 *
 * The `from`-only method selection stays LOCAL: it is the single method the
 * category service calls on the top-level client, and it is a property of this
 * route rather than of the shared helper.
 */
function fakeClient(responses: FakeResponse[], user: Identity | null) {
  return createRouteClient(["from"], responses, user);
}

/** The full triple the only real caller (`CategoriesManager.tsx`) always sends. */
function patchBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "Jedzenie", icon: "tag", isRecurring: false, ...overrides };
}

function patchRequest(id: number, body: unknown): PatchContext {
  return routeContext({
    url: `https://papertrail.test/api/categories/${String(id)}`,
    method: "PATCH",
    body,
    params: { id: String(id) },
  }) as unknown as PatchContext;
}

function deleteRequest(id: number): DeleteContext {
  return routeContext({
    url: `https://papertrail.test/api/categories/${String(id)}`,
    method: "DELETE",
    params: { id: String(id) },
  }) as unknown as DeleteContext;
}

describe("PATCH /api/categories/[id]", () => {
  it("answers 200 for a category the caller owns", async () => {
    // The positive control. Without it a refusal is indistinguishable from a
    // fixture that never reached the service at all.
    const fake = fakeClient(
      [
        {
          data: {
            id: OWN_ID,
            name: "Jedzenie",
            icon: "tag",
            is_recurring: false,
            kind: "expense",
            created_at: "2026-08-14T10:00:00.000Z",
          },
          error: null,
        },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await PATCH(patchRequest(OWN_ID, patchBody()));

    expect(response.status).toBe(200);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      id: OWN_ID,
      name: "Jedzenie",
      icon: "tag",
      isRecurring: false,
      kind: "expense",
      createdAt: "2026-08-14T10:00:00.000Z",
    });
  });

  it(`answers 404 when ${USER_A.id} patches a category owned by ${USER_B.id}`, async () => {
    // One queued response: `updateCategory` awaits exactly once, at `.single()`.
    // RLS filtered B's row out, so PostgREST reports "no rows returned".
    const fake = fakeClient([{ data: null, error: { code: "PGRST116" } }], SIGNED_IN);
    holder.client = fake.client;

    const response = await PATCH(patchRequest(FOREIGN_ID, patchBody({ name: "Przejęte" })));

    expect(response.status).toBe(404);
    // The BODY, not merely the status. This string is byte-identical to the one
    // an absent id produces, and that is the anti-enumeration property: saying
    // "that category is not yours" would confirm B's id exists
    // (`src/lib/services/entries.ts:90-93`). Changing it is a security decision,
    // not a copy edit.
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Nie znaleziono kategorii" });
  });
});

describe("DELETE /api/categories/[id]", () => {
  it("answers 204 for a category the caller owns", async () => {
    const fake = fakeClient([{ data: [{ id: OWN_ID }], error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await DELETE(deleteRequest(OWN_ID));

    expect(response.status).toBe(204);
  });

  it(`answers 404, not 204, when ${USER_A.id} deletes a category owned by ${USER_B.id}`, async () => {
    // The soft delete is an UPDATE with `.select("id")` appended, so a row RLS
    // filtered out comes back as an empty array rather than as an error. That
    // `.select("id")` is the whole zero-row detector: drop it and this route
    // answers 204 for a row it never touched — a silent no-op the caller reads
    // as success.
    const fake = fakeClient([{ data: [], error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await DELETE(deleteRequest(FOREIGN_ID));

    expect(response.status).toBe(404);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Nie znaleziono kategorii" });
  });
});
