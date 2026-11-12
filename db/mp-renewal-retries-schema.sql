-- Reintentos automáticos de la renovación cuando el pago ya está confirmado.
--
-- Un fallo transitorio del panel de FlujoTV (timeout de la lectura de línea
-- base, red, 5xx, cooldown post-éxito, verificación imposible) marcaba la
-- orden `renewal_failed` a la primera y exigía reintento manual del admin,
-- aunque el comprador había pagado y hecho su parte bien. Con estas columnas
-- el fallo transitorio agenda un reintento automático con backoff (1 min,
-- 3 min, 10 min) sin cambiar el estado de la orden (`paid`): el overlay del
-- comprador sigue en «renovación en curso» y termina en el panel de éxito
-- cuando un reintento logra renovar. `renewal_failed` —con su notificación—
-- queda para el fallo permanente o el presupuesto agotado.
--
-- - renewal_retry_count: reintentos automáticos ya agendados/consumidos.
--   El tope lo fija el código (RENEWAL_RETRY_DELAYS_MS); el reintento
--   manual del admin lo reinicia a 0.
-- - renewal_next_retry_at: cuándo toca el próximo reintento (NULL = sin
--   reintento pendiente). Lo limpia el éxito y el fallo terminal.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS renewal_retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS renewal_next_retry_at timestamptz;
