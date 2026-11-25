-- ============================================================================
-- Afiliados (plan speilink-afiliados): catálogo de afiliados + atribución de
-- negocios vía `spei.link/afiliado/<CÓDIGO>`. Idempotente (IF NOT EXISTS /
-- DROP+CREATE), patrón igual al resto del repo. AL FINAL de la cadena de
-- despliegue (después de apply-onboarding-signup, antes de verify-tenant-rls).
--
-- Modelo:
-- - Cada afiliado es una cuenta SIN tenant (users.tenant_id NULL, rol
--   'afiliado'), como las cuentas de plataforma: sin entidad Cuenta.
-- - `tenants.referred_by_affiliate_id` es la ÚNICA atribución del negocio:
--   un afiliado, para siempre (ON DELETE RESTRICT). La fecha es
--   tenants.created_at. Esta versión es atribución y estadísticas, SIN
--   dinero.
-- - Contexto de afiliado: GUC `app.affiliate_id` (runAsAffiliate, §6.2). El
--   rol de la app NO es dueño: RLS efectivo — el portal solo ve su fila y
--   sus negocios referidos; la escritura es SOLO plataforma.
-- ============================================================================

CREATE TABLE IF NOT EXISTS affiliates (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  full_name    text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 100),
  click_count  integer NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  created_by   uuid REFERENCES users(id),
  suspended_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Atribución única del negocio (nula = alta por consola sin enlace o
-- registro público sin afiliado).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS
  referred_by_affiliate_id uuid REFERENCES affiliates(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS tenants_referred_by_affiliate_idx
  ON tenants (referred_by_affiliate_id) WHERE referred_by_affiliate_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Función de aislamiento de afiliado (patrón app_tenant_ok de tenants)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_affiliate_ok(id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.affiliate_id', true), '') = id::text
      OR COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- RLS: lectura para plataforma o el propio afiliado; escritura SOLO
-- plataforma. UNA POLÍTICA POR COMANDO (regla de tenants: jamás FOR ALL —
-- se combinan con OR y abrirían el UPDATE). Sin DELETE ni grant de DELETE:
-- un afiliado no se borra, se suspende.
-- ---------------------------------------------------------------------------
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS affiliates_read ON affiliates;
CREATE POLICY affiliates_read ON affiliates
  FOR SELECT
  USING (app_affiliate_ok(id));
DROP POLICY IF EXISTS affiliates_insert ON affiliates;
CREATE POLICY affiliates_insert ON affiliates
  FOR INSERT
  WITH CHECK (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on');
DROP POLICY IF EXISTS affiliates_update ON affiliates;
CREATE POLICY affiliates_update ON affiliates
  FOR UPDATE
  USING (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on');

-- El afiliado ve SOLO los negocios que llegaron con su enlace. Política FOR
-- SELECT de lectura en `tenants`: vive en este archivo (y no en
-- tenants-schema.sql) porque la columna la crea esta migración, cuyo apply
-- corre después.
DROP POLICY IF EXISTS tenants_affiliate_read ON tenants;
CREATE POLICY tenants_affiliate_read ON tenants
  FOR SELECT
  USING (
    referred_by_affiliate_id::text = NULLIF(current_setting('app.affiliate_id', true), '')
  );

-- ---------------------------------------------------------------------------
-- Grants (tablas nuevas no heredan en entornos previos a los defaults):
-- la app lee/escribe vía contexto plataforma o afiliado. SIN DELETE.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON affiliates TO speilink_app;
GRANT SELECT, INSERT, UPDATE ON affiliates TO speilink_system;

-- ---------------------------------------------------------------------------
-- El CHECK de roles lista los CUATRO valores. También en roles-expand y
-- roles-rename: cualquiera de los tres applies puede correr en cualquier
-- orden, y con un afiliado existente re-crear el CHECK a tres valores
-- fallaría (violación de restricción) y detendría TODA la cadena.
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('plataforma', 'propietario', 'sucursal', 'afiliado'));
