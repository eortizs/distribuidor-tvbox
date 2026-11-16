-- Renovación de clientes FlujoTV por WhatsApp (/renovar): los clientes NO son
-- usuarios del panel; su identidad es el teléfono guardado en
-- `client_metadata.whatsapp_phone`. Envían `/renovar`, reciben su concepto de
-- pago + importe + datos bancarios de SU distribuidor (perfil → Datos
-- bancarios) y luego mandan el comprobante como archivo sin mensaje; el
-- escaneo LLM valida y la renovación se aplica sola.
--
-- Esta migración añade:
--
-- 1. `mp_orders.origin`: vía que creó la orden. NULL = flujos existentes
--    (sheet de /clientes, /tv3<usuario> del Asistente, Mercado Pago, cupón).
--    'wa_cliente' = orden de cliente por WhatsApp con cobro interno al
--    distribuidor (débito de `users.saldo_cupones` al aprobar).
--    'wa_cliente_admin' = cliente del ADMIN (ningún usuario distribuidor liga
--    su reseller): cuenta receptora del env `TRANSFER_*` y SIN débito.
--
-- 2. Kind nuevo de campana `client_renewal_notice`: avisos al distribuidor
--    (o admin) cuando un cliente intenta renovar y algo estructural falta
--    (datos bancarios incompletos, saldo insuficiente para el débito interno).

ALTER TABLE mp_orders ADD COLUMN IF NOT EXISTS origin text;

-- Kinds nuevos de la campana para el flujo de clientes. Patrón idempotente de
-- db/alertas-schema.sql: se suelta el CHECK previo y se vuelve a crear con el
-- conjunto ampliado (nunca rompe filas existentes: solo amplía). Esta
-- migración corre DESPUÉS de apply-alertas.mjs en la cadena: su DO block
-- recrearía el CHECK con solo 5 kinds y pisaría este kind si llegara antes.
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN (
        'renewal_success', 'renewal_failed', 'transfer_rejected',
        'alert_hit', 'reminder', 'client_renewal_notice'
      ));
  END IF;
END $$;

-- Lookup del teléfono en el hot path de WhatsApp: la rama de clientes
-- consulta `whatsapp_phone` por CADA mensaje de número no registrado
-- (antes de los topes de ráfaga); la tabla solo tiene la PK user_name.
CREATE INDEX IF NOT EXISTS client_metadata_whatsapp_phone_idx
  ON client_metadata (whatsapp_phone)
  WHERE whatsapp_phone IS NOT NULL;

-- Limpieza del índice de una iteración previa de esta migración: ninguna
-- query de la app filtra por `origin` (todas las lecturas van sobre filas ya
-- cargadas), así que un índice parcial ahí solo costaba escritura.
DROP INDEX IF EXISTS mp_orders_wa_cliente_idx;
