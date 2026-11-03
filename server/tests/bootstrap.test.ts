import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapInvite } from "../src/bootstrap.js";
import { migrate } from "../src/db.js";

const url = process.env.TEST_DATABASE_URL;
const schema = `t_${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!url)("bootstrapInvite", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it("prints an invite link only while there are no accounts", async () => {
    const line = await bootstrapInvite(pool, "https://x.test");
    expect(line).toMatch(/https:\/\/x\.test\/#\/invite\/[\w-]{20,}/);
    await pool.query("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'a@b.c', 'x')");
    expect(await bootstrapInvite(pool, "https://x.test")).toBeNull();
  });
});
