-- ============================================================================
-- Fase 2 Paso B (rename de roles): admin → propietario, distribuidor →
-- sucursal, CHECK final a plataforma|propietario|sucursal. Corre JUSTO
-- ANTES del build con el código ya desplegado (Paso A) que decide por
-- isOwnerRole/isBranchRole — la ventana con valores mezclados no afecta.
-- Idempotente (los UPDATE no encuentran filas viejas en la segunda pasada).
-- ============================================================================

UPDATE users SET role = 'propietario' WHERE role = 'admin';
UPDATE users SET role = 'sucursal' WHERE role = 'distribuidor';

-- Espejo en la entidad Cuenta (dynamicProperties.role y el encabezado del
-- markdownDocumentation: "Cuenta con perfil 'admin'.").
UPDATE entities
   SET doc = jsonb_set(doc, '{dynamicProperties,role}', to_jsonb('propietario'::text))
 WHERE entity_name = 'Cuenta'
   AND doc->'dynamicProperties'->>'role' = 'admin';
UPDATE entities
   SET doc = jsonb_set(doc, '{dynamicProperties,role}', to_jsonb('sucursal'::text))
 WHERE entity_name = 'Cuenta'
   AND doc->'dynamicProperties'->>'role' = 'distribuidor';
UPDATE entities
   SET doc = jsonb_set(
         doc,
         '{markdownDocumentation}',
         to_jsonb(replace(doc->>'markdownDocumentation', 'perfil ''admin''', 'perfil ''propietario'''))
       )
 WHERE entity_name = 'Cuenta'
   AND doc->>'markdownDocumentation' LIKE '%perfil ''admin''%';
UPDATE entities
   SET doc = jsonb_set(
         doc,
         '{markdownDocumentation}',
         to_jsonb(replace(doc->>'markdownDocumentation', 'perfil ''distribuidor''', 'perfil ''sucursal'''))
       )
 WHERE entity_name = 'Cuenta'
   AND doc->>'markdownDocumentation' LIKE '%perfil ''distribuidor''%';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('plataforma', 'propietario', 'sucursal'));

-- La sesión de un usuario de plataforma no tiene tenant (NULL): la cookie
-- solo vale en el host de plataforma (validateSessionHost).
ALTER TABLE sessions ALTER COLUMN tenant_id DROP NOT NULL;
