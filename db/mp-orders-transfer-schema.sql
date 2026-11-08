-- Órdenes de pago por transferencia bancaria: extiende mp_orders con el
-- método de pago y el comprobante (ticket) que el comprador sube.
--
-- Transferencia = orden `pending` creada al enviar el ticket; el admin la
-- revisa (aprueba → `paid` + renovación con la misma clave de idempotencia
-- `mp-<id>`, o rechaza → `rejected`). Mercado Pago sigue `method` por
-- defecto, así que las filas existentes no cambian de significado.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'mercadopago';

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS ticket_file_id uuid REFERENCES user_files(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mp_orders_method_pending_idx ON mp_orders (created_at DESC)
  WHERE method = 'transferencia' AND status = 'pending';
