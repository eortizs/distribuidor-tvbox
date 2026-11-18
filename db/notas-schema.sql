-- Notas (/modulos/notas): notetaker simple por usuario. Una fila por nota
-- con título, texto libre, fijada (pin) y `version` para compare-and-swap
-- por nota (editar la misma nota desde dos dispositivos no se pisa a
-- ciegas: la segunda guarda responde 409 con la nota actual). El título es
-- opcional: el dominio (src/lib/notas.ts) lo deriva de la primera línea del
-- texto cuando llega vacío.

CREATE TABLE IF NOT EXISTS notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  pinned     boolean NOT NULL DEFAULT false,
  version    bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_title_len CHECK (length(title) <= 120),
  CONSTRAINT notes_body_len CHECK (length(body) <= 20000)
);

CREATE INDEX IF NOT EXISTS notes_user_order_idx
  ON notes (user_id, pinned DESC, updated_at DESC);
