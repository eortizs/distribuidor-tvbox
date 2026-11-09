-- Paquetes FlujoTV (`/modulos/paquetes-flujotv`): meses gratis de un paquete
-- sobre la orden de pago existente (`mp_orders`).
--
-- `months` conserva los meses PAGADOS (base del precio); `bonus_months`
-- guarda los meses gratis que la renovación añade (0 en renovaciones
-- individuales, 1 en el paquete de 6 meses y 2 en el de 12). La renovación
-- (`attemptOrderRenewal`) aplica meses + bonus con claves de idempotencia
-- derivadas (`mp-<id>` para los meses pagados, `mp-<id>-b1`, `-b2`, … para
-- los gratis), de modo que reintentos y conciliación nunca duplican meses.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS bonus_months int NOT NULL DEFAULT 0;
