-- Tokens de Mercado Pago propios por usuario (Perfil → Datos bancarios) y
-- verificación de depósito para las renovaciones por transferencia.
--
-- user_mp_tokens: UNA credencial por cuenta. El token viaja CIFRADO en reposo
-- (AES-256-GCM, mismo cifrado de los conectores: CONECTORES_SECRET o
-- GOOGLE_CLIENT_SECRET derivan la clave; sin secret el módulo falla cerrado
-- y no se guardan tokens). El formulario del perfil es write-only: el token
-- nunca vuelve al navegador; aquí solo viven los metadatos de identificación
-- (últimos 4 caracteres, cuenta MP de destino, estado de la validación).
--
-- Con su propio token el distribuidor convierte en posible la verificación
-- AUTOMÁTICA de depósitos hacia SU cuenta (antes solo el admin con el token
-- de plataforma del .env):
--   - Ligas de pago: sus órdenes con comprobante válido pasan a 'verifying'
--     y se confirman solas cuando el dinero acredita en su cuenta MP.
--   - Reporte SPEI: consulta viva de los depósitos de su propia cuenta.
--   - Renovaciones por transferencia: la orden pasa a 'verifying' hasta que
--     el depósito aparece acreditado en la cuenta del vendedor.

CREATE TABLE IF NOT EXISTS user_mp_tokens (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_encrypted text NOT NULL,
  token_last4     text NOT NULL,
  mp_user_id      bigint,
  mp_nickname     text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid')),
  validated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Cola del verificador de depósitos: credenciales activas se resuelven por
-- user_id; la rotación de estado no deja filas huérfanas (FK CASCADE).
CREATE INDEX IF NOT EXISTS user_mp_tokens_active_idx
  ON user_mp_tokens (user_id) WHERE status = 'active';

-- --------------------------------------------------------------------------- --
-- mp_orders: estado 'verifying' de la verificación de depósito de renovaciones
-- por transferencia. Espejo exacto de las columnas de payment_orders
-- (db/payment-orders-deposit-schema.sql): el comprobante ya validó el escaneo
-- y la orden espera la ACREDITACIÓN real del depósito en la cuenta del
-- vendedor. El ID del pago de MP queda RESERVADO en exclusiva por orden
-- (índice único parcial): un depósito valida una sola orden, y la reserva es
-- CRUZADA entre flujos (payment_orders y mp_orders comparten la misma cuenta
-- MP: un depósito no puede confirmar una liga de pago y una renovación a la
-- vez — el filtro cruzado vive también en el código que reclama).
-- --------------------------------------------------------------------------- --

ALTER TABLE mp_orders DROP CONSTRAINT IF EXISTS mp_orders_status_check;

-- SUPERSET COMPLETO de estados vigentes: la lista de mp-refunds-schema.sql
-- ('pending', 'paid', 'renewed', 'applied', 'renewal_failed', 'rejected',
-- 'cancelled', 'refunding', 'refunded') + 'verifying'.
ALTER TABLE mp_orders ADD CONSTRAINT mp_orders_status_check CHECK (status IN (
  'pending', 'verifying', 'paid', 'renewed', 'applied',
  'renewal_failed', 'rejected', 'cancelled',
  'refunding', 'refunded'
));

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS mp_payment_id bigint;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS mp_deposit_at timestamptz;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS verifying_since timestamptz;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS deposit_next_check_at timestamptz;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS deposit_checks int NOT NULL DEFAULT 0;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS deposit_escalated_at timestamptz;

-- Reserva exclusiva del depósito por orden (la carrera de dos verificaciones
-- concurrentes que encuentran el mismo pago rebota aquí).
CREATE UNIQUE INDEX IF NOT EXISTS mp_orders_mp_payment_id_unique_idx
  ON mp_orders (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- Cola del verificador en background (tick de 60 s).
CREATE INDEX IF NOT EXISTS mp_orders_verifying_idx
  ON mp_orders (deposit_next_check_at)
  WHERE method = 'transferencia' AND status = 'verifying';
