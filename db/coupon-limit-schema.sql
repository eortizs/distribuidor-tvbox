-- Tope diario de canjes de cupón por comprador: override por usuario sobre el
-- valor global del servidor (`COUPON_QA_DAILY_LIMIT`, default 3). NULL = sin
-- override: manda el valor global. El admin lo ajusta desde /users (icono de
-- permisos); el canje en /api/cupones/orders usa el efectivo.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS coupon_daily_limit int;
