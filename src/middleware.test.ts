import { describe, expect, it, vi } from "vitest";

import { createRouteClient, USER_A, type Identity } from "@/lib/services/__fixtures__/route-context";
import type { createClient } from "@/lib/supabase";

// The SECOND, independent path to the per-user isolation guarantee failing:
// an authenticated response cached at Cloudflare's edge and served to someone
// else. RLS guards the database and says nothing about a rendered SSR page or
// an API payload sitting in a shared cache. Risk #3 in
// `context/foundation/test-plan.md` §2; `CLAUDE.md` names it a hard rule.
//
// The whole mechanism is ONE line — `src/middleware.ts:48-50`. These five cases
// exist to make weakening that line go red.
//
// WHAT THIS FILE DOES NOT PROVE. It does not prove Cloudflare honours the
// header, and it does not prove any particular page reaches this middleware. It
// proves what the middleware attaches to a response it is handed, which is the
// only part of the chain this repo owns.
//
// Oracles, all external to this code:
//
// 1. `CLAUDE.md`'s hard rule, for the exact header value.
// 2. `src/pages/index.astro:2-3`, for the fact that `GET /` picks its Location
//    from `locals.user` and is therefore auth-varying.
// 3. `supabase/seed.sql`, via `__fixtures__/route-context`, for the identity.

// WHY `astro:middleware` CAN BE MOCKED HERE AT ALL, and why this needed no
// config change. `vitest.config.ts` cannot RESOLVE `astro:*` — but Vitest 4's
// mock registry intercepts the specifier before Vite's resolver is consulted,
// so a `vi.mock` with a factory supplied never reaches resolution. That makes
// `src/middleware.ts` unit-testable as it stands, correcting the clause in
// `test-plan.md` §6.1 that says a resolvable specifier is required.
//
// `defineMiddleware` is a pure identity helper at runtime — it exists only to
// supply types — so replacing it with `(fn) => fn` changes nothing about what
// runs. The subject under test is still the real `onRequest` body.
vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

// The `vi.mock` factory is hoisted above every import, so it must not close
// over a binding initialised later: module-scope mutable holder, then a dynamic
// `import()` AFTER it.
type MaybeClient = ReturnType<typeof createClient>;
const holder: { client: MaybeClient } = { client: null };

vi.mock("@/lib/supabase", () => ({
  createClient: () => holder.client,
}));

const { onRequest } = await import("./middleware");

/**
 * The slice of `APIContext` the middleware actually reads, plus the `next` it
 * is handed.
 *
 * Bridged at the call site rather than in a fixture: `defineMiddleware`'s
 * declared return type is a union that may resolve to `void`, which is true of
 * middleware in general and false of this one — it returns a `Response` on
 * every branch. The cast states that, in one place, with this comment beside
 * it.
 */
interface MiddlewareContext {
  request: Request;
  cookies: Record<string, never>;
  url: URL;
  locals: { user: unknown };
  redirect: (path: string, status?: number) => Response;
}
type Middleware = (context: MiddlewareContext, next: () => Promise<Response>) => Promise<Response>;
const handle = onRequest as unknown as Middleware;

/**
 * A redirect built the way Astro's `context.redirect` builds one.
 *
 * The constructor form on purpose. The STATIC `Response.redirect()` returns a
 * response whose headers carry an immutable guard, and `headers.set()` throws
 * on it — so a test using the static form would fail for a reason that has
 * nothing to do with caching. There is no `Response.redirect` anywhere in
 * `src/` today; every redirect goes through `context.redirect` /
 * `Astro.redirect`, which yield mutable responses. Do not add one.
 */
function redirectResponse(path: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: path } });
}

function contextFor(pathname: string, user: Identity | null): MiddlewareContext {
  const url = new URL(`https://papertrail.test${pathname}`);
  // `[]` — no `from`, no `rpc`. The middleware touches `auth.getUser` and
  // nothing else on the client.
  holder.client = createRouteClient([], [], user).client;
  return {
    request: new Request(url),
    cookies: {},
    url,
    locals: { user: null },
    redirect: (target, status) => redirectResponse(target, status),
  };
}

describe("Cache-Control on authenticated responses", () => {
  it("sets `private, no-store` on an /api/** response when the caller is signed in", async () => {
    // THE PATH IS NOT WHAT EARNS THE HEADER HERE. `PROTECTED_ROUTES` is
    // `["/dashboard", "/reports"]` and prefix-matches neither
    // `/api/entries/summary` nor `/api/categories/42`, so `isProtected` is
    // false for the entire `/api/**` surface. The header comes solely from the
    // `context.locals.user` disjunct.
    const next = vi.fn(() => Promise.resolve(new Response('{"total":0}', { status: 200 })));

    const response = await handle(contextFor("/api/entries/summary", USER_A), next);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("leaves an /api/** response header-free when the caller is anonymous", async () => {
    // THE LOAD-BEARING CASE. It is the executable statement of the risk:
    // coverage of the whole `/api/**` surface rests on `locals.user`, never on
    // the path. Weaken that disjunct and the case above goes red; widen
    // `PROTECTED_ROUTES` to include `/api` and THIS one goes red instead —
    // because an anonymous API request would then be answered with a 302 to
    // `/auth/signin` rather than reaching the route's own 401 self-guard
    // (`src/middleware.ts:4-6` says so in its own words).
    //
    // An anonymous API response carries no user data, so the absent header is
    // correct, not a gap. What must not change silently is WHICH condition is
    // doing the work.
    const next = vi.fn(() => Promise.resolve(new Response('{"error":"Nieautoryzowany"}', { status: 401 })));

    const response = await handle(contextFor("/api/entries/summary", null), next);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  it("sets `private, no-store` on the anonymous /dashboard redirect", async () => {
    // Both disjuncts fire here, and the response is a redirect the middleware
    // built itself — `next()` is never reached, so the header has to be
    // attached after the branch rather than inside it.
    const next = vi.fn(() => Promise.resolve(new Response("unreachable", { status: 200 })));

    const response = await handle(contextFor("/dashboard", null), next);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(next).not.toHaveBeenCalled();
  });

  it("REPLACES an existing Cache-Control on a signed-in /dashboard render", async () => {
    // `.set()` semantics, pinned deliberately. Swapping it for `.append()`
    // would leave `public, max-age=3600, private, no-store` — a duplicated
    // directive whose first half invites exactly the edge caching the whole
    // mechanism exists to prevent, and which `headers.get()` returns
    // comma-joined, so `toBe` catches it.
    //
    // No response in `src/` carries a `Cache-Control` today — every API route
    // is built as `new Response(body, { status })` with no `headers` key at
    // all, and the pages set none. That is precisely why this is worth pinning:
    // the append/set distinction is invisible until the day something upstream
    // sets one, and by then it is a silent leak rather than a test failure.
    const next = vi.fn(() =>
      Promise.resolve(
        new Response("<html></html>", { status: 200, headers: { "Cache-Control": "public, max-age=3600" } }),
      ),
    );

    const response = await handle(contextFor("/dashboard", USER_A), next);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sets `private, no-store` on the anonymous `GET /` redirect", async () => {
    // `/` is neither protected nor signed in, so NEITHER disjunct fires — yet
    // `src/pages/index.astro:2-3` picks its Location out of `locals.user`. That
    // makes it an auth-varying response with a cacheable status and, before the
    // change this test drove, no guard at all.
    //
    // No body and no PII, so it is not a leak of data. It is a leak of the
    // ROUTING decision: an edge that cached `/ → /auth/signin` would keep
    // bouncing a signed-in visitor to the sign-in page. And it contradicted the
    // comment directly above the code, which already claimed coverage of "the
    // auth-dependent redirect that gates one".
    //
    // The redirect comes from the PAGE, not from the middleware, so it arrives
    // through `next()` — which is why neither the `isProtected` branch nor the
    // `retiredTarget` branch could ever have covered it.
    const next = vi.fn(() => Promise.resolve(redirectResponse("/auth/signin")));

    const response = await handle(contextFor("/", null), next);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
