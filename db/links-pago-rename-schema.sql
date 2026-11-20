-- Rename del módulo «Ligas de pago» → «Links de pago» (/modulos/links-de-pago).
-- SOLO DATOS (sin schema): el href del módulo vive en la visibilidad por
-- usuario (user_module_permissions) y en TRES lugares de las preferencias del
-- hub (user_module_prefs.prefs: favorites, assignments). Sin esta migración,
-- el href viejo deja de ser clave del catálogo (isModulePermissionKey /
-- normalizeModulePrefs) y el módulo «nace oculto» para las cuentas donde el
-- admin ya lo había habilitado, además de perderse el favorito y las
-- asignaciones a filtros.
-- Idempotente: segundas corridas no matchean filas.

-- 1. Visibilidad por usuario: renombra el href conservando `visible`. Si el
--    usuario ya tuviera fila con el href nuevo (no debería), la vieja se
--    elimina en el paso siguiente sin pisar la existente.
UPDATE user_module_permissions p_old
   SET module = '/modulos/links-de-pago'
  WHERE p_old.module = '/modulos/ligas-de-pago'
    AND NOT EXISTS (
      SELECT 1
        FROM user_module_permissions p_new
       WHERE p_new.user_id = p_old.user_id
         AND p_new.module = '/modulos/links-de-pago'
    );

DELETE FROM user_module_permissions
 WHERE module = '/modulos/ligas-de-pago';

-- 2. Favoritos del hub: reemplaza el href dentro del array jsonb
--    `favorites` (normalizeModulePrefs suelta los hrefs desconocidos, así
--    que sin este paso el favorito se perdería silenciosamente).
UPDATE user_module_prefs
   SET prefs = jsonb_set(
         prefs,
         '{favorites}',
         COALESCE(
           (SELECT jsonb_agg(
                     CASE WHEN t.elem = '"/modulos/ligas-de-pago"'::jsonb
                          THEN to_jsonb('/modulos/links-de-pago'::text)
                          ELSE t.elem END)
              FROM jsonb_array_elements(prefs->'favorites') AS t(elem)),
           '[]'::jsonb
         ),
         true
       ),
       updated_at = now()
 WHERE prefs->'favorites' @> '"/modulos/ligas-de-pago"'::jsonb;

-- 3. Asignaciones a filtros del hub: la CLAVE del objeto `assignments` es el
--    href del módulo. Se renombra la clave conservando su array de filtros
--    (normalizeModulePrefs descarta claves con hrefs desconocidos, así que
--    sin este paso la asignación se perdería silenciosamente). Si ambos
--    hrefs existieran como claves (no debe ocurrir: el href nuevo nace con
--    este deploy), la fila nueva pisa a la vieja en jsonb_object_agg.
UPDATE user_module_prefs
   SET prefs = jsonb_set(
         prefs,
         '{assignments}',
         (
           SELECT COALESCE(
             jsonb_object_agg(
               CASE WHEN t.key = '/modulos/ligas-de-pago'
                    THEN '/modulos/links-de-pago'
                    ELSE t.key END,
               t.value
             ),
             '{}'::jsonb
           )
           FROM jsonb_each(prefs->'assignments') AS t(key, value)
         ),
         true
       ),
       updated_at = now()
 WHERE prefs->'assignments' ? '/modulos/ligas-de-pago';
