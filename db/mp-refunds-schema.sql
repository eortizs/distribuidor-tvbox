-- Reembolsos (módulo reembolsos): extiende mp_orders con los estados del
-- flujo de devolución y crea la tabla de auditoría mp_refunds.
--
-- Política: solo se reembolsa una orden cobrada por Mercado Pago cuya
-- renovación en FlujoTV NO se consumió (`renewal_failed`). El reclamo
-- atómico `renewal_failed → refunding` bloquea reintentos de renovación en
-- paralelo; el resultado es `refunded` (terminal) o de vuelta a
-- `renewal_failed` con el error de MP registrado. Una orden `refunded` no se
-- reintenta nunca.
--
-- `mp_refunds` guarda cada devolución ejecutada: quién, cuándo, monto y el
-- `mp_refund_id` que devuelve la API de pagos de Mercado Pago
-- (`POST /v1/payments/{payment_id}/refunds`, reembolso total, body vacío).

ALTER TABLE mp_orders DROP CONSTRAINT IF EXISTS mp_orders_status_check;

ALTER TABLE mp_orders ADD CONSTRAINT mp_orders_status_check CHECK (status IN (
  'pending', 'paid', 'renewed',
  'renewal_failed', 'rejected', 'cancelled',
  'refunding', 'refunded'
));

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE TABLE IF NOT EXISTS mp_refunds (
  id           uuid PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES mp_orders(id) ON DELETE RESTRICT,
  payment_id   bigint NOT NULL,
  amount       numeric(10,2) NOT NULL,
  currency     text NOT NULL DEFAULT 'MXN',
  mp_refund_id bigint UNIQUE,
  status       text NOT NULL,
  reason       text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_refunds_order_idx ON mp_refunds (order_id);

-- Listado de la sección admin: reembolsables primero, reembolsadas visibles.
CREATE INDEX IF NOT EXISTS mp_orders_refunds_view_idx ON mp_orders (updated_at DESC)
  WHERE method = 'mercadopago' AND status IN ('renewal_failed', 'refunding', 'refunded');
