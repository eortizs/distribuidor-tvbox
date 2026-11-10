-- Concepto de pago de las transferencias bancarias: código de 4 caracteres
-- alfanuméricos que el comprador escribe en su transferencia y que queda
-- impreso en el comprobante; el escaneo del ticket lo valida contra la orden.
--
-- Ciclo de vida: el botón de transferencia entrega (o reutiliza) el código
-- activo del comprador + usuario de FlujoTV + mes actual (latente si el
-- comprador cancela: al volver recibe el mismo código). Vence al terminar el
-- mes (period_month) y se ANULA (status='consumed') cuando la orden que lo
-- usa llega a su fin (aprobada → pagada / rechazada), de modo que cada
-- transacción del mes queda trazada con su propio concepto.
--
-- Unicidad: un solo código activo por comprador + usuario + mes (el botón es
-- idempotente) y códigos activos únicos dentro del mes (el concepto identifica
-- la transacción sin ambigüedad).

CREATE TABLE IF NOT EXISTS transfer_concepts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name     text NOT NULL,
  -- Mes de vigencia 'YYYY-MM' (hora del servidor, igual que la verificación
  -- de fecha del comprobante): al vencer el mes el código ya no se entrega.
  period_month  text NOT NULL,
  -- active | consumed
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  consumed_by_order_id uuid
);

-- El botón de transferencia es idempotente: mismo comprador + usuario + mes
-- devuelve siempre el mismo código mientras siga activo.
CREATE UNIQUE INDEX IF NOT EXISTS transfer_concepts_one_active_idx
  ON transfer_concepts (buyer_user_id, user_name, period_month)
  WHERE status = 'active';

-- Cada código es único durante el mes entre los activos.
CREATE UNIQUE INDEX IF NOT EXISTS transfer_concepts_code_month_idx
  ON transfer_concepts (period_month, code)
  WHERE status = 'active';

-- La orden queda ligada al concepto que autoriza su comprobante.
ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS concept_id uuid REFERENCES transfer_concepts(id)
    ON DELETE SET NULL;

ALTER TABLE mp_orders
  ADD COLUMN IF NOT EXISTS concept_code text;
