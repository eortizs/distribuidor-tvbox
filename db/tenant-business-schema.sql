-- ============================================================================
-- Fase 3: cuenta del negocio a nivel tenant (§5 del plan multitenant).
-- Las columnas bancarias ya existen en tenants (db/tenants-schema.sql);
-- aquí añade la tabla del token de Mercado Pago del negocio, espejo de
-- user_mp_tokens con PK tenant_id, mismo cifrado en reposo, trigger + RLS.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_mp_tokens (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  token_encrypted text NOT NULL,
  token_last4     text NOT NULL,
  mp_user_id      bigint,
  mp_nickname     text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid')),
  validated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_mp_tokens_active_idx
  ON tenant_mp_tokens (tenant_id) WHERE status = 'active';

-- La tabla lleva tenancy como TODAS las nuevas: trigger + RLS.
DROP TRIGGER IF EXISTS set_tenant_id ON tenant_mp_tokens;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON tenant_mp_tokens
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE tenant_mp_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_mp_tokens;
CREATE POLICY tenant_isolation ON tenant_mp_tokens
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

-- Grants para el rol de la app (tablas creadas después de los default
-- privileges de la Fase 1 heredan; esto cubre entornos anteriores).
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_mp_tokens TO speilink_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_mp_tokens TO speilink_system;
