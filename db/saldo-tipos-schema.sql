-- Dos tipos de saldo para el módulo «Abonar saldo» (/modulos/abonar-saldo):
--
-- - saldo_cupones: la billetera para la compra/renovación de licencias de
--   FlujoTV. ES la columna `users.saldo` renombrada: todo el saldo que los
--   usuarios ya tenían queda direccionado aquí sin migración de datos.
-- - saldo_tokens: billetera nueva para pagar el uso de herramientas que
--   consumen APIs externas (fal.ai, OpenRouter, etc.). Empieza en 0 para
--   todas las cuentas.
--
-- Trazabilidad del destino:
-- - `mp_orders.saldo_tipo` guarda el tipo de saldo que acredita cada orden
--   de abono (`months = 0`); NULL en órdenes de renovación y en abonos
--   legados, que se interpretan como cupones.
-- - `saldo_movimientos.tipo` rotula cada movimiento con la billetera que
--   tocó (los históricos quedan en 'cupones': eran saldo para licencias).
--   `balance_after` pasa a ser el saldo DESPUÉS del movimiento EN ESA
--   billetera.

-- El renombrado exige el estado exacto «saldo existe, saldo_cupones no»:
-- la cadena de deploy re-ejecuta apply-saldo.mjs (que re-crea `saldo` con
-- IF NOT EXISTS tras el renombrado), así que un guard que solo mire `saldo`
-- fallaría con 42710 en el segundo deploy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'
       AND column_name = 'saldo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'
       AND column_name = 'saldo_cupones'
  ) THEN
    ALTER TABLE users RENAME COLUMN saldo TO saldo_cupones;
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS saldo_cupones numeric(12,2) NOT NULL DEFAULT 0;

-- Limpia la columna que apply-saldo.mjs re-crea en cada re-ejecución de la
-- cadena (después del renombrado queda vacía y a 0: nada la escribe ya).
ALTER TABLE users DROP COLUMN IF EXISTS saldo;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS saldo_tokens numeric(12,2) NOT NULL DEFAULT 0;

-- Destino del abono en la orden de pago (NULL = renovación o abono legado).
ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS saldo_tipo text;

ALTER TABLE mp_orders DROP CONSTRAINT IF EXISTS mp_orders_saldo_tipo_check;
ALTER TABLE mp_orders ADD CONSTRAINT mp_orders_saldo_tipo_check
  CHECK (saldo_tipo IN ('tokens', 'cupones'));

-- Billetera del movimiento en el libro mayor; los históricos heredan
-- 'cupones' (el saldo viejo era para licencias).
ALTER TABLE saldo_movimientos
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'cupones';

ALTER TABLE saldo_movimientos DROP CONSTRAINT IF EXISTS saldo_movimientos_tipo_check;
ALTER TABLE saldo_movimientos ADD CONSTRAINT saldo_movimientos_tipo_check
  CHECK (tipo IN ('tokens', 'cupones'));

-- Historial filtrado por billetera (lo más nuevo primero).
CREATE INDEX IF NOT EXISTS saldo_movimientos_user_tipo_idx
  ON saldo_movimientos (user_id, tipo, created_at DESC);
