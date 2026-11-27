-- ALTA DE ARTÍCULOS/SERVICIOS (/modulos/alta-de-articulos): catálogo de
-- productos y servicios del negocio, COMPARTIDO por todo el tenant (RLS) —
-- propietario y sucursales ven y editan lo mismo. Es un módulo `core`, así
-- que existe en el host legado y en los tenants de negocio (*.spei.link).
--
-- Columnas: SKU (único por tenant, normalizado a mayúsculas por el dominio,
-- INCLUYE archivados — para reutilizar un SKU se restaura la fila), nombre,
-- descripción, U.M. (código de la lista fija o texto libre de «Otro»),
-- precio unitario MXN, categoría (texto libre con sugerencias), disponible
-- (flag de venta) y status (archivado suave: NUNCA se borra una fila — el
-- permiso DELETE está revocado a la app).
--
-- Edición con compare-and-swap por `version` (409 si otra pestaña cambió la
-- fila) y auditoría created_by/updated_by.
--
-- Aditivo e idempotente. AL FINAL de la cadena de despliegue (después de
-- apply-links-pago-qr-fijo, antes de verify-tenant-rls): `app_set_tenant_id`
-- y `app_tenant_ok` existen porque apply-tenants corre antes.

CREATE TABLE IF NOT EXISTS articulos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku             text NOT NULL
                  CHECK (char_length(sku) BETWEEN 1 AND 40 AND sku = btrim(sku)),
  nombre          text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 120),
  descripcion     text NOT NULL DEFAULT ''
                  CHECK (char_length(descripcion) <= 2000),
  um              text NOT NULL CHECK (char_length(um) BETWEEN 1 AND 30),
  precio_unitario numeric(12,2) NOT NULL
                  CHECK (precio_unitario >= 0 AND precio_unitario <= 1000000),
  categoria       text
                  CHECK (categoria IS NULL OR char_length(categoria) BETWEEN 1 AND 60),
  disponible      boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  version         bigint NOT NULL DEFAULT 1,
  created_by      uuid REFERENCES users(id),
  updated_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articulos_tenant_sku_key UNIQUE (tenant_id, sku)
);

-- Listado por estado (activos primero) y filtro por categoría.
CREATE INDEX IF NOT EXISTS articulos_tenant_status_nombre_idx
  ON articulos (tenant_id, status, nombre);
CREATE INDEX IF NOT EXISTS articulos_tenant_categoria_idx
  ON articulos (tenant_id, categoria) WHERE categoria IS NOT NULL;

DROP TRIGGER IF EXISTS set_tenant_id ON articulos;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON articulos
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE articulos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON articulos;
CREATE POLICY tenant_isolation ON articulos
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT, UPDATE ON articulos TO speilink_app;
GRANT SELECT, INSERT, UPDATE ON articulos TO speilink_system;
-- Los privilegios por defecto del esquema dan DELETE a la app; el borrado es
-- ARCHIVAR (status='archived'), jamás una fila menos: se retira el permiso.
REVOKE DELETE ON articulos FROM speilink_app;
