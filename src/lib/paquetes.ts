/**
 * Catálogo de paquetes de renovación FlujoTV del módulo «Paquetes FlujoTV»
 * (`/modulos/paquetes-flujotv`), compartido por el cliente (selector del
 * sheet de compra) y el servidor (validación de las rutas `/api/paquetes/*`).
 *
 * Cada paquete paga sus meses y regala extras: el precio de la orden es
 * `meses × precio unitario` y la renovación aplica `meses + bonusMonths`
 * (los meses gratis van como renovaciones adicionales de 1 mes contra la
 * API del panel, con claves de idempotencia propias y deterministas).
 */

export const PAQUETE_MONTHS = [3, 6, 12] as const

export type PaqueteMonths = (typeof PAQUETE_MONTHS)[number]

export interface PaqueteFlujo {
  /** Meses pagados del paquete: base del precio y de la renovación. */
  months: PaqueteMonths
  /** Meses gratis que el paquete añade a la renovación. */
  bonusMonths: number
}

/** Paquetes en orden de presentación; 3 meses no regala nada. */
export const PAQUETES: PaqueteFlujo[] = [
  { months: 3, bonusMonths: 0 },
  { months: 6, bonusMonths: 1 },
  { months: 12, bonusMonths: 2 },
]

/**
 * Cupón asignado a los paquetes del módulo «Paquetes FlujoTV»: la forma de
 * pago «Cupón» de ese módulo lo usa para cualquiera de los paquetes (3, 6 o
 * 12 meses). Isomórfico para que la UI muestre exactamente el código que el
 * servidor valida.
 */
export const PAQUETE_COUPON_CODE = "1010"

export function isPaqueteMonths(value: unknown): value is PaqueteMonths {
  return (
    typeof value === "number" &&
    (PAQUETE_MONTHS as readonly number[]).includes(value)
  )
}

/** Meses gratis del paquete; 0 fuera del catálogo. */
export function paqueteBonusMonths(months: PaqueteMonths): number {
  return PAQUETES.find((paquete) => paquete.months === months)?.bonusMonths ?? 0
}

/** Etiqueta del paquete: «3 meses», «6 meses + 1 mes gratis», … */
export function paqueteLabel(months: PaqueteMonths): string {
  const bonus = paqueteBonusMonths(months)
  const base = `${months} meses`
  return bonus > 0
    ? `${base} + ${bonus} ${bonus === 1 ? "mes gratis" : "meses gratis"}`
    : base
}

/**
 * Etiqueta del plazo de una orden a partir de sus columnas (`months` pagados
 * + `bonus_months` gratis): «1 mes», «6 meses + 1 mes gratis», … Única fuente
 * para los mensajes de éxito de cliente y servidor.
 */
export function paqueteOrderLabel(
  months: number,
  bonusMonths: number
): string {
  const base = `${months} ${months === 1 ? "mes" : "meses"}`
  const bonus = Number.isInteger(bonusMonths) && bonusMonths > 0 ? bonusMonths : 0
  return bonus > 0
    ? `${base} + ${bonus} ${bonus === 1 ? "mes gratis" : "meses gratis"}`
    : base
}

/** Meses totales que aplica la renovación del paquete (pagados + gratis). */
export function paqueteTotalMonths(months: PaqueteMonths): number {
  return months + paqueteBonusMonths(months)
}
