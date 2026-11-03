import { defineConfig } from "vitest/config";

// Engine-vs-engine level calibration (slow; not part of npm test or CI).
export default defineConfig({
  test: {
    include: ["tests/calibration/**/*.calib.ts"],
    environment: "node",
    // Each pairing runs in its own engine process, in parallel.
    fileParallelism: false,
    sequence: { concurrent: true },
  },
});
