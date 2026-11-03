import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db.js";

// Needs Postgres: TEST_DATABASE_URL=postgres://... (CI provides it). Each run uses its own schema.
const url = process.env.TEST_DATABASE_URL;
const schema = `t_${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!url)("documents API", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let user: string | null = "u1";

  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const put = (path: string, data: unknown) =>
    call("PUT", `/api/db/doc?path=${encodeURIComponent(path)}`, { data });
  const query = async (body: unknown) =>
    (
      (await (await call("POST", "/api/db/query", body)).json()) as {
        docs: { id: string; data: unknown }[];
      }
    ).docs;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await migrate(pool);
    app = createApp({ pool, version: "9.9.9", resolveUser: () => user });
  });

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it("reports health without detail", async () => {
    const r = await call("GET", "/api/health");
    expect(await r.json()).toEqual({ ok: true, version: "9.9.9" });
  });

  it("keeps /api/voice/* reserved for later", async () => {
    for (const method of ["GET", "POST"]) {
      const r = await call(method, "/api/voice/speak");
      expect(r.status).toBe(501);
      expect(await r.json()).toEqual({
        error: { code: "not_implemented", message: "server voice is not available yet" },
      });
    }
  });

  it("migrating twice is a no-op", async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it("round-trips a document and replaces it whole", async () => {
    const path = "data/users/u1/current-game";
    expect((await put(path, { fen: "a", n: 1 })).status).toBe(204);
    const get = async () =>
      (await call("GET", `/api/db/doc?path=${encodeURIComponent(path)}`)).json();
    expect(await get()).toEqual({ exists: true, data: { fen: "a", n: 1 } });
    await put(path, { fen: "b" });
    expect(await get()).toEqual({ exists: true, data: { fen: "b" } });
    expect((await call("DELETE", `/api/db/doc?path=${encodeURIComponent(path)}`)).status).toBe(204);
    expect(await get()).toEqual({ exists: false });
    expect((await call("DELETE", `/api/db/doc?path=${encodeURIComponent(path)}`)).status).toBe(204);
  });

  it("requires sign-in", async () => {
    user = null;
    const r = await call("GET", "/api/db/doc?path=coach-kb/x");
    user = "u1";
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
  });

  it("keeps users apart and closes unknown paths", async () => {
    await put("data/users/u1/current-game", { mine: true });
    for (const path of ["data/users/u2/current-game", "secrets/x"]) {
      const r = await call("GET", `/api/db/doc?path=${encodeURIComponent(path)}`);
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("not_granted");
      expect((await put(path, { x: 1 })).status).toBe(403);
    }
    const q = await call("POST", "/api/db/query", { path: "data/users/u2/history/games" });
    expect(q.status).toBe(403);
  });

  it("closes the old shared areas to players, for reading and writing (CC-067)", async () => {
    for (const path of ["coach-kb/lesson.l1/entries/e1", "lesson-answers/l1/answers/a1"]) {
      const enc = encodeURIComponent(path);
      expect((await put(path, { text: "hi" })).status).toBe(403);
      expect((await call("DELETE", `/api/db/doc?path=${enc}`)).status).toBe(403);
      expect((await call("GET", `/api/db/doc?path=${enc}`)).status).toBe(403);
    }
    const q = await call("POST", "/api/db/query", { path: "coach-kb/lesson.l1/entries" });
    expect(q.status).toBe(403);
  });

  it("rejects malformed requests", async () => {
    const bad = [
      await call("GET", "/api/db/doc?path=a//b"),
      await call("GET", "/api/db/doc?path=coach-kb"),
      await put("data/users/u1/x", [1] as unknown),
      await call("PUT", "/api/db/doc?path=data/users/u1/x", { nope: 1 }),
      await call("POST", "/api/db/query", { path: "coach-kb/x" }),
      await call("POST", "/api/db/query", { path: "data/users/u1/x/y", limit: 5000 }),
    ];
    for (const r of bad) {
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("invalid_argument");
    }
  });

  it("rejects text Postgres cannot store", async () => {
    expect((await put("data/users/u1/nul", { t: "a\u0000b" })).status).toBe(400);
  });

  it("refuses a body over 64 KB", async () => {
    const r = await put("data/users/u1/big", { text: "x".repeat(70 * 1024) });
    expect(r.status).toBe(413);
  });

  describe("queries", () => {
    const base = "data/users/u1/history/games";
    beforeAll(async () => {
      await put(`${base}/g1`, { finishedAt: 100, result: "win", tags: ["a"], meta: { level: 2 } });
      await put(`${base}/g2`, {
        finishedAt: 300,
        result: "loss",
        tags: ["a", "b"],
        meta: { level: 5 },
      });
      await put(`${base}/g3`, { finishedAt: 200, result: "win", tags: [], meta: { level: 5 } });
      await put(`${base}/g4`, { result: "draw" });
      await put(`${base}/g1/sub/s1`, { finishedAt: 1 });
    });
    const ids = async (body: object) => (await query({ path: base, ...body })).map((d) => d.id);

    it("lists only direct children, by id", async () => {
      expect(await ids({})).toEqual(["g1", "g2", "g3", "g4"]);
    });
    it("orders numbers, newest first, and drops documents without the field", async () => {
      expect(await ids({ orderBy: { field: "finishedAt", dir: "desc" } })).toEqual([
        "g2",
        "g3",
        "g1",
      ]);
      expect(await ids({ orderBy: { field: "finishedAt" }, limit: 2 })).toEqual(["g1", "g3"]);
    });
    it("filters with each operator, including nested fields", async () => {
      expect(await ids({ where: [{ field: "result", op: "==", value: "win" }] })).toEqual([
        "g1",
        "g3",
      ]);
      expect(await ids({ where: [{ field: "result", op: "!=", value: "win" }] })).toEqual([
        "g2",
        "g4",
      ]);
      expect(await ids({ where: [{ field: "finishedAt", op: ">=", value: 200 }] })).toEqual([
        "g2",
        "g3",
      ]);
      expect(await ids({ where: [{ field: "finishedAt", op: "<", value: 200 }] })).toEqual(["g1"]);
      expect(await ids({ where: [{ field: "meta.level", op: "==", value: 5 }] })).toEqual([
        "g2",
        "g3",
      ]);
      expect(
        await ids({ where: [{ field: "result", op: "in", value: ["loss", "draw"] }] }),
      ).toEqual(["g2", "g4"]);
      expect(await ids({ where: [{ field: "tags", op: "array-contains", value: "b" }] })).toEqual([
        "g2",
      ]);
    });
    it("compares ranges only against the same type", async () => {
      await put(`${base}/g5`, { finishedAt: "later" });
      expect(await ids({ where: [{ field: "finishedAt", op: ">", value: 50 }] })).toEqual([
        "g1",
        "g2",
        "g3",
      ]);
      await call("DELETE", `/api/db/doc?path=${encodeURIComponent(`${base}/g5`)}`);
    });
    it("combines a filter with an order and a limit", async () => {
      const body = {
        where: [{ field: "result", op: "==", value: "win" }],
        orderBy: { field: "finishedAt", dir: "desc" },
        limit: 1,
      };
      expect(await ids(body)).toEqual(["g3"]);
    });
  });
});
