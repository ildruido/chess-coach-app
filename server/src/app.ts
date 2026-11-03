import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type pg from "pg";
import { deleteDoc, getDoc, putDoc } from "./db.js";
import { PathError, canAccess, collectionPath, docPath } from "./paths.js";
import { coachRoutes, type CoachDeps } from "./coach/routes.js";
import { QueryError, buildQuery, type QueryRequest } from "./query.js";
import { rateLimit, securityHeaders, staticSite } from "./web.js";

/** Who is calling? Sign-in (CC-043c) replaces the test resolver; null means not signed in. */
export type UserResolver = (c: Context) => string | null | Promise<string | null>;

export interface AppDeps {
  pool: pg.Pool;
  version: string;
  resolveUser: UserResolver;
  /** Sign-in routes, mounted at /api/auth. */
  authRoutes?: Hono;
  /** Coach endpoint (CC-043d); left out, /api/coach is not mounted and answers like any unknown route (400 invalid_argument). */
  coach?: CoachDeps;
  /** The built web app (`dist-web`); left out, the server answers the API only. */
  webDir?: string;
  /** Behind HTTPS: adds the Strict-Transport-Security header. */
  https?: boolean;
}

const MAX_BODY = 64 * 1024;

function fail(
  c: Context,
  status: 400 | 401 | 403 | 413 | 429 | 500 | 501 | 503,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}

/** Per signed-in person, per minute. Generous: a game saves a few times a minute. */
const DB_REQUESTS_PER_MINUTE = 600;

export function createApp({
  pool,
  version,
  resolveUser,
  authRoutes,
  coach,
  webDir,
  https = false,
}: AppDeps): Hono {
  const app = new Hono();
  app.use("*", securityHeaders({ https }));

  app.get("/api/health", async (c) => {
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000).unref()),
      ]);
      return c.json({ ok: true, version });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  const db = new Hono<{ Variables: { userId: string } }>();
  db.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY,
      onError: (c) => fail(c, 413, "invalid_argument", "request too large"),
    }),
  );
  db.use("*", async (c, next) => {
    const userId = await resolveUser(c);
    if (!userId) return fail(c, 401, "unauthenticated", "sign in first");
    c.set("userId", userId);
    await next();
  });
  db.use(
    "*",
    rateLimit({
      max: DB_REQUESTS_PER_MINUTE,
      windowMs: 60_000,
      key: (c) => `db:${String(c.get("userId"))}`,
    }),
  );

  /** Parses and authorises a path; returns a response when the request must stop. */
  const target = (c: Context, raw: unknown, kind: "doc" | "collection") => {
    try {
      const parts = kind === "doc" ? docPath(raw) : collectionPath(raw);
      if (!canAccess(parts, c.get("userId")))
        return fail(c, 403, "not_granted", "no access to this path");
      return parts;
    } catch (err) {
      if (err instanceof PathError) return fail(c, 400, "invalid_argument", err.message);
      throw err;
    }
  };

  db.get("/doc", async (c) => {
    const parts = target(c, c.req.query("path"), "doc");
    if (!Array.isArray(parts)) return parts;
    const data = await getDoc(pool, parts);
    return c.json(data === undefined ? { exists: false } : { exists: true, data });
  });

  db.put("/doc", async (c) => {
    const parts = target(c, c.req.query("path"), "doc");
    if (!Array.isArray(parts)) return parts;
    const body = await c.req.json().catch(() => null);
    const data = (body as { data?: unknown } | null)?.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return fail(c, 400, "invalid_argument", "data must be an object");
    }
    try {
      await putDoc(pool, parts, data);
    } catch (err) {
      // 22P05: text Postgres cannot store (a \u0000 character).
      if ((err as { code?: string }).code === "22P05")
        return fail(c, 400, "invalid_argument", "data has unsupported text");
      throw err;
    }
    return c.body(null, 204);
  });

  db.delete("/doc", async (c) => {
    const parts = target(c, c.req.query("path"), "doc");
    if (!Array.isArray(parts)) return parts;
    await deleteDoc(pool, parts);
    return c.body(null, 204);
  });

  db.post("/query", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      (QueryRequest & { path?: unknown }) | null;
    if (typeof body !== "object" || body === null)
      return fail(c, 400, "invalid_argument", "body must be an object");
    const parts = target(c, body.path, "collection");
    if (!Array.isArray(parts)) return parts;
    try {
      const q = buildQuery(parts.join("/"), body);
      const r = await pool.query(q.text, q.values);
      return c.json({ docs: r.rows.map((row) => ({ id: row.id, data: row.data })) });
    } catch (err) {
      if (err instanceof QueryError) return fail(c, 400, "invalid_argument", err.message);
      throw err;
    }
  });

  if (authRoutes) app.route("/api/auth", authRoutes);
  app.route("/api/db", db);
  if (coach) app.route("/api/coach", coachRoutes(coach, resolveUser));

  // Reserved for server-side speech (CC-039); until then voice is the browser's own.
  app.all("/api/voice/*", (c) =>
    fail(c, 501, "not_implemented", "server voice is not available yet"),
  );

  if (webDir) app.use("*", staticSite(webDir));

  // Unknown /api routes and failures use the same error shape; never echo request data.
  app.notFound((c) => fail(c, 400, "invalid_argument", "unknown route"));
  app.onError((err, c) => {
    console.error("request failed:", err.name);
    return fail(c, 500, "internal", "something went wrong");
  });
  return app;
}
