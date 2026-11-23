-- ============================================================================
-- Fase 2 Paso A (expansión de roles): el CHECK de users.role se amplía a los
-- CINCO valores. El código (mismo despliegue) acepta admin/distribuidor
-- (legado) y propietario/sucursal (nuevos) vía isOwnerRole/isBranchRole.
-- El rename de datos llega en Paso B (db/apply-roles-rename.mjs) con el
-- código ya desplegado. Idempotente.
-- ============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'distribuidor', 'propietario', 'sucursal', 'plataforma'));
