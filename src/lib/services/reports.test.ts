import { describe, expect, it } from "vitest";

import { createSupabaseFake } from "@/lib/services/__fixtures__/supabase-fake";
import {
  RangeTooLargeError,
  type SummaryQueryInput,
  getCategorySummary,
  getEntriesSummary,
  getFirstEntryDate,
} from "@/lib/services/reports";
import type { SummaryBucket } from "@/types";

// `context/foundation/test-plan.md` §2 risk #2: a KPI or chart reads plausibly
// but is wrong — rows silently dropped, the recurring filter disagreeing with
// the numbers displayed, or a range resolving to the wrong window. This module
// carries three deliberate "correct or absent" mechanisms and, until this file,
// not one of them was asserted anywhere at any layer.
//
// WHY THIS CANNOT BE A pgTAP TEST. Both pgTAP suites on this path explicitly
// disclaim the application-layer rules as out of reach and name them a
// permanent manual-verification requirement
// (`supabase/tests/entries_summary_test.sql:17-22`,
// `entries_category_summary_test.sql:20-25`). The structural half of that is
// true and permanent: **the truncation this file exists to catch is a PostgREST
// behaviour, not a Postgres one.** `max_rows` is applied by the API layer;
// pgTAP talks to Postgres directly and never crosses it, so no fixture size
// reproduces the failure there. The "therefore manual forever" half stopped
// following when a JS runner arrived (`context/foundation/lessons.md`, first
// entry) — the guard is a plain `array.length` comparison in TypeScript, so a
// 1000-row synthetic response reaches it exactly, in milliseconds.
//
// Every expectation below is hand-written from an external oracle, never
// derived by calling the code under test. The four sources:
//
// 1. **`supabase/config.toml:18` — `max_rows = 1000`** — plus PostgREST's
//    documented behaviour of TRUNCATING rather than erroring at that cap. That
//    number, and the fact that the overflow is silent, is the oracle for the
//    tripwire boundary. The archived defect it was added for is
//    `context/archive/2026-08-16-category-distribution-view/reviews/impl-review.md:54-78`
//    (S-05 finding F1).
// 2. **The two migrations' `grouping sets` clauses, read as the row-shape
//    spec** — `20260816103000_add_entries_summary_function.sql:56-59` gives
//    Board A `((bucket, type), (type))`, i.e. at most two rows per bucket plus
//    two grand totals; `20260816150000_add_entries_category_summary_function.sql`
//    gives Board B `((bucket, cat), (cat), ())`, and its own comment states
//    that the empty set exists to make the percentage denominator an exact
//    Postgres numeric rather than a JavaScript sum. Neither declares an
//    `order by`, which is why row order is treated as unspecified below.
// 3. **The impl-review's own worked bucket arithmetic** —
//    `?from=2026-01-01&to=2027-02-04&bucket=day` is *exactly* 400 buckets, and
//    a 30-day range across 33 categories is `30 × 33 + 33 + 1 = 1024` rows.
//    Both figures were computed there, before this file existed.
// 4. **Arithmetic done by hand.** Every total, every projection of a stated
//    population into RPC rows, and every row count below is worked out on paper
//    from the fixture's own numbers and written as a literal; none is obtained
//    by running the service and copying what came back.
//
// Deliberately NOT duplicated: anything `supabase/tests/entries_summary_test.sql`
// and `entries_category_summary_test.sql` already prove — cross-user isolation
// through `security invoker`, the `anon` execute revoke, the grouping-set
// arithmetic summing bucket → category → grand total, expense-only filtering,
// `p_exclude_recurring`'s row selection, entries under soft-deleted categories
// still counting, and Monday-first week alignment in SQL. This file asserts the
// TypeScript half: what the service refuses to issue, what it refuses to
// return, and how it reshapes what it gets.
//
// ACCEPTED AND NOT ASSERTED OTHERWISE: an authenticated user POSTing directly
// to `/rest/v1/rpc/entries_summary` bypasses the bucket guard entirely. That is
// S-04 finding F9, SKIPPED and accepted at
// `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:151-159`.
// The guard protects UI correctness, not the database. Nothing below may be
// read as claiming it protects more.

// The service's own SupabaseClient type is module-private; this names it
// without widening the module's API surface just for a test.
type ServiceClient = Parameters<typeof getEntriesSummary>[0];

// `max_rows` as configured for the local stack (`supabase/config.toml:18`),
// restated here as a literal rather than imported: `POSTGREST_MAX_ROWS` in the
// module under test is the copy being tested, and a test that imports its
// subject's constant cannot notice the constant changing.
const CONFIGURED_MAX_ROWS = 1000;

/** Board A's row shape (`entries_summary`), as PostgREST hands it back. */
interface FakeSummaryRow {
  bucket_start: string | null;
  entry_type: string;
  // Widened exactly as the service widens it: `numeric` is a type PostgREST is
  // entitled to serialise either way (`reports.ts:127-129`).
  total: number | string;
}

/** Board B's row shape (`entries_category_summary`). */
interface FakeCategoryRow {
  bucket_start: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  total: number | string;
}

function query(
  from: string,
  to: string,
  bucket: SummaryBucket = "day",
  recurring: "shown" | "hidden" = "shown",
): SummaryQueryInput {
  return { from, to, bucket, recurring };
}

// Test scaffolding, NOT an oracle: this only labels generated bucket rows, and
// nothing asserted in this file depends on the label being any particular date.
// Written locally rather than imported from `src/components/reports/range.ts`
// so a service test never depends on a browser-side module.
function dayAfter(start: string, offset: number): string {
  const [year, month, day] = start.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}

// --- The bucket ceiling (MAX_BUCKETS = 400, pre-flight) ---

// Both endpoints of the guard, taken from the impl-review's worked example
// rather than recomputed here: `2026-01-01 … 2027-02-04` is exactly 400
// inclusive days, so `bucketCountUpperBound` returns 400 for `bucket: "day"`
// and the guard's `> MAX_BUCKETS` does not fire. One day later it does.
const AT_BUCKET_CEILING = query("2026-01-01", "2027-02-04");
const OVER_BUCKET_CEILING = query("2026-01-01", "2027-02-05");

describe("the bucket ceiling", () => {
  it("refuses a 401-day daily range on Board A before issuing any request", async () => {
    const fake = createSupabaseFake([]);

    await expect(
      getEntriesSummary(fake.client as unknown as ServiceClient, OVER_BUCKET_CEILING),
    ).rejects.toBeInstanceOf(RangeTooLargeError);
    // PRE-FLIGHT is the property, not merely the throw. A guard that runs after
    // the RPC has already returned is a guard against nothing: PostgREST would
    // have truncated by then, and the difference between an error and a
    // plausible partial answer is exactly what risk #2 is about.
    expect(fake.calls).toStrictEqual([]);
  });

  it("refuses a 401-day daily range on Board B before issuing any request", async () => {
    const fake = createSupabaseFake([]);

    await expect(
      getCategorySummary(fake.client as unknown as ServiceClient, OVER_BUCKET_CEILING),
    ).rejects.toBeInstanceOf(RangeTooLargeError);
    expect(fake.calls).toStrictEqual([]);
  });

  it("admits exactly 400 daily buckets on Board A", async () => {
    // Two responses, because getEntriesSummary issues the current and previous
    // ranges together — see the queue-order case below.
    const fake = createSupabaseFake([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await expect(getEntriesSummary(fake.client as unknown as ServiceClient, AT_BUCKET_CEILING)).resolves.toMatchObject({
      bucket: "day",
    });
  });

  it("admits exactly 400 daily buckets on Board B", async () => {
    const fake = createSupabaseFake([{ data: [], error: null }]);

    await expect(getCategorySummary(fake.client as unknown as ServiceClient, AT_BUCKET_CEILING)).resolves.toMatchObject(
      { total: 0 },
    );
  });
});

// --- The truncation tripwire (POSTGREST_MAX_ROWS = 1000, post-flight) ---

/**
 * Board B's response for a `dayCount × categoryCount` population where every
 * cell is non-empty: the bucket × category cells, then one range total per
 * category, then the single `()` grand total. Row count is therefore
 * `dayCount × categoryCount + categoryCount + 1` — the arithmetic the S-05
 * impl-review used to size the defect, reproduced here as structure.
 */
function categorySummaryResponse(dayCount: number, categoryCount: number): FakeCategoryRow[] {
  const cells: FakeCategoryRow[] = [];
  const perCategory: FakeCategoryRow[] = [];

  for (let category = 1; category <= categoryCount; category += 1) {
    for (let day = 0; day < dayCount; day += 1) {
      cells.push({
        bucket_start: dayAfter("2026-01-01", day),
        category_id: category,
        category_name: `Kategoria ${String(category)}`,
        category_color: "slate",
        category_icon: "tag",
        total: 1,
      });
    }
    perCategory.push({
      bucket_start: null,
      category_id: category,
      category_name: `Kategoria ${String(category)}`,
      category_color: "slate",
      category_icon: "tag",
      total: dayCount,
    });
  }

  return [
    ...cells,
    ...perCategory,
    {
      bucket_start: null,
      category_id: null,
      category_name: null,
      category_color: null,
      category_icon: null,
      total: dayCount * categoryCount,
    },
  ];
}

/** The range covering exactly `dayCount` daily buckets from 2026-01-01. */
function dailyRange(dayCount: number): SummaryQueryInput {
  return query("2026-01-01", dayAfter("2026-01-01", dayCount - 1));
}

describe("the truncation tripwire", () => {
  // `MAX_BUCKETS` bounds BUCKETS, not ROWS, and Board B's width is the user's
  // category count — something nothing in the service can see. So the bucket
  // guard alone leaves this response able to reach `max_rows`, where PostgREST
  // truncates SILENTLY. Grouping-set order is unspecified and the `()` set is
  // emitted last, so the row most likely dropped is the grand total; `total`
  // then stays at its initialiser 0 and every ranking row prints 0% beside a
  // real złoty amount. That is the archived defect, verbatim.
  //
  // ACCEPTED COST, recorded at impl-review.md:70 and not a defect to fix here:
  // a legitimate view — "Cały okres" on a mature account with many categories —
  // becomes an error rather than a chart. The trade is deliberate. An error the
  // user can see beats a number they cannot check.
  it("rejects a response of exactly max_rows rows", async () => {
    // 36 × 27 + 27 + 1 = 1000, hand-checked: 972 cells + 27 category totals +
    // 1 grand total.
    const rows = categorySummaryResponse(36, 27);
    expect(rows).toHaveLength(CONFIGURED_MAX_ROWS);

    const fake = createSupabaseFake([{ data: rows, error: null }]);

    // The check is `>=`, not `>` (`reports.ts:381`), so an exactly-1000-row
    // result is rejected as truncated even though it may be complete. That is a
    // DELIBERATE conservative false positive — PostgREST gives no way to tell a
    // response that happens to be 1000 rows from one that was cut to 1000 — and
    // the boundary case belongs at 1000, never at 1001.
    await expect(getCategorySummary(fake.client as unknown as ServiceClient, dailyRange(36))).rejects.toBeInstanceOf(
      RangeTooLargeError,
    );
  });

  it("admits a response one row below max_rows", async () => {
    // The same response with one cell removed: 999 rows, still carrying every
    // per-category total and the `()` row.
    const rows = categorySummaryResponse(36, 27).slice(1);
    expect(rows).toHaveLength(CONFIGURED_MAX_ROWS - 1);

    const fake = createSupabaseFake([{ data: rows, error: null }]);

    await expect(getCategorySummary(fake.client as unknown as ServiceClient, dailyRange(36))).resolves.toMatchObject({
      total: 36 * 27,
    });
  });

  // The two reachability figures from the impl-review's triage, as tests rather
  // than as prose. They are what make the guard's cost concrete: the demo seed
  // sits ONE CATEGORY short of tripping it on the DEFAULT preset.
  it("rejects the default 30-day preset for a 33-category account", async () => {
    // 30 × 33 + 33 + 1 = 1024.
    const rows = categorySummaryResponse(30, 33);
    expect(rows).toHaveLength(1024);

    const fake = createSupabaseFake([{ data: rows, error: null }]);

    await expect(getCategorySummary(fake.client as unknown as ServiceClient, dailyRange(30))).rejects.toBeInstanceOf(
      RangeTooLargeError,
    );
  });

  it("admits the default 30-day preset for a 32-category account", async () => {
    // 30 × 32 + 32 + 1 = 993 — the demo seed's shape, seven rows below the cap.
    const rows = categorySummaryResponse(30, 32);
    expect(rows).toHaveLength(993);

    const fake = createSupabaseFake([{ data: rows, error: null }]);

    await expect(getCategorySummary(fake.client as unknown as ServiceClient, dailyRange(30))).resolves.toMatchObject({
      total: 30 * 32,
    });
  });
});

// --- What the service hands to PostgREST ---

describe("the requests issued", () => {
  it("issues the current range first and the previous range second", async () => {
    const fake = createSupabaseFake([
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await getEntriesSummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    // `Promise.all` evaluates its array in order, so the queue stays
    // deterministic — but §6.2 flags queue ordering as the thing readers get
    // wrong, so the order is PINNED here rather than assumed by the fixtures
    // that follow. The previous range is 2026-07-29 … 2026-07-31: three
    // inclusive days ending the day before `from`, hand-counted.
    expect(fake.calls).toStrictEqual([
      {
        method: "rpc",
        args: [
          "entries_summary",
          { p_from: "2026-08-01", p_to: "2026-08-03", p_bucket: "day", p_exclude_recurring: false },
        ],
      },
      {
        method: "rpc",
        args: [
          "entries_summary",
          { p_from: "2026-07-29", p_to: "2026-07-31", p_bucket: "day", p_exclude_recurring: false },
        ],
      },
    ]);
  });

  it("forwards the recurring filter to both ranges and to Board B", async () => {
    // FR-015's exclusion is half of risk #2 — "the recurring-cost filter
    // disagreeing with the numbers displayed". The caption the user reads is
    // driven by `input.recurring`; if the parameter did not reach the query,
    // the caption and the figures would describe different populations.
    const boardA = createSupabaseFake([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await getEntriesSummary(
      boardA.client as unknown as ServiceClient,
      query("2026-08-01", "2026-08-03", "day", "hidden"),
    );
    expect(
      boardA.calls.map((call) => (call.args[1] as { p_exclude_recurring: boolean }).p_exclude_recurring),
    ).toStrictEqual([true, true]);

    const boardB = createSupabaseFake([{ data: [], error: null }]);
    await getCategorySummary(
      boardB.client as unknown as ServiceClient,
      query("2026-08-01", "2026-08-03", "week", "hidden"),
    );
    expect(boardB.calls).toStrictEqual([
      {
        method: "rpc",
        args: [
          "entries_category_summary",
          { p_from: "2026-08-01", p_to: "2026-08-03", p_bucket: "week", p_exclude_recurring: true },
        ],
      },
    ]);
  });
});

// --- Totals are assigned from grouping-set rows, never accumulated ---

describe("Board A's totals", () => {
  // The fixture's bucket rows sum to 30, and its grand-total rows say 999. Only
  // a service that ASSIGNS from the `bucket_start is null` rows can produce
  // 999; one that accumulates the buckets produces 30. The two answers are
  // distinguishable only because the fixture makes them disagree — a fixture
  // where they matched would pass either way, which is the trap this avoids.
  const MISMATCHED: FakeSummaryRow[] = [
    { bucket_start: "2026-08-01", entry_type: "expense", total: 10 },
    { bucket_start: "2026-08-02", entry_type: "expense", total: 20 },
    { bucket_start: null, entry_type: "expense", total: 999 },
    { bucket_start: null, entry_type: "income", total: 5 },
  ];

  it("takes the range totals from the null-bucket rows, not from the buckets", async () => {
    const fake = createSupabaseFake([
      { data: MISMATCHED, error: null },
      { data: [], error: null },
    ]);

    const result = await getEntriesSummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.current.totals).toStrictEqual({ expense: 999, income: 5 });
    expect(result.current.points).toStrictEqual([
      { bucketStart: "2026-08-01", expense: 10, income: 0 },
      { bucketStart: "2026-08-02", expense: 20, income: 0 },
    ]);
  });

  it("reports income: 0 for an expense-only range rather than omitting the key", async () => {
    const fake = createSupabaseFake([
      { data: [{ bucket_start: null, entry_type: "expense", total: 42 }], error: null },
      { data: [], error: null },
    ]);

    const result = await getEntriesSummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.current.totals).toStrictEqual({ expense: 42, income: 0 });
    // The previous range, with no rows at all, must still be a well-formed
    // RangeSummary — the KPI deltas divide by it.
    expect(result.previous).toStrictEqual({
      from: "2026-07-29",
      to: "2026-07-31",
      points: [],
      totals: { expense: 0, income: 0 },
    });
  });

  it("reads numeric serialised as a string identically to numeric serialised as a number", async () => {
    // PostgREST is entitled to either form for a `numeric` column
    // (`reports.ts:127-129`). If a refactor ever dropped the `Number()` call,
    // the string fixture would produce "0123.45"-style concatenation or NaN
    // downstream while the number fixture stayed green.
    const asStrings: FakeSummaryRow[] = [
      { bucket_start: "2026-08-01", entry_type: "expense", total: "123.45" },
      { bucket_start: null, entry_type: "expense", total: "123.45" },
    ];
    const asNumbers: FakeSummaryRow[] = [
      { bucket_start: "2026-08-01", entry_type: "expense", total: 123.45 },
      { bucket_start: null, entry_type: "expense", total: 123.45 },
    ];

    const stringFake = createSupabaseFake([
      { data: asStrings, error: null },
      { data: [], error: null },
    ]);
    const numberFake = createSupabaseFake([
      { data: asNumbers, error: null },
      { data: [], error: null },
    ]);
    const input = query("2026-08-01", "2026-08-03");

    const fromStrings = await getEntriesSummary(stringFake.client as unknown as ServiceClient, input);
    const fromNumbers = await getEntriesSummary(numberFake.client as unknown as ServiceClient, input);

    expect(fromStrings).toStrictEqual(fromNumbers);
    expect(fromStrings.current.totals.expense).toBe(123.45);
  });

  it("sorts points ascending by bucket regardless of the order rows arrive in", async () => {
    // `entries_summary` declares no `order by` — grouping sets makes row order
    // an implementation detail of the planner — so the service sorts, and this
    // fixture arrives deliberately scrambled with the grand totals interleaved.
    const shuffled: FakeSummaryRow[] = [
      { bucket_start: "2026-08-03", entry_type: "expense", total: 3 },
      { bucket_start: null, entry_type: "income", total: 100 },
      { bucket_start: "2026-08-01", entry_type: "income", total: 50 },
      { bucket_start: "2026-08-02", entry_type: "expense", total: 2 },
      { bucket_start: null, entry_type: "expense", total: 6 },
      { bucket_start: "2026-08-01", entry_type: "expense", total: 1 },
    ];
    const fake = createSupabaseFake([
      { data: shuffled, error: null },
      { data: [], error: null },
    ]);

    const result = await getEntriesSummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.current.points).toStrictEqual([
      { bucketStart: "2026-08-01", expense: 1, income: 50 },
      { bucketStart: "2026-08-02", expense: 2, income: 0 },
      { bucketStart: "2026-08-03", expense: 3, income: 0 },
    ]);
  });

  // The premise at `reports.ts:32-44` — "entries_summary returns 2 rows per
  // bucket, so 400 buckets is ~802 rows, comfortably clear of the cap" — is the
  // ONLY thing standing between Board A and the same silent truncation Board B
  // carries an explicit tripwire for. It is load-bearing and, until this case,
  // asserted nowhere.
  //
  // COUPLING, and the load-bearing half of this comment: **this pins the shape
  // the service reshapes, not the shape Postgres returns.** The oracle is
  // `20260816103000_add_entries_summary_function.sql:56-59` —
  // `grouping sets ((bucket, type), (type))`, which admits at most one expense
  // and one income row per bucket plus two grand totals. A migration that
  // widens those grouping sets must update this fixture AND re-check the
  // arithmetic premise at `reports.ts:32-44`; this test going green after such
  // a migration would mean nothing.
  it("reshapes a maximum-width 400-bucket response without loss, at 802 rows", async () => {
    const BUCKETS = 400;
    const rows: FakeSummaryRow[] = [];
    for (let index = 0; index < BUCKETS; index += 1) {
      const bucketStart = dayAfter("2026-01-01", index);
      rows.push({ bucket_start: bucketStart, entry_type: "expense", total: 10 });
      rows.push({ bucket_start: bucketStart, entry_type: "income", total: 1 });
    }
    rows.push({ bucket_start: null, entry_type: "expense", total: 10 * BUCKETS });
    rows.push({ bucket_start: null, entry_type: "income", total: BUCKETS });

    // 2 × 400 + 2 = 802, and 802 < 1000. That inequality is the premise.
    expect(rows).toHaveLength(802);
    expect(rows.length).toBeLessThan(CONFIGURED_MAX_ROWS);

    const fake = createSupabaseFake([
      { data: rows, error: null },
      { data: [], error: null },
    ]);

    const result = await getEntriesSummary(fake.client as unknown as ServiceClient, AT_BUCKET_CEILING);

    expect(result.current.points).toHaveLength(BUCKETS);
    expect(result.current.points.every((point) => point.expense === 10 && point.income === 1)).toBe(true);
    expect(result.current.totals).toStrictEqual({ expense: 4000, income: 400 });
  });
});

describe("Board B's totals", () => {
  it("takes the range total from the both-null row, not from the category rows", async () => {
    // The category rows sum to 10; the `()` row says 777. Only reading the
    // grouping-set row produces 777. This is the DTO contract in
    // `src/types.ts:273-276` — "an exact Postgres numeric, never a JavaScript
    // sum of categories[].total. Every percentage on the board divides by
    // this" — asserted for the first time.
    const rows: FakeCategoryRow[] = [
      {
        bucket_start: "2026-08-01",
        category_id: 7,
        category_name: "Jedzenie",
        category_color: "slate",
        category_icon: "tag",
        total: 10,
      },
      {
        bucket_start: null,
        category_id: 7,
        category_name: "Jedzenie",
        category_color: "slate",
        category_icon: "tag",
        total: 10,
      },
      {
        bucket_start: null,
        category_id: null,
        category_name: null,
        category_color: null,
        category_icon: null,
        total: 777,
      },
    ];
    const fake = createSupabaseFake([{ data: rows, error: null }]);

    const result = await getCategorySummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.total).toBe(777);
    expect(result.categories).toStrictEqual([{ categoryId: 7, name: "Jedzenie", icon: "tag", total: 10 }]);
  });

  it("sorts categories descending by total, tie-broken by name", async () => {
    // The tie-break is not cosmetic: this order is what the client's top-N
    // selection and colour assignment both walk, so an unstable order reshuffles
    // the palette between two identical loads (`reports.ts:344-348`).
    const rows: FakeCategoryRow[] = [
      {
        bucket_start: null,
        category_id: 1,
        category_name: "Zakupy",
        category_color: "slate",
        category_icon: "tag",
        total: 50,
      },
      {
        bucket_start: null,
        category_id: 2,
        category_name: "Auto",
        category_color: "slate",
        category_icon: "tag",
        total: 50,
      },
      {
        bucket_start: null,
        category_id: 3,
        category_name: "Dom",
        category_color: "slate",
        category_icon: "tag",
        total: 80,
      },
      {
        bucket_start: null,
        category_id: null,
        category_name: null,
        category_color: null,
        category_icon: null,
        total: 180,
      },
    ];
    const fake = createSupabaseFake([{ data: rows, error: null }]);

    const result = await getCategorySummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.categories.map((category) => category.name)).toStrictEqual(["Dom", "Auto", "Zakupy"]);
  });

  it("falls back to the default icon when the column carries no recognised name", async () => {
    // `category_icon` has no CHECK constraint, so the service's assertion is a
    // boundary assumption rather than a guarantee (`reports.ts:286-289`).
    const rows: FakeCategoryRow[] = [
      {
        bucket_start: null,
        category_id: 7,
        category_name: "Jedzenie",
        category_color: "slate",
        category_icon: null,
        total: 10,
      },
      {
        bucket_start: null,
        category_id: null,
        category_name: null,
        category_color: null,
        category_icon: null,
        total: 10,
      },
    ];
    const fake = createSupabaseFake([{ data: rows, error: null }]);

    const result = await getCategorySummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.categories[0].icon).toBe("tag");
  });

  it("skips a bucketed row with no category rather than crashing on it", async () => {
    // Defensive branch at `reports.ts:321-324`. `category_id` is non-null on
    // both remaining grouping sets, so this row cannot arise from the current
    // migration — the narrowing exists so the two branches below it can index
    // by the id. Pinned so the branch cannot be deleted as dead code without
    // someone noticing it was load-bearing for the type narrowing.
    const rows: FakeCategoryRow[] = [
      {
        bucket_start: "2026-08-01",
        category_id: null,
        category_name: null,
        category_color: null,
        category_icon: null,
        total: 5,
      },
      {
        bucket_start: "2026-08-01",
        category_id: 7,
        category_name: "Jedzenie",
        category_color: "slate",
        category_icon: "tag",
        total: 10,
      },
      {
        bucket_start: null,
        category_id: 7,
        category_name: "Jedzenie",
        category_color: "slate",
        category_icon: "tag",
        total: 10,
      },
      {
        bucket_start: null,
        category_id: null,
        category_name: null,
        category_color: null,
        category_icon: null,
        total: 10,
      },
    ];
    const fake = createSupabaseFake([{ data: rows, error: null }]);

    const result = await getCategorySummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03"));

    expect(result.points).toStrictEqual([{ bucketStart: "2026-08-01", totals: { "7": 10 } }]);
    expect(result.total).toBe(10);
  });

  it("reads numeric serialised as a string identically to numeric serialised as a number", async () => {
    function rows(total: number | string): FakeCategoryRow[] {
      return [
        {
          bucket_start: null,
          category_id: 7,
          category_name: "Jedzenie",
          category_color: "slate",
          category_icon: "tag",
          total,
        },
        {
          bucket_start: null,
          category_id: null,
          category_name: null,
          category_color: null,
          category_icon: null,
          total,
        },
      ];
    }
    const input = query("2026-08-01", "2026-08-03");
    const stringFake = createSupabaseFake([{ data: rows("123.45"), error: null }]);
    const numberFake = createSupabaseFake([{ data: rows(123.45), error: null }]);

    const fromStrings = await getCategorySummary(stringFake.client as unknown as ServiceClient, input);
    const fromNumbers = await getCategorySummary(numberFake.client as unknown as ServiceClient, input);

    expect(fromStrings).toStrictEqual(fromNumbers);
    expect(fromStrings.total).toBe(123.45);
  });
});

// --- The two boards, checked against each other ---

describe("cross-board agreement", () => {
  // THE ONE CHECK THAT CATCHES BOTH BOARDS BEING INDIVIDUALLY CORRECT AND
  // JOINTLY WRONG. Board A's "Wydatki" tile (`KpiTiles.tsx:56`, from
  // `entries_summary`) and Board B's donut centre (`CategoryDonut.tsx:166`,
  // from `entries_category_summary`'s `()` row) are two independent SQL
  // aggregates over the same population, and nothing anywhere cross-checks
  // them. `20260816150000_add_entries_category_summary_function.sql:27-33`
  // flags exactly this: a `deleted_at` filter on one side and not the other
  // would make the board total disagree with the Wydatki tile.
  //
  // SCOPE, stated plainly: this asserts the two RESHAPING PATHS agree given
  // consistent inputs. It does NOT prove the two SQL functions' predicates
  // agree — that is the pgTAP suites' half, and no Vitest fixture can reach it.
  //
  // And a second thing it does not catch, measured rather than assumed: because
  // a consistent population is one where the per-category rows DO sum to the
  // `()` row, this pair stays green if `toCategorySummary` is changed to
  // accumulate `total` instead of reading the grouping-set row. The teeth check
  // for that regression is "takes the range total from the both-null row" in
  // `Board B's totals`, whose fixture deliberately makes the two disagree. Do
  // not read the cases below as covering it.
  //
  // THE POPULATION, written down before either projection (expenses in złoty,
  // over 2026-08-01 … 2026-08-03, bucket "day"):
  //
  //   2026-08-01  Jedzenie  (7)   40      Transport (9)  10
  //   2026-08-02  Jedzenie  (7)   25
  //   2026-08-03  Transport (9)   30      Jedzenie  (7)   5
  //
  //   plus one INCOME entry — 2026-08-02, 1000 — which Board A reports and
  //   Board B, being expense-only by construction, must not.
  //
  // Hand-totalled from that table and from nothing else:
  //   per day    : 08-01 = 50, 08-02 = 25, 08-03 = 35
  //   per category: Jedzenie = 40 + 25 + 5 = 70, Transport = 10 + 30 = 40
  //   grand      : 50 + 25 + 35 = 110, and 70 + 40 = 110
  const EXPENSE_TOTAL = 110;

  // Board A's projection: `grouping sets ((bucket, type), (type))`.
  const BOARD_A_ROWS: FakeSummaryRow[] = [
    { bucket_start: "2026-08-01", entry_type: "expense", total: 50 },
    { bucket_start: "2026-08-02", entry_type: "expense", total: 25 },
    { bucket_start: "2026-08-02", entry_type: "income", total: 1000 },
    { bucket_start: "2026-08-03", entry_type: "expense", total: 35 },
    { bucket_start: null, entry_type: "expense", total: 110 },
    { bucket_start: null, entry_type: "income", total: 1000 },
  ];

  // Board B's projection: `grouping sets ((bucket, cat), (cat), ())`, expenses
  // only.
  const BOARD_B_ROWS: FakeCategoryRow[] = [
    {
      bucket_start: "2026-08-01",
      category_id: 7,
      category_name: "Jedzenie",
      category_color: "slate",
      category_icon: "tag",
      total: 40,
    },
    {
      bucket_start: "2026-08-01",
      category_id: 9,
      category_name: "Transport",
      category_color: "slate",
      category_icon: "car",
      total: 10,
    },
    {
      bucket_start: "2026-08-02",
      category_id: 7,
      category_name: "Jedzenie",
      category_color: "slate",
      category_icon: "tag",
      total: 25,
    },
    {
      bucket_start: "2026-08-03",
      category_id: 9,
      category_name: "Transport",
      category_color: "slate",
      category_icon: "car",
      total: 30,
    },
    {
      bucket_start: "2026-08-03",
      category_id: 7,
      category_name: "Jedzenie",
      category_color: "slate",
      category_icon: "tag",
      total: 5,
    },
    {
      bucket_start: null,
      category_id: 7,
      category_name: "Jedzenie",
      category_color: "slate",
      category_icon: "tag",
      total: 70,
    },
    {
      bucket_start: null,
      category_id: 9,
      category_name: "Transport",
      category_color: "slate",
      category_icon: "car",
      total: 40,
    },
    {
      bucket_start: null,
      category_id: null,
      category_name: null,
      category_color: null,
      category_icon: null,
      total: 110,
    },
  ];

  it("reports one expense total for one population, on both boards", async () => {
    const input = query("2026-08-01", "2026-08-03");
    const boardA = createSupabaseFake([
      { data: BOARD_A_ROWS, error: null },
      { data: [], error: null },
    ]);
    const boardB = createSupabaseFake([{ data: BOARD_B_ROWS, error: null }]);

    const summary = await getEntriesSummary(boardA.client as unknown as ServiceClient, input);
    const categorySummary = await getCategorySummary(boardB.client as unknown as ServiceClient, input);

    expect(summary.current.totals.expense).toBe(EXPENSE_TOTAL);
    expect(categorySummary.total).toBe(EXPENSE_TOTAL);
    expect(summary.current.totals.expense).toBe(categorySummary.total);

    // And the parts add up to the whole on Board B's side, which is what every
    // percentage on that board divides by.
    const summed = categorySummary.categories.reduce((running, category) => running + category.total, 0);
    expect(summed).toBe(EXPENSE_TOTAL);

    // Board A carries the income the expense-only board must not see.
    expect(summary.current.totals.income).toBe(1000);
  });

  it("agrees bucket by bucket about where the expenses fell", async () => {
    const input = query("2026-08-01", "2026-08-03");
    const boardA = createSupabaseFake([
      { data: BOARD_A_ROWS, error: null },
      { data: [], error: null },
    ]);
    const boardB = createSupabaseFake([{ data: BOARD_B_ROWS, error: null }]);

    const summary = await getEntriesSummary(boardA.client as unknown as ServiceClient, input);
    const categorySummary = await getCategorySummary(boardB.client as unknown as ServiceClient, input);

    // Board A's per-bucket expense, hand-read off the population table above.
    expect(summary.current.points.map((point) => [point.bucketStart, point.expense])).toStrictEqual([
      ["2026-08-01", 50],
      ["2026-08-02", 25],
      ["2026-08-03", 35],
    ]);

    // Board B's stacked cells summed per bucket must land on the same three
    // figures — a stacked column whose height disagreed with the line chart
    // beside it is risk #2 rendered twice.
    const perBucket = categorySummary.points.map((point) => [
      point.bucketStart,
      Object.values(point.totals).reduce((running, amount) => running + amount, 0),
    ]);
    expect(perBucket).toStrictEqual([
      ["2026-08-01", 50],
      ["2026-08-02", 25],
      ["2026-08-03", 35],
    ]);
  });
});

// --- The min-date probe "Cały okres" resolves against ---

describe("getFirstEntryDate", () => {
  it("issues exactly the ordered limit-1 read, with all three filters absent", async () => {
    const fake = createSupabaseFake([{ data: [{ occurred_on: "2019-03-04" }], error: null }]);

    const result = await getFirstEntryDate(fake.client as unknown as ServiceClient);

    expect(result).toBe("2019-03-04");
    // THE ABSENCES ARE THE POINT (`reports.ts:235-247`). No `eq("user_id", …)`,
    // because RLS supplies the predicate and a hand-written copy would be a
    // second place for the isolation guarantee to drift. No
    // `is("deleted_at", null)` on the joined category, because both summary
    // functions deliberately count entries filed under soft-deleted categories
    // and a start date that disagreed would sit AFTER the earliest bar they
    // plot. No recurring filter, so toggling FR-015 never moves the X-axis —
    // re-scaling, and possibly re-bucketing, the chart under a control that is
    // supposed to change the bars. `toStrictEqual` on the whole call list is
    // what makes each of those an assertion rather than an omission.
    expect(fake.calls).toStrictEqual([
      { method: "from", args: ["entries"] },
      { method: "select", args: ["occurred_on"] },
      { method: "order", args: ["occurred_on", { ascending: true }] },
      { method: "limit", args: [1] },
    ]);
  });

  it("returns null for a user with no entries", async () => {
    const fake = createSupabaseFake([{ data: [], error: null }]);

    await expect(getFirstEntryDate(fake.client as unknown as ServiceClient)).resolves.toBeNull();
  });

  it("rethrows a failure rather than reporting no history", async () => {
    // A swallowed error here would read as "this user has no entries", and
    // "Cały okres" would silently resolve to the fallback window instead of the
    // user's real history.
    const failure = new Error("PostgREST: statement timeout");
    const fake = createSupabaseFake([{ data: null, error: failure }]);

    await expect(getFirstEntryDate(fake.client as unknown as ServiceClient)).rejects.toBe(failure);
  });
});

// --- Errors reach the caller unchanged ---

describe("error propagation", () => {
  // A PostgREST failure degraded into an empty aggregate renders as a page full
  // of zeros — a plausible number derived from no result set at all, which is
  // risk #2's worst shape. Each of the three RPC paths is checked separately
  // because each has its own `if (…error) throw` and a refactor can drop one.
  const failure = new Error("PostgREST: connection reset");

  it("rethrows a failure on the current range", async () => {
    const fake = createSupabaseFake([
      { data: null, error: failure },
      { data: [], error: null },
    ]);

    await expect(
      getEntriesSummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03")),
    ).rejects.toBe(failure);
  });

  it("rethrows a failure on the previous range", async () => {
    // The previous range feeds only the KPI deltas, so a swallowed failure here
    // would show a delta computed against zero — "spending doubled" on a
    // transport error.
    const fake = createSupabaseFake([
      { data: [], error: null },
      { data: null, error: failure },
    ]);

    await expect(
      getEntriesSummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03")),
    ).rejects.toBe(failure);
  });

  it("rethrows a failure on the category range", async () => {
    const fake = createSupabaseFake([{ data: null, error: failure }]);

    await expect(
      getCategorySummary(fake.client as unknown as ServiceClient, query("2026-08-01", "2026-08-03")),
    ).rejects.toBe(failure);
  });
});
