-- Google OAuth: cuentas sin contraseña local y vínculo google_sub.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;

-- URL de la foto de perfil de Google (claim picture del id_token); el avatar
-- de la app la muestra cuando la sesión viene de Google.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_picture text;

-- El sub de Google identifica la cuenta de forma estable aunque cambie el
-- correo; único para que dos usuarios de Google no compartan vínculo.
CREATE UNIQUE INDEX IF NOT EXISTS users_by_google_sub ON users (google_sub)
  WHERE google_sub IS NOT NULL;
