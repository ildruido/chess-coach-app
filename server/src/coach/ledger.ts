import type pg from "pg";

/** First day of the UTC month containing `now`, as YYYY-MM-DD. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** When the allowance next resets: the first instant of the next UTC month. */
export function resetsAt(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export async function getUsed(pool: pg.Pool, userId: string, now: Date): Promise<number> {
  const r = await pool.query("SELECT tokens FROM coach_usage WHERE user_id = $1 AND month = $2", [
    userId,
    monthStart(now),
  ]);
  return r.rows[0] ? Number(r.rows[0].tokens) : 0;
}

export async function addUsage(
  pool: pg.Pool,
  userId: string,
  tokens: number,
  now: Date,
): Promise<void> {
  if (!(tokens > 0)) return;
  await pool.query(
    `INSERT INTO coach_usage (user_id, month, tokens) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, month) DO UPDATE SET tokens = coach_usage.tokens + EXCLUDED.tokens`,
    [userId, monthStart(now), Math.round(tokens)],
  );
}

/** The person's own allowance, else the server default. 0 switches the coach off for them. */
export async function allowanceFor(
  pool: pg.Pool,
  userId: string,
  fallback: number,
): Promise<number> {
  const r = await pool.query("SELECT monthly_allowance FROM users WHERE id = $1", [userId]);
  const own = r.rows[0]?.monthly_allowance;
  return own === null || own === undefined ? fallback : Number(own);
}
