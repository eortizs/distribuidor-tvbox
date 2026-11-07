-- Permisos de secciones por usuario: controla qué entradas de la barra
-- inferior ve cada cuenta (solo visibilidad de navegación; las rutas siguen
-- servidas). Sin filas para un usuario = acceso completo (valor por defecto).

CREATE TABLE IF NOT EXISTS user_section_permissions (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section  text NOT NULL,                        -- clave de la sección en nav-config
  visible  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, section)
);

CREATE INDEX IF NOT EXISTS user_section_permissions_by_user
  ON user_section_permissions (user_id);
