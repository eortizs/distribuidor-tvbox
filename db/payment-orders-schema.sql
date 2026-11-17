-- Órdenes de pago por WhatsApp (/modulos/orden-de-pago): el creador (admin o
-- distribuidor) emite un cobro de MONTO LIBRE hacia un pagador externo
-- (cualquier persona, sin cuenta en el panel). El pagador recibe una liga
-- wa.me al agente con el CÓDIGO DE CONCEPTO de la orden prellenado, paga por
-- SPEI escribiendo ese código como concepto y manda el comprobante por el
-- mismo chat; el escaneo LLM del flujo de transferencias lo valida (fecha del
-- mes, código impreso, importe, beneficiario) y aprueba la orden o la deja en
-- revisión del creador.
--
-- Tabla PROPIA (no mp_orders): ese pipeline está acoplado a renovaciones de
-- FlujoTV (months, user_name, débitos, reintentos de panel) y forzar aquí un
-- cobro libre crearía casos especiales peligrosos. Se reutilizan en cambio
-- las piezas de dominio puro del escaneo (extraerComprobanteDeArchivo +
-- evaluarCondiciones con holderName parametrizable).
--
-- Snapshot bancario: la orden congela banco/cuenta/titular y monto al
-- crearse — ediciones posteriores del perfil (o del env TRANSFER_*) no
-- cambian órdenes vivas; `bank_holder` es el titular que valida el
-- beneficiario del comprobante.
--
-- Estado: 'pending' (activa, código reservado) → 'paid' | 'rejected'
-- (resueltas; con quién en reviewed_by) | 'cancelled' (por el creador). Sin
-- caducidad: queda activa hasta resolverse o cancelarse.

CREATE TABLE IF NOT EXISTS payment_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  creator_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_mxn       numeric(10,2) NOT NULL CHECK (amount_mxn >= 1 AND amount_mxn <= 50000),
  note             text,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','rejected','cancelled')),
  bank_name        text NOT NULL,
  bank_account     text NOT NULL,
  bank_holder      text NOT NULL,
  payer_phone      text,
  ticket_file_id   uuid REFERENCES user_files(id) ON DELETE SET NULL,
  ticket_sha256    text,
  scan_status      text,
  scan_result      jsonb,
  scan_model       text,
  scan_at          timestamptz,
  reviewed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- El código de 4 caracteres (mismo alfabeto sin 0/O/1/I que transfer_concepts)
-- es ÚNICO GLOBAL solo entre las órdenes PENDIENTES: es el namespace que el
-- pagador escribe como concepto y por el que el comprobante descubre la
-- orden. Al resolverse (paid/rejected/cancelled) el código queda libre para
-- una orden futura; la fila histórica conserva su código.
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_active_code_idx
  ON payment_orders (code) WHERE status = 'pending';

-- Dedup del comprobante por huella: el mismo archivo re-enviado nunca
-- auto-aprueba otra orden (el lookup corre GLOBAL sobre la tabla: el pagador
-- es anónimo y no hay buyer que acote). ÚNICO, no solo índice: cierra la
-- carrera check-then-act del dedup (dos envíos concurrentes del mismo
-- archivo a dos órdenes distintas) — el segundo save falla con 23505 y el
-- review degrada a revisión manual en vez de aprobar dos veces.
DROP INDEX IF EXISTS payment_orders_ticket_sha_idx;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_ticket_sha_uidx
  ON payment_orders (ticket_sha256) WHERE ticket_sha256 IS NOT NULL;

-- Descubrimiento de pendientes por comprobante (código impreso): el índice
-- del creador no sirve el filtro por estado y el de código es exclusivo de
-- pendientes; sin este índice cada turno de comprobante haría seq-scan de la
-- tabla completa, que crece con el histórico.
CREATE INDEX IF NOT EXISTS payment_orders_pending_created_idx
  ON payment_orders (created_at) WHERE status = 'pending';

-- Replay honesto de órdenes resueltas por código (pagador que reenvía el
-- comprobante de un pago ya resuelto): sin este índice la búsqueda por
-- código fuera de pendientes degradaría a seq-scan sobre todo el histórico.
CREATE INDEX IF NOT EXISTS payment_orders_resolved_code_idx
  ON payment_orders (code, resolved_at DESC) WHERE status <> 'pending';

-- Listado del módulo y descubrimiento de pendientes (códigos activos).
CREATE INDEX IF NOT EXISTS payment_orders_creator_idx
  ON payment_orders (creator_user_id, created_at DESC);

-- Kind nuevo de la campana `payment_order`: avisos al creador (cobro
-- recibido, comprobante por revisar, resolución manual de un admin). Patrón
-- idempotente del repo: se suelta el CHECK previo y se vuelve a crear. La
-- lista es el SUPERSET COMPLETO de kinds vigentes (los mismos 7 de
-- alertas-schema.sql y client-renewal-schema.sql, que recrean el mismo CHECK
-- en otros puntos de la cadena): si faltara un kind ya escrito en la tabla,
-- el ADD CONSTRAINT de una re-ejecución fallaría con 23514 y rompería la
-- cadena de despliegue. Al agregar un kind nuevo, actualizar la lista en los
-- TRES archivos.
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
      CHECK (kind IN (
        'renewal_success', 'renewal_failed', 'transfer_rejected',
        'alert_hit', 'reminder', 'client_renewal_notice',
        'payment_order'
      ));
  END IF;
END $$;
