import type pg from "pg";
import { createInvite, ensureAccount } from "./accounts.js";

/**
 * First-run helper for hosts without a shell (BOOTSTRAP_INVITE=1): while the
 * site has no accounts, prints one invite link in the start-up log. Does
 * nothing once anybody has signed up.
 */
export async function bootstrapInvite(pool: pg.Pool, publicUrl: string): Promise<string | null> {
  const r = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (r.rowCount) return null;
  // One live invite is enough: a restart must not leave more of them lying around.
  const open = await pool.query(
    "SELECT 1 FROM invites WHERE expires_at > now() AND used_at IS NULL LIMIT 1",
  );
  if (open.rowCount) return null;
  const inv = await createInvite(pool, "first account");
  return `First invite (one use, expires ${inv.expiresAt.toISOString().slice(0, 10)}): ${publicUrl}/#/invite/${inv.token}`;
}

/**
 * Opt-in test account (CC-046): when the server is started with TEST_ACCOUNT_PASSWORD, makes
 * sure an account with a dummy address exists with that password. The account bypasses the
 * invite, so it is for private previews only and never switched on by default.
 */
export async function ensureTestAccount(
  pool: pg.Pool,
  account: { email: string; password: string },
): Promise<string> {
  const r = await ensureAccount(pool, account.email, account.password);
  return `Test account ${account.email}: ${r}. Remove TEST_ACCOUNT_PASSWORD and run delete-user before public hosting.`;
}
