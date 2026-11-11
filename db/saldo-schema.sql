-- Saldo del panel (módulo «Abonar saldo», /modulos/abonar-saldo):
-- wallet por usuario del panel con historial de movimientos.
--
-- `saldo_cupones` es el disponible actual de la cuenta para licencias
-- FlujoTV (renombrado desde `saldo` por saldo-tipos-schema.sql; los tokens
-- para herramientas con APIs viven en `users.saldo_tokens`); este script
-- crea `saldo_cupones` directamente para que instalaciones frescas y
-- re-ejecuciones converjan al mismo esquema. `saldo_movimientos` es el
-- libro
-- mayor (una fila por abono aplicado; `cargo`/`ajuste` quedan previstos para
-- el gasto y la corrección manual del admin). Cada abono queda trazado con
-- la orden de pago que lo originó (`order_id` único: el crédito idempotente
-- de `apply-saldo` nunca acredita dos veces la misma orden).
--
-- Las órdenes de abono viven en `mp_orders` con `months = 0` (las de
-- renovación validan 1/3/6/12, así que 0 no colisiona) y terminan en el
-- estado nuevo `applied` cuando el saldo ya se acreditó.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS saldo_cupones numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS saldo_movimientos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Orden de pago que originó el abono (null solo en ajustes manuales).
  order_id      uuid REFERENCES mp_orders(id) ON DELETE SET NULL,
  -- abono | cargo | ajuste
  kind          text NOT NULL CHECK (kind IN ('abono', 'cargo', 'ajuste')),
  amount        numeric(12,2) NOT NULL,
  -- Saldo de la cuenta después del movimiento (evidencia del momento).
  balance_after numeric(12,2) NOT NULL,
  note          text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Historial de una cuenta: lo más nuevo primero.
CREATE INDEX IF NOT EXISTS saldo_movimientos_user_idx
  ON saldo_movimientos (user_id, created_at DESC);

-- Idempotencia del abono: una orden acredita exactamente un movimiento.
CREATE UNIQUE INDEX IF NOT EXISTS saldo_movimientos_order_uidx
  ON saldo_movimientos (order_id)
  WHERE order_id IS NOT NULL;

-- Estado final de las órdenes de abono: el crédito ya se aplicó a la cuenta.
ALTER TABLE mp_orders DROP CONSTRAINT IF EXISTS mp_orders_status_check;

ALTER TABLE mp_orders ADD CONSTRAINT mp_orders_status_check CHECK (status IN (
  'pending', 'paid', 'renewed', 'applied',
  'renewal_failed', 'rejected', 'cancelled',
  'refunding', 'refunded'
));
