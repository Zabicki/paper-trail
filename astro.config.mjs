// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  // Required by @astrojs/sitemap, which silently emits nothing without it.
  // Update if a custom domain replaces the workers.dev URL.
  site: "https://paper-trail.paper-trail.workers.dev",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Without this, Vite's dep pre-bundling can produce two separate module
    // instances of react-dom (the root export used by useFormStatus/useFormState
    // vs. react-dom/client used internally for hydration), each with its own
    // ReactSharedInternals singleton. The render loop sets the hook dispatcher
    // on one copy; useFormStatus reads it from the other, unset, copy — which
    // throws "Cannot read properties of null (reading 'useHostTransitionStatus')"
    // and crashes hydration for any component that calls useFormStatus.
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
  // The Cloudflare Images binding (env.IMAGES) is KEPT DELIBERATELY.
  // Adapter v13 defaults imageService to "cloudflare-binding" and auto-provisions
  // it; we adopt that on purpose because `sharp` and other native modules cannot
  // run on workerd, and IMAGES is the workerd-native way to downscale receipt
  // photos before the LLM call. Free cap: 5,000 transforms/month (error 9422 past it).
  // To opt out instead:
  //   cloudflare({ imageService: { build: "compile", runtime: "passthrough" } })
  // See context/deployment/deploy-plan.md, Phase 2c.
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
