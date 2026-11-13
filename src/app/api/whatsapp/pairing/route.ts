import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { requestWhatsAppPairing } from "@/server/whatsapp/socket"
import { AppError } from "@/server/umejson/types"

/** Mapea los fallos conocidos del emparejamiento a mensajes operables. */
function pairingError(error: unknown): Response {
  const raw = error instanceof Error ? error.message : String(error)
  const map: Record<string, { code: string; message: string }> = {
    whatsapp_not_configured: {
      code: "whatsapp_not_configured",
      message: "Falta WHATSAPP_AGENT_NUMBER en el servidor.",
    },
    whatsapp_already_paired: {
      code: "whatsapp_already_paired",
      message: "El número del agente ya está vinculado.",
    },
    whatsapp_socket_not_ready: {
      code: "whatsapp_socket_not_ready",
      message:
        "El gateway no está listo todavía; espera unos segundos e intenta de nuevo.",
    },
  }
  const known = map[raw]
  return errorResponse(
    known
      ? new AppError(409, known.code, known.message)
      : new AppError(
          502,
          "whatsapp_pairing_error",
          "WhatsApp no entregó el código. Intenta de nuevo o usa el QR."
        )
  )
}

/**
 * Código de emparejamiento de 8 dígitos (solo admin): se entra en el teléfono
 * del agente con WhatsApp → Dispositivos vinculados → Vincular con número de
 * teléfono. Alternativa sin cámara al QR.
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

    let code: string
    try {
      code = await requestWhatsAppPairing()
    } catch (error) {
      return pairingError(error)
    }

    return Response.json(
      { ok: true, data: { code } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
