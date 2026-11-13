import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { listWhatsAppOutbox } from "@/server/whatsapp/service"

/** Cola de salida de WhatsApp (solo admin): pendientes y fallidos primero. */
export async function GET() {
  try {
    await connection()
    const admin = await requireAdminApiUser()
    if (!admin) {
      const user = await requireApiUser()
      if (!user) return unauthorizedResponse()
      return forbiddenResponse()
    }

    const items = await listWhatsAppOutbox()
    return Response.json(
      { ok: true, data: { items } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
