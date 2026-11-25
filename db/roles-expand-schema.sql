-- ============================================================================
-- Fase 2 Paso A (expansión de roles): el CHECK de users.role se amplía a los
-- CINCO valores + 'afiliado' (plan speilink-afiliados: la cuenta de afiliado
-- es una cuenta SIN tenant, users.tenant_id NULL). El código (mismo
-- despliegue) acepta admin/distribuidor (legado) y propietario/sucursal
-- (nuevos) vía isOwnerRole/isBranchRole. El rename de datos llega en Paso B
-- (db/apply-roles-rename.mjs) con el código ya desplegado. Idempotente.
-- OJO: los TRES applies que re-crean este CHECK (roles-expand, roles-rename
-- y afiliados) deben listar el MISMO conjunto — con un afiliado existente,
-- re-crear el CHECK a menos valores fallaría y detendría la cadena.
-- ============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'distribuidor', 'propietario', 'sucursal', 'plataforma', 'afiliado'));
