-- Prompt pendiente del canje de cupón por chat (/tv3<usuario> -c): UNA fila
-- por usuario (PK) que recuerda a qué cliente va la renovación mientras el
-- comprador escribe el código. El estado es cross-canal por diseño (la PWA
-- puede pedir el código y contestarlo por WhatsApp: la conversación es una
-- sola). La vigencia se calcula sobre created_at (10 min) en la lectura; la
-- fila se borra al canjear, cancelar o expirar.
CREATE TABLE IF NOT EXISTS assistant_coupon_prompts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
