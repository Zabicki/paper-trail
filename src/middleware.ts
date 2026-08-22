import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

// Prefix-matched. Covers pages only — API routes self-guard with their own
// getUser() check, so /api/entries/summary is deliberately absent here.
const PROTECTED_ROUTES = ["/dashboard", "/reports"];

// /categories was retired — category management is a dialog on the dashboard
// now. Kept as a 302 so old bookmarks land somewhere useful; a 301 would be
// cached by browsers indefinitely and make the path unrecoverable if it is ever
// reused.
const RETIRED_ROUTES: Record<string, string> = {
  "/categories": "/dashboard",
};

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const retiredTarget = RETIRED_ROUTES[context.url.pathname];
  const isProtected = PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route));

  // Never let Cloudflare's edge cache a response rendered for a specific user, or
  // any redirect — because a redirect's Location can itself be the auth
  // decision. RLS guards the database; it does nothing about a rendered SSR page
  // cached at the edge and served to someone else. That is a second,
  // independent path to the same per-user isolation guarantee failing, and it
  // fails silently. Pinned by `src/middleware.test.ts`.
  let response: Response;
  if (retiredTarget) {
    // Ahead of the auth guard on purpose: were the guard first, an
    // unauthenticated hit on /categories would go to /auth/signin and never
    // reach this. This way it chains — /categories → /dashboard → /auth/signin.
    response = context.redirect(retiredTarget, 302);
  } else if (isProtected && !context.locals.user) {
    response = context.redirect("/auth/signin");
  } else {
    response = await next();
  }

  // The third disjunct covers the case neither of the first two reach: `GET /`
  // for an anonymous visitor. It is not protected and has no user, yet
  // `src/pages/index.astro` picks its Location out of `locals.user` — an
  // auth-varying response with a cacheable status. The redirect is produced by
  // the PAGE and arrives through next(), so no branch above sees it; keying on
  // the status is what catches it wherever it was built. Redirects that do not
  // vary by auth (`/categories` → `/dashboard`) pick the header up too, which
  // costs nothing on a bodyless 302 and keeps the rule stateable in one line.
  //
  // `.set()`, not `.append()`: a second directive would not replace a cacheable
  // first one. And after next(), not before — the response does not exist yet.
  const isRedirect = response.status >= 300 && response.status < 400;

  if (isProtected || context.locals.user || isRedirect) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
});
