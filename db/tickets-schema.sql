-- Alta de tickets (/modulos/alta-de-tickets): control de los tickets de
-- compra/gasto guardados como entidades umeJSON (entity_name
-- 'TicketCompra'). El documento `entities.doc` es la fuente de verdad de los
-- datos extraídos y corregidos; esta tabla solo lleva el vínculo fuerte con
-- la foto (user_files), la idempotencia por `request_id`, la deduplicación
-- por contenido (sha256) y el estado del análisis del LLM (lease incluido
-- para single-flight entre procesos).
--
-- La foto NO la borra el sweep de adjuntos ni DELETE /api/files/[id]: ambos
-- consultan esta tabla antes de tocar disco (ver db/sweep-attachments.mjs y
-- el route de files). La FK es RESTRICT como última red; deleteAccount
-- elimina primero los tickets del usuario para que la baja de cuenta nunca
-- se bloquee.

CREATE TABLE IF NOT EXISTS tickets (
  entity_id        uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id          uuid NOT NULL REFERENCES user_files(id) ON DELETE RESTRICT,
  request_id       text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status      text NOT NULL DEFAULT 'pending'
                     CHECK (scan_status IN ('pending', 'processing', 'succeeded', 'failed')),
  scan_attempt     bigint NOT NULL DEFAULT 0,
  scan_lease_until timestamptz,
  scan_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia de la alta por petición del cliente y deduplicación por
-- contenido: el mismo archivo del mismo usuario devuelve el ticket existente.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_by_request ON tickets (user_id, request_id);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_by_sha ON tickets (user_id, sha256);

CREATE INDEX IF NOT EXISTS tickets_by_user ON tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_by_file ON tickets (file_id);
