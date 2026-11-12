-- Orden manual de la hilera de filtros de /clientes («Reordenar»).
--
-- La hilera mezcla vistas preconfiguradas (chips fijos de la app) y filtros
-- guardados (filas de `client_saved_filters`), así que el orden completo no
-- cabe en una columna de esas tablas: aquí vive la lista de CLAVES de chips
-- en el orden elegido por el usuario, p. ej.
--   ["filter:9f…", "preset:todos", "preset:activo"]
-- Las claves que ya no existan se ignoran al renderizar y las nuevas se
-- agregan al final, así que el layout nunca rompe la pantalla.

CREATE TABLE IF NOT EXISTS client_chip_layout (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chip_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- El orden por-filtro (`sort_order`) quedó obsoleto: el orden de la hilera
-- completa vive aquí arriba y esta columna nunca llegó a escribirse en
-- producción con datos reales.
ALTER TABLE client_saved_filters DROP COLUMN IF EXISTS sort_order;
