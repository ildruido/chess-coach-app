import { defineConfig, devices } from "@playwright/test";

// e2e runs against the web page built without sign-in or server (`vite build --mode e2e`, on
// :4176): the specs fake `window.claude`. The "web" project runs against the real server.
const TEST = "http://localhost:4176";
/** Specs under e2e/web/ run only in the "web" project, against the real server. */
const WEB_TESTS = /[\\/]web[\\/].*\.spec\.ts$/;
const WEB = "http://localhost:4175";
/**
 * The phone run covers what a phone changes: layout and touch moves on the boards. Everything
 * else behaves the same at any screen size, so it runs on desktop only (Ale approved, 2026-10-09).
 */
const PHONE =
  /(^|[\\/])(layout|a11y|practice-board|practice|lessons|lesson-list|tactics-lessons|opening-mate-lessons|play-out)\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  // Each test fails after 30 s (the default) and names itself. In CI a shard stops after 6 minutes
  // and lists what didn't run, well inside the job limit.
  ...(process.env.CI && { globalTimeout: 6 * 60_000 }),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "on-first-retry",
    // Cloud sessions ship a Chromium that may not match this Playwright version.
    ...(process.env.PW_CHROMIUM && { launchOptions: { executablePath: process.env.PW_CHROMIUM } }),
  },
  projects: [
    {
      name: "desktop",
      testIgnore: WEB_TESTS,
      use: { ...devices["Desktop Chrome"], baseURL: TEST },
    },
    {
      name: "phone",
      testMatch: PHONE,
      testIgnore: WEB_TESTS,
      use: { ...devices["Pixel 7"], baseURL: TEST },
    },
    {
      name: "web",
      testMatch: WEB_TESTS,
      // One database and one server: the specs share them and run one after another.
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], baseURL: WEB },
    },
  ],
  webServer: [
    // SKIP_WEB_SERVER=1 leaves out the "web" project's server, so a single non-web spec runs without Postgres.
    ...(process.env.SKIP_WEB_SERVER
      ? []
      : [
          {
            // The real server and database with a scripted AI (server/e2e/server.ts); needs Postgres
            // (DATABASE_URL, default postgres://postgres:test@localhost:5432/postgres) and a web build.
            command: "npx tsx e2e/server.ts",
            cwd: "server",
            url: `${WEB}/api/health`,
            env: { PORT: "4175", WEB_DIR: "../dist-web" },
            reuseExistingServer: false,
          },
        ]),
    { command: "npm run preview:e2e", url: TEST, reuseExistingServer: !process.env.CI },
  ],
});
