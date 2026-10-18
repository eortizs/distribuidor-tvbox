import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"
import {
  isFileKind,
  listUserFiles,
  maxUploadBytes,
  saveUserFile,
  type FileKind,
  type UserFile,
} from "@/server/storage/user-files"
import { AppError } from "@/server/umejson/types"

function filePayload(file: UserFile) {
  return {
    id: file.id,
    kind: file.kind,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    url: `/api/files/${file.id}`,
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const kindParam = searchParams.get("kind")
    let kind: FileKind | undefined
    if (kindParam) {
      if (!isFileKind(kindParam)) {
        throw new AppError(
          422,
          "invalid_request",
          "kind debe ser 'attachment' o 'generated'"
        )
      }
      kind = kindParam
    }
    const limitParam = Number(searchParams.get("limit") ?? "100")
    const offsetParam = Number(searchParams.get("offset") ?? "0")

    const result = await listUserFiles(user.id, {
      kind,
      limit: Number.isFinite(limitParam) ? limitParam : 100,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    })

    return Response.json({
      ok: true,
      data: {
        files: result.files.map(filePayload),
        total: result.total,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const maxBytes = maxUploadBytes()
    const contentLength = Number(request.headers.get("content-length") ?? "0")
    if (contentLength > maxBytes + 64 * 1024) {
      throw new AppError(
        413,
        "file_too_large",
        `El archivo excede el límite de ${maxBytes} bytes`
      )
    }

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      throw new AppError(
        422,
        "invalid_request",
        "Se esperaba multipart/form-data con un campo 'file'"
      )
    }

    const kindParam = formData.get("kind")
    let kind: FileKind = "attachment"
    if (typeof kindParam === "string" && kindParam.length > 0) {
      if (!isFileKind(kindParam)) {
        throw new AppError(
          422,
          "invalid_request",
          "kind debe ser 'attachment' o 'generated'"
        )
      }
      kind = kindParam
    }

    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError(
        422,
        "invalid_request",
        "Se requiere un campo 'file' con contenido"
      )
    }
    if (file.size > maxBytes) {
      throw new AppError(
        413,
        "file_too_large",
        `El archivo excede el límite de ${maxBytes} bytes`
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const saved = await saveUserFile({
      userId: user.id,
      kind,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    })

    return Response.json(
      { ok: true, data: filePayload(saved) },
      { status: 201 }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
