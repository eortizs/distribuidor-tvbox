-- Per-user file storage: files live on disk under storage/users/<userId>/<kind>/
-- (or USER_FILES_DIR); this table is the queryable index for those files.

CREATE TABLE IF NOT EXISTS user_files (
  id          uuid PRIMARY KEY,                     -- UUID (server-generated)
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('attachment', 'generated')),
  file_name   text NOT NULL,                        -- original client name (sanitized)
  stored_name text NOT NULL,                        -- file name inside the user's folder
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_files_by_user ON user_files (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_by_kind ON user_files (user_id, kind);
