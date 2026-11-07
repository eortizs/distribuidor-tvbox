-- Órdenes de pago de licencias vía Mercado Pago (Checkout Pro,
-- purpose wallet_purchase).
--
-- Una fila por intento de compra: el botón de compra de /clientes crea la
-- orden `pending`, redirige al checkout de Mercado Pago y el webhook
-- (`POST /api/mercadopago/webhook`) la mueve a `paid` cuando el pago llega
-- aprobado y verificado contra la API de MP; después renueva la licencia en
-- el panel FlujoTV y la deja en `renewed` (o `renewal_failed` si la
-- renovación falla con el cobro ya hecho, caso que exige reintento manual
-- desde el endpoint admin de reintento).
--
-- `external_reference` = `id`: viaja en la preferencia de Mercado Pago y
-- vuelve en cada notificación de pago, de modo que la verificación no
-- depende de datos enviados por el navegador.

CREATE TABLE IF NOT EXISTS mp_orders (
  id                 uuid PRIMARY KEY,
  status             text NOT NULL CHECK (status IN (
                       'pending', 'paid', 'renewed',
                       'renewal_failed', 'rejected', 'cancelled'
                     )),
  user_name          text NOT NULL,
  months             int  NOT NULL DEFAULT 1,
  amount             numeric(10,2) NOT NULL,
  currency           text NOT NULL DEFAULT 'MXN',
  buyer_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  preference_id      text,
  payment_id         bigint,
  payment_status     text,
  external_reference text NOT NULL,
  error              text,
  renewed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_orders_buyer_idx ON mp_orders (buyer_user_id);
CREATE INDEX IF NOT EXISTS mp_orders_payment_idx ON mp_orders (payment_id)
  WHERE payment_id IS NOT NULL;
