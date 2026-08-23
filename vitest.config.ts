import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    // apps/mobile runs its own jest suite (RN preset) — don't double-run here.
    exclude: ["**/node_modules/**", "apps/mobile/**"],
    environment: "node",
  },
});
