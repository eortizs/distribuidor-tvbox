import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { getWhatsAppStatus } from "@/server/whatsapp/socket"

/**
 * Estado del gateway WhatsApp (solo admin): conexión del socket, QR vigente
 * y último corte. Fuente en vivo del módulo `/modulos/whatsapp`.
 */
export async function GET() {
  try {
    await connection()
    const admin = await requireAdminApiUser()
    if (!admin) {
      const user = await requireApiUser()
      if (!user) return unauthorizedResponse()
      return forbiddenResponse()
    }

    return Response.json(
      { ok: true, data: getWhatsAppStatus() },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
