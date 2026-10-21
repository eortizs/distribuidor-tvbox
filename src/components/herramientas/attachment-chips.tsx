"use client"

import {
  FileAudioIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  XIcon,
} from "lucide-react"

import { formatBytes } from "@/hooks/use-file-upload"

import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export type AttachmentStatus = "uploading" | "ready" | "error"

export interface AttachmentItem {
  /** Identificador local del chip (o id del archivo en el servidor). */
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  status?: AttachmentStatus
}

function iconFor(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon
  if (mimeType.startsWith("video/")) return FilmIcon
  if (mimeType.startsWith("audio/")) return FileAudioIcon
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") {
    return FileTextIcon
  }
  return FileIcon
}

/**
 * Chips de los archivos adjuntos: los que el usuario tiene seleccionados en
 * el área de texto y los que ya viajan en un mensaje del chat.
 */
export function AttachmentChips({
  attachments,
  onRemove,
  disabled,
}: {
  attachments: readonly AttachmentItem[]
  onRemove?: (id: string) => void
  disabled?: boolean
}) {
  if (attachments.length === 0) return null

  return (
    <ul className="flex flex-wrap items-center gap-1">
      {attachments.map((attachment) => {
        const Icon = iconFor(attachment.mimeType)
        return (
          <li key={attachment.id} className="flex items-center gap-0.5">
            <Badge
              variant={
                attachment.status === "error" ? "destructive-light" : "secondary"
              }
              radius="full"
              className="max-w-56 gap-1.5"
              title={`${attachment.fileName} · ${formatBytes(attachment.sizeBytes)}`}
            >
              {attachment.status === "uploading" ? (
                <Spinner className="size-3" aria-label="Subiendo" />
              ) : (
                <Icon className="size-3" />
              )}
              <span className="min-w-0 truncate">{attachment.fileName}</span>
              <span className="tabular-nums opacity-70">
                {formatBytes(attachment.sizeBytes)}
              </span>
            </Badge>
            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                onClick={() => onRemove(attachment.id)}
                aria-label={`Quitar ${attachment.fileName}`}
              >
                <XIcon />
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
