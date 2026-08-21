import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone config — deliberately NOT routed through astro/config's
// getViteConfig. `src/lib/text.ts` imports nothing, so the runner can be proven
// before the `astro:env/server` resolution question is answered; letting that
// question gate the bootstrap is how a harness problem gets mistaken for a code
// problem. Consequence to remember when component tests arrive: a standalone
// config inherits NONE of astro.config.mjs's Vite settings, including the
// `resolve.dedupe: ["react", "react-dom"]` fix documented there as preventing a
// real hydration crash.
export default defineConfig({
  resolve: {
    // Vite does not read tsconfig `paths`. Mirrors tsconfig.json's
    // `"@/*": ["./src/*"]`; the first test's own `@/lib/text` import is what
    // proves it resolves.
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
