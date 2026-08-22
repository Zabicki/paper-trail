// Shared construction for API-route tests: one identity-parameterised client
// and one route context that can carry `params`.
//
// Route tests need two things that `supabase-fake.ts` deliberately does not
// supply, because they belong to the ROUTE boundary rather than to the service
// boundary: an `auth.getUser` surface (every route checks it before it touches
// a service) and an Astro-shaped context object. Three files hand-rolled the
// first identically and none had the second, which is what blocked every
// `A requests B's id` test — `src/pages/api/entries/[id].ts:21` and
// `src/pages/api/categories/[id].ts:20` both read `context.params.id`.
//
// NOT named `*.test.ts` on purpose: `vitest.config.ts`'s only discovery glob is
// `src/**/*.test.ts`, so a helper with that suffix would be collected as a
// suite and fail the run with "No test found" (`test-plan.md` §6.2).
//
// THE TWO IDENTITIES ARE THE pgTAP SEED USERS. `USER_A` and `USER_B` are copied
// character for character from `supabase/seed.sql`, so the JS and pgTAP layers
// name the same two actors and a reader moving between
// `supabase/tests/entries_rls_test.sql` and a route test does not have to hold
// two sets of uuids in their head.
//
// WHAT THE IDENTITY DOES NOT DO, AND THIS IS THE IMPORTANT PART. The Supabase
// fake has no caller identity and no row store — it resolves queued responses
// in call order, whoever is asking. So passing `USER_B` instead of `USER_A`
// changes NOTHING about what the client returns. It documents which actor a
// test is speaking as; it does not enforce it. The consequence for every
// ownership test built on this file: the honest claim is *given a client that
// returns nothing for B's id, A gets a refusal whose body does not confirm B's
// row exists* — never *RLS returned nothing*. Proving RLS is pgTAP's job and is
// already done (`supabase/tests/*_rls_test.sql`).
//
// WHERE THE `as unknown as` BRIDGES SIT. Two of them, split on purpose:
//
//   - The CLIENT bridge lives here. It is the same cast all three route tests
//     already made inside their own local helper, and collapsing those four
//     copies into one is this file's reason to exist.
//   - The CONTEXT bridge stays at the CALL SITE (`test-plan.md` §6.2), because
//     the target type is `Parameters<typeof GET>[0]` — derived per route, and
//     therefore not knowable here. `routeContext()` returns a plain structural
//     object and each test casts it.

import type { createClient } from "@/lib/supabase";

import { createSupabaseFake, type FakeResponse, type QueryFake, type RecordedCall } from "./supabase-fake";

/** The signed-in user shape, as narrow as the routes actually read it. */
export interface Identity {
  id: string;
}

/** Seed user A — `supabase/seed.sql`, `rls-test-user-a@example.com`. */
export const USER_A: Identity = { id: "11111111-1111-1111-1111-111111111111" };

/** Seed user B — `supabase/seed.sql`, `rls-test-user-b@example.com`. */
export const USER_B: Identity = { id: "22222222-2222-2222-2222-222222222222" };

/** What `createClient` hands back once its null branch is ruled out. */
export type RouteClient = NonNullable<ReturnType<typeof createClient>>;

/**
 * Which of the fake's entry points a given route's service actually calls.
 *
 * Carried across SELECTIVELY rather than by spreading the fake, because the
 * fake's `then` would come with it and make the client itself thenable — the
 * trap `summary.test.ts` documented when it first hit it. `from` covers the
 * table services; `rpc` covers the two aggregates.
 */
export type ClientMethod = "from" | "rpc";

/** The structural client a route sees: the selected methods, plus `auth`. */
interface RouteClientShape {
  auth: { getUser: () => Promise<{ data: { user: Identity | null } }> };
  from?: QueryFake["from"];
  rpc?: QueryFake["rpc"];
}

export interface RouteClientFake {
  /** Bridged to the route's client type; hand it straight to the `vi.mock` holder. */
  client: RouteClient;
  /** Every builder call the route caused, in order. */
  calls: RecordedCall[];
}

/**
 * A recording client for one route, speaking as one identity.
 *
 * @param methods Which fake methods to expose — see {@link ClientMethod}.
 * @param responses Canned results, in the order the service will await them.
 * @param user The caller, or `null` for anonymous.
 */
export function createRouteClient(
  methods: readonly ClientMethod[],
  responses: FakeResponse[],
  user: Identity | null,
): RouteClientFake {
  const fake = createSupabaseFake(responses);

  // `auth.getUser` is PARTIAL ON PURPOSE. The real one also resolves an
  // `error`, which no route reads — every one of them destructures
  // `{ data: { user } }` and branches on `user` alone. Widening this to match
  // the real shape would assert a contract nothing depends on.
  const client: RouteClientShape = {
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
  };

  // Written out rather than looped over the union: assigning through a computed
  // key of a union type needs a cast, and this file exists to keep casts down
  // to the one deliberate bridge below.
  if (methods.includes("from")) {
    client.from = fake.client.from;
  }
  if (methods.includes("rpc")) {
    client.rpc = fake.client.rpc;
  }

  return { client: client as unknown as RouteClient, calls: fake.calls };
}

export interface RouteContextOptions {
  /** Absolute URL, including any query string. */
  url: string;
  /** Defaults to `GET`. */
  method?: string;
  /** Serialised as JSON with a matching `Content-Type`. Omit for no body. */
  body?: unknown;
  /** Astro's dynamic-segment map — `{ id: "42" }` for `/api/entries/[id]`. */
  params?: Record<string, string | undefined>;
}

/**
 * The slice of `APIContext` the routes actually read.
 *
 * `cookies` is present but empty: the routes only forward it to `createClient`,
 * which is mocked in every one of these tests. A full `APIContext` would be
 * several hundred lines of Astro internals for no added signal.
 */
export interface RouteContextShape {
  request: Request;
  cookies: Record<string, never>;
  url: URL;
  params: Record<string, string | undefined>;
}

/**
 * Build the context a route handler is called with.
 *
 * Bridge it to the handler's own parameter type at the call site:
 * `routeContext({ … }) as unknown as Parameters<typeof PATCH>[0]`.
 */
export function routeContext(options: RouteContextOptions): RouteContextShape {
  const url = new URL(options.url);
  const hasBody = options.body !== undefined;
  const request = new Request(url, {
    method: options.method ?? "GET",
    ...(hasBody ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) } : {}),
  });

  return { request, cookies: {}, url, params: options.params ?? {} };
}
