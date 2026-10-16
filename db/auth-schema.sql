-- Authentication schema: users + sessions.

CREATE TABLE users (
  id            uuid PRIMARY KEY,                -- UUID v7
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,                   -- scrypt:N:r:p:salt:hash
  role          text NOT NULL CHECK (role IN ('admin', 'distribuidor')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_by_role ON users (role);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY,                    -- UUID v7
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,                -- sha256 of the cookie token
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
