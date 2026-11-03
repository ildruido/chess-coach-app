import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { CSP, rateLimit, securityHeaders, staticSite } from "../src/web.js";

describe("web serving", () => {
  let app: Hono;
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "site-"));
    await mkdir(join(dir, "assets"));
    await mkdir(join(dir, "engine"));
    await writeFile(join(dir, "index.html"), "<h1>page</h1>");
    await writeFile(join(dir, "assets", "index-AbC12345.js"), "1");
    await writeFile(join(dir, "engine", "e.wasm"), "\0asm");
    app = new Hono();
    app.use("*", securityHeaders({ https: true }));
    app.get("/api/ping", (c) => c.json({ ok: true }));
    app.use("*", staticSite(dir));
  });

  it("sends the page policy and no-store on the API", async () => {
    const page = await app.request("/");
    expect(page.headers.get("content-security-policy")).toBe(CSP);
    expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(page.headers.get("strict-transport-security")).toBeTruthy();
    expect((await app.request("/api/ping")).headers.get("cache-control")).toBe("no-store");
  });

  it("serves files with the right types and caching", async () => {
    const wasm = await app.request("/engine/e.wasm");
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(wasm.headers.get("cache-control")).toBe("no-cache");
    const asset = await app.request("/assets/index-AbC12345.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await (await app.request("/")).text()).toBe("<h1>page</h1>");
  });

  it("gives the page to unknown routes, 404 to missing files, and never leaves the folder", async () => {
    expect(await (await app.request("/elsewhere")).text()).toBe("<h1>page</h1>");
    expect((await app.request("/nope.js")).status).toBe(404);
    for (const path of ["/../index.html", "/%2e%2e/%2e%2e/etc/passwd.txt", "/a%00b.txt"]) {
      const res = await app.request(path);
      expect(await res.text()).not.toContain("root:");
    }
    expect((await app.request("/%2e%2e%2f%2e%2e%2fetc%2fpasswd.txt")).status).toBe(404);
  });
});

describe("rateLimit", () => {
  it("lets max requests through per key and window, then answers 429", async () => {
    let now = 0;
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        max: 2,
        windowMs: 1000,
        key: (c) => c.req.header("x-who") ?? "?",
        now: () => now,
      }),
    );
    app.get("/", (c) => c.text("ok"));
    const get = (who: string) => app.request("/", { headers: { "x-who": who } });
    expect((await get("a")).status).toBe(200);
    expect((await get("a")).status).toBe(200);
    const blocked = await get("a");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect((await get("b")).status).toBe(200);
    now = 1001;
    expect((await get("a")).status).toBe(200);
  });
});
