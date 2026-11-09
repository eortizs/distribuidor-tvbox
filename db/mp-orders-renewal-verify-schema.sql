-- Verificación anti-falsos-positivos de renovaciones: vencimiento ORIGINAL de
-- la licencia leído en el panel de FlujoTV justo antes de ejecutar la
-- renovación (primer intento). Tras renovar, el servidor relee el vencimiento
-- y solo marca la orden `renewed` si cambió respecto a esta línea base: un
-- panel que responde 200 sin aplicar la renovación ya no produce éxitos
-- falsos.
--
-- Se persiste en la orden para que los reintentos (idempotentes por
-- `mp-<orderId>`) comparen contra el original y no contra un vencimiento que
-- un intento anterior ya hubiera movido, lo que haría la verificación
-- imposible de satisfacer.
--
-- `renewal_verified_expires_at` es el vencimiento NUEVO que la verificación
-- leyó del panel al confirmar el cambio: es la evidencia que muestran los
-- mensajes de «renovación aplicada» para que el comprador vea la fecha real.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS renewal_baseline_expires_at text,
  ADD COLUMN IF NOT EXISTS renewal_verified_expires_at text;
