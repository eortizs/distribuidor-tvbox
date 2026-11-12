-- Filtros compuestos guardados de /clientes, por usuario.
--
-- Antes los filtros creados eran efímeros (localStorage) y solo admitían una
-- consulta por dispositivo. Ahora cada usuario nombra y guarda sus filtros
-- (stack de reglas + modo de agrupación) en su cuenta: la tabla guarda la
-- carga útil validada por src/lib/client-filters.ts.

CREATE TABLE IF NOT EXISTS client_saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  group_by   text NOT NULL DEFAULT 'ninguno',
  rules      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS client_saved_filters_user_idx
  ON client_saved_filters (user_id, created_at);
