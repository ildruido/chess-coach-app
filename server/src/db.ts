import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { serverRoot } from "./root.js";

const MIGRATIONS_DIR = new URL("migrations/", serverRoot());

/** Applies migrations/*.sql in name order, once each, under an advisory lock. */
export async function migrate(pool: pg.Pool, dir: URL = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(4300431)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    for (const name of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (done.has(name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(new URL(name, dir), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
      applied.push(name);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(4300431)").catch(() => undefined);
    client.release();
  }
  return applied;
}

export async function getDoc(pool: pg.Pool, parts: string[]): Promise<unknown> {
  const r = await pool.query("SELECT data FROM documents WHERE path = $1", [parts.join("/")]);
  return r.rows[0]?.data;
}

export async function putDoc(pool: pg.Pool, parts: string[], data: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO documents (path, parent, id, data) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [parts.join("/"), parts.slice(0, -1).join("/"), parts[parts.length - 1], JSON.stringify(data)],
  );
}

export async function deleteDoc(pool: pg.Pool, parts: string[]): Promise<void> {
  await pool.query("DELETE FROM documents WHERE path = $1", [parts.join("/")]);
}
