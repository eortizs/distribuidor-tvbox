-- Lista de compras con IA (/modulos/lista-de-compras): una sola lista por
-- usuario, guardada automáticamente. Los productos viven en un JSONB
-- validado por el servidor (src/lib/lista-compras.ts); `revision` crece en
-- cada mutación y funciona como compare-and-swap para evitar que dos
-- dispositivos se pisen. El log de mutaciones hace idempotentes los
-- reintentos por `request_id` (mismo payload no vuelve a aplicar; payload
-- distinto se rechaza).

CREATE TABLE IF NOT EXISTS shopping_lists (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision   bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_lists_items_array CHECK (jsonb_typeof(items) = 'array')
);

CREATE TABLE IF NOT EXISTS shopping_list_mutations (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id      text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
  payload_hash    text NOT NULL,
  revision_before bigint NOT NULL,
  revision_after  bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
