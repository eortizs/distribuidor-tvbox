/**
 * Precio de venta con Mercado Pago: la comisión del procesador (3.49% +
 * $4.00 fijos) y su IVA (16%) se descuentan del precio final de venta, así
 * que el cargo se engrosa para que el depósito neto sea el precio de la
 * licencia:
 *
 *   Precio final = (Neto + Fija × 1.16) / (1 − Variable × 1.16)
 *
 * Con neto $100: (100 + 4.64) / 0.959516 = $109.05, con $9.05 de retención.
 * La fórmula vive aquí y la comparten el servidor (importe de la orden que
 * verifica el webhook) y la UI (desglose del carrito), para que jamás
 * difieran.
 */

/** Comisión variable de Mercado Pago sobre el importe (3.49%). */
export const MP_FEE_VARIABLE = 0.0349

/** Comisión fija por pago de Mercado Pago, en MXN. */
export const MP_FEE_FIXED_MXN = 4

/** IVA que el procesador retiene sobre su comisión (16%). */
export const MP_FEE_IVA = 0.16

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Precio final a cobrar con Mercado Pago para recibir `netMxn` netos. La
 * comisión fija se cobra una vez por pago: sobre el total del cargo (por
 * eso el engrose se aplica al total de meses, no mes a mes).
 */
export function mpTotalMxn(netMxn: number): number {
  const withIva = 1 + MP_FEE_IVA
  return round2(
    (netMxn + MP_FEE_FIXED_MXN * withIva) / (1 - MP_FEE_VARIABLE * withIva)
  )
}

/** Costo por procesamiento del desglose: total a cobrar menos neto. */
export function mpProcessingFeeMxn(netMxn: number): number {
  return round2(mpTotalMxn(netMxn) - netMxn)
}
