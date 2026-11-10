import { MercadoPagoError } from "./errors"
import { publicSiteUrl } from "@/server/site-url"

/** Base de la API pública de Mercado Pago. */
export const MERCADOPAGO_API_BASE = "https://api.mercadopago.com"

export interface MercadoPagoConfig {
  accessToken: string
  /** Precio unitario de la renovación mensual, en MXN. */
  licensePriceMxn: number
  /** URL pública del sitio, sin slash final (back_urls, notification_url). */
  siteUrl: string
}

/**
 * Precio de la renovación mensual sin lanzar excepciones: `null` si no está
 * configurado o es inválido (la UI muestra el checkout como no disponible en
 * lugar de romper).
 */
export function licensePriceMxnOrNull(): number | null {
  const raw = process.env.LICENSE_PRICE_MXN?.trim() ?? ""
  const value = Number(raw)
  return raw.length > 0 && Number.isFinite(value) && value > 0 ? value : null
}

export interface TransferBankConfig {
  /** Nombre del banco receptor (p. ej. BBVA). */
  bank: string
  /** Cuenta receptora: CLABE, número de tarjeta o cuenta. */
  account: string
  /** Titular de la cuenta, tal como debe verse a nombre de quién se paga. */
  holder: string
}

/**
 * Cupón de QA (0000): por defecto DESACTIVADO. Es un código de prueba sin
 * catálogo ni vigencia: si quedara siempre activo, cualquier cuenta con
 * alcance podría renovar licencias gratis sin límite. Solo con
 * `COUPON_QA_ENABLED=1` en el servidor se acepta el canje, y con el tope
 * diario por comprador (`COUPON_QA_DAILY_LIMIT`) un código de prueba no se
 * vuelve una fuente ilimitada de renovaciones.
 */
export function isCouponQaEnabled(): boolean {
  return process.env.COUPON_QA_ENABLED?.trim() === "1"
}

/** Máximo de canjes de cupón por comprador en 24 horas. */
export function couponQaDailyLimit(): number {
  const raw = process.env.COUPON_QA_DAILY_LIMIT?.trim() ?? ""
  const value = Number(raw)
  return raw.length > 0 && Number.isInteger(value) && value > 0 ? value : 3
}

/**
 * Máximo de canjes de cupón por comprador en 30 días (acumulado mensual).
 * Complementa el tope diario: repartir cupones en días distintos no sortea
 * el techo del mes.
 */
export function couponQaMonthlyLimit(): number {
  const raw = process.env.COUPON_QA_MONTHLY_LIMIT?.trim() ?? ""
  const value = Number(raw)
  return raw.length > 0 && Number.isInteger(value) && value > 0 ? value : 10
}

/**
 * Datos bancarios que la UI muestra para pagar por transferencia, desde
 * `.env` (`TRANSFER_BANK_NAME`, `TRANSFER_ACCOUNT`, `TRANSFER_HOLDER`).
 * `null` si falta alguno: la opción de transferencia no se muestra en el
 * sheet en lugar de ofrecer un pago que nadie puede recibir.
 */
export function transferBankDataOrNull(): TransferBankConfig | null {
  const bank = process.env.TRANSFER_BANK_NAME?.trim() ?? ""
  const account = process.env.TRANSFER_ACCOUNT?.trim() ?? ""
  const holder = process.env.TRANSFER_HOLDER?.trim() ?? ""
  if (bank.length === 0 || account.length === 0 || holder.length === 0) {
    return null
  }
  return { bank, account, holder }
}

/**
 * Credencial y URL pública sin el precio de licencia: la usan los flujos de
 * pago que no cobran renovaciones (p. ej. el abono de saldo de
 * `/modulos/abonar-saldo`), donde `LICENSE_PRICE_MXN` es irrelevante.
 */
export function resolveMercadoPagoGateway(): {
  accessToken: string
  siteUrl: string
} {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? ""
  if (accessToken.length === 0) {
    throw new MercadoPagoError(
      503,
      "not_configured",
      "El pago con Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN en el servidor."
    )
  }

  const siteUrl = publicSiteUrl()

  return { accessToken, siteUrl }
}

/**
 * Configuración del motor de pagos: credencial del vendedor, precio de la
 * renovación mensual y URL pública para las URLs de retorno y de notificación
 * del webhook. Todo vive en `.env` (`MERCADOPAGO_ACCESS_TOKEN`,
 * `LICENSE_PRICE_MXN`, `SITE_URL`); sin token o sin precio válido no hay
 * checkout y el error lo dice claro antes de crear ninguna orden.
 */
export function resolveMercadoPagoConfig(): MercadoPagoConfig {
  const { accessToken, siteUrl } = resolveMercadoPagoGateway()

  const licensePriceMxn = licensePriceMxnOrNull()
  if (licensePriceMxn === null) {
    throw new MercadoPagoError(
      503,
      "not_configured",
      "El precio de la licencia no está configurado. Define LICENSE_PRICE_MXN (MXN, mayor que 0) en el servidor."
    )
  }

  return { accessToken, licensePriceMxn, siteUrl }
}
