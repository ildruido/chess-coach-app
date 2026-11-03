import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/admin.js";
import { ensureTestAccount } from "../src/bootstrap.js";
import { createInvite, hashPassword, verifyPassword } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { migrate } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL;
const schema = `t_${Math.random().toString(36).slice(2, 10)}`;
const PW = "correct horse battery";

describe("password hashing", () => {
  it("uses argon2id and verifies", async () => {
    const h = await hashPassword(PW);
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, PW)).toBe(true);
    expect(await verifyPassword(h, "nope nope nope")).toBe(false);
    expect(await verifyPassword("garbage", PW)).toBe(false);
  });
});

describe.skipIf(!url)("sign-in", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let addr = "1.1.1.1";

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "x.test", ...headers },
      body: JSON.stringify(body),
    });
  const cookieOf = (r: Response) =>
    /cc_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  const me = (token?: string) =>
    app.request("/api/auth/me", { headers: token ? { cookie: `cc_session=${token}` } : {} });
  const invite = async () => (await createInvite(pool)).token;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await migrate(pool);
    const auth = createAuth(pool, { secureCookie: true, clientIp: () => addr });
    app = createApp({
      pool,
      version: "1",
      resolveUser: auth.resolveUser,
      authRoutes: auth.routes,
    });
  });

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it("signs up with an invite, sets a hardened cookie and reaches the API", async () => {
    const r = await post("signup", {
      invite: await invite(),
      email: " Ann@Example.com ",
      password: PW,
    });
    expect(r.status).toBe(200);
    const flags = r.headers.get("set-cookie") ?? "";
    expect(flags).toMatch(/HttpOnly/i);
    expect(flags).toMatch(/Secure/i);
    expect(flags).toMatch(/SameSite=Lax/i);
    const token = cookieOf(r)!;
    const who = (await (await me(token)).json()) as { userId: string; email: string };
    expect(who.email).toBe("ann@example.com");
    const doc = await app.request(`/api/db/doc?path=data/users/${who.userId}/current-game`, {
      headers: { cookie: `cc_session=${token}` },
    });
    expect(await doc.json()).toEqual({ exists: false });
    const stored = await pool.query("SELECT password_hash FROM users");
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const sess = await pool.query("SELECT token_hash FROM sessions");
    expect(sess.rows[0].token_hash).not.toBe(token);
  });

  it("refuses the API and /me without a session", async () => {
    expect((await me()).status).toBe(401);
    expect((await me("bogus")).status).toBe(401);
    const r = await app.request("/api/db/doc?path=data/users/x/current-game");
    expect(r.status).toBe(401);
  });

  it("accepts an invite only once", async () => {
    const inv = await invite();
    expect(
      (await post("signup", { invite: inv, email: "b@example.com", password: PW })).status,
    ).toBe(200);
    const again = await post("signup", { invite: inv, email: "c@example.com", password: PW });
    expect(again.status).toBe(400);
  });

  it("rejects expired, unknown and malformed invites, bad emails and short passwords", async () => {
    const old = await invite();
    await pool.query("UPDATE invites SET expires_at = now() - interval '1 day'");
    expect(
      (await post("signup", { invite: old, email: "d@example.com", password: PW })).status,
    ).toBe(400);
    expect(
      (await post("signup", { invite: "x".repeat(43), email: "d@example.com", password: PW }))
        .status,
    ).toBe(400);
    const fresh = await invite();
    expect(
      (await post("signup", { invite: fresh, email: "not-an-email", password: PW })).status,
    ).toBe(400);
    expect(
      (await post("signup", { invite: fresh, email: "d@example.com", password: "short" })).status,
    ).toBe(400);
    // The invite survived those failures.
    expect(
      (await post("signup", { invite: fresh, email: "d@example.com", password: PW })).status,
    ).toBe(200);
  });

  it("does not use up an invite when the email is taken", async () => {
    const inv = await invite();
    const r = await post("signup", { invite: inv, email: "ann@example.com", password: PW });
    expect(r.status).toBe(400);
    expect(
      (await post("signup", { invite: inv, email: "e@example.com", password: PW })).status,
    ).toBe(200);
  });

  it("logs in, logs out and ends the session", async () => {
    const bad = await post("login", { email: "ann@example.com", password: "wrong password!" });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
    const ok = await post("login", { email: "ANN@example.com", password: PW });
    expect(ok.status).toBe(200);
    const token = cookieOf(ok)!;
    expect((await me(token)).status).toBe(200);
    const out = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: `cc_session=${token}` },
    });
    expect(out.status).toBe(204);
    expect((await me(token)).status).toBe(401);
  });

  it("answers an unknown email the same way as a wrong password", async () => {
    const r = await post("login", { email: "nobody@example.com", password: PW });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe(
      "wrong email or password",
    );
  });

  it("rate limits repeated wrong passwords per account, then recovers for others", async () => {
    addr = "2.2.2.2";
    for (let i = 0; i < 5; i++) {
      expect(
        (await post("login", { email: "ann@example.com", password: "wrong password!" })).status,
      ).toBe(401);
    }
    const blocked = await post("login", { email: "ann@example.com", password: PW });
    expect(blocked.status).toBe(429);
    addr = "3.3.3.3";
    expect((await post("login", { email: "b@example.com", password: PW })).status).toBe(200);
  });

  it("limits many failures from one address", async () => {
    addr = "4.4.4.4";
    for (let i = 0; i < 30; i++) await post("login", { email: `u${i}@example.com`, password: PW });
    expect((await post("login", { email: "b@example.com", password: PW })).status).toBe(429);
  });

  it("refuses cross-site posts", async () => {
    addr = "8.8.8.8";
    const r = await post(
      "login",
      { email: "b@example.com", password: PW },
      { origin: "https://evil.test" },
    );
    expect(r.status).toBe(403);
    const same = await post(
      "login",
      { email: "b@example.com", password: PW },
      { origin: "http://x.test" },
    );
    expect(same.status).toBe(200);
  });

  it("counts parallel wrong guesses before verifying, so a burst can't get past the limit", async () => {
    addr = "9.9.9.9";
    const rs = await Promise.all(
      Array.from({ length: 12 }, () =>
        post("login", { email: "b@example.com", password: "wrong password!" }),
      ),
    );
    expect(rs.filter((r) => r.status === 401)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it("refuses an Origin of null instead of failing", async () => {
    addr = "10.0.0.1";
    const r = await post("login", { email: "x@example.com", password: PW }, { origin: "null" });
    expect(r.status).toBe(403);
  });

  it("a good login gives its attempt back", async () => {
    addr = "10.0.0.2";
    for (let i = 0; i < 40; i++) {
      expect((await post("login", { email: "e@example.com", password: PW })).status).toBe(200);
    }
  });

  it("expired sessions stop working", async () => {
    addr = "5.5.5.5";
    const token = cookieOf(await post("login", { email: "b@example.com", password: PW }))!;
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await me(token)).status).toBe(401);
  });

  it("uses the proxy-reported address only when told to trust the proxy", async () => {
    const trusting = createAuth(pool, { secureCookie: false, trustProxy: true });
    const plain = createAuth(pool, { secureCookie: false });
    let n = 0;
    const send = (a: ReturnType<typeof createAuth>, xff: string) =>
      createApp({ pool, version: "1", resolveUser: a.resolveUser, authRoutes: a.routes }).request(
        "/api/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": xff },
          body: JSON.stringify({ email: `n${n++}@example.com`, password: PW }),
        },
      );
    // 30 failures from client A (behind the proxy) block A but not client B.
    for (let i = 0; i < 30; i++) await send(trusting, `spoof, 11.0.0.1`);
    expect((await send(trusting, "11.0.0.1")).status).toBe(429);
    expect((await send(trusting, "11.0.0.2")).status).toBe(401);
    // Without trust, a spoofed header changes nothing: everyone is one address.
    expect((await send(plain, "1.2.3.4")).status).toBe(401);
  });

  describe("change password", () => {
    const NEW = "a brand new password";
    const change = (token: string | undefined, body: unknown) =>
      post("change-password", body, token ? { cookie: `cc_session=${token}` } : {});
    const login = (email: string, password: string) => post("login", { email, password });
    const account = async (email: string) => {
      addr = `9.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      await post("signup", { invite: await invite(), email, password: PW });
      const first = cookieOf(await login(email, PW))!;
      const second = cookieOf(await login(email, PW))!;
      return { first, second };
    };

    it("changes the password, keeps this session and ends the others", async () => {
      const { first, second } = await account("pw1@example.com");
      expect((await change(first, { current: PW, password: NEW })).status).toBe(204);
      expect((await me(first)).status).toBe(200);
      expect((await me(second)).status).toBe(401);
      expect((await login("pw1@example.com", PW)).status).toBe(401);
      expect((await login("pw1@example.com", NEW)).status).toBe(200);
    });

    it("refuses without a session, with a wrong current or a bad new password", async () => {
      const { first } = await account("pw2@example.com");
      expect((await change(undefined, { current: PW, password: NEW })).status).toBe(401);
      expect((await change(first, { current: "nope nope nope", password: NEW })).status).toBe(403);
      expect((await change(first, { current: PW, password: "short" })).status).toBe(400);
      expect((await change(first, { current: PW, password: "x".repeat(201) })).status).toBe(400);
      expect((await change(first, { password: NEW })).status).toBe(400);
      expect((await login("pw2@example.com", PW)).status).toBe(200);
    });

    it("limits wrong current passwords per person, and a success hands the count back", async () => {
      const a = await account("pw3@example.com");
      const b = await account("pw4@example.com");
      for (let i = 0; i < 5; i++) {
        expect((await change(a.first, { current: "wrong password!", password: NEW })).status).toBe(
          403,
        );
      }
      expect((await change(a.first, { current: PW, password: NEW })).status).toBe(429);
      expect((await change(b.first, { current: PW, password: NEW })).status).toBe(204);
    });

    it("refuses a cross-site post", async () => {
      const { first } = await account("pw5@example.com");
      const r = await change(first, { current: PW, password: NEW });
      expect(r.status).toBe(204);
      const bad = await post(
        "change-password",
        { current: NEW, password: PW },
        { cookie: `cc_session=${first}`, origin: "https://evil.test" },
      );
      expect(bad.status).toBe(403);
    });
  });

  describe("test account", () => {
    const acct = { email: "test@chess-coach.org", password: "test123456" };
    it("creates it, leaves it alone, and puts the password back", async () => {
      expect(await ensureTestAccount(pool, acct)).toMatch(/created/);
      addr = "8.8.1.1";
      const token = cookieOf(await post("login", acct))!;
      expect(await ensureTestAccount(pool, acct)).toMatch(/unchanged/);
      expect((await me(token)).status).toBe(200);
      await run(["reset-password", acct.email], pool, "");
      expect(await ensureTestAccount(pool, acct)).toMatch(/updated/);
      expect((await me(token)).status).toBe(401);
      addr = "8.8.1.2";
      expect((await post("login", acct)).status).toBe(200);
    });

    it("survives two servers starting together", async () => {
      const other = { email: "race@chess-coach.org", password: "test123456" };
      await Promise.all([ensureTestAccount(pool, other), ensureTestAccount(pool, other)]);
      const n = await pool.query("SELECT 1 FROM users WHERE email = $1", [other.email]);
      expect(n.rowCount).toBe(1);
    });

    it("delete-user removes the account and its data, and only that", async () => {
      const id = (
        await pool.query("SELECT id FROM users WHERE email = $1", ["test@chess-coach.org"])
      ).rows[0].id as string;
      const keep = (await pool.query("SELECT id FROM users WHERE email = $1", ["pw1@example.com"]))
        .rows[0].id as string;
      for (const u of [id, keep]) {
        await pool.query(
          "INSERT INTO documents (path, parent, id, data) VALUES ($1, $2, 'g', '{}')",
          [`data/users/${u}/current-game`, `data/users/${u}`],
        );
        await pool.query("INSERT INTO coach_usage (user_id, month, tokens) VALUES ($1, now(), 5)", [
          u,
        ]);
      }
      expect(await run(["delete-user", "Test@chess-coach.org"], pool, "")).toMatch(/Deleted/);
      expect((await pool.query("SELECT 1 FROM users WHERE id = $1", [id])).rowCount).toBe(0);
      expect(
        (await pool.query("SELECT 1 FROM documents WHERE path LIKE $1", [`%${id}%`])).rowCount,
      ).toBe(0);
      expect(
        (await pool.query("SELECT 1 FROM coach_usage WHERE user_id = $1", [id])).rowCount,
      ).toBe(0);
      expect(
        (await pool.query("SELECT 1 FROM documents WHERE path LIKE $1", [`%${keep}%`])).rowCount,
      ).toBe(1);
      await expect(run(["delete-user", "test@chess-coach.org"], pool, "")).rejects.toThrow(
        /no account/,
      );
    });
  });

  describe("admin command", () => {
    it("makes an invite link that works", async () => {
      const out = await run(["invite", "for", "Carla", "--days", "3"], pool, "https://app.test");
      const token = /#\/invite\/(\S+)/.exec(out)![1]!;
      expect(out).toContain("https://app.test/#/invite/");
      addr = "6.6.6.6";
      expect(
        (await post("signup", { invite: token, email: "carla@example.com", password: PW })).status,
      ).toBe(200);
      const row = await pool.query(
        "SELECT note FROM invites WHERE used_by IS NOT NULL ORDER BY used_at DESC LIMIT 1",
      );
      expect(row.rows[0].note).toBe("for Carla");
    });

    it("resets a password and signs the person out", async () => {
      addr = "7.7.7.7";
      const token = cookieOf(await post("login", { email: "carla@example.com", password: PW }))!;
      const out = await run(["reset-password", "Carla@example.com"], pool, "");
      const fresh = out.split("\n")[1]!;
      expect((await me(token)).status).toBe(401);
      expect((await post("login", { email: "carla@example.com", password: PW })).status).toBe(401);
      expect((await post("login", { email: "carla@example.com", password: fresh })).status).toBe(
        200,
      );
      await expect(run(["reset-password", "ghost@example.com"], pool, "")).rejects.toThrow(
        /no account/,
      );
    });

    it("sets and clears an allowance, and lists users", async () => {
      await run(["set-allowance", "carla@example.com", "50000"], pool, "");
      expect(await run(["list-users"], pool, "")).toMatch(/carla@example.com {2}allowance: 50000/);
      await run(["set-allowance", "carla@example.com", "default"], pool, "");
      expect(await run(["list-users"], pool, "")).toMatch(
        /carla@example.com {2}allowance: default/,
      );
      await expect(run(["set-allowance", "carla@example.com", "-5"], pool, "")).rejects.toThrow(
        /usage/,
      );
      await expect(run(["invite", "--days", "0"], pool, "")).rejects.toThrow(/--days/);
    });

    it("prints usage for an unknown command", async () => {
      expect(await run([], pool, "")).toMatch(/invite/);
    });
  });
});
