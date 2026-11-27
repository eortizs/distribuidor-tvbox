-- NOTA DIGITAL (/modulos/nota-digital): comandas armadas desde el catálogo
-- de Alta de Artículos. La orden VIVE en `payment_orders` (origin='nota',
-- note=NULL) y reutiliza TODO el ciclo: código de 4, shortener spei.link,
-- binding del pagador, verificación de depósito, campana y realtime.
-- Esta tabla hija guarda los RENGLONES CONGELADOS (sku/nombre/um/precio al
-- crear) para que el desglose enviado por WhatsApp sea inmutable aunque el
-- catálogo cambie después.
--
-- Aditiva e idempotente. AL FINAL de la cadena de despliegue: DESPUÉS de
-- apply-articulos.mjs y ANTES de scripts/verify-tenant-rls.mjs. IMPORTANTE:
-- apply-links-pago-qr-fijo.mjs re-crea el CHECK de origin con solo
-- ('link','qr') en CADA deploy; esta migración lo re-crea con el superset de
-- TRES. Toda migración futura que toque payment_orders_origin_check debe
-- incluir 'nota'.

CREATE TABLE IF NOT EXISTS nota_digital_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_order_id uuid NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  articulo_id      uuid REFERENCES articulos(id),
  sku              text NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 40),
  nombre           text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  um               text NOT NULL CHECK (char_length(um) BETWEEN 1 AND 30),
  precio_unitario  numeric(12,2) NOT NULL
                   CHECK (precio_unitario >= 0 AND precio_unitario <= 1000000),
  cantidad         numeric(10,3) NOT NULL CHECK (cantidad > 0),
  importe_linea    numeric(12,2) NOT NULL CHECK (importe_linea >= 0),
  posicion         integer NOT NULL CHECK (posicion >= 0)
);

CREATE INDEX IF NOT EXISTS nota_digital_items_order_pos_idx
  ON nota_digital_items (payment_order_id, posicion);
CREATE INDEX IF NOT EXISTS nota_digital_items_tenant_order_idx
  ON nota_digital_items (tenant_id, payment_order_id);

DROP TRIGGER IF EXISTS set_tenant_id ON nota_digital_items;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON nota_digital_items
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE nota_digital_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON nota_digital_items;
CREATE POLICY tenant_isolation ON nota_digital_items
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT ON nota_digital_items TO speilink_app;
GRANT SELECT, INSERT ON nota_digital_items TO speilink_system;
-- Los renglones son INMUTABLES: la orden se cancela/resuelve, nunca se
-- reescribe su desglose. El default ACL del esquema daba UPDATE/DELETE.
REVOKE UPDATE, DELETE ON nota_digital_items FROM speilink_app;

ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_origin_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_origin_check
  CHECK (origin IN ('link','qr','nota'));
