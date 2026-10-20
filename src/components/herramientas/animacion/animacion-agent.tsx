"use client"

import { memo, useEffect, useRef, useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUpIcon, ClapperboardIcon, RotateCcwIcon, SquareIcon } from "lucide-react"
import { useEveAgent } from "eve/react"

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
  tools: ToolActivity[]
  isStreaming: boolean
}

const ChatMessageRow = memo(
  function ChatMessageRow({
    messageId,
    role,
    text,
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
    prev.tools.length === next.tools.length &&
    prev.tools.every((tool, index) => tool.id === next.tools[index].id && tool.label === next.tools[index].label)
)

export function AnimacionAgent() {
  const agent = useEveAgent({ followIdle: false })
  const [draft, setDraft] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const messages = agent.data.messages
  const isBusy = agent.status === "submitted" || agent.status === "streaming"
  const isResuming = agent.status === "resuming"
  const inputDisabled = isResuming
  const lastMessage = messages[messages.length - 1]
  const showPendingRow = isBusy && (!lastMessage || lastMessage.role === "user")

  function fitTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(fitTextarea, [draft])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || isBusy || inputDisabled) return
    setDraft("")
    void agent.send(message).catch(() => {})
  }

  function handleStop() {
    void agent.cancel().catch(() => {})
  }

  function handleReset() {
    agent.reset()
    setDraft("")
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
        {messages.length > 0 ? (
          <div className="flex w-full justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={isBusy}
            >
              <RotateCcwIcon aria-hidden="true" />
              Nueva conversación
            </Button>
          </div>
        ) : null}
        <form className="w-full" onSubmit={handleSubmit}>
          <InputGroup className="bg-background">
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
              ) : (
                <InputGroupButton
                  type="submit"
                  size="icon-sm"
                  variant="default"
                  aria-disabled={!draft.trim() || inputDisabled}
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
