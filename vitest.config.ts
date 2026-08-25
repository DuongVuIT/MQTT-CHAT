import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./apps/web/src", import.meta.url).pathname,
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    // apps/mobile runs its own jest suite (RN preset) — don't double-run here.
    exclude: ["**/node_modules/**", "apps/mobile/**"],
    environment: "node",
  },
});
