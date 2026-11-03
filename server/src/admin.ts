import pg from "pg";
import {
  INVITE_DAYS,
  createInvite,
  deleteUser,
  listUsers,
  normalizeEmail,
  randomPassword,
  resetPassword,
  setAllowance,
} from "./accounts.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db.js";

const USAGE = `Chess Coach admin (run on the server, with DATABASE_URL set)

  invite [note] [--days N]        make a one-use invite link (default ${INVITE_DAYS} days)
  reset-password <email>          set a new random password and sign the person out everywhere
  set-allowance <email> <tokens>  coach tokens per month for one person ("default" to clear)
  delete-user <email>             remove an account with its sessions and saved games
  list-users                      show accounts and allowances`;

export async function run(args: string[], pool: pg.Pool, publicUrl: string): Promise<string> {
  const [cmd, ...rest] = args;
  if (cmd === "invite") {
    const i = rest.indexOf("--days");
    let days = INVITE_DAYS;
    if (i >= 0) {
      days = Number(rest[i + 1]);
      rest.splice(i, 2);
      if (!Number.isInteger(days) || days < 1 || days > 90)
        throw new Error("--days must be 1 to 90");
    }
    const inv = await createInvite(pool, rest.join(" "), days);
    return `Invite link (one use, expires ${inv.expiresAt.toISOString().slice(0, 10)}):\n${publicUrl}/#/invite/${inv.token}`;
  }
  if (cmd === "reset-password") {
    const email = normalizeEmail(rest[0]);
    if (!email) throw new Error("usage: reset-password <email>");
    const password = randomPassword();
    if (!(await resetPassword(pool, email, password)))
      throw new Error("no account with that email");
    return `New password for ${email} (shown once; they can change it after signing in):\n${password}`;
  }
  if (cmd === "set-allowance") {
    const email = normalizeEmail(rest[0]);
    const raw = rest[1];
    const tokens = raw === "default" ? null : /^\d{1,15}$/.test(raw ?? "") ? Number(raw) : NaN;
    if (!email || Number.isNaN(tokens))
      throw new Error('usage: set-allowance <email> <tokens|"default">');
    if (!(await setAllowance(pool, email, tokens))) throw new Error("no account with that email");
    return `${email}: ${tokens === null ? "server default" : `${tokens} tokens per month`}`;
  }
  if (cmd === "delete-user") {
    const email = normalizeEmail(rest[0]);
    if (!email) throw new Error("usage: delete-user <email>");
    if (!(await deleteUser(pool, email))) throw new Error("no account with that email");
    return `Deleted ${email}.`;
  }
  if (cmd === "list-users") {
    const users = await listUsers(pool);
    return users.length
      ? users
          .map(
            (u) =>
              `${u.email}  allowance: ${u.monthlyAllowance ?? "default"}  since ${u.createdAt.toISOString().slice(0, 10)}`,
          )
          .join("\n")
      : "No accounts yet.";
  }
  return USAGE;
}

// Only when run directly (tests import `run`).
if (process.argv[1]?.endsWith("admin.js") || process.argv[1]?.endsWith("admin.ts")) {
  const config = loadConfig(process.env, "admin");
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    await migrate(pool);
    process.stdout.write(`${await run(process.argv.slice(2), pool, config.publicUrl)}\n`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
