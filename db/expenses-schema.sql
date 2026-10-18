-- Expense tracking ("control de gastos"): one row per expense registered by a
-- user, either from the Finanzas › Gastos UI or through the assistant tools.
-- Amounts are stored in the currency they were paid in (MXN or USD); the
-- Banxico FIX rate snapshot and the MXN equivalent are frozen at registration
-- so historical reports stay stable even if rates move later.

CREATE TABLE IF NOT EXISTS expenses (
  id             uuid PRIMARY KEY,                    -- UUID v4, server-generated
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description    text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  category       text NOT NULL,                       -- closed list, validated app-side
  amount         numeric(14, 6) NOT NULL CHECK (amount > 0),
  currency       text NOT NULL CHECK (currency IN ('MXN', 'USD')),
  exchange_rate  numeric(12, 6) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
                 -- Banxico FIX (MXN per USD) for spent_on; NULL for MXN rows
  mxn_equivalent numeric(16, 6) CHECK (mxn_equivalent IS NULL OR mxn_equivalent >= 0),
                 -- amount converted to MXN at registration; NULL = rate unavailable
  spent_on       date NOT NULL,                       -- business day (America/Mexico_City)
  notes          text CHECK (notes IS NULL OR length(notes) <= 1000),
  created_by     text NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'asistente', 'sistema')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,                         -- soft delete; NULL = live
  source_image_id uuid UNIQUE REFERENCES image_generations(id) ON DELETE SET NULL
                 -- mirror of a tarificador cost; keeps image costs inside the
                 -- expense control exactly once (unique = idempotent backfill)
);

CREATE INDEX IF NOT EXISTS expenses_by_user_date ON expenses (user_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS expenses_by_user_category ON expenses (user_id, category);

-- Upgrades for installs created before image-cost mirroring.
ALTER TABLE expenses ALTER COLUMN amount TYPE numeric(14, 6);
ALTER TABLE expenses ALTER COLUMN mxn_equivalent TYPE numeric(16, 6);
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_created_by_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_created_by_check
  CHECK (created_by IN ('user', 'asistente', 'sistema'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_image_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_by_source_image ON expenses (source_image_id);
