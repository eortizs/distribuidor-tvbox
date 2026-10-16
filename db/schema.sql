-- umeJSON persistence schema (normative)
-- Source of truth: eortizs/ume-json-v1 docs/PERSISTENCE.md section 3.
-- Any implementation must reproduce these tables, columns and indexes exactly.

-- Head: one row per entity
CREATE TABLE entities (
  id          uuid PRIMARY KEY,                 -- UUID v7, generated at /finalize
  entity_name text NOT NULL,                    -- mirror of doc->>'entityName'
  doc         jsonb NOT NULL,                   -- full umeJSON document (current state)
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz                      -- soft delete; NULL = live
);

CREATE INDEX entities_by_name ON entities (entity_name);
CREATE INDEX entities_doc_gin ON entities USING gin (doc jsonb_path_ops);

-- Journal: append-only behavior log
CREATE TABLE entity_events (
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  seq         integer NOT NULL CHECK (seq >= 1),   -- 1, 2, 3... per entity, no gaps
  event_type  text NOT NULL,                       -- closed list, see PERSISTENCE.md section 6
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- event data (diff, from/to, etc.)
  actor       text NOT NULL DEFAULT 'system',      -- user | system | process/agent id
  reason      text,
  occurred_at timestamptz NOT NULL,                -- business time (when it happened)
  recorded_at timestamptz NOT NULL DEFAULT now(),  -- system time (when it hit the DB)
  PRIMARY KEY (entity_id, seq)
);

CREATE INDEX entity_events_by_type ON entity_events (event_type, occurred_at);
