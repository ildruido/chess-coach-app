import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import type pg from "pg";
import {
  SESSION_DAYS,
  changePassword,
  checkPassword,
  decoyHash,
  endSession,
  login,
  normalizeEmail,
  signup,
  startSession,
  userForSession,
} from "./accounts.js";
import { FailureLimiter } from "./ratelimit.js";

export const COOKIE = "cc_session";

export interface AuthOptions {
  /** Secure cookies: on in production, off for plain-http local development. */
  secureCookie: boolean;
  /** Test hook: the caller's address when there is no socket. */
  clientIp?: (c: Context) => string;
  /** Behind exactly one trusted proxy: use the address it appended to X-Forwarded-For. */
  trustProxy?: boolean;
}

function fail(c: Context, status: 400 | 401 | 403 | 429, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function ipOf(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const last = c.req.header("x-forwarded-for")?.split(",").pop()?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Sign-in routes and the session lookup the rest of the API uses. */
export function createAuth(pool: pg.Pool, opts: AuthOptions) {
  const ip = opts.clientIp ?? ((c: Context) => ipOf(c, opts.trustProxy ?? false));
  void decoyHash(); // warm up, so the first unknown email isn't slower than the rest
  // 5 wrong passwords per account and 30 failed attempts per address, per 15 minutes.
  const byEmail = new FailureLimiter(5, 15 * 60_000);
  const byIp = new FailureLimiter(30, 15 * 60_000);
  // Wrong current passwords on change-password, apart from sign-in so a stolen cookie can't lock
  // the owner out of signing in.
  const byUser = new FailureLimiter(5, 15 * 60_000);

  const setSession = (c: Context, token: string) =>
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: opts.secureCookie,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });

  const resolveUser = async (c: Context): Promise<string | null> => {
    const token = getCookie(c, COOKIE);
    if (!token) return null;
    return (await userForSession(pool, token))?.userId ?? null;
  };

  const routes = new Hono();
  routes.use(
    "*",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => fail(c, 400, "invalid_argument", "request too large"),
    }),
  );
  // A browser always sends Origin on cross-site posts; refuse any that is not this host.
  routes.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (c.req.method !== "GET" && origin) {
      const host = (opts.trustProxy && c.req.header("x-forwarded-host")) || c.req.header("host");
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        // "null" and junk origins are refused below.
      }
      if (originHost !== host) return fail(c, 403, "not_granted", "cross-site request refused");
    }
    c.header("Cache-Control", "no-store");
    await next();
  });

  const readBody = async (c: Context): Promise<Record<string, unknown>> => {
    const b = await c.req.json().catch(() => null);
    return typeof b === "object" && b !== null && !Array.isArray(b)
      ? (b as Record<string, unknown>)
      : {};
  };

  // Attempts are counted before the slow password work, so a burst of parallel guesses can't
  // get past the limit; a success hands its count back.
  routes.post("/signup", async (c) => {
    const addr = `ip:${ip(c)}`;
    if (!byIp.reserve(addr)) return fail(c, 429, "rate_limited", "too many attempts, try later");
    const b = await readBody(c);
    const email = normalizeEmail(b.email);
    const password = checkPassword(b.password);
    if (!email) return fail(c, 400, "invalid_argument", "enter a valid email");
    if (!password) return fail(c, 400, "invalid_argument", "password must be 10 to 200 characters");
    if (typeof b.invite !== "string" || b.invite.length < 20 || b.invite.length > 100) {
      return fail(c, 400, "invalid_argument", "this invite link is not valid");
    }
    const r = await signup(pool, b.invite, email, password);
    if (r === "bad_invite") {
      return fail(c, 400, "invalid_argument", "this invite link is not valid or was already used");
    }
    if (r === "email_taken")
      return fail(c, 400, "invalid_argument", "that email already has an account");
    byIp.refund(addr);
    setSession(c, await startSession(pool, r.userId));
    return c.json({ userId: r.userId, email });
  });

  routes.post("/login", async (c) => {
    const addr = `ip:${ip(c)}`;
    const b = await readBody(c);
    const email = normalizeEmail(b.email);
    const key = `email:${email ?? ""}`;
    if (!byIp.reserve(addr)) return fail(c, 429, "rate_limited", "too many attempts, try later");
    if (!byEmail.reserve(key)) {
      byIp.refund(addr);
      return fail(c, 429, "rate_limited", "too many attempts, try later");
    }
    const userId =
      email && typeof b.password === "string" && b.password.length <= 200
        ? await login(pool, email, b.password)
        : null;
    if (!userId) return fail(c, 401, "unauthenticated", "wrong email or password");
    byIp.refund(addr);
    byEmail.clear(key);
    setSession(c, await startSession(pool, userId));
    return c.json({ userId, email });
  });

  routes.post("/logout", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await endSession(pool, token);
    deleteCookie(c, COOKIE, { path: "/", httpOnly: true, secure: opts.secureCookie });
    return c.body(null, 204);
  });

  // Needs the current password, so a stolen cookie alone can't take the account over. Wrong
  // current passwords are limited per account here, on top of the sign-in limits.
  routes.post("/change-password", async (c) => {
    const token = getCookie(c, COOKIE);
    const me = token ? await userForSession(pool, token) : null;
    if (!token || !me) return fail(c, 401, "unauthenticated", "sign in first");
    const b = await readBody(c);
    const next = checkPassword(b.password);
    if (typeof b.current !== "string" || b.current.length > 200) {
      return fail(c, 400, "invalid_argument", "enter your current password");
    }
    if (!next) return fail(c, 400, "invalid_argument", "password must be 10 to 200 characters");
    const addr = `ip:${ip(c)}`;
    const key = `user:${me.userId}`;
    if (!byIp.reserve(addr)) return fail(c, 429, "rate_limited", "too many attempts, try later");
    if (!byUser.reserve(key)) {
      byIp.refund(addr);
      return fail(c, 429, "rate_limited", "too many attempts, try later");
    }
    if (!(await changePassword(pool, me.userId, token, b.current, next))) {
      return fail(c, 403, "not_granted", "the current password isn't right");
    }
    byIp.refund(addr);
    byUser.clear(key);
    return c.body(null, 204);
  });

  routes.get("/me", async (c) => {
    const token = getCookie(c, COOKIE);
    const me = token ? await userForSession(pool, token) : null;
    if (!me) return fail(c, 401, "unauthenticated", "sign in first");
    return c.json(me);
  });

  return { routes, resolveUser };
}
