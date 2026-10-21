"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowUpIcon,
  ClapperboardIcon,
  ClockIcon,
  PaperclipIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react"
import type { UserContent } from "ai"
import { createDataUrlFilePart } from "eve/client"
import { useEveAgent } from "eve/react"

import { formatDurationMs } from "@/lib/duration"
import {
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  MAX_AGENT_ATTACHMENT_TOTAL_BYTES,
} from "@/lib/attachments"

import {
  AttachmentChips,
  type AttachmentItem,
} from "@/components/herramientas/attachment-chips"
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  MODEL_SELECTOR_PREFIX,
  animationBudgetSteps,
  type AnimationModelInfo,
} from "@/server/animaciones/models"

const MAX_INPUT_LENGTH = 4000

// El costo en vivo se muestra con 4 decimales: los montos por paso son
// fracciones de centavo y con 2 se vería siempre $0.00.
const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

function costLabel(cost: { usd: number; mxn: number | null }): string {
  if (cost.mxn !== null) return mxnFormatter.format(cost.mxn)
  return `US$${cost.usd.toFixed(6)}`
}

const SUGGESTIONS = [
  {
    label: "Guion para un video corto",
    prompt:
      "Escribe un guion de 20 segundos para promocionar un TVBox en redes sociales, con gancho inicial, demostración y llamado a la acción.",
  },
  {
    label: "Render de prueba",
    prompt:
      "Produce un draft de 2 segundos, 320×180 y sin audio, para verificar que el pipeline de render funciona, y entrégalo con guardar_archivo.",
  },
  {
    label: "Storyboard animado",
    prompt:
      "Arma el storyboard de un video de 30 segundos que explique qué incluye la caja y cómo se instala, y luego renderiza un draft de la primera escena.",
  },
]

function messageText(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n\n")
}

/** Archivos adjuntos que Eve proyecta en el historial del mensaje. */
function messageFiles(
  parts: readonly {
    type: string
    filename?: string
    mediaType?: string
    size?: number
  }[]
): AttachmentItem[] {
  return parts.flatMap((part, index) =>
    part.type === "file"
      ? [
          {
            id: `file-${index}`,
            fileName: part.filename ?? "archivo",
            mimeType: part.mediaType ?? "application/octet-stream",
            sizeBytes: part.size ?? 0,
          },
        ]
      : []
  )
}

type ToolActivity = { id: string; label: string }

function toolActivity(parts: readonly {
  type: string
  toolCallId?: string
  toolName?: string
  toolMetadata?: { eve?: { label?: string } }
}[]): ToolActivity[] {
  return parts.flatMap((part) =>
    part.type === "dynamic-tool" && part.toolCallId
      ? [
          {
            id: part.toolCallId,
            label: part.toolMetadata?.eve?.label ?? part.toolName ?? "Herramienta",
          },
        ]
      : []
  )
}

const MEDIA_VIDEO_RE = /\.(mp4|webm|mov)$/i
const MEDIA_AUDIO_RE = /\.(wav|mp3)$/i

const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (href && href.startsWith("/api/files/")) {
      if (MEDIA_VIDEO_RE.test(href)) {
        return (
          <video controls preload="metadata" className="w-full">
            <source src={href} />
          </video>
        )
      }
      if (MEDIA_AUDIO_RE.test(href)) {
        return (
          <audio controls preload="metadata" className="w-full">
            <source src={href} />
          </audio>
        )
      }
    }
    return <a href={href}>{children}</a>
  },
}

const REMARK_PLUGINS = [remarkGfm]

type ChatMessageRowProps = {
  messageId: string
  role: "user" | "assistant"
  text: string
  files: AttachmentItem[]
  tools: ToolActivity[]
  isStreaming: boolean
}

const ChatMessageRow = memo(
  function ChatMessageRow({
    messageId,
    role,
    text,
    files,
    tools,
    isStreaming,
  }: ChatMessageRowProps) {
    const isUser = role === "user"

    return (
      <MessageScrollerItem messageId={messageId} scrollAnchor={isUser}>
        <Message align={isUser ? "end" : "start"}>
          <MessageAvatar className="size-8">
            {isUser ? (
              <Avatar>
                <AvatarFallback>Tú</AvatarFallback>
              </Avatar>
            ) : (
              <>
                <ClapperboardIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-4"
                />
                <span className="sr-only">Agente de animación</span>
              </>
            )}
          </MessageAvatar>
          <MessageContent>
            <Bubble
              variant={isUser ? "muted" : "ghost"}
              align={isUser ? "end" : "start"}
            >
              <BubbleContent className="space-y-2">
                {files.length > 0 ? (
                  <AttachmentChips attachments={files} />
                ) : null}
                {tools.length > 0 && !isUser ? (
                  <div className="gap-1 flex flex-col">
                    {tools.map((tool) => (
                      <p
                        key={tool.id}
                        className="text-muted-foreground text-xs"
                      >
                        {tool.label}
                      </p>
                    ))}
                  </div>
                ) : null}
                {isUser || isStreaming ? (
                  <p className="whitespace-pre-wrap">{text}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [--tw-prose-body:var(--foreground)] [--tw-prose-bold:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-quotes:var(--foreground)]">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      components={markdownComponents}
                    >
                      {text}
                    </ReactMarkdown>
                  </div>
                )}
                {isStreaming ? (
                  <Spinner className="size-3" aria-hidden="true" />
                ) : null}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    )
  },
  (prev, next) =>
    prev.messageId === next.messageId &&
    prev.role === next.role &&
    prev.text === next.text &&
    prev.isStreaming === next.isStreaming &&
    prev.files.length === next.files.length &&
    prev.files.every(
      (file, index) =>
        file.fileName === next.files[index].fileName &&
        file.sizeBytes === next.files[index].sizeBytes
    ) &&
    prev.tools.length === next.tools.length &&
    prev.tools.every((tool, index) => tool.id === next.tools[index].id && tool.label === next.tools[index].label)
)

type AnimacionAgentProps = {
  /** Catálogo de LLMs para el selector (nivel máximo de razonamiento incluido). */
  models: readonly AnimationModelInfo[]
  /** Fires when a turn settles (files may have been delivered meanwhile). */
  onTurnSettled?: () => void
}

export function AnimacionAgent({
  models,
  onTurnSettled,
}: AnimacionAgentProps = { models: [] }) {
  const agent = useEveAgent({ followIdle: false })
  const [draft, setDraft] = useState("")
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  // `submitting` cierra el envío mientras se leen y codifican los adjuntos:
  // hasta que el turno no arranca, `isBusy` sigue en false y un segundo Enter
  // volvería a entrar al handler y mandaría todo dos veces.
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [
    { files: pickedFiles },
    { openFileDialog, getInputProps, removeFile, clearFiles },
  ] = useFileUpload({
    multiple: true,
    maxFiles: MAX_AGENT_ATTACHMENT_FILES,
    maxSize: MAX_AGENT_ATTACHMENT_BYTES,
    onError: () => {
      setAttachmentError(
        `No se pudo adjuntar: se aceptan hasta ${MAX_AGENT_ATTACHMENT_FILES} archivos de ${formatBytes(MAX_AGENT_ATTACHMENT_BYTES)} cada uno.`
      )
    },
  })
  // El presupuesto (bajo/medio/alto) es lo que elige el usuario; cada paso
  // corresponde al modelo que ocupa esa posición en ANIMATION_MODELS.
  const [budgetIndex, setBudgetIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const budgetSteps = useMemo(() => animationBudgetSteps(models), [models])
  const activeBudgetIndex = Math.min(
    budgetIndex,
    Math.max(budgetSteps.length - 1, 0)
  )
  const selectedModel =
    budgetSteps[activeBudgetIndex]?.model ?? budgetSteps[0]?.model

  // Working-time stopwatch: ticks while a turn is in flight, accumulates the
  // conversation's closed turns, and resets with "Nueva conversación".
  const turnStartRef = useRef<number | null>(null)
  const [accumulatedMs, setAccumulatedMs] = useState(0)
  const [currentTurnMs, setCurrentTurnMs] = useState(0)
  const onTurnSettledRef = useRef(onTurnSettled)

  useEffect(() => {
    onTurnSettledRef.current = onTurnSettled
  }, [onTurnSettled])

  const messages = agent.data.messages
  const isBusy = agent.status === "submitted" || agent.status === "streaming"
  const isResuming = agent.status === "resuming"
  const inputDisabled = isResuming
  const lastMessage = messages[messages.length - 1]
  const showPendingRow = isBusy && (!lastMessage || lastMessage.role === "user")

  // Tarificador: costo acumulado de la conversación, en vivo mientras el
  // agente trabaja (el hook del servidor escribe cada paso medido).
  const sessionId = agent.session?.sessionId
  const [cost, setCost] = useState<{ usd: number; mxn: number | null } | null>(
    null
  )

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    const load = () => {
      fetch(
        `/api/animaciones/costo?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      )
        .then((response) => response.json())
        .then(
          (body: {
            ok?: boolean
            data?: { costUsd?: number; costMxn?: number | null }
          }) => {
            if (cancelled) return
            if (!body?.ok || !body.data) return
            if (typeof body.data.costUsd !== "number") return
            setCost({
              usd: body.data.costUsd,
              mxn:
                typeof body.data.costMxn === "number" ? body.data.costMxn : null,
            })
          }
        )
        .catch(() => {
          // El costo es informativo: un fallo no interrumpe la conversación.
        })
    }
    load()
    if (!isBusy) return
    const interval = window.setInterval(load, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [sessionId, isBusy])

  useEffect(() => {
    if (isBusy) {
      if (turnStartRef.current === null) turnStartRef.current = Date.now()
      return
    }
    if (turnStartRef.current !== null) {
      const startedAt = turnStartRef.current
      turnStartRef.current = null
      setAccumulatedMs((ms) => ms + (Date.now() - startedAt))
      setCurrentTurnMs(0)
      onTurnSettledRef.current?.()
    }
  }, [isBusy])

  useEffect(() => {
    if (!isBusy) return
    const interval = window.setInterval(() => {
      if (turnStartRef.current !== null) {
        setCurrentTurnMs(Date.now() - turnStartRef.current)
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [isBusy])

  const workingTimeMs = accumulatedMs + currentTurnMs

  // Los adjuntos viajan como partes de archivo del turno: Eve los deja en el
  // sandbox de la sesión y el agente los abre con read_file o bash.
  const attachments: AttachmentItem[] = pickedFiles.flatMap((item) =>
    item.file instanceof File
      ? [
          {
            id: item.id,
            fileName: item.file.name,
            mimeType: item.file.type || "application/octet-stream",
            sizeBytes: item.file.size,
          },
        ]
      : []
  )

  function fitTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(fitTextarea, [draft])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current || isBusy || inputDisabled) return
    const message = draft.trim()
    const files = pickedFiles.flatMap((item) =>
      item.file instanceof File ? [item.file] : []
    )
    if (!message && files.length === 0) return

    // El turno viaja entero en el body del POST: los adjuntos se codifican
    // en base64 (~1.37×), así que el total tiene que quedar bajo el tope.
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_AGENT_ATTACHMENT_TOTAL_BYTES) {
      setAttachmentError(
        `Los adjuntos suman ${formatBytes(totalBytes)}; el máximo por turno es ${formatBytes(MAX_AGENT_ATTACHMENT_TOTAL_BYTES)}.`
      )
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    // El texto se vacía de inmediato: lo que el usuario escriba mientras se
    // leen los archivos se conserva y no se pisa al terminar.
    setDraft("")
    setAttachmentError(null)

    const content: UserContent = []
    if (message) content.push({ type: "text", text: message })
    try {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        content.push(
          createDataUrlFilePart({
            bytes,
            filename: file.name,
            mediaType: file.type || "application/octet-stream",
          })
        )
      }
    } catch {
      submittingRef.current = false
      setSubmitting(false)
      setDraft((current) => current || message)
      setAttachmentError("No se pudo leer el archivo adjunto.")
      return
    }

    clearFiles()
    // El presupuesto elegido viaja como clientContext del turno: llega al
    // resolver dinámico de modelo y no se persiste en el historial durable.
    void agent
      .send(content, {
        clientContext: `${MODEL_SELECTOR_PREFIX}${selectedModel?.id ?? ""}`,
      })
      .catch(() => {})
      .finally(() => {
        submittingRef.current = false
        setSubmitting(false)
      })
  }

  function handleStop() {
    void agent.cancel().catch(() => {})
  }

  function handleReset() {
    agent.reset()
    setDraft("")
    clearFiles()
    setAttachmentError(null)
    submittingRef.current = false
    setSubmitting(false)
    turnStartRef.current = null
    setAccumulatedMs(0)
    setCurrentTurnMs(0)
  }

  return (
    <Card className="mx-auto min-h-0 w-full max-w-4xl flex-1 gap-0 overflow-hidden py-0">
      <CardContent className="min-h-0 flex-1 p-0">
        {messages.length === 0 ? (
          <Empty className="h-full border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClapperboardIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>¿Qué quieres animar?</EmptyTitle>
              <EmptyDescription className="text-foreground">
                Produzco videos reales con Remotion: guion, storyboard,
                render y sonido. Cuéntame el producto, el formato y la
                duración.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion.label}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(suggestion.prompt)
                    textareaRef.current?.focus()
                  }}
                >
                  {suggestion.label}
                </Button>
              ))}
            </EmptyContent>
          </Empty>
        ) : (
          <MessageScrollerProvider autoScroll>
            <MessageScroller>
              <MessageScrollerViewport aria-label="Conversación con el agente de animación">
                <MessageScrollerContent
                  aria-busy={isBusy}
                  className="gap-5 p-(--card-spacing)"
                >
                  {messages.map((message, index) => {
                    const role =
                      message.role === "user" ? "user" : "assistant"

                    return (
                      <ChatMessageRow
                        key={message.id}
                        messageId={message.id}
                        role={role}
                        text={messageText(message.parts)}
                        files={messageFiles(message.parts)}
                        tools={toolActivity(message.parts)}
                        isStreaming={
                          role === "assistant" &&
                          isBusy &&
                          index === messages.length - 1
                        }
                      />
                    )
                  })}
                  {showPendingRow ? (
                    <MessageScrollerItem scrollAnchor>
                      <Message align="start">
                        <MessageAvatar className="size-8">
                          <>
                            <ClapperboardIcon
                              aria-hidden="true"
                              className="text-muted-foreground size-4"
                            />
                            <span className="sr-only">
                              Agente de animación
                            </span>
                          </>
                        </MessageAvatar>
                        <MessageContent>
                          <Bubble variant="ghost" align="start">
                            <BubbleContent>
                              <Spinner className="size-3" aria-hidden="true" />
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <p role="status" aria-live="polite" className="sr-only">
                {isBusy
                  ? "El agente está respondiendo"
                  : "Respuesta completa"}
              </p>
              <MessageScrollerButton
                variant="outline"
                className="rounded-full shadow-sm"
              />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </CardContent>
      <CardFooter className="shrink-0 flex-col gap-2 border-t py-4">
        {agent.error ? (
          <div
            role="alert"
            className="text-destructive flex w-full items-center justify-between gap-2 text-xs"
          >
            <span>{agent.error.message}</span>
          </div>
        ) : null}
        <div className="flex w-full items-center justify-between gap-2">
          <span
            className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs tabular-nums"
            title="Tiempo de trabajo del agente en esta conversación (sin contar las esperas de tu respuesta)"
          >
            <ClockIcon
              aria-hidden="true"
              className={
                isBusy ? "size-3.5 shrink-0 animate-spin" : "size-3.5 shrink-0"
              }
            />
            <span className="truncate">
              {formatDurationMs(workingTimeMs)}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {cost ? (
              <span
                className="text-muted-foreground text-xs tabular-nums"
                title="Costo acumulado de esta conversación (tarificador), al TC FIX del día"
              >
                {costLabel(cost)}
              </span>
            ) : null}
            {messages.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={isBusy}
              >
                <RotateCcwIcon aria-hidden="true" />
                Nueva conversación
              </Button>
            ) : null}
          </div>
        </div>
        {budgetSteps.length > 1 ? (
          <div className="grid w-full gap-1.5">
            <Label
              id="animacion-presupuesto"
              className="text-muted-foreground text-xs"
            >
              Presupuesto
              <span className="sr-only">
                : {budgetSteps[activeBudgetIndex].budget}
              </span>
            </Label>
            <Slider
              aria-labelledby="animacion-presupuesto"
              value={[activeBudgetIndex + 1]}
              min={1}
              max={budgetSteps.length}
              step={1}
              disabled={inputDisabled}
              onValueChange={(value) => {
                const next = Array.isArray(value)
                  ? value[value.length - 1]
                  : value
                if (typeof next === "number") setBudgetIndex(next - 1)
              }}
            />
            <div
              aria-hidden="true"
              className="text-muted-foreground flex w-full items-center justify-between text-xs font-medium"
            >
              {budgetSteps.map((step, index) => (
                <span
                  key={step.budget}
                  className={index === activeBudgetIndex ? "text-foreground" : undefined}
                >
                  {step.budget}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <form className="w-full" onSubmit={handleSubmit}>
          <div className="flex w-full flex-col gap-1.5">
            {attachments.length > 0 ? (
              <AttachmentChips
                attachments={attachments}
                onRemove={removeFile}
                disabled={inputDisabled}
              />
            ) : null}
            <InputGroup className="bg-background">
              <InputGroupAddon align="inline-start">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={openFileDialog}
                        aria-label="Adjuntar archivos al agente"
                      />
                    }
                  >
                    <PaperclipIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>Adjuntar archivos</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
              <InputGroupTextarea
                ref={textareaRef}
                aria-label="Mensaje para el agente de animación"
                placeholder="Describe tu idea, guion o storyboard… (Enter para enviar, Shift+Enter para salto de línea)"
                rows={1}
                maxLength={MAX_INPUT_LENGTH}
                value={draft}
                disabled={inputDisabled}
                onChange={(event) => setDraft(event.target.value)}
                className="placeholder:text-foreground/60"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              <InputGroupAddon align="inline-end">
                {isBusy ? (
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={handleStop}
                  >
                    <SquareIcon aria-hidden="true" />
                    <span className="sr-only">Detener respuesta</span>
                  </InputGroupButton>
                ) : submitting ? (
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="default"
                    disabled
                  >
                    <Spinner className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Enviando</span>
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    type="submit"
                    size="icon-sm"
                    variant="default"
                    aria-disabled={
                      (!draft.trim() && attachments.length === 0) || inputDisabled
                    }
                  >
                    <ArrowUpIcon aria-hidden="true" />
                    <span className="sr-only">Enviar</span>
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
            <input
              {...getInputProps()}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            {attachmentError ? (
              <p role="alert" className="text-destructive text-xs">
                {attachmentError}
              </p>
            ) : null}
          </div>
        </form>
      </CardFooter>
    </Card>
  )
}
