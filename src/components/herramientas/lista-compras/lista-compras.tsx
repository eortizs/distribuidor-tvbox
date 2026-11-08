"use client"

import * as React from "react"

import { cn } from "cn"
import {
  agruparPorCategoria,
  contarPendientes,
  formatCantidad,
  MAX_TEXTO_INTERPRETE,
  type ItemLista,
  type Operacion,
  type SnapshotLista,
} from "@/lib/lista-compras"
import {
  Alert,
  AlertDescription,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"
import confetti from "canvas-confetti"
import {
  MicIcon,
  ShoppingBasketIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

/**
 * Módulo Lista de compras: un solo área de texto (escrita o dictada) que la
 * IA convierte en operaciones sobre la única lista del usuario. El flujo
 * siempre termina en PATCH transaccional con `request_id` y `revision`: el
 * texto se limpia solo si la persistencia confirmó, y un conflicto 409
 * refresca el snapshot sin perder el borrador.
 */

interface PendienteConfirmacion {
  ops: Operacion[]
  requestId: string
  textoEnviado: string
}

type Nota = { tipo: "info" | "error"; texto: string } | null

function unirTexto(base: string, addition: string): string {
  const clean = addition.trim()
  if (!clean) return base
  return base.trim() ? `${base.trim()} ${clean}` : clean
}

async function leerRespuesta(response: Response) {
  try {
    return (await response.json()) as {
      ok?: boolean
      data?: unknown
      error?: { code?: string; message?: string }
    }
  } catch {
    return null
  }
}

export function ListaCompras({
  inicial,
  cargaFallida,
}: {
  inicial: SnapshotLista | null
  cargaFallida: boolean
}) {
  const [snapshot, setSnapshot] = React.useState<SnapshotLista | null>(inicial)
  const [cargando, setCargando] = React.useState(false)
  const [texto, setTexto] = React.useState("")
  const [nota, setNota] = React.useState<Nota>(null)
  const [interpretando, setInterpretando] = React.useState(false)
  const [aplicando, setAplicando] = React.useState(false)
  const [pendiente, setPendiente] = React.useState<PendienteConfirmacion | null>(
    null
  )
  // Casilla en guardado: la fila se deshabilita hasta que el PATCH confirma.
  const [marcandoId, setMarcandoId] = React.useState<string | null>(null)
  // Producto en eliminación: la X muestra spinner y las filas se bloquean.
  const [eliminandoId, setEliminandoId] = React.useState<string | null>(null)

  const textoEnviadoRef = React.useRef("")
  const snapshotRef = React.useRef<SnapshotLista | null>(inicial)
  React.useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  // Texto vivo en un ref para decidir, al confirmar la escritura, si el
  // borrador sigue siendo exactamente lo que se envió.
  const textoRef = React.useRef("")
  React.useEffect(() => {
    textoRef.current = texto
  }, [texto])

  // Dictado por voz: el patrón de image-studio. `dictationBase` guarda lo
  // escrito al iniciar la sesión y cada sesión se agrega a eso; si el
  // usuario teclea mientras dicta, lo escrito manda y el dictado se aborta.
  const dictationBaseRef = React.useRef("")
  const dictationCancelledRef = React.useRef(false)

  const ocupado = interpretando || aplicando || pendiente !== null

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
      setTexto(unirTexto(dictationBaseRef.current, text))
    },
    onEnd: (text) => {
      const base = dictationBaseRef.current
      dictationBaseRef.current = ""
      if (dictationCancelledRef.current) {
        dictationCancelledRef.current = false
        return
      }
      if (text.trim()) {
        setTexto(unirTexto(base, text))
      }
      textareaRef.current?.focus()
    },
  })

  React.useEffect(() => {
    if (!dictationError) return
    toast.error(dictationError)
  }, [dictationError])

  const toggleDictation = React.useCallback(() => {
    if (dictating) {
      stopDictation()
      return
    }
    if (!dictationSupported) {
      toast.error(
        "Tu navegador no admite dictado por voz. Escribe tu instrucción."
      )
      return
    }
    if (ocupado) return
    dictationBaseRef.current = texto
    startDictation()
  }, [dictating, dictationSupported, ocupado, texto, startDictation, stopDictation])

  /** Texto editado a mano mientras se dicta: el dictado se cancela. */
  const editarTexto = (next: string) => {
    if (dictating) {
      dictationCancelledRef.current = true
      stopDictation()
      dictationBaseRef.current = ""
    }
    setTexto(next)
    // El error del campo se limpia en cuanto el usuario lo corrige; la
    // aclaración informativa también (ya correspondía a la acción previa).
    if (nota?.tipo === "error") setNota(null)
  }

  const aplicarSnapshot = (data: SnapshotLista) => {
    setSnapshot(data)
    snapshotRef.current = data
  }

  const cargarLista = React.useCallback(async () => {
    setCargando(true)
    try {
      const response = await fetch("/api/lista-compras", {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "load_error")
      }
      aplicarSnapshot((body as { data: SnapshotLista }).data)
      setNota(null)
    } catch {
      setNota({
        tipo: "error",
        texto: "No se pudo cargar tu lista. Revisa tu conexión y reintenta.",
      })
    } finally {
      setCargando(false)
    }
  }, [])

  /**
   * PATCH con operaciones, revisión y request_id. Reintento con el mismo
   * request_id es idempotente; 409 refresca el snapshot y conserva el texto.
   */
  const enviarOps = React.useCallback(
    async (ops: Operacion[], requestId: string, confirmar: boolean) => {
      const revision = snapshotRef.current?.revision ?? 0
      setAplicando(true)
      try {
        const response = await fetch("/api/lista-compras", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision,
            requestId,
            confirmar,
            ops,
          }),
        })
        const body = await leerRespuesta(response)
        if (response.status === 409) {
          await cargarLista()
          setNota({
            tipo: "error",
            texto:
              "Tu lista cambió en otro dispositivo o pestaña. Revísala y vuelve a agregar.",
          })
          return false
        }
        if (!response.ok || !body?.ok) {
          setNota({
            tipo: "error",
            texto:
              body?.error?.message ??
              "No se pudo aplicar el cambio. Intenta de nuevo.",
          })
          return false
        }
        aplicarSnapshot((body as { data: SnapshotLista }).data)
        return true
      } catch {
        setNota({
          tipo: "error",
          texto: "No se pudo aplicar el cambio. Revisa tu conexión e intenta de nuevo.",
        })
        return false
      } finally {
        setAplicando(false)
      }
    },
    [cargarLista]
  )

  /** Aplicar la instrucción: interpretar → confirmar si toca → PATCH. */
  const aplicar = React.useCallback(async () => {
    const instruccion = texto.trim()
    if (!instruccion || ocupado || dictating) return
    const requestId = crypto.randomUUID()
    textoEnviadoRef.current = instruccion
    setInterpretando(true)
    setNota(null)
    try {
      const response = await fetch("/api/lista-compras/interpretar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: instruccion }),
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        setNota({
          tipo: "error",
          texto:
            body?.error?.message ??
            "No pude interpretar la instrucción. Reformúlala e intenta de nuevo.",
        })
        return
      }
      const data = body.data as {
        aclaracion: string | null
        ops: Operacion[]
        revision: number
      }
      if (data.ops.length === 0) {
        setNota({
          tipo: "info",
          texto:
            data.aclaracion ??
            "No entendí la instrucción. Prueba con «agrega 1 kg de manzanas».",
        })
        return
      }

      const destructiva = data.ops.some(
        (op) => op.tipo === "vaciar" || op.tipo === "eliminar" || op.tipo === "reemplazar"
      )
      if (destructiva) {
        // Se pide confirmación antes de escribir: el borrador se conserva
        // si el usuario cancela.
        setPendiente({ ops: data.ops, requestId, textoEnviado: instruccion })
        return
      }

      const ok = await enviarOps(data.ops, requestId, false)
      if (ok && textoEnviadoRef.current === instruccion && textoRef.current === instruccion) {
        setTexto("")
      }
      if (data.aclaracion) {
        setNota({ tipo: "info", texto: data.aclaracion })
      }
    } catch {
      setNota({
        tipo: "error",
        texto:
          "No se pudo interpretar la instrucción. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setInterpretando(false)
    }
  }, [dictating, ocupado, texto, enviarOps])

  /**
   * Empezar una lista nueva desde el botón: reemplazo por lista vacía con
   * el flujo de confirmación (el clic abre el diálogo; el PATCH llega ya
   * confirmado). El borrador en curso no se toca.
   */
  const nuevaLista = React.useCallback(() => {
    if (ocupado || dictating) return
    if (!snapshot || snapshot.items.length === 0) return
    setPendiente({
      ops: [{ tipo: "reemplazar", items: [] }],
      requestId: crypto.randomUUID(),
      textoEnviado: "",
    })
  }, [ocupado, dictating, snapshot])

  /** Confirmación aceptada: PATCH con las mismas ops y request_id. */
  const confirmarPendiente = React.useCallback(async () => {    if (!pendiente) return
    const { ops, requestId, textoEnviado } = pendiente
    const ok = await enviarOps(ops, requestId, true)
    if (ok && textoEnviadoRef.current === textoEnviado && textoRef.current === textoEnviado) {
      setTexto("")
      textoEnviadoRef.current = ""
    }
    if (ok) setNota(null)
    setPendiente(null)
  }, [pendiente, enviarOps])

  /** Casilla marcada sin LLM: PATCH directo con una op de marcar. */
  const marcarItem = React.useCallback(
    async (item: ItemLista, comprado: boolean) => {
      if (ocupado || marcandoId) return
      setMarcandoId(item.id)
      const ok = await enviarOps(
        [{ tipo: "marcar", id: item.id, comprado }],
        crypto.randomUUID(),
        false
      )
      if (!ok) {
        toast.error("No se pudo actualizar la casilla. Intenta de nuevo.")
      }
      setMarcandoId(null)
    },
    [ocupado, marcandoId, enviarOps]
  )

  /**
   * Borrar un producto con la X de su fila: el clic del botón es la
   * confirmación explícita, así que el PATCH llega ya confirmado y no pide
   * un diálogo extra por cada artículo.
   */
  const eliminarItem = React.useCallback(
    async (item: ItemLista) => {
      if (ocupado || marcandoId || eliminandoId) return
      setEliminandoId(item.id)
      const ok = await enviarOps(
        [{ tipo: "eliminar", id: item.id }],
        crypto.randomUUID(),
        true
      )
      if (!ok) {
        toast.error("No se pudo eliminar el producto. Intenta de nuevo.")
      }
      setEliminandoId(null)
    },
    [ocupado, marcandoId, eliminandoId, enviarOps]
  )

  // Refresco al volver a enfocar la página: solo cuando no hay nada en
  // vuelo (dictado, interpretación, PATCH o confirmación pendiente) y
  // descartando respuestas que quedaron obsoletas por una mutación propia.
  const enVueloRef = React.useRef(false)
  React.useEffect(() => {
    enVueloRef.current = interpretando || aplicando || dictating
  }, [interpretando, aplicando, dictating])

  React.useEffect(() => {
    const refrescar = () => {
      if (document.hidden || enVueloRef.current || pendiente !== null) return
      const revisionAlPedir = snapshotRef.current?.revision
      const controller = new AbortController()
      void (async () => {
        try {
          const response = await fetch("/api/lista-compras", {
            cache: "no-store",
            signal: controller.signal,
          })
          const body = await leerRespuesta(response)
          if (!response.ok || !body?.ok) return
          const data = (body as { data: SnapshotLista }).data
          // Obsoleta si mientras volaba se aplicó algo localmente.
          if (
            snapshotRef.current?.revision !== revisionAlPedir ||
            data.revision < (snapshotRef.current?.revision ?? 0)
          ) {
            return
          }
          aplicarSnapshot(data)
        } catch {
          // Refresco de fondo: el fallo se muestra al siguiente intento real.
        }
      })()
      return () => controller.abort()
    }
    let cleanup: (() => void) | undefined
    const onFocus = () => {
      cleanup?.()
      cleanup = refrescar() ?? undefined
    }
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      cleanup?.()
    }
  }, [pendiente])

  const pendientes = snapshot ? contarPendientes(snapshot.items) : null
  const grupos = snapshot ? agruparPorCategoria(snapshot.items) : []
  const textareaVacio = texto.trim().length === 0
  const listaVacia = !snapshot || snapshot.items.length === 0
  // Porcentaje comprado; con lista vacía la barra no se muestra.
  const progreso =
    pendientes && pendientes.total > 0
      ? Math.round(
          ((pendientes.total - pendientes.pendientes) / pendientes.total) * 100
        )
      : 0

  // Confeti solo en la TRANSICIÓN a 100 % (no en la carga inicial de una
  // lista que ya estaba completa) y una sola vez por racha: al bajar del
  // 100 % el disparador se rearma.
  const confetiListoRef = React.useRef(progreso >= 100)
  React.useEffect(() => {
    if (progreso < 100) {
      confetiListoRef.current = false
      return
    }
    if (confetiListoRef.current) return
    confetiListoRef.current = true
    confetti({
      particleCount: 160,
      spread: 75,
      origin: { y: 0.7 },
      disableForReducedMotion: true,
    })
  }, [progreso])

  const tituloPendiente = pendiente
    ? pendiente.ops.some((op) => op.tipo === "vaciar" || op.tipo === "reemplazar")
      ? "¿Reemplazar o vaciar la lista?"
      : "¿Eliminar productos de la lista?"
    : ""

  return (
    <div className="w-full max-w-xl">
      {/* Sin el anillo exterior del Card: el módulo fluye sobre el fondo. */}
      <Card className="ring-0">
        <CardHeader>
          <CardTitle>Lista de compras</CardTitle>
          {pendientes && pendientes.total > 0 ? (
            <CardAction>
              <p className="text-xs text-muted-foreground tabular-nums">
                {pendientes.total - pendientes.pendientes} de {pendientes.total}{" "}
                comprados
              </p>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* El botón de dictar vive dentro de la caja, abajo a la derecha.
              Sin atributo disabled: ocuparía el estilo `has-disabled:` del
              InputGroup y atenuaría la caja completa; el guard de
              `toggleDictation` ignora el clic mientras hay algo en vuelo. */}
          <InputGroup>
            <InputGroupTextarea
              ref={textareaRef}
              aria-label="Instrucción para tu lista de compras"
              value={texto}
              onChange={(event) => editarTexto(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void aplicar()
                }
              }}
              maxLength={MAX_TEXTO_INTERPRETE}
              rows={2}
              placeholder="Agregar a la lista..."
              className="min-h-16"
            />
            <InputGroupAddon align="inline-end" className="self-end pb-1.5">
              <Button
                variant="outline"
                size="icon"
                onClick={toggleDictation}
                aria-pressed={dictating}
                aria-label={dictating ? "Detener el dictado" : "Dictar una instrucción"}
                title={dictating ? "Detener el dictado" : "Dictar una instrucción"}
                className={cn(
                  "rounded-full",
                  dictating
                    ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {dictating ? (
                  <SquareIcon aria-hidden="true" />
                ) : (
                  <MicIcon aria-hidden="true" />
                )}
              </Button>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex gap-2">
            <Button
              onClick={() => void aplicar()}
              disabled={textareaVacio || ocupado || dictating}
              className="w-1/2"
            >
              {interpretando || aplicando ? (
                <>
                  <Spinner className="size-3.5" />
                  Agregando…
                </>
              ) : (
                "Agregar"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={nuevaLista}
              disabled={ocupado || dictating || listaVacia}
              className="w-1/2"
            >
              Nueva
            </Button>
          </div>

          {nota ? (
            <Alert variant={nota.tipo === "error" ? "destructive" : "info"}>
              <TriangleAlertIcon />
              <AlertDescription>{nota.texto}</AlertDescription>
            </Alert>
          ) : null}

          {cargando && !snapshot ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null}

          {!cargando && !snapshot && cargaFallida ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>
                No se pudo cargar tu lista.
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void cargarLista()}
                >
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {snapshot && snapshot.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShoppingBasketIcon />
                </EmptyMedia>
                <EmptyTitle>Tu lista está vacía</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}

          {snapshot && grupos.length > 0 ? (
            <div className="flex flex-col gap-5">
              <Progress
                value={progreso}
                aria-label={`Progreso de compras: ${progreso}% completado`}
              />
              {grupos.map((grupo) => (
                <section key={grupo.categoria} className="flex flex-col gap-1">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {grupo.categoria}
                  </h3>
                  <ul className="flex flex-col">
                    {grupo.items.map((item) => {
                      const cantidad = formatCantidad(item)
                      return (
                        <li
                          key={item.id}
                          className="flex items-start gap-2.5 py-1.5"
                        >
                          <Checkbox
                            id={`item-${item.id}`}
                            checked={item.comprado}
                            onCheckedChange={(checked) => {
                              void marcarItem(item, checked === true)
                            }}
                            disabled={ocupado || marcandoId === item.id}
                            aria-label={`Marcar ${item.nombre} como ${
                              item.comprado ? "pendiente" : "comprado"
                            }`}
                            className="mt-0.5 rounded-full"
                          />
                          <label
                            htmlFor={`item-${item.id}`}
                            className="flex flex-1 cursor-pointer flex-col gap-0.5 text-sm leading-snug"
                          >
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span
                                className={
                                  item.comprado
                                    ? "text-muted-foreground line-through"
                                    : undefined
                                }
                              >
                                {item.nombre}
                              </span>
                              {item.estimado ? (
                                <Badge
                                  variant="info-light"
                                  size="xs"
                                  radius="full"
                                >
                                  Estimado
                                </Badge>
                              ) : null}
                            </span>
                            {cantidad ? (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {cantidad}
                              </span>
                            ) : null}
                          </label>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void eliminarItem(item)}
                            disabled={ocupado || marcandoId !== null || eliminandoId !== null}
                            aria-label={`Eliminar ${item.nombre} de la lista`}
                            title={`Elimina ${item.nombre} de la lista`}
                            className="-mr-1 mt-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            {eliminandoId === item.id ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <XIcon aria-hidden="true" />
                            )}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendiente !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendiente(null)
            textareaRef.current?.focus()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tituloPendiente}</AlertDialogTitle>
            <AlertDialogDescription>
              Tu lista actual tiene{" "}
              {snapshot?.items.length === 1
                ? "1 producto"
                : `${snapshot?.items.length ?? 0} productos`}
              . Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmarPendiente()}
              disabled={aplicando}
            >
              {aplicando ? (
                <>
                  <Spinner className="size-3.5" />
                  Aplicando…
                </>
              ) : (
                "Sí, aplicar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
