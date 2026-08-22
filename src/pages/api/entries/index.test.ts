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

// Entry creation at the route boundary, with the two category refusals side by
// side: a category the caller does NOT own (ambiguous 404) and one they DO own
// but of the wrong kind (honest 400). Risk #3 in
// `context/foundation/test-plan.md` §2.
//
// THE CONTRAST IS THE POINT. Both are "your categoryId is not acceptable", and
// they answer differently on purpose (`src/lib/services/entries.ts:90-93`): the
// ownership one must stay indistinguishable from an absent id, because naming it
// would confirm another user's category id exists; the kind mismatch is a plain
// client bug against a row the caller demonstrably owns, so it can afford to say
// what is wrong. Testing them together is what shows the ambiguity is a decision
// rather than an accident.
//
// WHAT THIS FILE DOES NOT PROVE. It does NOT prove that RLS works. The Supabase
// fake has no caller identity and no row store — it resolves queued responses in
// call order, whoever is asking — so `USER_B` documents which actor a case
// speaks about and enforces nothing. The honest claim is: *given a client that
// returns nothing for B's category id, A gets a 404 whose body does not confirm
// B's row exists.* Proving RLS actually returns nothing is pgTAP's job and is
// already done — `supabase/tests/categories_rls_test.sql`.
//
// AND HERE, AS ON THE PATCH PATH, ONE CASE HAS NO pgTAP TO DEFER TO.
// `entries.category_id` is a plain foreign key and Postgres FK checks are NOT
// subject to RLS on the referenced table
// (`supabase/migrations/20260815164539_create_entries_table.sql:31-36`), so the
// database would accept A's insert naming B's category. `assertCategoryUsable`'s
// RLS-scoped lookup is the only thing that refuses it, and this change added no
// pgTAP — so this file and `[id].test.ts` are that invariant's only automated
// guards.
//
// Oracles, all external to this code:
//
// 1. `src/pages/api/entries/index.ts` read as a contract, plus the two Polish
//    strings it hand-writes at `:68` and `:74`.
// 2. `src/lib/services/entries.ts` for which PostgREST result each refusal keys
//    on.
// 3. `supabase/seed.sql` for the two identities.
//
// Closes the hand-run `curl` verification archived at
// `context/archive/2026-08-15-daily-expense-entry/plan.md:377` — "Posting
// another user's `categoryId` returns `404`" — checked once, by hand, at ship
// time, leaving no regression guard behind.
//
// WHY THIS FILE IS REACHABLE AT ALL. `index.ts:2` value-imports
// `@/lib/supabase`, which value-imports `astro:env/server`, and
// `vitest.config.ts` cannot resolve `astro:*` (see `test-plan.md` §6.1). The
// `vi.mock` below replaces the module BEFORE it is ever evaluated.
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

const { POST } = await import("./index");

type PostContext = Parameters<typeof POST>[0];

/** A category A owns. */
const OWN_CATEGORY = 7;
/** A category B owns. A never learns whether this id exists. */
const FOREIGN_CATEGORY = 3131;

const SIGNED_IN = USER_A;

/**
 * The recording fake plus the `auth.getUser` surface the route checks before it
 * touches the service.
 *
 * The `from`-only method selection stays LOCAL: it is the single method the
 * entry service calls on the top-level client, and it is a property of this
 * route rather than of the shared helper.
 */
function fakeClient(responses: FakeResponse[], user: Identity | null) {
  return createRouteClient(["from"], responses, user);
}

/** A well-formed create body; individual tests override one field at a time. */
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { amount: 12.5, categoryId: OWN_CATEGORY, occurredOn: "2026-08-14", type: "expense", ...overrides };
}

function postRequest(body: unknown): PostContext {
  return routeContext({
    url: "https://papertrail.test/api/entries",
    method: "POST",
    body,
  }) as unknown as PostContext;
}

describe("POST /api/entries", () => {
  it("answers 201 for a category the caller owns", async () => {
    // The positive control, and the file's statement of the round-trip count:
    // two awaits — `assertCategoryUsable`, then the insert. Responses are queued
    // in AWAIT order, not keyed by table.
    const fake = fakeClient(
      [
        { data: { id: OWN_CATEGORY, kind: "expense" }, error: null },
        {
          data: {
            id: 101,
            amount: 12.5,
            occurred_on: "2026-08-14",
            type: "expense",
            created_at: "2026-08-14T10:00:00.000Z",
            description: null,
            category: { id: OWN_CATEGORY, name: "Jedzenie", icon: "tag" },
          },
          error: null,
        },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await POST(postRequest(createBody()));

    expect(response.status).toBe(201);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      id: 101,
      amount: 12.5,
      occurredOn: "2026-08-14",
      type: "expense",
      category: { id: OWN_CATEGORY, name: "Jedzenie", icon: "tag" },
      createdAt: "2026-08-14T10:00:00.000Z",
      description: null,
    });
  });

  it(`answers 404 when ${USER_A.id} files an entry under a category owned by ${USER_B.id}`, async () => {
    // ONE queued response: `assertCategoryUsable`'s `.maybeSingle()` comes back
    // empty and `createEntry` throws before the insert
    // (`src/lib/services/entries.ts:168-177`).
    const fake = fakeClient([{ data: null, error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await POST(postRequest(createBody({ categoryId: FOREIGN_CATEGORY })));

    expect(response.status).toBe(404);
    // The BODY, not merely the status. Byte-identical to what an absent id
    // produces: absent, soft-deleted and someone-else's are indistinguishable on
    // purpose, because distinguishing them would confirm B's id exists.
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Nie znaleziono kategorii",
      field: "categoryId",
    });
    // Nothing reached the database. The FK would have accepted this row.
    expect(fake.calls.map((call) => call.method)).not.toContain("insert");
  });

  it("answers 400 naming the mismatch for a category the caller DOES own", async () => {
    // The contrast case. The lookup succeeds — A owns this category — so the
    // refusal can say what is actually wrong without leaking anything. A
    // different status AND a different string from the case above, which is how
    // a reader can tell the ambiguity is deliberate.
    const fake = fakeClient([{ data: { id: OWN_CATEGORY, kind: "income" }, error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await POST(postRequest(createBody()));

    expect(response.status).toBe(400);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Kategoria nie pasuje do typu wpisu",
      field: "categoryId",
    });
    expect(fake.calls.map((call) => call.method)).not.toContain("insert");
  });
});
