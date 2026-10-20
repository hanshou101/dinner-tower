import { defineConfig } from "vitest/config";

// Unit tests cover the pure parts of the board: 12-hour formatting, status
// badges, station text and the timeline lane maths. The DOM is exercised by
// the Playwright suite in test/e2e.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
