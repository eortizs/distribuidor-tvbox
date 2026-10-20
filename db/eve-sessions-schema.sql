-- EVE agent session ownership: binds each durable eve session to its creator.

CREATE TABLE IF NOT EXISTS eve_sessions (
  session_id text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eve_sessions_by_user ON eve_sessions (user_id);
