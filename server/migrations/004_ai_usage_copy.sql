-- Copy the coach token ledger to the harness AI module's table name (same columns, same rows).
-- `coach_usage` stays, and the server keeps writing to both tables (and deleting from both) during
-- the transition, so rolling back a failed deploy finds a current table and nobody's allowance
-- is lost. Drop `coach_usage` and the second write in a later release, once this one has run cleanly.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id  text   NOT NULL,
  month    date   NOT NULL,
  tokens   bigint NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  PRIMARY KEY (user_id, month)
);
INSERT INTO ai_usage (user_id, month, tokens) SELECT user_id, month, tokens FROM coach_usage;
