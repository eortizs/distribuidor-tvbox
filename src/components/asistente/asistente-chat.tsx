"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUpIcon, BotIcon, SquareIcon } from "lucide-react"

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

const MAX_INPUT_LENGTH = 4000

type Turn = {
  id: string
  role: "user" | "assistant"
  text: string
}

const SUGGESTIONS = [
  {
    label: "¿Qué puedes hacer?",
    prompt:
      "¿Qué puedes hacer y qué podrás hacer cuando tengas acceso a los datos?",
  },
  {
    label: "Explícame las entidades",
    prompt: "Explícame cómo funcionan las entidades umeJSON en este panel.",
  },
  {
    label: "Ayuda con el panel",
    prompt:
      "Dame un repaso rápido de las secciones del panel y para qué sirve cada una.",
  },
]

export function AsistenteChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const counterRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function nextId() {
    counterRef.current += 1
    return `t${counterRef.current}`
  }

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

  async function runCompletion(history: Turn[]) {
    const replyId = nextId()
    setTurns([...history, { id: replyId, role: "assistant", text: "" }])
    setStreaming(true)
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch("/api/asistente/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, text }) => ({ role, content: text })),
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
      setStreaming(false)
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || streaming) return
    setDraft("")
    void runCompletion([
      ...turns,
      { id: nextId(), role: "user", text: question },
    ])
  }

  function handleRetry() {
    if (streaming) return
    const last = turns[turns.length - 1]
    if (!last || last.role !== "user") return
    void runCompletion(turns)
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  const lastTurn = turns[turns.length - 1]

  return (
    <Card className="mx-auto min-h-0 w-full max-w-4xl flex-1 gap-0 overflow-hidden py-0">
      <CardContent className="min-h-0 flex-1 p-0">
        {turns.length === 0 ? (
          <Empty className="h-full border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>¿En qué te ayudo?</EmptyTitle>
              <EmptyDescription className="text-foreground">
                Pregúntame sobre el panel o las entidades umeJSON, o pídeme
                ayuda para redactar. Pronto también podrás consultar tus datos.
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
                            <Bubble
                              variant={isUser ? "muted" : "ghost"}
                              align={isUser ? "end" : "start"}
                            >
                              <BubbleContent className="space-y-2">
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
          <InputGroup className="bg-background">
            <InputGroupTextarea
              ref={textareaRef}
              aria-label="Mensaje para el asistente"
              placeholder="Escribe tu mensaje… (Enter para enviar, Shift+Enter para salto de línea)"
              rows={1}
              maxLength={MAX_INPUT_LENGTH}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="[&::placeholder]:text-foreground/60"
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
              {streaming ? (
                <InputGroupButton
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={handleStop}
                >
                  <SquareIcon aria-hidden="true" />
                  <span className="sr-only">Detener respuesta</span>
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  variant="default"
                  disabled={!draft.trim()}
                >
                  <ArrowUpIcon aria-hidden="true" />
                  <span className="sr-only">Enviar</span>
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        </form>
      </CardFooter>
    </Card>
  )
}
