// A recording stand-in for the Supabase client, for service-layer tests.
//
// The point is what a service HANDS to PostgREST, not only what it returns. A
// test that asserts the return value proves the mapping; only a test that
// asserts the recorded `upsert` argument proves the row array — the `batch_seq`
// assignment, the shared `occurred_on`, the conflict options that make a replay
// idempotent. Those are invisible in the return value, and they are exactly the
// fields a refactor can change without a single existing check going red.
//
// NOT named `*.test.ts` on purpose: `vitest.config.ts`'s only discovery glob is
// `src/**/*.test.ts`, so a helper with that suffix would be collected as a suite
// and fail the run with "No test found". `__fixtures__/` also keeps it clear of
// the co-located `<module>.test.ts` convention that marks a real suite.
//
// RESPONSES ARE QUEUED IN CALL ORDER, NOT KEYED BY TABLE. This is the one thing
// a reader gets wrong. A service that makes several round trips consumes one
// queued response per `await`, in the order the awaits execute — for
// `createEntriesBatch` that is:
//
//   1. the category check   from("categories").select(…).in(…).is(…)
//   2. the batch write      from("entries").upsert(rows, opts).select(…)
//   3. the re-select        from("entries").select(…).eq(…).order(…)
//                           — ONLY when the upsert returns fewer rows than it
//                             was given, i.e. on a replay
//
// So a happy-path test queues two responses and a replay test queues three.
// Queue too few and the fake throws naming how many calls it had recorded;
// queue too many and the surplus is simply never read.

/** One canned PostgREST result. */
export interface FakeResponse {
  // Deliberately `unknown` rather than a row type: the real client is untyped,
  // and the services under test do their own `as unknown as EntryRow[]`
  // narrowing. Typing it here would let a test hand over a shape the service
  // could never receive, and would drag `any` into the fixture to get there.
  data: unknown;
  error: unknown;
}

/** One builder method call, in the order it was made. */
export interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * The chainable query builder. Every method returns the same object, so the
 * chain's shape is irrelevant and only the recorded call list matters.
 *
 * `then` is what makes it awaitable: awaiting anywhere in the chain resolves
 * the next queued response.
 */
export interface QueryFake {
  from: (...args: unknown[]) => QueryFake;
  select: (...args: unknown[]) => QueryFake;
  in: (...args: unknown[]) => QueryFake;
  is: (...args: unknown[]) => QueryFake;
  eq: (...args: unknown[]) => QueryFake;
  order: (...args: unknown[]) => QueryFake;
  upsert: (...args: unknown[]) => QueryFake;
  insert: (...args: unknown[]) => QueryFake;
  update: (...args: unknown[]) => QueryFake;
  delete: (...args: unknown[]) => QueryFake;
  maybeSingle: (...args: unknown[]) => QueryFake;
  single: (...args: unknown[]) => QueryFake;
  then: (onFulfilled: (value: FakeResponse) => unknown) => Promise<unknown>;
}

export interface SupabaseFake {
  /** Bridge to a service's `SupabaseClient` parameter with `as unknown as` at the call site. */
  client: QueryFake;
  /** Every builder call made so far, in order. */
  calls: RecordedCall[];
}

/**
 * A client stand-in that records every builder call and resolves each `await`
 * to the next queued response.
 *
 * @param responses Canned results, in the order the service will await them.
 */
export function createSupabaseFake(responses: FakeResponse[]): SupabaseFake {
  const calls: RecordedCall[] = [];
  const queue = [...responses];

  function nextResponse(): FakeResponse {
    const response = queue.shift();
    if (response === undefined) {
      // The failure a reader hits first, so it names the cause rather than
      // surfacing later as "cannot destructure data of undefined" inside the
      // service. The recorded methods say how far the service got.
      throw new Error(
        `supabase-fake ran out of queued responses after ${String(calls.length)} builder call(s): ` +
          calls.map((call) => call.method).join(" → "),
      );
    }
    return response;
  }

  function record(method: string, args: unknown[]): QueryFake {
    calls.push({ method, args });
    return client;
  }

  // Written out rather than generated from a name list: an index-signature
  // object would need a cast to satisfy QueryFake, and the whole file exists to
  // stay free of `any`.
  const client: QueryFake = {
    from: (...args) => record("from", args),
    select: (...args) => record("select", args),
    in: (...args) => record("in", args),
    is: (...args) => record("is", args),
    eq: (...args) => record("eq", args),
    order: (...args) => record("order", args),
    upsert: (...args) => record("upsert", args),
    insert: (...args) => record("insert", args),
    update: (...args) => record("update", args),
    delete: (...args) => record("delete", args),
    maybeSingle: (...args) => record("maybeSingle", args),
    single: (...args) => record("single", args),
    // Resolved lazily: nextResponse() runs when the chain is awaited, not when
    // it is built, which is what keeps the queue in await order.
    then: (onFulfilled) => Promise.resolve(nextResponse()).then(onFulfilled),
  };

  return { client, calls };
}
