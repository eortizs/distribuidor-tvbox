-- Módulo Alertas: alertas de búsqueda programadas (con Google Search
-- grounding) y recordatorios, descritas en lenguaje natural y interpretadas
-- por un LLM (ALERTS_MODEL). Un scheduler en proceso (src/instrumentation.ts)
-- revisa las alertas vencidas y, cuando detecta el evento o vence un
-- recordatorio, avisa por la campana (tabla `notifications`, kinds nuevos) y
-- por notificación de sistema Android (Web Push, tabla `push_subscriptions`).
--
-- `alerts`: una fila por alerta. `kind` separa búsquedas de recordatorios y
-- el CHECK de forma garantiza la coherencia del schedule (search ⇔ frequency;
-- reminder ⇔ remind_at). `next_check_at` es el índice del scheduler (para los
-- recordatorios se iguala a remind_at al crear). `last_finding_fingerprint`
-- deduplica avisos de alertas recurrentes: no se vuelve a avisar el mismo
-- hallazgo. `status='error'` marca 3 fallos consecutivos del LLM (reactivable).
--
-- `alert_hits`: historial de revisiones (hallazgos con fuentes, recordatorios
-- disparados y errores) que pinta el módulo.
--
-- `push_subscriptions`: suscripciones Web Push (VAPID) por dispositivo del
-- usuario; el endpoint del push service es único y las filas caducadas se
-- borran cuando el servicio responde 404/410.
--
-- Además se amplía el CHECK de kinds de `notifications` con 'alert_hit' y
-- 'reminder' (migración idempotente al final).

CREATE TABLE IF NOT EXISTS alerts (
  id                       uuid PRIMARY KEY,
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                     text NOT NULL CHECK (kind IN ('search', 'reminder')),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN (
                             'active', 'paused', 'done', 'error'
                           )),
  mode                     text CHECK (mode IN ('once', 'recurring')),
  source_request           text NOT NULL,
  title                    text NOT NULL,
  query                    text,
  frequency                text CHECK (frequency IN (
                             'hourly', '6h', '12h', 'daily', 'weekly'
                           )),
  time_of_day              text,
  weekday                  smallint CHECK (weekday BETWEEN 0 AND 6),
  remind_at                timestamptz,
  attachments              jsonb,
  last_finding_fingerprint text,
  last_checked_at          timestamptz,
  last_hit_at              timestamptz,
  check_count              int NOT NULL DEFAULT 0,
  error_count              int NOT NULL DEFAULT 0,
  last_error               text,
  next_check_at            timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerts_kind_shape CHECK (
    (kind = 'search'
       AND frequency IS NOT NULL AND query IS NOT NULL AND remind_at IS NULL
       AND (frequency IN ('hourly', '6h', '12h') OR time_of_day IS NOT NULL))
    OR (kind = 'reminder'
       AND frequency IS NULL AND time_of_day IS NULL AND weekday IS NULL
       AND remind_at IS NOT NULL)
  )
);

-- El CHECK de forma se gestiona por DROP+ADD para que esta migración pueda
-- corregir versiones previas de la tabla sin perder datos.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_kind_shape;
ALTER TABLE alerts ADD CONSTRAINT alerts_kind_shape CHECK (
  (kind = 'search'
     AND frequency IS NOT NULL AND query IS NOT NULL AND remind_at IS NULL
     AND (frequency IN ('hourly', '6h', '12h') OR time_of_day IS NOT NULL))
  OR (kind = 'reminder'
     AND frequency IS NULL AND time_of_day IS NULL AND weekday IS NULL
     AND remind_at IS NOT NULL)
);

-- Los avisos de una alerta recurrente ya disparada pueden volver cuando haya
-- una novedad: el estado activo manda. `done`/`paused`/`error` salen del
-- índice del scheduler.
CREATE INDEX IF NOT EXISTS alerts_due_idx
  ON alerts (next_check_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS alerts_user_created_idx
  ON alerts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_hits (
  id          uuid PRIMARY KEY,
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('hit', 'reminder', 'error')),
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  sources     jsonb,
  fingerprint text,
  notified    boolean NOT NULL DEFAULT false,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_hits_user_checked_idx
  ON alert_hits (user_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS alert_hits_alert_checked_idx
  ON alert_hits (alert_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);

-- Kinds nuevos de la campana para el módulo: hallazgo de alerta y
-- recordatorio. Protegido con to_regclass para que el archivo sea
-- independiente del orden (sin la tabla, las sentencias abortarían toda la
-- migración). Idempotente: se suelta el CHECK previo y se vuelve a crear con
-- el conjunto ampliado (nunca rompe filas existentes: solo amplía).
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN (
        'renewal_success', 'renewal_failed', 'transfer_rejected',
        'alert_hit', 'reminder'
      ));
  END IF;
END $$;
