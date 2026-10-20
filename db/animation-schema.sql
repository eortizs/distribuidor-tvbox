-- Animation agent metering and gallery ("tarificador" + contador de tiempo):
-- one row per model step (cost), one row per turn (working time), one row per
-- delivered file. Binaries live on disk through user_files (kind 'generated')
-- and are served via /api/files/<fileId>.

-- Cost per model step reported by the AI Gateway for the animation agent.
CREATE TABLE IF NOT EXISTS animation_costs (
  id            uuid PRIMARY KEY,                     -- UUID (server-generated)
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    text NOT NULL,                        -- EVE session id
  turn_id       text NOT NULL,                        -- EVE turn id
  step_index    int  NOT NULL,
  model         text NOT NULL,
  cost_usd      numeric(12, 6),                       -- provider-reported USD cost; NULL = unknown
  input_tokens  bigint,
  output_tokens bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_id, step_index)            -- retried steps upsert in place
);

CREATE INDEX IF NOT EXISTS animation_costs_by_user ON animation_costs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS animation_costs_by_session ON animation_costs (session_id);
CREATE INDEX IF NOT EXISTS animation_costs_by_turn ON animation_costs (session_id, turn_id);

-- Working time per agent turn: wall-clock minus time parked waiting for a human.
CREATE TABLE IF NOT EXISTS animation_turns (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id     text NOT NULL,
  turn_id        text NOT NULL,
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz,
  wait_input_ms  bigint NOT NULL DEFAULT 0 CHECK (wait_input_ms >= 0),
  duration_ms    bigint,                              -- (ended_at - started_at) - wait_input_ms; NULL while open
  UNIQUE (session_id, turn_id)
);

CREATE INDEX IF NOT EXISTS animation_turns_by_user ON animation_turns (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS animation_turns_by_session ON animation_turns (session_id);

-- Files delivered by the animation agent through the guardar_archivo tool.
CREATE TABLE IF NOT EXISTS animation_deliverables (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id    uuid REFERENCES user_files(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  turn_id    text,
  file_name  text NOT NULL,
  mime_type  text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  deleted_at timestamptz,                             -- soft delete: hides the file, keeps spend/time totals
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS animation_deliverables_by_user
  ON animation_deliverables (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS animation_deliverables_by_session
  ON animation_deliverables (session_id);

-- Idempotent anchor for the per-turn expense mirror in the expense control.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_animation_session_id text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_animation_turn_id text;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_by_source_animation_turn
  ON expenses (source_animation_session_id, source_animation_turn_id);
