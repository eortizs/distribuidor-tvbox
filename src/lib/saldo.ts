/**
 * Utilidades del módulo «Abonar saldo» (`/modulos/abonar-saldo`),
 * compartidas por el cliente (formulario de monto) y el servidor (rutas
 * `/api/saldo/*`), para que jamás difieran:
 *
 * - El comprador define el monto libremente: cualquier cantidad mayor a $0
 *   MXN, con hasta 2 decimales y redondeo a centavos. Sin mínimos ni topes
 *   comerciales; el máximo técnico existe solo para caber en
 *   `mp_orders.amount numeric(10,2)` incluso engrosado con la comisión de
 *   Mercado Pago.
 * - `months = 0` es la marca de las órdenes de abono en `mp_orders`: las de
 *   renovación validan 1/3/6/12, así que 0 no colisiona y el cumplimiento
 *   (acreditar saldo en vez de renovar licencia) se despacha por ella.
 */

/** Techo técnico del abono por transacción (MXN): cabe engrosado en numeric(10,2). */
export const ABONO_MAX_MXN = 10_000_000

export interface AbonoAmountOk {
  ok: true
  /** Monto en centavos redondeado (el que se acredita al saldo). */
  amount: number
}

export interface AbonoAmountError {
  ok: false
  /** Mensaje legible para el campo del formulario. */
  message: string
}

/**
 * Valida y normaliza el monto a abonar. Acepta number o texto del input
 * (con coma decimal o separadores de miles); devuelve el monto redondeado a
 * centavos o el motivo del rechazo.
 */
export function parseAbonoAmount(value: unknown): AbonoAmountOk | AbonoAmountError {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/\s/g, "").replace(/,/g, "."))
        : Number.NaN

  if (!Number.isFinite(raw)) {
    return { ok: false, message: "Escribe un monto válido." }
  }
  const amount = Math.round(raw * 100) / 100
  if (amount <= 0) {
    return { ok: false, message: "El monto debe ser mayor a $0." }
  }
  if (amount > ABONO_MAX_MXN) {
    return {
      ok: false,
      message: `El monto excede el máximo por transacción (${ABONO_MAX_MXN.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}).`,
    }
  }
  return { ok: true, amount }
}
