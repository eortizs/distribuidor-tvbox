import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { pushConfigured, sendPushToUser } from "@/server/push/service"
import { AppError } from "@/server/umejson/types"

/** Límite del aviso de prueba: 3 por minuto por usuario (bucket en memoria). */
const RATE_LIMIT_MAX = 3
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  if (rateBuckets.size > 1000) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key)
    }
  }
  const bucket = rateBuckets.get(userId)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  bucket.count += 1
  return bucket.count <= RATE_LIMIT_MAX
}

/** «Probar aviso»: envía una notificación de prueba a este usuario. */
export async function POST() {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    if (!pushConfigured()) {
      throw new AppError(
        500,
        "push_not_configured",
        "El servidor no tiene llaves VAPID configuradas."
      )
    }
    if (!checkRateLimit(user.id)) {
      throw new AppError(
        429,
        "rate_limited",
        "Espera un momento antes de pedir otro aviso de prueba."
      )
    }

    const delivered = await sendPushToUser(user.id, {
      title: "Aviso de prueba",
      body: "Así se ve una notificación de tus alertas en este dispositivo.",
      url: "/modulos/alertas",
      tag: "alertas-test",
    })

    return Response.json(
      { ok: true, data: { delivered } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
