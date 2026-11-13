-- Permisos de módulos por usuario: controla qué tarjetas del hub `/modulos`
-- ve cada cuenta (solo visibilidad del listado; las rutas siguen servidas).
-- Sin filas para un usuario = todos los módulos visibles (valor por defecto).

CREATE TABLE IF NOT EXISTS user_module_permissions (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module   text NOT NULL,                        -- href del módulo en lib/modulos
  visible  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, module)
);

CREATE INDEX IF NOT EXISTS user_module_permissions_by_user
  ON user_module_permissions (user_id);
