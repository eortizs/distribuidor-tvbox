-- Image generation history and billing ("tarificador"): one row per generated
-- image; the binary lives on disk through user_files (kind 'generated') and is
-- served via /api/files/<fileId>.

CREATE TABLE IF NOT EXISTS image_generations (
  id           uuid PRIMARY KEY,                     -- UUID (server-generated)
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id      uuid REFERENCES user_files(id) ON DELETE SET NULL,
  prompt       text NOT NULL,
  model        text NOT NULL,                        -- e.g. openai/gpt-image-2.5-sunburst
  aspect_ratio text,
  quality      text,
  cost_usd     numeric(12, 6),                       -- provider-reported USD cost; NULL = unknown
  deleted_at   timestamptz,                          -- soft delete: hides the image, keeps the cost in totals
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_generations_by_user ON image_generations (user_id, created_at DESC);

-- Installs created before soft delete existed.
ALTER TABLE image_generations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
