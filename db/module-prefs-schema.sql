-- Preferencias del hub de módulos (/modulos) por usuario: favoritos,
-- filtros creados por el usuario y asignaciones módulo→filtro.
--
-- Antes vivían en localStorage (clave `modulos.filtros.v1`), así que cada
-- dispositivo tenía su propio estado. Ahora el servidor es la fuente de
-- verdad y los cambios se difunden por el bus SSE (evento `prefs`,
-- alcance solo-propietario).

CREATE TABLE IF NOT EXISTS user_module_prefs (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
