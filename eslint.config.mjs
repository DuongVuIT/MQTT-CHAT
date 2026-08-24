// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.config.mjs",
      "**/vitest.config.ts",
      "**/next-env.d.ts",
      // E2E harness scripts run via tsx outside any tsconfig project.
      "scripts/**/*.mts",
      // React Native tooling configs are CommonJS by framework convention.
      "apps/mobile/metro.config.js",
      "apps/mobile/babel.config.js",
      "apps/mobile/jest.config.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Async results are handled via await / void explicitly; allow floating in event handlers
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Numbers in template literals are safe and idiomatic for logging/ids.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],
      // Void-returning arrow shorthands are idiomatic in event handlers / zustand set().
      "@typescript-eslint/no-confusing-void-expression": "off",
      // Unknown-typed values are stringified intentionally in logs after validation.
      "@typescript-eslint/no-base-to-string": "off",
      // Spreading HeadersInit/URLSearchParamsInit arrays is valid JS.
      "@typescript-eslint/no-misused-spread": "off",
      // Produces false positives with Zod-inferred defaults (values typed non-nullable at compile time).
      "@typescript-eslint/no-unnecessary-condition": "off",
      // NestJS module classes are intentionally empty (declarative modules).
      "@typescript-eslint/no-extraneous-class": "off",
      // Provider implementations may be async for interface compatibility without awaiting.
      "@typescript-eslint/require-await": "off",
      // Cross-package source imports resolve as `any` in the type-aware linter
      // (workspace packages are consumed from src without project references),
      // which makes every value look "unsafe". Typecheck covers this properly.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // One-off ops scripts are CommonJS by design.
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    rules: {
      // RN preset enforces its own import style; keep parity with the web app.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
