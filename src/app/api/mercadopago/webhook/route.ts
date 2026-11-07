import { validateMercadoPagoSignature } from "@/server/mercadopago/signature"
import { processPaymentNotification } from "@/server/mercadopago/service"

interface WebhookPayload {
  type?: unknown
  topic?: unknown
  action?: unknown
  data?: unknown
  id?: unknown
}

/**
 * Notificaciones de Mercado Pago (webhook), endpoint público sin sesión.
 *
 * Seguridad: el cuerpo de la notificación NO es fuente de verdad. Solo se
 * extrae el identificador del pago y el estado real se consulta a la API de
 * MP con el token del vendedor, verificando monto, moneda y
 * `external_reference` contra la orden en la base de datos. Con
 * `MERCADOPAGO_WEBHOOK_SECRET` configurado, además se valida el header
 * `x-signature` y una notificación sin firma válida se rechaza con 401
 * antes de consumir la API de MP.
 *
 * Siempre responde 200 salvo firma inválida: cualquier otro código haría que
 * Mercado Pago reintente con backoff sobre eventos que ya se procesaron (o
 * que no nos competen).
 */
export async function POST(request: Request) {
  let payload: WebhookPayload = {}

  try {
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      payload = (await request.json()) as WebhookPayload
    } else {
      const form = await request.formData()
      payload = Object.fromEntries(form.entries()) as WebhookPayload
    }
  } catch {
    // Cuerpo ilegible: nada que procesar, pero se confirma la recepción.
    return Response.json({ ok: true, received: true })
  }

  const eventType =
    typeof payload.type === "string"
      ? payload.type
      : typeof payload.topic === "string"
        ? payload.topic
        : typeof payload.action === "string" && payload.action.startsWith("payment")
          ? "payment"
          : ""

  if (eventType !== "payment") {
    return Response.json({ ok: true, received: true })
  }

  // La notificación trae el id del pago en `data.id` (JSON) o en `data_id` /
  // `id` (form-urlencoded, formato IPN clásico).
  const dataRecord =
    typeof payload.data === "object" && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : {}
  const rawId =
    typeof dataRecord.id === "string" && dataRecord.id.trim().length > 0
      ? dataRecord.id.trim()
      : typeof dataRecord.id === "number"
        ? String(dataRecord.id)
        : typeof payload.id === "string" && payload.id.trim().length > 0
          ? payload.id.trim()
          : ""

  if (rawId.length === 0 || !/^\d+$/.test(rawId)) {
    return Response.json({ ok: true, received: true })
  }

  if (
    !validateMercadoPagoSignature({
      signatureHeader: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      paymentId: rawId,
    })
  ) {
    // Firma inválida: no se procesa ni se consume la API de MP. No responde
    // 200 para que no se confunda con una recepción procesada.
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        warn: `mercadopago: webhook con firma inválida (pago ${rawId})`,
      })
    )
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid_signature",
          message: "Firma de la notificación inválida.",
        },
      },
      { status: 401 }
    )
  }

  try {
    await processPaymentNotification({ paymentId: rawId })
  } catch (error) {
    // Fallo de proceso: se registra y se responde 200. MP reintenta las
    // notificaciones ante fallos reales de su lado; si el pago existió y la
    // orden quedó en medio, la conciliación del GET la recupera.
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `mercadopago: webhook pago ${rawId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }

  return Response.json({ ok: true, received: true })
}
