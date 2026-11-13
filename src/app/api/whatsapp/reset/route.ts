import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { resetWhatsAppSession } from "@/server/whatsapp/socket"
import { AppError } from "@/server/umejson/types"

/**
 * Re-vinculación tras una revocación (solo admin): borra la sesión vieja de
 * `storage/whatsapp-session` y recrea el socket para generar QR/código
 * nuevo. Solo procede en estado `revoked`.
 */
export async function POST() {
  try {
    await connection()
    const admin = await requireAdminApiUser()
    if (!admin) {
      const user = await requireApiUser()
      if (!user) return unauthorizedResponse()
      return forbiddenResponse()
    }

    try {
      await resetWhatsAppSession()
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      if (raw === "whatsapp_not_revoked") {
        throw new AppError(
          409,
          "whatsapp_not_revoked",
          "La sesión no está revocada: no hay nada que re-vincular."
        )
      }
      throw error
    }

    return Response.json(
      { ok: true, data: { reset: true } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
