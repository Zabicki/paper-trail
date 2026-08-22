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

// Entry ownership at the route boundary: user A naming user B's entry id, and —
// the sharper case — A re-pointing an entry A *does* own at a category B owns.
// Risk #3 in `context/foundation/test-plan.md` §2.
//
// WHAT THIS FILE DOES NOT PROVE. It does NOT prove that RLS works. The Supabase
// fake has no caller identity and no row store, so it cannot express "this row
// belongs to B" — it resolves queued responses in call order, whoever is asking.
// `USER_B` documents which actor a case speaks about; it enforces nothing. The
// honest claim is: *given a client that returns nothing for B's id, A gets a 404
// whose body does not confirm B's row exists.* Proving RLS actually returns
// nothing is pgTAP's job and is already done —
// `supabase/tests/entries_rls_test.sql`.
//
// EXCEPT FOR ONE CASE, WHERE THERE IS NO pgTAP TO DEFER TO. The foreign-
// `categoryId` case below guards an invariant the database does not hold.
// `entries.category_id` is a plain foreign key, and Postgres FK checks are NOT
// subject to RLS on the referenced table
// (`supabase/migrations/20260815164539_create_entries_table.sql:31-36`, which
// says so in its own words) — so a raw SQL insert by A naming B's category id is
// legal and succeeds. `supabase/tests/entries_rls_test.sql:8-17` excludes the
// case in writing. The only thing that stops it is the RLS-scoped lookup in
// `assertCategoryUsable` (`src/lib/services/entries.ts:154-181`), and this
// change added no pgTAP — so **this test is that invariant's only automated
// guard**. A green suite must not be read as covering the database layer here.
//
// Oracles, all external to this code:
//
// 1. `src/pages/api/entries/[id].ts` read as a contract, plus the Polish strings
//    it hand-writes at `:58` and `:61`.
// 2. `src/lib/services/entries.ts` for which PostgREST result each refusal keys
//    on, and for the round-trip count each case must queue.
// 3. `supabase/seed.sql` for the two identities.
//
// Closes the hand-run `curl` verifications archived at
// `context/archive/2026-08-15-income-and-entry-management/plan.md:374` —
// "`PATCH /api/entries/<id>` against another user's entry returns 404" and
// "`DELETE /api/entries/<id>` twice returns 204 then 404" — each checked once, by
// hand, at ship time, leaving no regression guard behind.
//
// WHY THIS FILE IS REACHABLE AT ALL. `[id].ts:2` value-imports `@/lib/supabase`,
// which value-imports `astro:env/server`, and `vitest.config.ts` cannot resolve
// `astro:*` (see `test-plan.md` §6.1). The `vi.mock` below replaces the module
// BEFORE it is ever evaluated. `Request`/`Response` are native in Node 22 —
// default `node` environment, no jsdom.

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

/** An entry A owns. */
const OWN_ENTRY = 101;
/** An entry B owns. A never learns whether this id exists. */
const FOREIGN_ENTRY = 4242;
/** A category A owns, and the one `OWN_ENTRY` is currently filed under. */
const OWN_CATEGORY = 7;
/** A category B owns. */
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

/**
 * A well-formed PATCH body. `description` is mandatory and nullable, not
 * optional — omitting it is a 400 (`src/lib/services/entries.ts:43-51`).
 */
function patchBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { amount: 12.5, categoryId: OWN_CATEGORY, occurredOn: "2026-08-14", description: null, ...overrides };
}

/** A stored row exactly as PostgREST hands it back, with the joined category. */
function storedRow(categoryId: number) {
  return {
    id: OWN_ENTRY,
    amount: 12.5,
    occurred_on: "2026-08-14",
    type: "expense",
    created_at: "2026-08-14T10:00:00.000Z",
    description: null,
    category: { id: categoryId, name: "Jedzenie", icon: "tag" },
  };
}

function patchRequest(id: number, body: unknown): PatchContext {
  return routeContext({
    url: `https://papertrail.test/api/entries/${String(id)}`,
    method: "PATCH",
    body,
    params: { id: String(id) },
  }) as unknown as PatchContext;
}

function deleteRequest(id: number): DeleteContext {
  return routeContext({
    url: `https://papertrail.test/api/entries/${String(id)}`,
    method: "DELETE",
    params: { id: String(id) },
  }) as unknown as DeleteContext;
}

describe("PATCH /api/entries/[id]", () => {
  it("answers 200 for an entry the caller owns", async () => {
    // The positive control, and the file's statement of the round-trip count:
    // three awaits — the `type`/`category_id` pre-read, `assertCategoryUsable`,
    // then the update itself. Responses are queued in AWAIT order, not keyed by
    // table.
    const fake = fakeClient(
      [
        { data: { type: "expense", category_id: OWN_CATEGORY }, error: null },
        { data: { id: OWN_CATEGORY, kind: "expense" }, error: null },
        { data: storedRow(OWN_CATEGORY), error: null },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await PATCH(patchRequest(OWN_ENTRY, patchBody()));

    expect(response.status).toBe(200);
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      id: OWN_ENTRY,
      amount: 12.5,
      occurredOn: "2026-08-14",
      type: "expense",
      category: { id: OWN_CATEGORY, name: "Jedzenie", icon: "tag" },
      createdAt: "2026-08-14T10:00:00.000Z",
      description: null,
    });
  });

  it(`answers 404 when ${USER_A.id} patches an entry owned by ${USER_B.id}`, async () => {
    // ONE queued response: the `.maybeSingle()` pre-read returns `data: null`
    // and `updateEntry` throws before it ever reaches the category check
    // (`src/lib/services/entries.ts:335-337`). The refusal is a read result, not
    // an error — absent and RLS-filtered are the same value here on purpose.
    const fake = fakeClient([{ data: null, error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await PATCH(patchRequest(FOREIGN_ENTRY, patchBody()));

    expect(response.status).toBe(404);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Nie znaleziono wpisu" });
    // The write never issued. `update` is what would have reached the database.
    expect(fake.calls.map((call) => call.method)).not.toContain("update");
  });

  it(`refuses to re-point ${USER_A.id}'s own entry at a category owned by ${USER_B.id}`, async () => {
    // THE INVARIANT WITH NO DATABASE BACKSTOP — see this file's header. The FK
    // on `entries.category_id` checks row existence only; it would accept B's
    // id. `assertCategoryUsable`'s RLS-scoped lookup is what refuses, and with
    // no pgTAP added by this change, this case is its only automated guard.
    //
    // TWO queued responses, in await order: the pre-read finds A's entry, then
    // the category lookup for B's id comes back empty.
    const fake = fakeClient(
      [
        { data: { type: "expense", category_id: OWN_CATEGORY }, error: null },
        { data: null, error: null },
      ],
      SIGNED_IN,
    );
    holder.client = fake.client;

    const response = await PATCH(patchRequest(OWN_ENTRY, patchBody({ categoryId: FOREIGN_CATEGORY })));

    expect(response.status).toBe(404);
    // Same ambiguous string as an absent category, plus the field the edit form
    // highlights. Naming ownership here would confirm B's category id exists.
    await expect(response.json<unknown>()).resolves.toStrictEqual({
      error: "Nie znaleziono kategorii",
      field: "categoryId",
    });
    // Nothing was written: the entry keeps pointing at A's own category.
    expect(fake.calls.map((call) => call.method)).not.toContain("update");
  });
});

describe("DELETE /api/entries/[id]", () => {
  it("answers 204 for an entry the caller owns", async () => {
    const fake = fakeClient([{ data: [{ id: OWN_ENTRY }], error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await DELETE(deleteRequest(OWN_ENTRY));

    expect(response.status).toBe(204);
  });

  it(`answers 404, not 204, when ${USER_A.id} deletes an entry owned by ${USER_B.id}`, async () => {
    // A hard DELETE with `.select("id")` appended, so a row RLS filtered out
    // comes back as an empty array rather than as an error
    // (`src/lib/services/entries.ts:367-377`). That `.select("id")` is the whole
    // zero-row detector: drop it and the route answers a cheerful 204 for a row
    // it never touched, which the caller reads as "deleted".
    const fake = fakeClient([{ data: [], error: null }], SIGNED_IN);
    holder.client = fake.client;

    const response = await DELETE(deleteRequest(FOREIGN_ENTRY));

    expect(response.status).toBe(404);
    await expect(response.json<unknown>()).resolves.toStrictEqual({ error: "Nie znaleziono wpisu" });
  });
});
