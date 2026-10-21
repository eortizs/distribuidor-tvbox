-- Per-user settings: the image models behind each level of the quality slider
-- ("media" / "alta") in the images tool.
--
-- Each level holds a list of model entries: the first is the primary model
-- and the second is the fallback used when the primary fails. Every entry
-- carries its own render quality and output size, because each provider
-- exposes those controls differently.
--
-- While a user has no row here, the mapping falls back to IMAGE_MODELS
-- (.env): two models per level, in order (principal, respaldo).

CREATE TABLE IF NOT EXISTS user_settings (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  image_levels jsonb,                                  -- { media: [...], alta: [...] }
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Bases migradas con el esquema anterior (una columna por campo).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS image_levels jsonb;
ALTER TABLE user_settings DROP COLUMN IF EXISTS image_media_model;
ALTER TABLE user_settings DROP COLUMN IF EXISTS image_alta_model;
ALTER TABLE user_settings DROP COLUMN IF EXISTS image_media_quality;
ALTER TABLE user_settings DROP COLUMN IF EXISTS image_alta_quality;
ALTER TABLE user_settings DROP COLUMN IF EXISTS image_media_size;
ALTER TABLE user_settings DROP COLUMN IF EXISTS image_alta_size;
