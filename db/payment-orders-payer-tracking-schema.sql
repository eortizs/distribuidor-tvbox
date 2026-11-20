-- Trazabilidad de etapas del pagador en ligas de pago (payment_orders):
--   - link_opened_at: primera vez que el pagador ABRIÓ la liga corta
--     (spei.link/<CÓDIGO> respondió 302 a wa.me). Solo la primera apertura
--     de una orden ACTIVA escribe (idempotente por el IS NULL).
--   - payer_bound_at: primera vez que se LIGÓ el teléfono del pagador. El
--     binding ocurre cuando el sistema ENTREGA el código a ese chat
--     (solicitud por monto con candidata única, código explícito o
--     comprobante) — la entrega del código es la identidad, no el monto.
-- Ambas columnas alimentan la línea de tiempo del módulo Ligas de pago y
-- los avisos al cobrador; NINGUNA interviene en decisiones de dinero
-- (la confirmación sigue exigiendo comprobante validado con el código).

ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS link_opened_at timestamptz;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payer_bound_at timestamptz;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payer_nudged_at timestamptz;
