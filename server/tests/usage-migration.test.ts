import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db.js";

// Needs Postgres: TEST_DATABASE_URL=postgres://... (CI provides it). Own schema per run.
const url = process.env.TEST_DATABASE_URL;
const schema = `t_${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!url)("ai_usage migration keeps usage history", () => {
  let pool: pg.Pool;
  const tmp = mkdtempSync(join(tmpdir(), "mig-"));

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  });

  afterAll(async () => {
    await pool.end();
    rmSync(tmp, { recursive: true, force: true });
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it("copies every row and leaves the old table for a rollback", async () => {
    const real = new URL("../migrations/", import.meta.url);
    for (const f of ["001_documents.sql", "002_auth.sql", "003_coach_usage.sql"]) {
      cpSync(new URL(f, real), join(tmp, f));
    }
    await migrate(pool, pathToFileURL(tmp + "/"));
    await pool.query(
      "INSERT INTO coach_usage VALUES ('a', '2026-11-01', 1234), ('b', '2026-11-01', 5), ('a', '2026-10-01', 99)",
    );
    expect(await migrate(pool, real)).toContain("004_ai_usage_copy.sql");
    const rows = (await pool.query("SELECT * FROM ai_usage ORDER BY user_id, month")).rows;
    expect(rows.map((r) => [r.user_id, Number(r.tokens)])).toEqual([
      ["a", 99],
      ["a", 1234],
      ["b", 5],
    ]);
    expect((await pool.query("SELECT count(*) FROM coach_usage")).rows[0].count).toBe("3");
  });
});
