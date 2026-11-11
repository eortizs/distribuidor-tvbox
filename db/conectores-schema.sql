-- Conectores: conexiones OAuth por usuario y conector del catálogo.

-- Los tokens de acceso y refresco viajan cifrados (AES-256-GCM con clave
-- derivada del secret de la app); nunca se sirven al cliente.
CREATE TABLE IF NOT EXISTS connector_connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id  text NOT NULL,                    -- id del catálogo (p. ej. 'google-calendar')
  provider      text NOT NULL,                    -- proveedor del conector ('google', ...)
  status        text NOT NULL DEFAULT 'connected'
                  CHECK (status IN ('connected', 'error')),
  account_email text,                             -- cuenta del proveedor conectada
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,                      -- vencimiento del access_token
  scope         text,                             -- scopes otorgados por el proveedor
  error_code    text,                             -- último error de refresco (status='error')
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Una conexión por usuario y conector: reconectar reemplaza la fila.
CREATE UNIQUE INDEX IF NOT EXISTS connector_connections_by_user_connector
  ON connector_connections (user_id, connector_id);

CREATE INDEX IF NOT EXISTS connector_connections_by_user
  ON connector_connections (user_id);
