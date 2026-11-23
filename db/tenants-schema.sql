-- ============================================================================
-- Tenancy: tabla `tenants`, columna tenant_id + trigger + RLS en todas las
-- tablas de negocio. Idempotente (IF NOT EXISTS / DROP+CREATE), patrón igual
-- al resto del repo.
--
-- Semántica de aislamiento:
-- - Cada sesión SQL fija `app.tenant_id` (uuid del tenant) o `app.platform`
--   ('on') vía set_config(..., is_local => true) — ver src/server/db.ts.
-- - La política `tenant_isolation` filtra por app_tenant_ok(tenant_id): un
--   contexto olvidado VE 0 FILAS (falla cerrado), nunca filtra.
-- - El rol de la APLICACIÓN (`speilink_app`) NO es dueño ni superuser, así
--   que RLS es efectivo. Las migraciones corren con el dueño (bypass) — no
--   usar FORCE ROW LEVEL SECURITY para no romperlas.
-- - users.tenant_id admite NULL = cuenta de plataforma.
-- - flujotv_app / flujotv_settings son singletons de plataforma: sin RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Catálogo de tenants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('legacy','business')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  modules text[] NOT NULL CHECK (modules <@ ARRAY['core','general','flujo']),
  use_platform_mp_account boolean NOT NULL DEFAULT false,
  whatsapp_number text, whatsapp_linked_at timestamptz, whatsapp_last_seen_at timestamptz,
  bank_name text, bank_holder text, bank_clabe text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_whatsapp_number_uidx
  ON tenants (whatsapp_number) WHERE whatsapp_number IS NOT NULL;

-- Tenant legado: todo lo existente (tvbox). UUID fijo para que el código lo
-- referencie como constante.
INSERT INTO tenants (id, slug, name, kind, status, modules, use_platform_mp_account)
VALUES ('8e83b5cc-9f43-28b2-a8f3-2882fef090a8', 'tvbox', 'Distribuidor TVBox', 'legacy', 'active', ARRAY['core','general','flujo'], true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Funciones de aislamiento
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_tenant_ok(t uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '') = t::text
      OR COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION app_set_tenant_id() RETURNS trigger
LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.tenant_id IS NULL THEN
      NEW.tenant_id := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    END IF;
    RETURN NEW;
  END;
$$;

-- ---------------------------------------------------------------------------
-- Columnas tenant_id + NOT NULL (users lo admite NULL = plataforma)
-- ---------------------------------------------------------------------------
ALTER TABLE sessions             ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE eve_sessions         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE entities             ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE entity_events        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE tickets              ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE client_metadata      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE client_saved_filters ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE client_chip_layout   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE mp_orders            ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE mp_order_events      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE mp_refunds           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE transfer_concepts    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE payment_orders       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE saldo_movimientos    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE wa_outbox            ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE wa_message_log       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE assistant_messages   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE assistant_coupon_prompts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE notifications        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE alerts               ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE alert_hits           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE push_subscriptions   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE notes                ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE shopping_lists       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE shopping_list_mutations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_files           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_file_variants   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE image_generations    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE animation_costs      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE animation_turns      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE animation_deliverables ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE expenses             ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_settings        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_section_permissions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_module_permissions  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_module_prefs    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE connector_connections ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE user_mp_tokens       ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

-- ---------------------------------------------------------------------------
-- Backfill: todo lo existente pertenece al tenant legado (hoy no hay otros).
-- Se hace ANTES de añadir el NOT NULL. Idempotente: solo toca NULLs.
-- ---------------------------------------------------------------------------
UPDATE users                SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE sessions             SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE eve_sessions         SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE entities             SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE entity_events        SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE tickets              SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE client_metadata      SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE client_saved_filters SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE client_chip_layout   SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE mp_orders            SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE mp_order_events      SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE mp_refunds           SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE transfer_concepts    SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE payment_orders       SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE saldo_movimientos    SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE wa_outbox            SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE wa_message_log       SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE assistant_messages   SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE assistant_coupon_prompts SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE notifications        SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE alerts               SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE alert_hits           SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE push_subscriptions   SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE notes                SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE shopping_lists       SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE shopping_list_mutations SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_files           SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_file_variants   SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE image_generations    SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE animation_costs      SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE animation_turns      SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE animation_deliverables SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE expenses             SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_settings        SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_section_permissions SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_module_permissions  SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_module_prefs    SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE connector_connections SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;
UPDATE user_mp_tokens       SET tenant_id = '8e83b5cc-9f43-28b2-a8f3-2882fef090a8' WHERE tenant_id IS NULL;

-- ---------------------------------------------------------------------------
-- NOT NULL tras el backfill
-- ---------------------------------------------------------------------------
ALTER TABLE sessions             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE eve_sessions         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE entities             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE entity_events        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tickets              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE client_metadata      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE client_saved_filters ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE client_chip_layout   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mp_orders            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mp_order_events      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mp_refunds           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE transfer_concepts    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_orders       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE saldo_movimientos    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE wa_outbox            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE wa_message_log       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assistant_messages   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assistant_coupon_prompts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notifications        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE alerts               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE alert_hits           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE push_subscriptions   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notes                ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE shopping_lists       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE shopping_list_mutations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_files           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_file_variants   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE image_generations    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE animation_costs      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE animation_turns      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE animation_deliverables ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE expenses             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_settings        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_section_permissions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_module_permissions  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_module_prefs    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE connector_connections ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_mp_tokens       ALTER COLUMN tenant_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Triggers: BEFORE INSERT rellena tenant_id desde el contexto si falta
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','eve_sessions','entities','entity_events','tickets',
    'client_metadata','client_saved_filters','client_chip_layout',
    'mp_orders','mp_order_events','mp_refunds','transfer_concepts',
    'payment_orders','saldo_movimientos','wa_outbox','wa_message_log',
    'assistant_messages','assistant_coupon_prompts','notifications',
    'alerts','alert_hits','push_subscriptions','notes','shopping_lists',
    'shopping_list_mutations','user_files','user_file_variants',
    'image_generations','animation_costs','animation_turns',
    'animation_deliverables','expenses','user_settings',
    'user_section_permissions','user_module_permissions','user_module_prefs',
    'connector_connections','user_mp_tokens'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_tenant_id ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER set_tenant_id BEFORE INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: una política por tabla. La app corre con un rol que no
-- es dueño (speilink_app), así que las políticas son efectivas; el dueño de
-- las tablas (migraciones) sigue sin RLS (sin FORCE).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','eve_sessions','entities','entity_events','tickets',
    'client_metadata','client_saved_filters','client_chip_layout',
    'mp_orders','mp_order_events','mp_refunds','transfer_concepts',
    'payment_orders','saldo_movimientos','wa_outbox','wa_message_log',
    'assistant_messages','assistant_coupon_prompts','notifications',
    'alerts','alert_hits','push_subscriptions','notes','shopping_lists',
    'shopping_list_mutations','user_files','user_file_variants',
    'image_generations','animation_costs','animation_turns',
    'animation_deliverables','expenses','user_settings',
    'user_section_permissions','user_module_permissions','user_module_prefs',
    'connector_connections','user_mp_tokens'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (app_tenant_ok(tenant_id))
         WITH CHECK (app_tenant_ok(tenant_id))', t);
  END LOOP;
END $$;

-- tenants: lectura de la fila propia (branding/resolución) + plataforma ve
-- todo; escritura SOLO plataforma.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_read ON tenants;
CREATE POLICY tenants_read ON tenants
  USING (
    id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on'
  );
DROP POLICY IF EXISTS tenants_write ON tenants;
CREATE POLICY tenants_write ON tenants
  USING (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on')
  WITH CHECK (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on');

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payment_orders_tenant_created_idx
  ON payment_orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_tenant_payer_idx
  ON payment_orders (tenant_id, payer_phone) WHERE payer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_outbox_tenant_pending_idx
  ON wa_outbox (tenant_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS users_tenant_role_idx ON users (tenant_id, role);

-- WhatsApp: el único de phone pasa a ser POR TENANT (la plataforma, con
-- tenant_id NULL, queda fuera del índice parcial).
DROP INDEX IF EXISTS users_whatsapp_phone_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS users_whatsapp_phone_tenant_uidx
  ON users (tenant_id, whatsapp_phone)
  WHERE whatsapp_phone IS NOT NULL AND tenant_id IS NOT NULL;
