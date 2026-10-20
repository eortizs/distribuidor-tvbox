"use client"

import { memo, useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
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
    label: "Storyboard de 30 segundos",
    prompt:
      "Arma el storyboard de un video de 30 segundos que explique qué incluye la caja y cómo se instala, con planos, cámara y texto en pantalla.",
  },
  {
    label: "Prompts para animación IA",
    prompt:
      "Dame prompts detallados para animar con IA un producto tecnológico sobre un escritorio: estilo visual, iluminación, cámara y ritmo.",
  },
]

function messageText(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n\n")
}

const REMARK_PLUGINS = [remarkGfm]

type ChatMessageRowProps = {
  messageId: string
  role: "user" | "assistant"
  text: string
  isStreaming: boolean
}

const ChatMessageRow = memo(
  function ChatMessageRow({
    messageId,
    role,
    text,
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
                {isUser || isStreaming ? (
                  <p className="whitespace-pre-wrap">{text}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground [--tw-prose-body:var(--foreground)] [--tw-prose-bold:var(--foreground)] [--tw-prose-headings:var(--foreground)] [--tw-prose-quotes:var(--foreground)]">
                    <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
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
    prev.isStreaming === next.isStreaming
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
                Te ayudo a convertir una idea en guion, storyboard y prompts
                listos para producir. Cuéntame el producto, el público y el
                formato.
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
