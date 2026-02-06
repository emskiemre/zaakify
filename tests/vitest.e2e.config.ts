import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    globals: true,
    restoreMocks: true,
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 2 },
    },
  },
});
