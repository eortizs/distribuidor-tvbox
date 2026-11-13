"use client"

import * as React from "react"

import type { AttachmentItem, AttachmentStatus } from "@/components/herramientas/attachment-chips"
import { useFileUpload, type FileWithPreview } from "@/hooks/use-file-upload"

/**
 * Adjuntos de referencia de una herramienta: sube cada archivo elegido al
 * almacenamiento del usuario (`/api/files`, kind `attachment`), conserva el
 * id del servidor y expone los chips, los ids listos para el backend y los
 * estados de error. Un solo dueño para la máquina de estado que antes vivía
 * copiada en image-studio y alertas-studio, incluido el guard de carrera del
 * archivo que se quita mientras su subida vuela (se libera del servidor para
 * no dejar huérfanos en el disco).
 *
 * `remove` quita el chip y BORRA el archivo del servidor; `detachAll` limpia
 * el editor sin borrar nada (para cuando los adjuntos ya quedaron ligados a
 * un registro creado).
 */

type AttachmentState = {
  id: string
  serverId: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  status: AttachmentStatus
}

export function useAttachmentUpload(options: {
  accept: string
  maxFiles: number
  maxSize: number
  maxTotalBytes: number
  /** Mensaje/aviso cuando el navegador rechaza un archivo por tipo o tamaño. */
  onInvalidFile?: () => void
  /** Mensaje/aviso cuando una subida al servidor falla. */
  onUploadError?: (message: string) => void
}): {
  attachments: AttachmentItem[]
  attachmentIds: string[]
  uploading: boolean
  failed: boolean
  totalBytes: number
  tooBig: boolean
  error: string | null
  setError: (message: string | null) => void
  openFileDialog: () => void
  getInputProps: ReturnType<typeof useFileUpload>[1]["getInputProps"]
  remove: (id: string) => void
  detachAll: () => void
} {
  const [attachments, setAttachments] = React.useState<Record<string, AttachmentState>>({})
  const [error, setError] = React.useState<string | null>(null)
  const uploadControllers = React.useRef(new Map<string, AbortController>())
  const removedIds = React.useRef(new Set<string>())

  const [{ files: pickedFiles }, { openFileDialog, getInputProps, removeFile }] =
    useFileUpload({
      multiple: true,
      maxFiles: options.maxFiles,
      maxSize: options.maxSize,
      accept: options.accept,
      onFilesAdded: (added) => {
        void Promise.all(
          added.map((item) =>
            upload(item).catch((uploadError: unknown) => {
              options.onUploadError?.(
                uploadError instanceof Error
                  ? uploadError.message
                  : "No se pudo adjuntar el archivo."
              )
            })
          )
        )
      },
      onError: () => {
        options.onInvalidFile?.()
      },
    })

  async function upload(item: FileWithPreview) {
    const file = item.file
    if (!(file instanceof File)) return
    const base: AttachmentState = {
      id: item.id,
      serverId: null,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      status: "uploading",
    }
    removedIds.current.delete(item.id)
    setAttachments((current) => ({ ...current, [item.id]: base }))

    const controller = new AbortController()
    uploadControllers.current.set(item.id, controller)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("kind", "attachment")
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })
      const body = (await response.json()) as {
        ok: boolean
        data?: { id: string }
        error?: { message?: string }
      }
      if (!response.ok || !body.ok || !body.data) {
        throw new Error(body.error?.message ?? "No se pudo subir el archivo.")
      }
      // El chip se quitó mientras el archivo subía: ya está en el servidor y
      // hay que liberarlo para no dejarlo huérfano en el disco.
      if (removedIds.current.has(item.id)) {
        void fetch(`/api/files/${body.data.id}`, { method: "DELETE" }).catch(
          () => {}
        )
        return
      }
      setAttachments((current) => ({
        ...current,
        [item.id]: {
          ...(current[item.id] ?? base),
          serverId: body.data!.id,
          status: "ready",
        },
      }))
    } catch (uploadError) {
      if (controller.signal.aborted) return
      setAttachments((current) => ({
        ...current,
        [item.id]: { ...(current[item.id] ?? base), status: "error" },
      }))
      throw uploadError instanceof Error
        ? uploadError
        : new Error("No se pudo adjuntar el archivo.")
    } finally {
      uploadControllers.current.delete(item.id)
    }
  }

  function remove(id: string) {
    const entry = attachments[id]
    removedIds.current.add(id)
    uploadControllers.current.get(id)?.abort()
    uploadControllers.current.delete(id)
    removeFile(id)
    setAttachments((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    if (entry?.serverId) {
      void fetch(`/api/files/${entry.serverId}`, { method: "DELETE" }).catch(
        () => {}
      )
    }
  }

  /** Limpia el editor conservando los archivos ya subidos al servidor. */
  function detachAll() {
    for (const controller of uploadControllers.current.values()) {
      controller.abort()
    }
    uploadControllers.current.clear()
    removedIds.current.clear()
    for (const id of Object.keys(attachments)) removeFile(id)
    setAttachments({})
    setError(null)
  }

  const items: AttachmentItem[] = pickedFiles.flatMap((item) => {
    const entry = attachments[item.id]
    if (!entry) return []
    return [
      {
        id: entry.id,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes,
        status: entry.status,
      },
    ]
  })

  const serverIds = items.flatMap((item) => {
    const entry = attachments[item.id]
    return entry?.serverId && entry.status === "ready" ? [entry.serverId] : []
  })

  return {
    attachments: items,
    attachmentIds: serverIds,
    uploading: items.some((item) => item.status === "uploading"),
    failed: items.some((item) => item.status === "error"),
    totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    tooBig:
      items.reduce((sum, item) => sum + item.sizeBytes, 0) >
      options.maxTotalBytes,
    error,
    setError,
    openFileDialog,
    getInputProps,
    remove,
    detachAll,
  }
}
