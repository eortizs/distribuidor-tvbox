import { forbiddenResponse, requireApiUser } from "@/server/auth/api"
import { archiveClient, updateClient } from "@/server/clientes/registry"
import { AppError } from "@/server/umejson/types"

export const instant = false

function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status }
    )
  }
  throw error
}

/** PATCH (editar) y DELETE (archivar: borrado suave) de un cliente propio. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireApiUser("core")
  if (!user) return forbiddenResponse()
  const { id } = await params
  let body: { name?: unknown; whatsappPhone?: unknown; notes?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json(
      { ok: false, error: { code: "cuerpo_invalido", message: "JSON inválido" } },
      { status: 400 }
    )
  }
  try {
    const client = await updateClient(id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.whatsappPhone !== undefined
        ? {
            whatsappPhone:
              body.whatsappPhone == null ? null : String(body.whatsappPhone),
          }
        : {}),
      ...(body.notes !== undefined
        ? { notes: body.notes == null ? null : String(body.notes) }
        : {}),
    })
    return Response.json({ ok: true, data: client })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireApiUser("core")
  if (!user) return forbiddenResponse()
  const { id } = await params
  try {
    await archiveClient(id)
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
