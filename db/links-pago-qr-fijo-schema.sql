-- QR FIJO de cobro (/modulos/links-de-pago): cada cobrador tiene un QR
-- permanente (spei.link/cobro/<CÓDIGO>) para cobros LIBRES — el pagador
-- transfiere el monto que quiera con el concepto que quiera y envía su
-- comprobante por WhatsApp; la orden nace de ese comprobante y solo se
-- confirma cuando el depósito acredita en Mercado Pago.
--
-- Tres piezas:
--   - users.payment_qr_code: código de 6 caracteres del alfabeto sin
--     ambigüedad (el de los links tiene 4: nunca se confunden). Es el
--     identificador del QR del cobrador — viaja en el mensaje inicial
--     («Solicito realizar un pago. (cobrador XXXXXX)») porque un mismo
--     número de WhatsApp atiende a todos los cobradores del panel. Se asigna
--     la primera vez que el cobrador pide su QR y jamás se reasigna.
--   - payment_qr_requests: la SOLICITUD de cada pagador (quién escaneó y de
--     quién). Un comprobante se atribuye al cobrador de la solicitud vigente
--     del MISMO teléfono de WhatsApp: es la identidad del pagador. Una fila
--     por (tenant, teléfono, cobrador); reescanear refresca el último escaneo.
--   - payment_orders.origin: 'link' (importe y concepto del cobrador, el
--     comportamiento de siempre) | 'qr' (pago libre: importe leído del
--     comprobante, `note` = concepto libre informativo, `created_at` =
--     cuándo pagó el pagador, que abre la ventana del depósito).
--
-- Todo es aditivo e idempotente. La tabla nueva lleva tenant_id + trigger +
-- RLS (regla de tenancy); las otras dos ya los tenían.

ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_qr_code
  text CHECK (payment_qr_code IS NULL OR payment_qr_code ~ '^[A-HJ-NP-Z2-9]{6}$');

-- Un código identifica a UN cobrador, para siempre.
CREATE UNIQUE INDEX IF NOT EXISTS users_payment_qr_code_uidx
  ON users (payment_qr_code) WHERE payment_qr_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_qr_requests (
  payer_phone       text NOT NULL,
  payer_name        text CHECK (payer_name IS NULL OR char_length(payer_name) BETWEEN 1 AND 80),
  cobrador_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, payer_phone, cobrador_user_id)
);

-- El canal las consulta por teléfono con el último escaneo vigente.
CREATE INDEX IF NOT EXISTS payment_qr_requests_payer_idx
  ON payment_qr_requests (payer_phone, last_requested_at DESC);

DROP TRIGGER IF EXISTS set_tenant_id ON payment_qr_requests;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON payment_qr_requests
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE payment_qr_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_qr_requests;
CREATE POLICY tenant_isolation ON payment_qr_requests
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT, UPDATE ON payment_qr_requests TO speilink_app;
-- Los privilegios por defecto del esquema dan DELETE a la app; aquí no se
-- borra nada (la vigencia la decide la consulta), así que se retira.
REVOKE DELETE ON payment_qr_requests FROM speilink_app;

ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS origin
  text NOT NULL DEFAULT 'link';
ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_origin_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_origin_check
  CHECK (origin IN ('link','qr'));

-- Índices de la versión con caducidad de solicitudes declaradas (ya no
-- aplica: la orden nace del comprobante, no hay solicitudes sin comprobante).
DROP INDEX IF EXISTS payment_orders_qr_expired_idx;
DROP INDEX IF EXISTS payment_orders_qr_reopen_idx;
