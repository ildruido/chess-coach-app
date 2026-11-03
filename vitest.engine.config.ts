import { defineConfig } from "vitest/config";

// Engine checks of bundled data (slow; `npm run verify:puzzles`, and the
// "Puzzles verify" workflow when the puzzle file changes).
export default defineConfig({
  test: {
    include: ["tests/engine/**/*.engine.test.ts"],
    environment: "node",
    testTimeout: 30 * 60 * 1000,
  },
});
