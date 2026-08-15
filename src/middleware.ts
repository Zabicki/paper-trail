import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/categories"];

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

  const isProtected = PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route));

  // Never let Cloudflare's edge cache a response rendered for a specific user, or
  // the auth-dependent redirect that gates one. RLS guards the database; it does
  // nothing about a rendered SSR page cached at the edge and served to someone
  // else. That is a second, independent path to the same per-user isolation
  // guarantee failing, and it fails silently.
  const response = isProtected && !context.locals.user ? context.redirect("/auth/signin") : await next();

  if (isProtected || context.locals.user) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
});
