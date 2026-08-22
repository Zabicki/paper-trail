/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

// Playwright hands the test body to a fixture callback conventionally named
// `use` (tests/e2e/fixtures.ts). react-hooks reads that as React's `use` hook
// being called outside a component and errors. Renaming the parameter would
// silence it, but tests/e2e/seed.spec.ts and fixtures.ts are the exemplars every
// generated spec is copied from, so they have to show the idiomatic Playwright
// shape. There is no React in tests/ — it drives a real browser — so the rule
// has nothing to protect here.
const e2eConfig = tseslint.config({
  files: ["tests/**/*.ts"],
  rules: {
    "react-hooks/rules-of-hooks": "off",
  },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
    // astro-eslint-parser's synthetic wrapper around frontmatter gives a
    // top-level `return` statement no real enclosing function node, which
    // crashes no-misused-promises's return-statement check (a parser/rule
    // incompatibility, not a real violation) whenever frontmatter does
    // `return Astro.redirect(...)`.
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
  },
});

// includeIgnoreFile reads the ROOT .gitignore only, and supabase/.temp is
// ignored by the nested supabase/.gitignore instead. `supabase start` writes a
// TypeScript edge-runtime shim in there that is outside tsconfig's project, so
// projectService fails it with a parsing error — turning `npm run lint` red for
// anyone who has the local stack running. Not our code; not lintable.
const generatedIgnores = { ignores: ["supabase/.temp/**"] };

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  generatedIgnores,
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  e2eConfig,
  eslintPluginPrettier,
);
