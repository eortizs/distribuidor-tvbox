-- Resultado del escaneo LLM del comprobante de transferencia bancaria
-- (RECEIPT_SCAN_MODEL + AI_GATEWAY_API_KEY). La orden se crea igual que hoy;
-- estas columnas guardan qué extrajo el modelo y cómo salió la verificación
-- determinística (mes actual, concepto con el usuario, importe, beneficiario):
--
-- scan_status = 'approved'   pasó todas las condiciones → orden aprobada y
--                            renovación lanzada automáticamente.
--             = 'rejected'   al menos una condición falló → la orden sigue
--                            `pending` para la revisión manual del admin.
--             = 'error'      el escaneo no pudo ejecutarse (modelo fuera,
--                            salida rota, sin configurar) → revisión manual.
-- scan_result guarda el detalle: datos extraídos, condiciones evaluadas y
-- los motivos de rechazo legibles para el comprador y el admin.
--
-- Columnas opcionales (NULL = orden anterior al escaneo o revisión manual
-- pura): nada del flujo existente cambia de significado.

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS scan_status text;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS scan_result jsonb;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS scan_model text;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS scan_at timestamptz;

-- Huella del comprobante (sha256 de los bytes): permite rechazar el re-envío
-- del MISMO comprobante por el mismo comprador (una transferencia real no
-- puede autorizar varias renovaciones). El escaneo escribe la huella al
-- revisar y consulta órdenes previas del mismo comprador con la misma huella
-- antes de auto-aprobar; el duplicado queda `pending` para revisión manual.
ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS ticket_sha256 text;

CREATE INDEX IF NOT EXISTS mp_orders_ticket_sha_idx
  ON mp_orders (buyer_user_id, ticket_sha256)
  WHERE ticket_sha256 IS NOT NULL;
