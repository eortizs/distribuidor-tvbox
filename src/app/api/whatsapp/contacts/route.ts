import { connection } from "next/server"

import {
  forbiddenResponse,
  requireAdminApiUser,
  requireApiUser,
  unauthorizedResponse,
} from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { listWhatsAppContacts } from "@/server/whatsapp/service"

export async function GET() {
  try {
    await connection()
    const admin = await requireAdminApiUser("core")
    if (!admin) {
      const user = await requireApiUser("core")
      if (!user) return unauthorizedResponse()
      return forbiddenResponse()
    }

    const items = await listWhatsAppContacts()
    return Response.json(
      { ok: true, data: { items } },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
