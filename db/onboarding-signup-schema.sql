-- ============================================================================
-- Fase 1: registro público de negocios (§6 del plan). Tabla `signup_handoffs`
-- — ticket de entrega de sesión: tras crear el negocio en el apex, el
-- comprador redirige a su subdominio con un token de un solo uso (10 min);
-- aquí vive solo su sha256. La tabla lleva tenancy como TODAS las nuevas:
-- trigger + RLS (el canje solo ve tickets de SU host). Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signup_handoffs (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signup_handoffs_tenant_idx
  ON signup_handoffs (tenant_id, created_at DESC);

-- Tenancy estándar.
DROP TRIGGER IF EXISTS set_tenant_id ON signup_handoffs;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON signup_handoffs
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE signup_handoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signup_handoffs;
CREATE POLICY tenant_isolation ON signup_handoffs
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON signup_handoffs TO speilink_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON signup_handoffs TO speilink_system;
