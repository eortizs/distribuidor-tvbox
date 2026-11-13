-- Módulo WhatsApp (Baileys): espejo de la campana de notificaciones y agente
-- de consultas vía chat. Tres piezas:
--
-- 1. `users.whatsapp_phone`: número de WhatsApp del usuario (solo dígitos con
--    código de país, p. ej. 525540049353). Único: un número = una cuenta, es
--    la identidad con la que el agente resuelve quién habla (el teléfono
--    verificado por WhatsApp ES la autenticación).
-- 2. `wa_outbox`: cola de salida duradera. Cada notificación de campana de un
--    usuario con WhatsApp registrado encola aquí una copia; el dispatcher del
--    proceso la entrega con reintentos y backoff. Sobrevive reinicios y
--    desconexiones del socket: mientras WhatsApp esté caído los mensajes
--    quedan `pending` y salen al reconectar.
-- 3. `wa_message_log`: bitácora de mensajes entrantes y salientes (auditoría
--    y contexto del módulo admin). Se poda a 90 días desde el dispatcher.

ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone text;

CREATE UNIQUE INDEX IF NOT EXISTS users_whatsapp_phone_uidx
  ON users (whatsapp_phone)
  WHERE whatsapp_phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS wa_outbox (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id uuid,
  phone text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  kind text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS wa_outbox_pending_idx
  ON wa_outbox (next_attempt_at)
  WHERE status IN ('pending', 'sending');

-- Listado del módulo admin (polled cada 15 s): pendientes/fallidos primero
-- por creación. Sin este índice parcial la consulta sería un seq scan que
-- crece con la tabla para siempre.
CREATE INDEX IF NOT EXISTS wa_outbox_open_created_idx
  ON wa_outbox (created_at DESC)
  WHERE status <> 'sent';

CREATE INDEX IF NOT EXISTS wa_outbox_user_created_idx
  ON wa_outbox (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_message_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  user_id uuid,
  phone text NOT NULL,
  text text NOT NULL DEFAULT '',
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_message_log_created_idx
  ON wa_message_log (created_at DESC);
