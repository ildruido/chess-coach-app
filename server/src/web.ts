import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { FailureLimiter } from "./ratelimit.js";

/**
 * Headers on every response. The page runs only its own files: scripts and the engine worker
 * from this origin (`wasm-unsafe-eval` lets the engine's WebAssembly compile; plain eval stays
 * off), Google Fonts for type, and calls back to this server only.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  // The board and the page set element styles (positions, sizes); style sheets stay locked.
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(opts: { https: boolean }): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), geolocation=(), payment=(), microphone=(self)");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    if (opts.https) c.header("Strict-Transport-Security", "max-age=31536000");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

/** Serves the built site (`dist-web`). Unknown paths without an extension get the page (links like /#/invite/…). */
export function staticSite(dir: string): MiddlewareHandler {
  const root = resolve(dir);
  const read = async (path: string) => {
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return null;
    try {
      if (!(await stat(file)).isFile()) return null;
      return { file, body: await readFile(file) };
    } catch {
      return null;
    }
  };
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    if (c.req.path.startsWith("/api/")) return next();
    let path: string;
    try {
      path = decodeURIComponent(c.req.path);
    } catch {
      return c.text("Not found", 404);
    }
    if (path.includes("\0")) return c.text("Not found", 404);
    let hit = await read(path.endsWith("/") ? `${path}index.html` : path);
    if (!hit && !extname(path)) hit = await read("index.html");
    if (!hit) return c.text("Not found", 404);
    const hashed = /^\/assets\/[^/]+-[\w-]{8,}\.\w+$/.test(path);
    return c.body(new Uint8Array(hit.body), 200, {
      "Content-Type": TYPES[extname(hit.file)] ?? "application/octet-stream",
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    });
  };
}

/**
 * At most `max` requests per signed-in person (or address) per window; the rest get 429.
 * In memory, like the sign-in limits: run one server instance.
 */
export function rateLimit(opts: {
  max: number;
  windowMs: number;
  key: (c: Context) => string | Promise<string>;
  now?: () => number;
}): MiddlewareHandler {
  const limiter = new FailureLimiter(opts.max, opts.windowMs, opts.now);
  return async (c, next) => {
    if (!limiter.reserve(await opts.key(c))) {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json(
        { error: { code: "rate_limited", message: "too many requests, slow down" } },
        429,
      );
    }
    await next();
  };
}
