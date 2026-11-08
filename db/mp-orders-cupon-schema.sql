-- Órdenes de pago por cupón: el código canjeado queda en la orden para la
-- futura conciliación con el catálogo de cupones autorizados. El flujo actual
-- solo acepta el cupón 0000 (compra directa de QA, con `COUPON_QA_ENABLED`);
-- la renovación se ejecuta al instante con la misma clave de idempotencia
-- `mp-<id>`.
--
-- `coupon_request_id` identifica la INTENCIÓN de canje en el cliente: el
-- mismo id en un reintento (respuesta perdida, doble clic) devuelve la orden
-- original en lugar de crear otra y sumar otro mes.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS mp_orders_coupon_request_uidx
  ON mp_orders (coupon_request_id)
  WHERE method = 'cupon' AND coupon_request_id IS NOT NULL;
