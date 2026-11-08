-- Tope MENSUAL (acumulado) de canjes de cupón por comprador: override por
-- usuario sobre el valor global del servidor (`COUPON_QA_MONTHLY_LIMIT`,
-- default 10). NULL = sin override: manda el valor global. El admin lo ajusta
-- desde /users (icono de permisos) junto al tope diario; el canje en
-- /api/cupones/orders usa el efectivo sobre una ventana rodante de 30 días.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS coupon_monthly_limit int;
