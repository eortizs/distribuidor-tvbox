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

/**
 * Tipos de saldo de la cuenta (`users.saldo_tokens` / `users.saldo_cupones`):
 * los tokens pagan el uso de herramientas con APIs externas (fal.ai,
 * OpenRouter, etc.) y los cupones la compra de licencias de FlujoTV.
 */
export type SaldoTipo = "tokens" | "cupones"

/** Catálogo canónico, en el orden en que se ofrecen en el módulo. */
export const SALDO_TIPOS: readonly SaldoTipo[] = ["tokens", "cupones"]

/**
 * Valida el tipo de saldo que llega del cliente (campo `tipo` de las rutas
 * `/api/saldo/*`). Devuelve null si no es una de las opciones válidas.
 */
export function parseSaldoTipo(value: unknown): SaldoTipo | null {
  return value === "tokens" || value === "cupones" ? value : null
}

/**
 * Columna de la billetera destino en `users` según el tipo de saldo. Solo
 * para interpolar en SQL con un valor ya validado (`parseSaldoTipo`): jamás
 * con entrada cruda del cliente.
 */
export const SALDO_TIPO_COLUMN: Record<
  SaldoTipo,
  "saldo_tokens" | "saldo_cupones"
> = {
  tokens: "saldo_tokens",
  cupones: "saldo_cupones",
}

/**
 * Etiqueta corta para UI (badges, títulos): «tokens» / «cupones». El nombre
 * completo siempre va acompañado de «Saldo en …».
 */
export function saldoTipoLabel(tipo: SaldoTipo): string {
  return tipo
}

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
