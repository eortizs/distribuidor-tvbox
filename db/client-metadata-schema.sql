-- Metadatos locales de clientes FlujoTV (/clientes), llave por usuario del
-- panel (en minúsculas). El listado y los pagos se alimentan del panel, pero
-- el alias, el WhatsApp de contacto y el precio especial por cliente viven
-- aquí: son datos propios de la app, no del panel.

CREATE TABLE IF NOT EXISTS client_metadata (
  user_name      text PRIMARY KEY,
  alias          text,
  whatsapp_phone text,
  price_mxn      numeric(10, 2) CHECK (price_mxn IS NULL OR price_mxn > 0),
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
