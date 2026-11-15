-- Idempotencia de las órdenes de transferencia por concepto de pago.
--
-- Un concepto de pago (transfer_concepts) identifica UNA intención de compra:
-- sin llave única en `mp_orders.concept_id`, dos envíos del mismo comprobante
-- con el mismo concepto activo (respuesta perdida + reintento del comprador,
-- o doble clic antes del consumo) creaban DOS órdenes — cada una con su
-- escaneo y su propia aprobación automática — y tras el consumo del concepto
-- el reintento moría en `concepto_invalido`. El índice único parcial convierte
-- el concepto en la llave de idempotencia del envío: la segunda inserción
-- rebota y el servidor responde con la orden original (replay), el mismo
-- contrato de `coupon_request_id` para los canjes de cupón.
--
-- Limpieza previa: si existieran órdenes duplicadas por concepto (la carrera
-- era posible antes del índice), conservan el vínculo la más antigua y las
-- terminales posteriores; al resto se le anula `concept_id` para que el
-- índice pueda crearse de forma idempotente.

-- Desempate determinista: la orden más antigua conserva el concepto.
WITH duplicadas AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY concept_id ORDER BY created_at ASC, id ASC
         ) AS posicion
    FROM mp_orders
   WHERE concept_id IS NOT NULL
)
UPDATE mp_orders o
   SET concept_id = NULL,
         updated_at = now()
  FROM duplicadas d
 WHERE o.id = d.id AND d.posicion > 1;

-- Un concepto de pago autoriza exactamente una orden.
CREATE UNIQUE INDEX IF NOT EXISTS mp_orders_concept_id_unique_idx
  ON mp_orders (concept_id)
  WHERE concept_id IS NOT NULL;
