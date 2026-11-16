import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type pg from "pg";

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
export const SESSION_DAYS = 30;
export const INVITE_DAYS = 7;

// OWASP-recommended argon2id floor (19 MiB, 2 passes, 1 lane); the library defaults to argon2id.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON);
export const verifyPassword = (stored: string, password: string): Promise<boolean> =>
  verify(stored, password).catch(() => false);

/** A hash nobody can match, so unknown emails cost the same time as wrong passwords. */
let decoy: Promise<string> | undefined;
export const decoyHash = (): Promise<string> => (decoy ??= hashPassword(newToken()));

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function checkPassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD || raw.length > MAX_PASSWORD) return null;
  return raw;
}

export interface Invite {
  token: string;
  expiresAt: Date;
}

export async function createInvite(pool: pg.Pool, note = "", days = INVITE_DAYS): Promise<Invite> {
  const token = newToken();
  const r = await pool.query(
    `INSERT INTO invites (token_hash, note, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3)) RETURNING expires_at`,
    [hashToken(token), note.slice(0, 200), days],
  );
  return { token, expiresAt: r.rows[0].expires_at };
}

export async function startSession(pool: pg.Pool, userId: string): Promise<string> {
  const token = newToken();
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS],
  );
  return token;
}

export async function endSession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function userForSession(
  pool: pg.Pool,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const r = await pool.query(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  return row ? { userId: row.id, email: row.email } : null;
}

export type SignupResult = { userId: string } | "bad_invite" | "email_taken";

/** Redeems an invite and creates the account in one transaction. */
export async function signup(
  pool: pg.Pool,
  invite: string,
  email: string,
  password: string,
): Promise<SignupResult> {
  // Cheap check first, so a made-up invite doesn't cost a password hash.
  const live = await pool.query(
    "SELECT 1 FROM invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
    [hashToken(invite)],
  );
  if (!live.rowCount) return "bad_invite";
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Invite first, so a bad invite never reveals which emails have accounts.
    const used = await client.query(
      `UPDATE invites SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(invite)],
    );
    if (!used.rowCount) {
      await client.query("ROLLBACK");
      return "bad_invite";
    }
    const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (taken.rowCount) {
      await client.query("ROLLBACK");
      return "email_taken";
    }
    await client.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [
      userId,
      email,
      passwordHash,
    ]);
    await client.query("UPDATE invites SET used_by = $2 WHERE token_hash = $1", [
      hashToken(invite),
      userId,
    ]);
    await client.query("COMMIT");
    return { userId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    // Two signups with one email racing past the check above.
    if ((err as { code?: string }).code === "23505") return "email_taken";
    throw err;
  } finally {
    client.release();
  }
}

export async function login(
  pool: pg.Pool,
  email: string,
  password: string,
): Promise<string | null> {
  const r = await pool.query("SELECT id, password_hash FROM users WHERE email = $1", [email]);
  const row = r.rows[0];
  const ok = await verifyPassword(row ? row.password_hash : await decoyHash(), password);
  return row && ok ? row.id : null;
}

/** Admin: new password for an account; every existing session ends. */
export async function resetPassword(
  pool: pg.Pool,
  email: string,
  password: string,
): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  const r = await pool.query("UPDATE users SET password_hash = $2 WHERE email = $1 RETURNING id", [
    email,
    passwordHash,
  ]);
  if (!r.rowCount) return false;
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [r.rows[0].id]);
  return true;
}

/**
 * Signed-in person changes their own password. Needs the current one; every other session
 * of the account ends, the one making the change stays.
 */
export async function changePassword(
  pool: pg.Pool,
  userId: string,
  keepToken: string,
  current: string,
  next: string,
): Promise<boolean> {
  const r = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const row = r.rows[0];
  if (!row || !(await verifyPassword(row.password_hash, current))) return false;
  const passwordHash = await hashPassword(next);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
    await client.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [
      userId,
      hashToken(keepToken),
    ]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test account (CC-046): makes sure the account exists with exactly this password. An
 * account that already has it is left alone, so a restart signs nobody out.
 */
export async function ensureAccount(
  pool: pg.Pool,
  email: string,
  password: string,
): Promise<"created" | "updated" | "unchanged"> {
  const r = await pool.query("SELECT id, password_hash FROM users WHERE email = $1", [email]);
  const row = r.rows[0];
  if (!row) {
    // A race with another instance starting up loses on the unique email: that is "unchanged".
    const made = await pool.query(
      "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
      [randomUUID(), email, await hashPassword(password)],
    );
    return made.rowCount ? "created" : "unchanged";
  }
  if (await verifyPassword(row.password_hash, password)) return "unchanged";
  await resetPassword(pool, email, password);
  return "updated";
}

/** Admin: removes an account, its sessions and its saved data. */
export async function deleteUser(pool: pg.Pool, email: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("DELETE FROM users WHERE email = $1 RETURNING id", [email]);
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const id: string = r.rows[0].id;
    // Ids are generated UUIDs, so they hold no LIKE wildcards.
    await client.query("DELETE FROM documents WHERE path LIKE $1", [`data/users/${id}/%`]);
    await client.query("DELETE FROM ai_usage WHERE user_id = $1", [id]);
    // Transition (migration 004): the old table is kept in step until it is dropped.
    await client.query("DELETE FROM coach_usage WHERE user_id = $1", [id]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Admin: tokens per month for one person; null puts them back on the server default. */
export async function setAllowance(
  pool: pg.Pool,
  email: string,
  tokens: number | null,
): Promise<boolean> {
  const r = await pool.query("UPDATE users SET monthly_allowance = $2 WHERE email = $1", [
    email,
    tokens,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export interface UserRow {
  email: string;
  monthlyAllowance: number | null;
  createdAt: Date;
}

export async function listUsers(pool: pg.Pool): Promise<UserRow[]> {
  const r = await pool.query(
    "SELECT email, monthly_allowance, created_at FROM users ORDER BY created_at",
  );
  return r.rows.map((x) => ({
    email: x.email,
    monthlyAllowance: x.monthly_allowance === null ? null : Number(x.monthly_allowance),
    createdAt: x.created_at,
  }));
}

export const randomPassword = (): string => randomBytes(15).toString("base64url");
