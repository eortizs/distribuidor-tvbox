import { z } from "zod"

import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse, readJsonBody } from "@/server/http"
import {
  deletePushSubscription,
  upsertPushSubscription,
} from "@/server/alertas/repository"
import { isValidPushEndpoint, pushConfigured } from "@/server/push/service"
import { AppError } from "@/server/umejson/types"

/**
 * Suscripciones Web Push del dispositivo actual. El endpoint es único por
 * navegador: el mismo dispositivo re-suscribiéndose refresca la fila (si el
 * dueño es la misma cuenta). El endpoint solo se acepta de los push services
 * reales de los navegadores: el servidor lo marca en cada disparo, y una URL
 * arbitraria convertiría el envío en un sondeo hacia cualquier destino.
 */

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(40).max(400),
    auth: z.string().min(8).max(400),
  }),
})

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!pushConfigured()) {
      throw new AppError(
        500,
        "push_not_configured",
        "El servidor no tiene llaves VAPID configuradas: los avisos del dispositivo están deshabilitados."
      )
    }

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const parsed = subscriptionSchema.safeParse(body.body)
    if (!parsed.success) {
      throw new AppError(
        422,
        "invalid_request",
        "La suscripción del navegador no tiene la forma esperada."
      )
    }
    if (!isValidPushEndpoint(parsed.data.endpoint)) {
      throw new AppError(
        422,
        "invalid_request",
        "El endpoint de push no pertenece a un servicio de notificaciones conocido."
      )
    }

    const upserted = await upsertPushSubscription({
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: request.headers.get("user-agent"),
    })
    if (!upserted) {
      throw new AppError(
        409,
        "endpoint_owned_by_other",
        "Este dispositivo ya tiene avisos activados con otra cuenta. Desactívalos allí antes de activarlos aquí."
      )
    }

    return Response.json({ ok: true, data: { subscribed: true } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const body = await readJsonBody(request)
    if (!body.ok) return body.response

    const endpoint = (body.body as { endpoint?: unknown }).endpoint
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      throw new AppError(422, "invalid_request", "Falta el endpoint del dispositivo.")
    }

    await deletePushSubscription(user.id, endpoint)

    return Response.json({ ok: true, data: { subscribed: false } })
  } catch (error) {
    return errorResponse(error)
  }
}
