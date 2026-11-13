-- Bitácora durable del ciclo de vida de las renovaciones de `mp_orders`.
--
-- El log de pm2 rota y se pierde; esta tabla permite seguir UN caso concreto
-- (por `order_id` o por `transaction_id`) sin depender del historial de
-- consola: cada intento de renovación (webhook, cupón, scheduler,
-- conciliación o reintento del admin) corre bajo un `transaction_id` propio
-- y va dejando eventos aquí — inicio, línea base, respuesta del panel,
-- verificación, reintento agendado y fallo definitivo. Es la base del
-- monitoreo de falsos negativos («el cupón se aceptó pero la renovación no
-- se confirmó»): la cadena de eventos demuestra qué pasó y cuándo.

CREATE TABLE IF NOT EXISTS mp_order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL,
  transaction_id text NOT NULL,
  event text NOT NULL,
  outcome text,
  attempt integer,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_order_events_order_idx
  ON mp_order_events (order_id, id);

CREATE INDEX IF NOT EXISTS mp_order_events_tx_idx
  ON mp_order_events (transaction_id);

-- La poda por retención (scheduler de renovaciones, una vez por hora)
-- recorre la tabla por fecha sin secuencia completa.
CREATE INDEX IF NOT EXISTS mp_order_events_created_idx
  ON mp_order_events (created_at);
