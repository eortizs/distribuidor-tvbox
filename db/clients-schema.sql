-- ============================================================================
-- Fase 3: registro local de clientes (§5 del plan): clientes PROPIOS del
-- tenant (nombre, WhatsApp, notas), sin vencimientos ni renovaciones. Un
-- link de pago puede asociarse a un cliente (payment_orders.client_id).
-- La tabla lleva tenancy como TODAS las nuevas: trigger + RLS. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS clients (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  whatsapp_phone text CHECK (whatsapp_phone IS NULL OR (whatsapp_phone ~ '^[0-9]{8,15}$')),
  notes          text CHECK (notes IS NULL OR length(notes) <= 2000),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_tenant_status_idx
  ON clients (tenant_id, status, name);

-- Asociacion opcional de un link de pago a un cliente del tenant.
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS payment_orders_client_idx
  ON payment_orders (client_id) WHERE client_id IS NOT NULL;

-- Tenancy estándar.
DROP TRIGGER IF EXISTS set_tenant_id ON clients;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON clients
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON clients;
CREATE POLICY tenant_isolation ON clients
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO speilink_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO speilink_system;
