import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import { crearTicketDesdeArchivo, listarVista } from "@/server/tickets/service"
import { maxUploadBytes } from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"

const ESTADOS_VALIDOS = new Set(["borrador", "revision", "confirmado"])

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const estadoParam = searchParams.get("estado")
    let estado: "borrador" | "revision" | "confirmado" | undefined
    if (estadoParam) {
      if (!ESTADOS_VALIDOS.has(estadoParam)) {
        throw new AppError(
          422,
          "invalid_request",
          "estado debe ser 'borrador', 'revision' o 'confirmado'."
        )
      }
      estado = estadoParam as "borrador" | "revision" | "confirmado"
    }
    const limitParam = Number(searchParams.get("limit") ?? "20")
    const offsetParam = Number(searchParams.get("offset") ?? "0")

    const resultado = await listarVista(user.id, {
      estado,
      limit: Number.isFinite(limitParam) ? limitParam : 20,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    })

    return Response.json(
      { ok: true, data: resultado },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Alta durable: guarda la foto y crea el ticket draft; el análisis corre
 * después por `POST /api/tickets/[id]/extraer`. Multipart con `file` y
 * `requestId`. Mismo archivo ya guardado → el ticket existente
 * (data.duplicado true), sin cobrar otro análisis.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const maxBytes = maxUploadBytes()
    // Content-Length no es confiable, pero permite rechazar de entrada los
    // excesos evidentes; el límite real se aplica sobre los bytes leídos.
    const contentLength = Number(request.headers.get("content-length") ?? "0")
    if (contentLength > maxBytes + 64 * 1024) {
      throw new AppError(
        413,
        "file_too_large",
        `La imagen excede el límite de ${maxBytes} bytes`
      )
    }

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      throw new AppError(
        422,
        "invalid_request",
        "Se esperaba multipart/form-data con campos 'file' y 'requestId'."
      )
    }

    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(
        422,
        "invalid_request",
        "Se requiere un campo 'file' con la foto del ticket."
      )
    }
    if (file.size > maxBytes) {
      throw new AppError(
        413,
        "file_too_large",
        `La imagen excede el límite de ${maxBytes} bytes`
      )
    }

    const resultado = await crearTicketDesdeArchivo(user, file, formData.get("requestId"))

    return Response.json(
      {
        ok: true,
        data: resultado.vista,
        duplicado: resultado.duplicado,
      },
      { status: resultado.duplicado ? 200 : 201 }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
