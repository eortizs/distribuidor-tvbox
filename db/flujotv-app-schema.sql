-- Información editable de la app FlujoTV (módulo «Actualización FlujoTV»).
--
-- Una sola fila (id = 1) con la versión, el código de downloader y los
-- enlaces de descarga que el admin edita desde la propia tarjeta. Si la
-- fila no existe, el servidor sirve los valores por defecto de
-- src/lib/flujotv-app.ts.

CREATE TABLE IF NOT EXISTS flujotv_app (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version         text        NOT NULL,
  downloader_code text        NOT NULL,
  url_tv          text        NOT NULL,
  url_celular     text        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES users(id) ON DELETE SET NULL
);
