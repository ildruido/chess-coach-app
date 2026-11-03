-- Coach tokens used per user per UTC month (CC-043d). No foreign key: the dev test user has no account.
CREATE TABLE coach_usage (
  user_id  text   NOT NULL,
  month    date   NOT NULL,
  tokens   bigint NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  PRIMARY KEY (user_id, month)
);
