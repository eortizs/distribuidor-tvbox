"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowUpIcon,
  BotIcon,
  MicIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  ASSISTANT_ATTACHMENT_TYPES,
  MAX_ASSISTANT_ATTACHMENT_BYTES,
  MAX_ASSISTANT_ATTACHMENT_FILES,
  MAX_ASSISTANT_ATTACHMENT_TOTAL_BYTES,
} from "@/lib/attachments"
import { formatBytes } from "@/hooks/use-file-upload"
import { useAttachmentUpload } from "@/hooks/use-attachment-upload"
import { useRealtimeEvent } from "@/hooks/use-realtime"
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"

import { AttachmentChips, type AttachmentItem } from "@/components/herramientas/attachment-chips"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
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
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const MAX_INPUT_LENGTH = 4000

type Turn = {
  id: string
  role: "user" | "assistant"
  text: string
  /** Canal de origen del turno; WhatsApp cuando la conversación siguió ahí. */
  channel?: "web" | "whatsapp"
  /** Adjuntos del turno (chips en la burbuja; los trae la historia del servidor). */
  attachments?: AttachmentItem[]
}

/**
 * Junta el texto que ya estaba en el área con lo que se dictó. Cada sesión de
 * dictado se agrega a lo escrito antes y el resultado nunca pasa del límite
 * del área (mismo contrato del prompt en Imágenes).
 */
function joinDraft(base: string, spoken: string): string {
  const clean = spoken.trim()
  const previous = base.trim()
  const joined = clean ? (previous ? `${previous} ${clean}` : clean) : base
  return joined.length > MAX_INPUT_LENGTH
    ? joined.slice(0, MAX_INPUT_LENGTH)
    : joined
}

/** Copy del dictado según su estado: una sola fuente para botón, tooltip,
 *  estado de escucha y avisos (igual que Imágenes). */
function dictationCopy(supported: boolean, listening: boolean) {
  if (!supported) {
    return {
      label: "Dictado por voz no disponible",
      tooltip: "El dictado por voz no está disponible aquí",
      error:
        "El dictado por voz no está disponible aquí. Usa Chrome, Edge o Safari en una conexión segura.",
      status: "",
    }
  }
  if (listening) {
    return {
      label: "Detener el dictado",
      tooltip: "Detener el dictado",
      error: "",
      status: "Escuchando… detén el micrófono cuando termines.",
    }
  }
  return {
    label: "Dictar el mensaje",
    tooltip: "Dictar el mensaje con la voz",
    error: "",
    status: "",
  }
}

const SUGGESTIONS = [
  {
    label: "¿Qué puedes hacer?",
    prompt:
      "¿Qué puedes hacer? Explícame cómo me ayudas con el control de mis gastos y de mis clientes.",
  },
  {
    label: "Vencimientos de clientes",
    prompt: "¿Qué clientes FlujoTV vencen esta semana?",
  },
  {
    label: "Estado de cuenta",
    prompt:
      "Genera mi estado de cuenta de gastos del año, con el total y el desglose por categoría.",
  },
]

type AsistenteChatProps = {
  /**
   * Lector de adjuntos configurado en el servidor (modelo de visión + clave
   * de gateway): sin él el botón «+» se oculta, como el método de
   * transferencia sin datos bancarios.
   */
  attachmentsReady?: boolean
}

export function AsistenteChat({ attachmentsReady = false }: AsistenteChatProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const counterRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Espejo de `streaming` sin re-render: lo leen los callbacks de sincronización. */
  const streamingRef = useRef(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
   * Adjuntos del turno: mismos límites y máquina de estado que las imágenes
   * de referencia de Imágenes (subida a /api/files con chips y errores). Al
   * enviar el mensaje se usa `detachAll` (limpia los chips SIN borrar los
   * archivos del servidor: quedan ligados al turno persistido); quitar un
   * chip antes de enviar sí borra el archivo.
   */
  const {
    attachments: pendingAttachments,
    attachmentIds: pendingAttachmentIds,
    uploading: uploadingAttachments,
    failed: failedAttachments,
    totalBytes: attachmentsBytes,
    tooBig: attachmentsTooBig,
    error: attachmentsError,
    setError: setAttachmentsError,
    openFileDialog,
    getInputProps,
    remove: handleRemoveAttachment,
    detachAll: detachSentAttachments,
  } = useAttachmentUpload({
    accept: ASSISTANT_ATTACHMENT_TYPES.join(","),
    maxFiles: MAX_ASSISTANT_ATTACHMENT_FILES,
    maxSize: MAX_ASSISTANT_ATTACHMENT_BYTES,
    maxTotalBytes: MAX_ASSISTANT_ATTACHMENT_TOTAL_BYTES,
    onInvalidFile: () => {
      setAttachmentsError(
        `Solo se admiten imágenes o PDF de hasta ${formatBytes(MAX_ASSISTANT_ATTACHMENT_BYTES)} y máximo ${MAX_ASSISTANT_ATTACHMENT_FILES} por mensaje.`
      )
    },
    onUploadError: (message) => toast.error(message),
  })

  // Adjuntos listos para viajar (subida completa al servidor).
  const readyAttachments = pendingAttachments.filter(
    (attachment) => attachment.status === "ready"
  )

  /*
   * Dictado por voz (Web Speech API, mismo hook de Imágenes): `dictationBase`
   * es lo que había escrito cuando empezó la sesión, para que cada sesión se
   * agregue a lo escrito antes. Va en un ref porque el reconocedor puede
   * devolver palabras antes de que el área se vuelva a pintar.
   */
  const dictationBaseRef = useRef("")
  // Si el usuario escribe mientras se dicta, lo escrito manda: la sesión se
  // cierra sin guardar lo dictado.
  const dictationCancelledRef = useRef(false)

  const {
    isSupported: dictationSupported,
    isListening: dictating,
    error: dictationError,
    start: startDictation,
    stop: stopDictation,
  } = useSpeechRecognition({
    lang: "es-MX",
    onTranscript: (text) => {
      if (dictationCancelledRef.current || !text.trim()) return
      setDraft(joinDraft(dictationBaseRef.current, text))
    },
    onEnd: (text) => {
      const base = dictationBaseRef.current
      dictationBaseRef.current = ""
      if (dictationCancelledRef.current) {
        dictationCancelledRef.current = false
        return
      }
      if (text.trim()) {
        setDraft(joinDraft(base, text))
      }
      textareaRef.current?.focus()
    },
  })

  // Copy del dictado disponible desde aquí: el toast de «no soportado» y el
  // botón comparten la misma fuente.
  const dictation = dictationCopy(dictationSupported, dictating)

  const toggleDictation = useCallback(() => {
    if (dictating) {
      stopDictation()
      return
    }
    if (!dictationSupported) {
      toast.error(dictation.error)
      return
    }
    dictationBaseRef.current = draft
    startDictation()
  }, [
    dictating,
    dictation,
    dictationSupported,
    draft,
    startDictation,
    stopDictation,
  ])

  useEffect(() => {
    if (!dictationError) return
    toast.error(dictationError)
  }, [dictationError])

  function nextId() {
    counterRef.current += 1
    return `t${counterRef.current}`
  }

  /** Historia del servidor → turnos de la UI (la conversación unificada). */
  const loadServerTurns = useCallback(async (): Promise<Turn[] | null> => {
    try {
      const response = await fetch("/api/asistente/chat", { cache: "no-store" })
      if (!response.ok) return null
      const data = (await response.json()) as {
        data?: {
          messages?: {
            id: number
            role: "user" | "assistant"
            content: string
            channel?: "web" | "whatsapp"
            attachments?: {
              id: string
              fileName: string
              mimeType: string
              sizeBytes: number
            }[]
          }[]
        }
      }
      return (data.data?.messages ?? []).map((row) => ({
        id: `m${row.id}`,
        role: row.role,
        text: row.content,
        channel: row.channel,
        attachments: (row.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          status: "ready" as const,
        })),
      }))
    } catch {
      return null
    }
  }, [])

  /*
   * Sincronización en tiempo real: la conversación es compartida con
   * WhatsApp, así que cada evento del bus `assistant` (turno nuevo en
   * cualquier canal) refresca la historia en silencio. Nunca durante un
   * stream propio (el turno local aún no está en el servidor y la respuesta
   * en curso no debe pisarse); el evento del propio turno al persistirse
   * re-sincroniza al terminar.
   */
  const syncFromServer = useCallback(async () => {
    if (streamingRef.current) return
    const serverTurns = await loadServerTurns()
    if (serverTurns) setTurns(serverTurns)
  }, [loadServerTurns])

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      void syncFromServer()
    }, 400)
  }, [syncFromServer])

  useRealtimeEvent(["assistant"], scheduleSync)

  // La conversación vive en el servidor y se comparte con WhatsApp: al
  // montar se carga la historia (incluidos los turnos originados ahí).
  useEffect(() => {
    let cancelled = false
    void loadServerTurns().then((serverTurns) => {
      if (cancelled || !serverTurns) {
        if (!cancelled) setLoaded(true)
        return
      }
      setTurns(serverTurns)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [loadServerTurns])

  // Al volver a la pestaña: recuperar lo escrito en el otro canal mientras
  // estuvo oculta (los eventos SSE se ignoran con la pestaña oculta).
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) scheduleSync()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [scheduleSync])

  function fitTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(fitTextarea, [draft])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function runCompletion(
    question: string,
    dedupe: boolean,
    attachments: AttachmentItem[] = []
  ) {
    const questionId = nextId()
    const replyId = nextId()
    setTurns((current) => [
      ...current,
      {
        id: questionId,
        role: "user",
        text: question,
        channel: "web",
        attachments:
          attachments.length > 0
            ? attachments.map((attachment) => ({
                ...attachment,
                status: "ready" as const,
              }))
            : undefined,
      },
      { id: replyId, role: "assistant", text: "" },
    ])
    streamingRef.current = true
    setStreaming(true)
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch("/api/asistente/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          dedupe,
          attachmentIds:
            attachments.length > 0
              ? attachments.map((attachment) => attachment.id)
              : undefined,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const data = (await response
          .json()
          .catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(
          data?.error?.message ?? "No se pudo contactar al asistente."
        )
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (!chunk) continue
        setTurns((current) =>
          current.map((turn) =>
            turn.id === replyId ? { ...turn, text: turn.text + chunk } : turn
          )
        )
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No se pudo contactar al asistente."
        )
        setTurns((current) => {
          const last = current[current.length - 1]
          return last && last.id === replyId && last.text.length === 0
            ? current.slice(0, -1)
            : current
        })
      }
    } finally {
      abortRef.current = null
      streamingRef.current = false
      setStreaming(false)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.trim()
    // Un turno lleva texto, adjuntos o ambos; nada mientras dicta, sube un
    // archivo o hay un adjunto roto o excedido.
    if (
      (!question && readyAttachments.length === 0) ||
      streaming ||
      dictating ||
      uploadingAttachments ||
      failedAttachments ||
      attachmentsTooBig
    ) {
      return
    }
    setDraft("")
    // Los chips del turno llevan el id del ARCHIVO en el servidor (lo que
    // `attachmentIds` del hook devuelve para los adjuntos listos, en el
    // mismo orden): es lo que la API valida contra `user_files`.
    const attachments = readyAttachments.map((attachment, index) => ({
      ...attachment,
      id: pendingAttachmentIds[index] ?? attachment.id,
    }))
    // Los archivos ya están ligados al turno: se quitan los chips sin borrar
    // nada del servidor.
    detachSentAttachments()
    void runCompletion(question, false, attachments)
  }

  function handleRetry() {
    if (streaming) return
    const last = turns[turns.length - 1]
    if (!last || last.role !== "user") return
    // Los adjuntos viajan de nuevo (por si el intento anterior no llegó a
    // persistirse); si el turno ya estaba en el servidor, `dedupe` conserva
    // la fila original y sus descripciones.
    void runCompletion(last.text, true, last.attachments ?? [])
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  const lastTurn = turns[turns.length - 1]

  return (
    <Card className="mx-auto min-h-0 w-full max-w-4xl flex-1 gap-0 overflow-hidden py-0">
      <CardContent className="min-h-0 flex-1 p-0">
        {loaded && turns.length === 0 ? (
          <Empty className="h-full border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>¿En qué te ayudo?</EmptyTitle>
              <EmptyDescription className="text-foreground">
                Pregúntame por tus gastos, saldo, clientes FlujoTV,
                vencimientos, tickets u órdenes. La conversación continúa en
                WhatsApp: lo que hables aquí sigue allá y viceversa.
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
              <MessageScrollerViewport aria-label="Conversación con el asistente">
                <MessageScrollerContent
                  aria-busy={streaming}
                  className="gap-5 p-(--card-spacing)"
                >
                  {turns.map((turn, index) => {
                    const isUser = turn.role === "user"
                    const isStreamingRow =
                      turn.role === "assistant" &&
                      streaming &&
                      index === turns.length - 1

                    return (
                      <MessageScrollerItem
                        key={turn.id}
                        messageId={turn.id}
                        scrollAnchor={isUser}
                      >
                        <Message align={isUser ? "end" : "start"}>
                          <MessageAvatar className="size-8">
                            {isUser ? (
                              <Avatar>
                                <AvatarFallback>Tú</AvatarFallback>
                              </Avatar>
                            ) : (
                              <>
                                <BotIcon
                                  aria-hidden="true"
                                  className="text-muted-foreground size-4"
                                />
                                <span className="sr-only">Asistente</span>
                              </>
                            )}
                          </MessageAvatar>
                          <MessageContent>
                            {turn.channel === "whatsapp" ? (
                              <span className="text-muted-foreground mb-1 block text-xs">
                                vía WhatsApp
                              </span>
                            ) : null}
                            <Bubble
                              variant={isUser ? "muted" : "ghost"}
                              align={isUser ? "end" : "start"}
                            >
                              <BubbleContent className="space-y-2">
                                {turn.attachments &&
                                turn.attachments.length > 0 ? (
                                  <AttachmentChips
                                    attachments={turn.attachments}
                                  />
                                ) : null}
                                {isUser || isStreamingRow ? (
                                  <p className="whitespace-pre-wrap">
                                    {turn.text}
                                  </p>
                                ) : (
                                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [--tw-prose-body:var(--foreground)] [--tw-prose-bold:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-quotes:var(--foreground)]">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {turn.text}
                                    </ReactMarkdown>
                                  </div>
                                )}
                                {isStreamingRow ? (
                                  <Spinner
                                    className="size-3"
                                    aria-hidden="true"
                                  />
                                ) : null}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )
                  })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <p role="status" aria-live="polite" className="sr-only">
                {streaming
                  ? "El asistente está respondiendo"
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
        {error ? (
          <div
            role="alert"
            className="text-destructive flex w-full items-center justify-between gap-2 text-xs"
          >
            <span>{error}</span>
            {lastTurn?.role === "user" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                disabled={streaming}
              >
                Reintentar
              </Button>
            ) : null}
          </div>
        ) : null}
        <form className="w-full" onSubmit={handleSubmit}>
          <div className="flex w-full flex-col gap-1.5">
            {pendingAttachments.length > 0 ? (
              <AttachmentChips
                attachments={pendingAttachments}
                onRemove={handleRemoveAttachment}
                disabled={uploadingAttachments}
              />
            ) : null}
            {/* Bitono como la Descripción de Imágenes: la celda de adjuntos
                lleva un fondo propio (sin borde: solo cambio de tono) y el
                símbolo + grande; el mensaje vive en la zona de la derecha y
                las acciones (dictar, enviar) quedan en la esquina inferior
                derecha del área (items-end + self-end), acompañando el
                crecimiento del texto hasta 160 px. */}
            <InputGroup className="items-end bg-background">
              {attachmentsReady ? (
                <InputGroupAddon
                  align="inline-start"
                  className="self-stretch bg-muted/50 pl-1 pr-1 has-[>button]:ml-0"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <InputGroupButton
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={openFileDialog}
                          aria-label="Adjuntar imágenes o PDF al mensaje"
                        />
                      }
                    >
                      <PlusIcon aria-hidden="true" className="size-5" />
                    </TooltipTrigger>
                    <TooltipContent>Adjuntar imágenes o PDF</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              ) : null}
              <InputGroupTextarea
                ref={textareaRef}
                aria-label="Mensaje para el asistente"
                placeholder="Escribe tu mensaje… (Enter para enviar, Shift+Enter para salto de línea)"
                rows={1}
                maxLength={MAX_INPUT_LENGTH}
                value={draft}
                onChange={(event) => {
                  // Escribir mientras se dicta manda sobre lo dictado: la
                  // sesión se cierra sin guardar lo que se estaba oyendo.
                  if (dictating) {
                    dictationCancelledRef.current = true
                    stopDictation()
                  }
                  setDraft(event.target.value)
                }}
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
              <InputGroupAddon align="inline-end" className="self-end">
                {/* El micrófono cierra el renglón junto al envío: dictar es
                    la otra forma de escribir el mensaje (misma UX que la
                    Descripción de Imágenes). Ambos botones a 36 px con zona
                    de toque de 52×52 px (estándar móvil de AGENTS.md:
                    extensión invisible, sin cambiar el aspecto). */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="button"
                        size="icon-sm"
                        variant={dictating ? "destructive" : "ghost"}
                        onClick={toggleDictation}
                        aria-label={dictation.label}
                        aria-pressed={dictating}
                        aria-disabled={!dictationSupported}
                        className="size-9 aria-disabled:opacity-50 relative after:absolute after:content-[''] after:-inset-2"
                      />
                    }
                  >
                    <MicIcon aria-hidden="true" className="size-5" />
                  </TooltipTrigger>
                  <TooltipContent>{dictation.tooltip}</TooltipContent>
                </Tooltip>
                {streaming ? (
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={handleStop}
                    className="size-9 relative after:absolute after:content-[''] after:-inset-2"
                  >
                    <SquareIcon aria-hidden="true" className="size-5" />
                    <span className="sr-only">Detener respuesta</span>
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    type="submit"
                    size="icon-sm"
                    variant="default"
                    aria-disabled={
                      !draft.trim() && readyAttachments.length === 0
                    }
                    className="size-9 relative after:absolute after:content-[''] after:-inset-2"
                  >
                    <ArrowUpIcon aria-hidden="true" className="size-5" />
                    <span className="sr-only">Enviar</span>
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
            {dictating ? (
              <p
                role="status"
                className="text-muted-foreground flex items-center gap-2 text-xs"
              >
                <span
                  aria-hidden="true"
                  className="bg-destructive size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                />
                {dictation.status}
              </p>
            ) : null}
            {draft.length >= MAX_INPUT_LENGTH ? (
              <p
                role="status"
                className="text-muted-foreground text-xs"
              >
                Límite de {MAX_INPUT_LENGTH} caracteres alcanzado: lo que
                sigas dictando o escribiendo no se agrega.
              </p>
            ) : null}
            <input
              {...getInputProps()}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            {attachmentsError ? (
              <p role="alert" className="text-destructive text-xs">
                {attachmentsError}
              </p>
            ) : null}
            {attachmentsTooBig ? (
              <p role="alert" className="text-destructive text-xs">
                Los archivos adjuntos suman {formatBytes(attachmentsBytes)};
                el máximo por mensaje es{" "}
                {formatBytes(MAX_ASSISTANT_ATTACHMENT_TOTAL_BYTES)}.
              </p>
            ) : null}
            {failedAttachments ? (
              <p role="alert" className="text-destructive text-xs">
                Hay un archivo adjunto que no se pudo subir. Quítalo para
                continuar.
              </p>
            ) : null}
          </div>
        </form>
      </CardFooter>
    </Card>
  )
}
