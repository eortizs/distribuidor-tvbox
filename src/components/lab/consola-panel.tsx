"use client"

import { useState } from "react"
import { PlayIcon, TerminalIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { sendRawFlujoRequest } from "./flujo-api"
import { JsonViewer } from "./json-viewer"

const QUICK_PATHS = [
  "/health",
  "/openapi.json",
  "/get_clients",
  "/search_clients",
  "/find_user",
  "/users/validity",
  "/licencias",
]

interface ConsolaPanelProps {
  baseUrl: string
}

export function ConsolaPanel({ baseUrl }: ConsolaPanelProps) {
  const [method, setMethod] = useState<"GET" | "POST">("GET")
  const [path, setPath] = useState("/openapi.json")
  const [query, setQuery] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{
    status: number
    durationMs: number
    headers: Record<string, string>
    payload: unknown
  } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function send() {
    setSending(true)
    setErrorMessage(null)
    try {
      const response = await sendRawFlujoRequest({
        method,
        path,
        query,
        body: method === "POST" ? body : "",
      })
      setResult(response)
    } catch (error) {
      setResult(null)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo completar la llamada."
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <TerminalIcon aria-hidden="true" />
        <AlertTitle>Consola directa contra {baseUrl}</AlertTitle>
        <AlertDescription>
          <p>
            Cada llamada usa la clave del servidor y solo admite GET y POST
            sobre rutas de la API. Los valores sensibles de la respuesta se
            ocultan antes de mostrarse.
          </p>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
        <Field>
          <FieldLabel htmlFor="consola-metodo">Método</FieldLabel>
          <Select
            value={method}
            onValueChange={(value) => setMethod(value === "POST" ? "POST" : "GET")}
          >
            <SelectTrigger className="w-full" id="consola-metodo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="consola-ruta">Ruta</FieldLabel>
          <Input
            id="consola-ruta"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/get_clients"
            className="font-mono"
            spellCheck={false}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="consola-query">Parámetros de consulta</FieldLabel>
        <Input
          id="consola-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="user_name=cliente01"
          className="font-mono"
          spellCheck={false}
        />
        <FieldDescription>
          Formato <span className="font-mono">clave=valor&amp;clave=valor</span>.
        </FieldDescription>
      </Field>

      {method === "POST" ? (
        <Field>
          <FieldLabel htmlFor="consola-body">Cuerpo</FieldLabel>
          <Textarea
            id="consola-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder='{"months": 1}'
            rows={4}
            className="font-mono"
            spellCheck={false}
          />
        </Field>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void send()} disabled={sending || path.trim() === ""}>
          <PlayIcon aria-hidden="true" />
          {sending ? "Enviando…" : "Enviar"}
        </Button>
        {QUICK_PATHS.map((quick) => (
          <Button
            key={quick}
            variant="outline"
            size="xs"
            onClick={() => setPath(quick)}
          >
            {quick}
          </Button>
        ))}
      </div>

      {errorMessage ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>La llamada falló</AlertTitle>
          <AlertDescription>
            <p>{errorMessage}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                result.status >= 200 && result.status < 300
                  ? "success-light"
                  : "destructive-light"
              }
              size="sm"
            >
              HTTP {result.status}
            </Badge>
            <span className="text-muted-foreground text-xs tabular-nums">
              {(result.durationMs / 1000).toFixed(2)} s
            </span>
          </div>
          <JsonViewer value={result.payload} />
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">Encabezados de respuesta</summary>
            <JsonViewer value={result.headers} />
          </details>
        </div>
      ) : null}
    </div>
  )
}
