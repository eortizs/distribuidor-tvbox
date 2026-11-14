-- Conversación unificada del asistente (PWA y WhatsApp comparten la misma
-- historia por usuario). Idempotente.
CREATE TABLE IF NOT EXISTS assistant_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  -- Canal de origen del turno: web (Asistente de la PWA) o whatsapp.
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_messages_user_recent_idx
  ON assistant_messages (user_id, id DESC);
