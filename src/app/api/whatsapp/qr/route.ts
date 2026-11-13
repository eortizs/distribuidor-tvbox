import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { getWhatsAppQrDataUrl } from "@/server/whatsapp/socket"

/**
 * QR vigente para vincular el número del agente (solo admin), como data URL
 * lista para pintar en `<img>`. 404 si no hay QR en este momento (ya
 * vinculado, sin conexión o módulo deshabilitado).
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

    const dataUrl = await getWhatsAppQrDataUrl()
    if (!dataUrl) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "whatsapp_qr_no_disponible",
            message:
              "No hay QR activo: la sesión ya puede estar vinculada o el gateway no está conectando.",
          },
        },
        { status: 404 }
      )
    }

    return Response.json(
      { ok: true, data: { dataUrl } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
