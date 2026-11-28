-- INVENTARIO (/modulos/inventario): gestión de existencias ligada al catálogo
-- de Alta de Artículos. COMPARTIDO por todo el tenant (RLS) — propietario y
-- sucursales ven y gestionan lo mismo. Es un módulo `core`, así que existe
-- en el host legado y en los tenants de negocio (*.spei.link).
--
-- Modelo POR LOTES: cada artículo puede tener varios lotes
-- (inventory_lots), cada uno con su propia cantidad, caducidad, condición
-- (nuevo/usado/dañado) y ubicación opcional. El stock NUNCA se edita a mano:
-- cambia SOLO por movimientos (inventory_movements) de entrada/salida/ajuste
-- registrados en la MISMA transacción que actualizan el balance del lote,
-- con cantidad_antes/cantidad_despues/delta — el CHECK de balance garantiza
-- que la bitácora cuadre siempre. Los movimientos son INMUTABLES (el permiso
-- DELETE está revocado): una corrección es un movimiento `ajuste`, jamás una
-- fila menos.
--
-- Edición de metadatos del lote (lote/caducidad/condición/ubicación) con
-- compare-and-swap por `version` (409 si otro dispositivo cambió la fila;
-- los movimientos también la suben, así que un editor con datos viejos no
-- pisa a ciegas). Auditoría created_by/updated_by.
--
-- Aditivo e idempotente. AL FINAL de la cadena de despliegue (después de
-- apply-articulos, antes de verify-tenant-rls): `app_set_tenant_id` y
-- `app_tenant_ok` existen porque apply-tenants corre antes.

CREATE TABLE IF NOT EXISTS inventory_lots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  articulo_id uuid NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  lote        text
              CHECK (lote IS NULL OR (char_length(lote) BETWEEN 1 AND 60 AND lote = btrim(lote))),
  caducidad   date CHECK (caducidad IS NULL OR caducidad >= DATE '2000-01-01'),
  condicion   text NOT NULL DEFAULT 'nuevo' CHECK (condicion IN ('nuevo','usado','danado')),
  ubicacion   text
              CHECK (ubicacion IS NULL OR (char_length(ubicacion) BETWEEN 1 AND 120 AND ubicacion = btrim(ubicacion))),
  cantidad    numeric(12,3) NOT NULL DEFAULT 0
              CHECK (cantidad >= 0 AND cantidad <= 999999999.999),
  version     bigint NOT NULL DEFAULT 1,
  created_by  uuid REFERENCES users(id),
  updated_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_lots_articulo_idx
  ON inventory_lots (articulo_id);
CREATE INDEX IF NOT EXISTS inventory_lots_tenant_caducidad_idx
  ON inventory_lots (tenant_id, caducidad) WHERE caducidad IS NOT NULL;

DROP TRIGGER IF EXISTS set_tenant_id ON inventory_lots;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory_lots;
CREATE POLICY tenant_isolation ON inventory_lots
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT, UPDATE ON inventory_lots TO speilink_app;
GRANT SELECT, INSERT, UPDATE ON inventory_lots TO speilink_system;
-- Los privilegios por defecto del esquema dan DELETE a la app; un lote se
-- agota con un movimiento `salida`/`ajuste`, jamás se borra: se retira.
REVOKE DELETE ON inventory_lots FROM speilink_app;

-- Kardex: bitácora apéndice-solo de los movimientos. `delta` es SIGNED
-- (entrada > 0, salida < 0, ajuste = cualquier cambio distinto de cero) y
-- el CHECK de balance obliga a que cantidad_despues = cantidad_antes + delta
-- y a que el signo calce con el kind: la bitácora no puede quedar torcida.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lote_id          uuid NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('entrada','salida','ajuste')),
  delta            numeric(12,3) NOT NULL
                   CHECK (delta <> 0 AND delta >= -999999999.999 AND delta <= 999999999.999),
  cantidad_antes   numeric(12,3) NOT NULL CHECK (cantidad_antes >= 0),
  cantidad_despues numeric(12,3) NOT NULL
                   CHECK (cantidad_despues >= 0 AND cantidad_despues <= 999999999.999),
  motivo           text
                   CHECK (motivo IS NULL OR (char_length(motivo) BETWEEN 1 AND 200 AND motivo = btrim(motivo))),
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_balance_chk CHECK (
    cantidad_despues = cantidad_antes + delta
    AND (
      (kind = 'entrada' AND delta > 0)
      OR (kind = 'salida' AND delta < 0)
      OR kind = 'ajuste'
    )
  )
);

CREATE INDEX IF NOT EXISTS inventory_movements_lote_created_idx
  ON inventory_movements (lote_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_articulo_idx
  ON inventory_movements (tenant_id, lote_id);

DROP TRIGGER IF EXISTS set_tenant_id ON inventory_movements;
CREATE TRIGGER set_tenant_id BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION app_set_tenant_id();

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory_movements;
CREATE POLICY tenant_isolation ON inventory_movements
  USING (app_tenant_ok(tenant_id))
  WITH CHECK (app_tenant_ok(tenant_id));

GRANT SELECT, INSERT ON inventory_movements TO speilink_app;
GRANT SELECT, INSERT ON inventory_movements TO speilink_system;
-- El kardex es INMUTABLE: registrar un movimiento es INSERT; corregir es un
-- movimiento `ajuste`. UPDATE/DELETE retirados a la app.
REVOKE UPDATE, DELETE ON inventory_movements FROM speilink_app;
