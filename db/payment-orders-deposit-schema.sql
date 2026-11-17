-- Confirmación de depósito (reporte SPEI) para órdenes de pago
-- (/modulos/orden-de-pago): el escaneo del comprobante ya NO basta para
-- declarar `paid`. Tras un comprobante válido la orden pasa a 'verifying'
-- y un verificador en background sondea la API de Mercado Pago (misma
-- fuente que /modulos/reporte-spei, ambos rieles: SPEI a la CLABE
-- `account_fund` + transferencia desde saldo MP `money_transfer`) hasta que
-- aparece el depósito acreditado.
--
-- MP NO expone el concepto escrito por el pagador (verificado en el payload
-- crudo), así que el depósito se casa por IMPORTE EXACTO + VENTANA
-- [created_at − 2 min, ahora] y el ID del pago de MP queda RESERVADO en
-- exclusiva por orden (índice único parcial): un depósito solo valida una
-- orden. El código impreso validado en el comprobante sigue siendo la prueba
-- que liga al pagador con la orden.
--
-- Ciclo de vida: 'pending' → 'verifying' (comprobante válido, esperando
-- depósito; el CÓDIGO SIGUE RESERVADO) → 'paid' | 'rejected' (automático o
-- manual) | 'cancelled'. El creador puede resolver manualmente desde
-- 'verifying' (override; la verificación es red de seguridad, no jaula).
--
-- Sin caducidad del estado: tras 24 h en 'verifying' el verificador escala
-- una sola vez (aviso a creador y pagador) y deja de sondear; la orden queda
-- en resolución manual. Columnas:
--   mp_payment_id       ID del pago de MP que confirmó el depósito (exclusivo).
--   mp_deposit_at       Fecha de acreditación del depósito según MP.
--   verifying_since     Cuándo entró en verificación (base del tope de 24 h).
--   deposit_next_check_at Próximo sondeo programado (backoff del verificador).
--   deposit_checks      Cuántos sondeos sin hallazgo (elige el backoff).
--   deposit_escalated_at  Escalamiento a manual ya avisado (una sola vez).

ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_status_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_status_check
  CHECK (status IN ('pending','verifying','paid','rejected','cancelled'));

ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS mp_payment_id text;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS mp_deposit_at timestamptz;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS verifying_since timestamptz;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS deposit_next_check_at timestamptz;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS deposit_checks int NOT NULL DEFAULT 0;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS deposit_escalated_at timestamptz;

-- El código de 4 caracteres sigue ÚNICO GLOBAL entre las órdenes ACTIVAS
-- (pending + verifying): durante la verificación el pagador puede reenviar
-- su comprobante/código y una orden futura jamás reasigna un código en
-- verificación.
DROP INDEX IF EXISTS payment_orders_active_code_idx;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_active_code_idx
  ON payment_orders (code) WHERE status IN ('pending','verifying');

-- «Resueltas» pasa a ser explícito (verifying NO es resuelta: los replays de
-- código y solicitud por monto no deben tratarla como tal).
DROP INDEX IF EXISTS payment_orders_resolved_code_idx;
CREATE INDEX IF NOT EXISTS payment_orders_resolved_code_idx
  ON payment_orders (code, resolved_at DESC)
  WHERE status IN ('paid','rejected','cancelled');

DROP INDEX IF EXISTS payment_orders_resolved_payer_idx;
CREATE INDEX IF NOT EXISTS payment_orders_resolved_payer_idx
  ON payment_orders (payer_phone, resolved_at DESC)
  WHERE status IN ('paid','rejected','cancelled') AND payer_phone IS NOT NULL;

-- Un depósito (ID de pago de MP) valida UNA sola orden: cierra la carrera de
-- dos verificaciones concurrentes que encuentran el mismo pago.
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_mp_payment_uidx
  ON payment_orders (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

-- Cola de sondeo del verificador: órdenes en verificación con sondeo
-- programado y aún no escaladas.
CREATE INDEX IF NOT EXISTS payment_orders_verifying_idx
  ON payment_orders (deposit_next_check_at)
  WHERE status = 'verifying' AND deposit_escalated_at IS NULL;

-- Las consultas activas (descubrimiento por comprobante/solicitud por
-- monto, tope de 20 por creador) pasaron a filtrar `status IN
-- ('pending','verifying')`: el índice original (`WHERE status='pending'`,
-- de payment-orders-schema.sql) dejó de servir su predicado y degradaba
-- esas consultas — incluida la de cada turno de comprobante de WhatsApp —
-- a seq-scan sobre la tabla histórica.
DROP INDEX IF EXISTS payment_orders_pending_created_idx;
CREATE INDEX IF NOT EXISTS payment_orders_pending_created_idx
  ON payment_orders (created_at) WHERE status IN ('pending','verifying');
