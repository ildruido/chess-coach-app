import type pg from "pg";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import type { CoachUpstream } from "./coach/upstream.js";
import type { Config } from "./config.js";

/** The whole server for one config. The e2e server calls this with a scripted upstream. */
export function buildApp(
  pool: pg.Pool,
  config: Config,
  upstream: CoachUpstream | null,
  webDir?: string,
) {
  const auth = createAuth(pool, {
    secureCookie: config.secureCookie,
    trustProxy: config.trustProxy,
  });
  return createApp({
    pool,
    version: config.version,
    // A real session wins; the test user only fills in when AUTH_TEST_USER_ID is set.
    resolveUser: async (c) => (await auth.resolveUser(c)) ?? config.testUserId,
    authRoutes: auth.routes,
    coach: {
      pool,
      upstream,
      models: config.models,
      defaultAllowance: config.defaultMonthlyAllowance,
    },
    webDir,
    https: config.secureCookie,
  });
}
