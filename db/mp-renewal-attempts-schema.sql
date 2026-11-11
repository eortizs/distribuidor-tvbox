-- Contador de claves de idempotencia usadas por la renovación de una orden.
--
-- El servicio de licencias guarda en caché la respuesta de cada
-- Idempotency-Key, INCLUIDA la de un rechazo por cooldown («Solicitud
-- bloqueada: operacion reciente exitosa…», que no ejecuta nada). Repetir la
-- misma clave tras ese rechazo re-obtiene la respuesta guardada para siempre:
-- el reintento nunca se ejecuta y la orden queda atrapada en
-- `renewal_failed`. El remedio es rotar la clave (`mp-<id>` → `mp-<id>-r2` →
-- `-r3` → `-r4`) SOLO cuando el panel rechazó sin ejecutar nada
-- (`months_added: 0`, `attempts: 0`): la compra real nunca usó la clave
-- anterior, así que rotarla no puede duplicar meses. Este contador dice qué
-- clave toca usar en el próximo intento.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS renewal_key_attempts integer NOT NULL DEFAULT 1;
