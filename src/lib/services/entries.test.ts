import { describe, expect, it } from "vitest";

import { createSupabaseFake } from "@/lib/services/__fixtures__/supabase-fake";
import {
  CategoryKindMismatchError,
  CategoryNotFoundError,
  type CreateEntriesBatchInput,
  createEntriesBatch,
  createEntriesBatchSchema,
  createEntrySchema,
} from "@/lib/services/entries";

// `createEntriesBatch` is the receipt confirm's write boundary: everything the
// user reviewed on screen becomes one row array here, and one statement puts it
// in the database. Risk #1 in `context/foundation/test-plan.md` §2 is that what
// persists differs from what was confirmed — a wrong per-category split, a wrong
// date, a wrong amount, or a duplicated batch on retry. Every one of those is a
// property of the array asserted below, and none of them is visible in the value
// this function RETURNS. That is why the fake records the call rather than only
// canning the result.
//
// Every expectation is hand-written from an external oracle, never derived by
// calling the code under test. The four sources:
//
// 1. `supabase/migrations/20260817190000_add_entry_batch_key.sql:62-64` —
//    `unique (user_id, batch_id, batch_seq)`. That column list, in that order,
//    is the oracle for the `onConflict` string. A change to either half breaks
//    idempotency silently: PostgREST would stop inferring the constraint and
//    every replay would either error or double-write.
// 2. `supabase/migrations/20260815164539_create_entries_table.sql:10-13` — the
//    `type` check constraint and `occurred_on date not null`. Every row this
//    path writes is an `expense`, and every row of one receipt shares one date.
// 3. `entries.ts:190-208`, read as a spec: three app-layer-only invariants —
//    ownership via the RLS-scoped select, `type` ↔ `kind`, and the exclusion of
//    soft-deleted categories. `context/foundation/lessons.md`'s first entry says
//    pgTAP structurally cannot reach any of them; this file is where they go.
// 4. `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135`
//    for the replay behaviour, including the edited-retry trade characterised at
//    the bottom of this file.
//
// Deliberately NOT duplicated: anything `supabase/tests/entries_batch_key_test.sql`
// already proves. That suite covers the constraint itself — the column shape,
// `col_is_unique` over the exact three columns, a plain replay raising 23505, and
// a `do nothing` replay leaving the row count unchanged. What it cannot see is
// what the statement RETURNED, which is the branch the replay cases below take.
//
// Scope: `createEntriesBatch`, plus the `occurredOn` bound on the two schemas
// that guard the write paths. The other exports in this module serve other risks
// and other rollout phases.

// The service's own SupabaseClient type is module-private; this names it without
// widening the module's API surface just for a test.
type ServiceClient = Parameters<typeof createEntriesBatch>[0];

// Any v4 UUID. The value is opaque to the service — it only ever passes it
// through — so a fixed literal keeps the assertions readable.
const BATCH_ID = "11111111-1111-4111-8111-111111111111";

const FOOD = 7;
const TRANSPORT = 9;

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

describe("createEntriesBatch", () => {
  describe("the row array handed to PostgREST", () => {
    it("carries one row per item, with the position assigned server-side", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [
          { amount: 12.5, categoryId: FOOD, description: "Chleb 4,50 · Mleko 3,40" },
          // No description key at all — the `?? null` must turn undefined into
          // an explicit null, because PostgREST omitting the column would take
          // the column default rather than storing NULL.
          { amount: 30, categoryId: TRANSPORT },
        ],
      };
      const fake = createSupabaseFake([
        {
          data: [
            { id: FOOD, kind: "expense" },
            { id: TRANSPORT, kind: "expense" },
          ],
          error: null,
        },
        { data: [storedRow(101, 12.5, "Chleb 4,50 · Mleko 3,40"), storedRow(102, 30, null)], error: null },
      ]);

      await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      const upsert = fake.calls.find((call) => call.method === "upsert");
      expect(upsert?.args[0]).toStrictEqual([
        {
          amount: 12.5,
          category_id: 7,
          occurred_on: "2026-08-14",
          type: "expense",
          description: "Chleb 4,50 · Mleko 3,40",
          batch_id: "11111111-1111-4111-8111-111111111111",
          batch_seq: 0,
        },
        {
          amount: 30,
          category_id: 9,
          // The SAME date on every row. A receipt is one shopping trip; a
          // per-row date would let half a paragon land on a different day.
          occurred_on: "2026-08-14",
          type: "expense",
          description: null,
          batch_id: "11111111-1111-4111-8111-111111111111",
          batch_seq: 1,
        },
      ]);
    });

    it("uses the conflict target the unique constraint declares", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [{ amount: 12.5, categoryId: FOOD }],
      };
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [storedRow(101, 12.5, null)], error: null },
      ]);

      await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      // `unique (user_id, batch_id, batch_seq)` — the column list AND its order
      // come from 20260817190000_add_entry_batch_key.sql:62-64. PostgREST only
      // infers the constraint when the target matches it exactly, so a change to
      // either half breaks idempotency without erroring. `ignoreDuplicates` is
      // what makes supabase-js emit `on conflict … do nothing`; flipped to false
      // it becomes a real upsert and a replay OVERWRITES the stored rows.
      const upsert = fake.calls.find((call) => call.method === "upsert");
      expect(upsert?.args[1]).toStrictEqual({
        onConflict: "user_id,batch_id,batch_seq",
        ignoreDuplicates: true,
      });
    });

    it("never accepts batch_seq from the client", async () => {
      // Assigned through a variable rather than inline so TypeScript's
      // excess-property check does not reject the smuggled key — which is the
      // point: a client CAN send it, and zod strips it before this layer, but
      // the service must not depend on that.
      const smuggled = { amount: 12.5, categoryId: FOOD, batch_seq: 99 };
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [smuggled],
      };
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [storedRow(101, 12.5, null)], error: null },
      ]);

      await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      const upsert = fake.calls.find((call) => call.method === "upsert");
      // A client-supplied position could collide two lines of one receipt into
      // a single stored row — silently, since the conflict resolves to `do
      // nothing`. toStrictEqual proves nothing extra rode along either.
      expect(upsert?.args[0]).toStrictEqual([
        {
          amount: 12.5,
          category_id: 7,
          occurred_on: "2026-08-14",
          type: "expense",
          description: null,
          batch_id: "11111111-1111-4111-8111-111111111111",
          batch_seq: 0,
        },
      ]);
    });
  });

  describe("the category guard", () => {
    it("asks for distinct ids only, scoped to live categories", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        // Two lines, one category — the ordinary receipt shape.
        items: [
          { amount: 12.5, categoryId: FOOD },
          { amount: 4.2, categoryId: FOOD },
        ],
      };
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [storedRow(101, 12.5, null), storedRow(102, 4.2, null)], error: null },
      ]);

      await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      // The whole first round trip, asserted as one chain. Two things ride on
      // it. The `in` list must be DEDUPED, because the guard below compares row
      // count against id count — with `[7, 7]` a single returned row would read
      // as "one id missing" and 404 a perfectly good receipt. And
      // `.is("deleted_at", null)` is this path's third invariant, the one that
      // differs from assertCategoryUsable: that function admits a soft-deleted
      // category when correcting an entry already filed under it, but a receipt
      // confirm creates NEW entries and must not resurrect a deleted category.
      expect(fake.calls.slice(0, 4)).toStrictEqual([
        { method: "from", args: ["categories"] },
        { method: "select", args: ["id, kind"] },
        { method: "in", args: ["id", [7]] },
        { method: "is", args: ["deleted_at", null] },
      ]);
    });

    it("refuses the whole batch when an id comes back missing", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [
          { amount: 12.5, categoryId: FOOD },
          { amount: 30, categoryId: TRANSPORT },
        ],
      };
      // Two ids asked for, one row back. Absent, soft-deleted, or someone
      // else's — indistinguishable on purpose, because saying which would
      // confirm that another user's category id exists.
      const fake = createSupabaseFake([{ data: [{ id: FOOD, kind: "expense" }], error: null }]);

      await expect(createEntriesBatch(fake.client as unknown as ServiceClient, input)).rejects.toBeInstanceOf(
        CategoryNotFoundError,
      );
      // Nothing was written. All-or-nothing is the property that stops a
      // half-filed receipt the user cannot reconcile.
      expect(fake.calls.map((call) => call.method)).not.toContain("upsert");
    });

    it("refuses the whole batch when a category is an income category", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [{ amount: 12.5, categoryId: FOOD }],
      };
      // Nothing in the schema ties entries.type to categories.kind, so this
      // check is the only thing standing between a receipt line and an expense
      // filed against an income category.
      const fake = createSupabaseFake([{ data: [{ id: FOOD, kind: "income" }], error: null }]);

      await expect(createEntriesBatch(fake.client as unknown as ServiceClient, input)).rejects.toBeInstanceOf(
        CategoryKindMismatchError,
      );
      expect(fake.calls.map((call) => call.method)).not.toContain("upsert");
    });
  });

  describe("what it returns", () => {
    it("maps the inserted rows to DTOs on a first confirm", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [{ amount: 12.5, categoryId: FOOD, description: "Chleb 4,50" }],
      };
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [storedRow(101, 12.5, "Chleb 4,50")], error: null },
      ]);

      const result = await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      expect(result).toStrictEqual([
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
      // One confirm, one round trip to write. The re-select is the replay
      // branch and must not fire here.
      expect(fake.calls.filter((call) => call.method === "eq")).toStrictEqual([]);
    });

    it("re-selects the stored batch when the upsert returns nothing", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [
          { amount: 12.5, categoryId: FOOD, description: "Chleb 4,50" },
          { amount: 4.2, categoryId: FOOD, description: "Mleko 4,20" },
        ],
      };
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        // The replay. `on conflict do nothing` means RETURNING yields only rows
        // the statement actually inserted, so a fully-conflicting retry hands
        // back an empty array. Unfixed, the UI reports "saved 0 entries" for a
        // receipt sitting in the database.
        //
        // This is precisely the branch pgTAP cannot reach:
        // entries_batch_key_test.sql asserts the row COUNT after a replay,
        // never what the statement returned.
        { data: [], error: null },
        { data: [storedRow(101, 12.5, "Chleb 4,50"), storedRow(102, 4.2, "Mleko 4,20")], error: null },
      ]);

      const result = await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      // A retry answers with the same rows the first call did, which is also
      // what lets DayView's id-keyed dedupe recognise them as already present.
      expect(result.map((entry) => entry.id)).toStrictEqual([101, 102]);
      expect(result).toHaveLength(2);

      // The re-select chain. `batch_id` is safe to key on without a user filter
      // because RLS scopes the read and the id is half of a user_id-scoped
      // unique key. The order clause is not cosmetic: it is what keeps the
      // replay's response in the order the user confirmed in, matching the
      // first call's RETURNING order.
      const reSelectStart = fake.calls.map((call) => call.method).lastIndexOf("from");
      expect(fake.calls.slice(reSelectStart)).toStrictEqual([
        { method: "from", args: ["entries"] },
        {
          method: "select",
          // The joined category, spelled out: without it `toDto` produces rows
          // whose `category` is undefined and the day list renders blanks.
          args: ["id, amount, occurred_on, type, created_at, description, category:categories(id, name, icon)"],
        },
        { method: "eq", args: ["batch_id", "11111111-1111-4111-8111-111111111111"] },
        { method: "order", args: ["batch_seq", { ascending: true }] },
      ]);
    });

    // CHARACTERISATION TEST — this pins an ACCEPTED TRADE, not an endorsement.
    //
    // If the user edits the item list and retries after a lost response, the
    // positions already stored conflict and only genuinely new ones are
    // appended; the re-select then returns everything under the batch id. So the
    // corrections are discarded and the response describes what is stored, not
    // what was just submitted. That is accurate to the database and it is also
    // not what the user asked for.
    //
    // Recorded and accepted at
    // context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:135.
    // The reasoning still holds: re-minting the batch key on every edit would
    // reopen the double-write the key exists to close. Changing this is a
    // PRODUCT decision, not a test change — do not "fix" the code to make this
    // test go green a different way. Delete the test in the same commit that
    // deliberately changes the behaviour.
    it("returns the stored batch, not the resubmitted one, after an edited retry", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        // The user corrected the receipt down to three lines and retried.
        items: [
          { amount: 10, categoryId: FOOD },
          { amount: 20, categoryId: FOOD },
          { amount: 30, categoryId: FOOD },
        ],
      };
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [], error: null },
        // Five rows are already stored under this batch id from the first
        // confirm, at the original amounts.
        {
          data: [
            storedRow(101, 1, null),
            storedRow(102, 2, null),
            storedRow(103, 3, null),
            storedRow(104, 4, null),
            storedRow(105, 5, null),
          ],
          error: null,
        },
      ]);

      const result = await createEntriesBatch(fake.client as unknown as ServiceClient, input);

      // Three submitted, five returned, and none of the returned amounts is one
      // of the three that were sent.
      expect(result).toHaveLength(5);
      expect(result.map((entry) => entry.amount)).toStrictEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("errors", () => {
    it("rethrows a failure from the category check", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [{ amount: 12.5, categoryId: FOOD }],
      };
      const failure = new Error("PostgREST: connection reset");
      const fake = createSupabaseFake([{ data: null, error: failure }]);

      // Rethrown unchanged, not swallowed into a CategoryNotFoundError — the
      // route maps that to a 404, and a transport failure reported as "category
      // not found" sends the user hunting for a problem that is not theirs.
      await expect(createEntriesBatch(fake.client as unknown as ServiceClient, input)).rejects.toBe(failure);
      expect(fake.calls.map((call) => call.method)).not.toContain("upsert");
    });

    it("rethrows a failure from the batch write", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [{ amount: 12.5, categoryId: FOOD }],
      };
      const failure = new Error("PostgREST: 23514 check constraint violated");
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: null, error: failure },
      ]);

      await expect(createEntriesBatch(fake.client as unknown as ServiceClient, input)).rejects.toBe(failure);
    });

    it("rethrows a failure from the replay re-select", async () => {
      const input: CreateEntriesBatchInput = {
        occurredOn: "2026-08-14",
        batchId: BATCH_ID,
        items: [{ amount: 12.5, categoryId: FOOD }],
      };
      const failure = new Error("PostgREST: statement timeout");
      const fake = createSupabaseFake([
        { data: [{ id: FOOD, kind: "expense" }], error: null },
        { data: [], error: null },
        { data: null, error: failure },
      ]);

      await expect(createEntriesBatch(fake.client as unknown as ServiceClient, input)).rejects.toBe(failure);
    });
  });
});

// The oracle here is the calendar itself — February 2026 has 28 days, April has
// 30, and 2026 is not a leap year. Nothing in this repository is consulted to
// know any of that, which is the point: the previous bound was a shape regex
// that could not know it either.
//
// What the shape regex cost (research finding F1): `2026-02-30` passed
// validation, reached Postgres, was refused by `occurred_on date not null`
// (20260815164539_create_entries_table.sql:12), and came back as a 500 with a
// non-JSON body — so the user was told "Coś poszło nie tak" about a receipt
// whose only problem was a misread printed date. The route half of this is
// asserted in `src/pages/api/receipts/entries.test.ts`.
describe("the occurredOn bound", () => {
  const IMPOSSIBLE = [
    // February 2026 ends on the 28th.
    "2026-02-30",
    // No thirteenth month, no forty-fifth day.
    "2026-13-45",
    // April has 30 days.
    "2026-04-31",
    // 2026 is not divisible by 4, so there is no 29 February that year. The
    // pair with the accepted `2024-02-29` below is what proves the check is a
    // real calendar and not a per-month day-count table.
    "2026-02-29",
  ];

  // Kept from the regex era: the swap must not have loosened the shape while
  // tightening the semantics.
  const MALFORMED = ["", "14.08.2026", "2026-8-14", "2026-08-14T00:00:00Z", "wczoraj"];

  describe("createEntriesBatchSchema", () => {
    function body(occurredOn: string) {
      return {
        occurredOn,
        batchId: "11111111-1111-4111-8111-111111111111",
        items: [{ amount: 12.5, categoryId: FOOD }],
      };
    }

    it.each(IMPOSSIBLE)("rejects %s, which is not a day that exists", (occurredOn) => {
      const result = createEntriesBatchSchema.safeParse(body(occurredOn));

      expect(result.success).toBe(false);
      // The field name is what the route forwards as `field`, and what the panel
      // needs to point at the right control.
      expect(result.error?.issues[0].path).toStrictEqual(["occurredOn"]);
    });

    it.each(MALFORMED)("rejects %s, which is not an ISO date at all", (occurredOn) => {
      expect(createEntriesBatchSchema.safeParse(body(occurredOn)).success).toBe(false);
    });

    it("accepts 2024-02-29, a real leap day", () => {
      expect(createEntriesBatchSchema.safeParse(body("2024-02-29")).success).toBe(true);
    });

    it("accepts an ordinary day", () => {
      expect(createEntriesBatchSchema.safeParse(body("2026-08-21")).success).toBe(true);
    });
  });

  // The consistency half. `createEntrySchema` guards the single-entry write, not
  // the receipt confirm, so it is outside risk #1 — but both schemas carried the
  // same shape-only regex one screen apart, and fixing one of two identical
  // copies is the drift `context/foundation/lessons.md` exists to stop.
  describe("createEntrySchema", () => {
    function body(occurredOn: string) {
      return { amount: 12.5, categoryId: FOOD, occurredOn };
    }

    it.each(IMPOSSIBLE)("rejects %s too", (occurredOn) => {
      expect(createEntrySchema.safeParse(body(occurredOn)).success).toBe(false);
    });

    it("accepts an ordinary day", () => {
      expect(createEntrySchema.safeParse(body("2026-08-21")).success).toBe(true);
    });
  });
});
