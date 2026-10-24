-- Ajustes del panel para la API de licencias (FlujoTV).
--
-- Una sola fila (id = 1) con la clave de API cifrada y la URL base. La clave
-- se guarda cifrada (AES-256-GCM) y solo se lee en el servidor: la interfaz
-- nunca recibe el valor en claro, solo un identificador parcial.
--
-- Si la fila no existe, el servidor usa la clave del entorno
-- (FLUJO_API_KEY o FLUJO_API_KEY_FILE).

CREATE TABLE IF NOT EXISTS flujotv_settings (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  api_key_encrypted text   NOT NULL,
  base_url          text    NOT NULL DEFAULT 'https://api.eortizs.people-negocios.com',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid    REFERENCES users(id) ON DELETE SET NULL
);
