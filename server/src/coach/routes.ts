import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type pg from "pg";
import { allowanceFor, getUsed, resetsAt } from "./ledger.js";
import { type ModelIds } from "./mapping.js";
import { type CoachUpstream } from "./upstream.js";
import { askHandler } from "./ask.js";
import { rateLimit } from "../web.js";

export interface CoachDeps {
  pool: pg.Pool;
  /** Null when the server has no API key: the routes answer `capability_removed`. */
  upstream: CoachUpstream | null;
  models: ModelIds;
  defaultAllowance: number;
  /** Calls running at once per person, so parallel clicks can't slip past the allowance check. */
  maxConcurrent?: number;
  /** Requests per person per minute (default 30). */
  maxPerMinute?: number;
  now?: () => Date;
}

const MAX_BODY = 256 * 1024;

type Status = 400 | 401 | 403 | 413 | 429 | 503;
const fail = (c: Context, status: Status, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

export function coachRoutes(
  deps: CoachDeps,
  resolveUser: (c: Context) => string | null | Promise<string | null>,
): Hono {
  const { pool, upstream, models } = deps;
  const now = deps.now ?? (() => new Date());
  const maxConcurrent = deps.maxConcurrent ?? 2;
  const running = new Map<string, number>();
  const coach = new Hono<{ Variables: { userId: string } }>();

  coach.use("*", async (c, next) => {
    const userId = await resolveUser(c);
    if (!userId) return fail(c, 401, "not_granted", "sign in first");
    c.set("userId", userId);
    await next();
  });

  // Starting calls is also capped per minute, on top of the monthly allowance and two at once.
  coach.use(
    "*",
    rateLimit({
      max: deps.maxPerMinute ?? 30,
      windowMs: 60_000,
      key: (c) => `coach:${String(c.get("userId"))}`,
    }),
  );

  coach.get("/usage", async (c) => {
    const userId = c.get("userId");
    const [used, allowance] = await Promise.all([
      getUsed(pool, userId, now()),
      allowanceFor(pool, userId, deps.defaultAllowance),
    ]);
    return c.json({ usedTokens: used, allowanceTokens: allowance, resetsAt: resetsAt(now()) });
  });

  /** Switched off for this person (allowance 0)? Applies to saved answers too. */
  const enabled = async (c: Context): Promise<Response | null> =>
    (await allowanceFor(pool, c.get("userId"), deps.defaultAllowance)) <= 0
      ? fail(c, 403, "capability_disabled", "the coach is switched off for you")
      : null;

  /** The checks before a model call: within the month, not too many at once. Takes its place in the count. */
  const admit = async (c: Context): Promise<Response | null> => {
    const userId = c.get("userId");
    const allowance = await allowanceFor(pool, userId, deps.defaultAllowance);
    if ((await getUsed(pool, userId, now())) >= allowance)
      return fail(c, 429, "rate_limited", "monthly coach allowance used up");
    // Check and take the place in one step, so parallel clicks can't slip past.
    if ((running.get(userId) ?? 0) >= maxConcurrent)
      return fail(c, 429, "rate_limited", "too many coach calls at once");
    running.set(userId, (running.get(userId) ?? 0) + 1);
    return null;
  };
  const ask = upstream
    ? askHandler({ pool, upstream, models, now }, (id) =>
        running.set(id, (running.get(id) ?? 1) - 1),
      )
    : null;

  coach.post(
    "/ask",
    bodyLimit({
      maxSize: MAX_BODY,
      onError: (c) => fail(c, 413, "prompt_too_large", "request too large"),
    }),
    async (c) => {
      if (!ask) return fail(c, 503, "capability_removed", "the coach is not set up");
      const userId = c.get("userId");
      return ask(c, userId, await c.req.json().catch(() => null), { enabled, admit });
    },
  );

  return coach as unknown as Hono;
}
