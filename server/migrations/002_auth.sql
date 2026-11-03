-- Accounts, invites and sessions (CC-043c). Tokens are stored only as SHA-256 hashes.
CREATE TABLE users (
  id                 text PRIMARY KEY,
  email              text NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  -- Coach tokens per month; NULL means the server default (read by the coach endpoint).
  monthly_allowance  bigint CHECK (monthly_allowance IS NULL OR monthly_allowance >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  token_hash  text PRIMARY KEY,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by     text REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
