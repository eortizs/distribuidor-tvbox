-- Notificaciones persistentes del panel: resultados de renovaciones de
-- licencias (Mercado Pago, transferencia aprobada/rechazada, cupón y
-- paquetes) dirigidas al comprador de la orden (`mp_orders.buyer_user_id`).
-- Cada aviso al comprador se replica en la cuenta de cada administrador con
-- la atribución al distribuidor que ejecutó la operación (exitosas y
-- fallidas; fan-out en `fanoutAdminCopies`). Además, cuando la validación
-- automática rechaza un comprobante de transferencia, se inserta una copia
-- con los motivos en la cuenta de cada administrador para que la campana le
-- avise de la orden pendiente de revisión.
--
-- Una fila por evento; el comprador las consulta en cualquier momento desde
-- la campana de la cabecera. `kind` distingue el resultado para el icono y el
-- tono; `user_name` es el cliente FlujoTV renovado y `expires_at` guarda el
-- vencimiento nuevo verificado en el panel (texto tal cual lo reportó el
-- panel, se formatea al pintar). `read_at` NULL = no leída (contador de la
-- campana); el borrado es físico y por lotes con `ids` o total sin ellos.

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN (
               'renewal_success', 'renewal_failed', 'transfer_rejected'
             )),
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  user_name  text,
  expires_at text,
  order_id   uuid,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id) WHERE read_at IS NULL;

-- Una sola notificación de fallo/rechazo por orden y destinatario: los
-- intentos solapados de renovación (webhooks at-least-once, reintento +
-- conciliación) y los re-escaneos de la misma orden insertan con
-- ON CONFLICT DO NOTHING contra este índice. Cubre tanto las notificaciones
-- del comprador (`renewal_failed`, `transfer_rejected`) como la copia de
-- revisión que llega a los administradores (`transfer_rejected` en su
-- cuenta cuando la validación automática rechaza un comprobante).
DROP INDEX IF EXISTS notifications_user_order_failed_idx;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_order_failed_idx
  ON notifications (user_id, order_id)
  WHERE order_id IS NOT NULL
    AND kind IN ('renewal_failed', 'transfer_rejected');
