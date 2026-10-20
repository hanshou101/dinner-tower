import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 90_000,
    // Each file spawns its own real server process; run them one at a time.
    fileParallelism: false,
  },
});
