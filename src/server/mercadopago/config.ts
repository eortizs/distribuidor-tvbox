import { MercadoPagoError } from "./errors"

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

/**
 * Configuración del motor de pagos: credencial del vendedor, precio de la
 * renovación mensual y URL pública para las URLs de retorno y de notificación
 * del webhook. Todo vive en `.env` (`MERCADOPAGO_ACCESS_TOKEN`,
 * `LICENSE_PRICE_MXN`, `SITE_URL`); sin token o sin precio válido no hay
 * checkout y el error lo dice claro antes de crear ninguna orden.
 */
export function resolveMercadoPagoConfig(): MercadoPagoConfig {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? ""
  if (accessToken.length === 0) {
    throw new MercadoPagoError(
      503,
      "not_configured",
      "El pago con Mercado Pago no está configurado. Define MERCADOPAGO_ACCESS_TOKEN en el servidor."
    )
  }

  const licensePriceMxn = licensePriceMxnOrNull()
  if (licensePriceMxn === null) {
    throw new MercadoPagoError(
      503,
      "not_configured",
      "El precio de la licencia no está configurado. Define LICENSE_PRICE_MXN (MXN, mayor que 0) en el servidor."
    )
  }

  const siteUrl = (
    process.env.SITE_URL?.trim() ||
    "https://distribuidor-tvbox.people-ia.com"
  ).replace(/\/+$/, "")

  return { accessToken, licensePriceMxn, siteUrl }
}
