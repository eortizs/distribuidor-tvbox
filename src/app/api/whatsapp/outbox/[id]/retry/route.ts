import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { retryWhatsAppOutboxItem } from "@/server/whatsapp/service"
import { AppError } from "@/server/umejson/types"

/** Reencola un envío fallido o varado de la cola de WhatsApp (solo admin). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connection()
    const admin = await requireAdminApiUser()
    if (!admin) {
      const user = await requireApiUser()
      if (!user) return unauthorizedResponse()
      return forbiddenResponse()
    }

    const { id } = await params
    const retried = await retryWhatsAppOutboxItem(id)
    if (!retried) {
      throw new AppError(
        404,
        "whatsapp_outbox_not_found",
        "El envío no existe o ya salió de la cola."
      )
    }

    return Response.json(
      { ok: true, data: { retried: true } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
