import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import pg from "pg";
import { anthropicUpstream } from "./coach/upstream.js";
import { bootstrapInvite, ensureTestAccount } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db.js";
import { serverRoot } from "./root.js";
import { buildApp } from "./wire.js";

const root = serverRoot();
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  version: string;
};
const config = loadConfig(process.env, pkg.version);
const pool = new pg.Pool({ connectionString: config.databaseUrl });

const applied = await migrate(pool);
if (applied.length) console.warn("migrations applied:", applied.join(", "));

if (process.env.BOOTSTRAP_INVITE === "1") {
  const line = await bootstrapInvite(pool, config.publicUrl);
  if (line) console.warn(line);
}

if (config.testAccount) console.warn(await ensureTestAccount(pool, config.testAccount));

// WEB_DIR, else the repo's own build when running from a checkout.
const checkoutBuild = fileURLToPath(new URL("../dist-web", root));
const webDir = config.webDir ?? (existsSync(checkoutBuild) ? checkoutBuild : undefined);
if (!webDir) console.warn("no web app to serve (set WEB_DIR); answering the API only");

const app = buildApp(
  pool,
  config,
  config.anthropicApiKey ? anthropicUpstream(config.anthropicApiKey) : null,
  webDir,
);
serve({ fetch: app.fetch, port: config.port }, (info) => console.warn(`listening on ${info.port}`));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void pool.end().finally(() => process.exit(0)));
}
