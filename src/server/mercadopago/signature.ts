import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Validación del header `x-signature` de las notificaciones de Mercado Pago.
 *
 * Formato del header: `ts=<timestamp>,v1=<hmac-hex>`. El HMAC-SHA256 se
 * calcula con el secret del webhook (`MERCADOPAGO_WEBHOOK_SECRET`) sobre el
 * manifiest oficial:
 *
 *   id:<id del pago>;request-id:<header x-request-id>;ts:<ts>;
 *
 * Sin secret configurado la validación se omite (la integridad del estado
 * sigue garantizada porque el pago se reconsulta a la API de MP y se verifica
 * contra la orden en BD); con secret configurado, una notificación sin
 * firma válida se rechaza antes de tocar la API de MP, cerrando el
 * vector de amplificación hacia los rate limits de la cuenta vendedora.
 */
export function validateMercadoPagoSignature(input: {
  signatureHeader: string | null
  requestId: string | null
  paymentId: string
}): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? ""
  if (secret.length === 0) return true

  const header = input.signatureHeader?.trim() ?? ""
  if (header.length === 0) return false

  let ts = ""
  let v1 = ""
  for (const part of header.split(",")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === "ts") ts = value
    if (key === "v1") v1 = value
  }
  if (ts.length === 0 || v1.length === 0) return false

  const manifest = `id:${input.paymentId};request-id:${
    input.requestId ?? ""
  };ts:${ts};`
  const expected = createHmac("sha256", secret).update(manifest).digest("hex")

  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(v1.toLowerCase(), "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}
