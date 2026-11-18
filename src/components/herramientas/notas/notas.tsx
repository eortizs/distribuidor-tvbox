"use client"

import * as React from "react"

import { cn } from "cn"
import { toast } from "sonner"
import {
  MicIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  SquareIcon,
  StickyNoteIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  deriveTitle,
  NOTA_BODY_MAX,
  NOTA_TITLE_MAX,
  NOTAS_BUSQUEDA_MIN,
  previewBody,
  type Nota,
  type NotaPreview,
} from "@/lib/notas"
import { Alert, AlertDescription } from "@/components/reui/alert"
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
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"

/**
 * Módulo Notas: lista de notas propias con búsqueda, fijar y borrado con
 * confirmación; el editor es un sheet con dictado por voz. El servidor es
 * la fuente de verdad: el listado viaja truncado y el cuerpo completo se
 * pide al abrir el editor; la edición exige la `version` conocida y un 409
 * ofrece recargar la nota vigente en lugar de pisar cambios ajenos.
 */

type Aviso = { tipo: "info" | "error"; texto: string } | null

type Editor =
  | { modo: "nueva"; nota: null }
  | { modo: "editar"; nota: Nota | null; notaId: string }
  | null

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

/**
 * Fecha corta determinista (misma en servidor y cliente): CDMX fija. Los
 * formateadores viven a nivel de módulo — construir un Intl.DateTimeFormat
 * por fila y render es caro en móvil (hasta 200 filas re-renderizando en
 * cada pulsación del buscador).
 */
const FECHA_CORTA_OPCIONES = {
  day: "numeric",
  month: "short",
  timeZone: "America/Mexico_City",
} as const
const fechaCortaFormato = new Intl.DateTimeFormat("es-MX", FECHA_CORTA_OPCIONES)
const fechaCortaFormatoAnio = new Intl.DateTimeFormat("es-MX", {
  ...FECHA_CORTA_OPCIONES,
  year: "numeric",
})

function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ""
  const hoy = new Date()
  const mismoAnio = fecha.getFullYear() === hoy.getFullYear()
  return (mismoAnio ? fechaCortaFormato : fechaCortaFormatoAnio).format(fecha)
}

/** Orden canónico del listado: fijadas primero, luego últimas editadas. */
function ordenar(lista: NotaPreview[]): NotaPreview[] {
  return [...lista].sort((a, b) =>
    a.pinned === b.pinned
      ? b.updatedAt.localeCompare(a.updatedAt)
      : a.pinned
        ? -1
        : 1
  )
}

const renglonDe = (nota: Nota): NotaPreview => ({
  id: nota.id,
  title: nota.title,
  body: previewBody(nota.body),
  pinned: nota.pinned,
  updatedAt: nota.updatedAt,
})

export function Notas({
  inicial,
  cargaFallida,
}: {
  inicial: NotaPreview[] | null
  cargaFallida: boolean
}) {
  const [todas, setTodas] = React.useState<NotaPreview[] | null>(inicial)
  const [cargando, setCargando] = React.useState(false)
  const [aviso, setAviso] = React.useState<Aviso>(null)
  const [busqueda, setBusqueda] = React.useState("")
  const [resultados, setResultados] = React.useState<NotaPreview[] | null>(null)
  const [editor, setEditor] = React.useState<Editor>(null)
  const [borradorTitulo, setBorradorTitulo] = React.useState("")
  const [borradorTexto, setBorradorTexto] = React.useState("")
  const [cargandoNota, setCargandoNota] = React.useState(false)
  const [guardando, setGuardando] = React.useState(false)
  const [avisoEditor, setAvisoEditor] = React.useState<Aviso>(null)
  const [conflicto, setConflicto] = React.useState(false)
  const [pendienteEliminar, setPendienteEliminar] =
    React.useState<NotaPreview | null>(null)
  const [eliminando, setEliminando] = React.useState(false)
  const [fijandoId, setFijandoId] = React.useState<string | null>(null)

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  // Dictado por voz: patrón de lista-compras. `dictationBase` guarda el
  // texto al iniciar la sesión y cada sesión se agrega a eso; si el usuario
  // teclea mientras dicta, lo escrito manda y el dictado se aborta.
  const dictationBaseRef = React.useRef("")
  const dictationCancelledRef = React.useRef(false)
  // Guardia de secuencia: una respuesta tardía de búsqueda o de recarga
  // jamás pinta resultados de una consulta anterior.
  const cargaSeqRef = React.useRef(0)

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
      setBorradorTexto(unirTexto(dictationBaseRef.current, text))
    },
    onEnd: (text) => {
      const base = dictationBaseRef.current
      dictationBaseRef.current = ""
      if (dictationCancelledRef.current) {
        dictationCancelledRef.current = false
        return
      }
      if (text.trim()) {
        setBorradorTexto(unirTexto(base, text))
      }
      textareaRef.current?.focus()
    },
  })

  React.useEffect(() => {
    if (!dictationError) return
    toast.error(dictationError)
  }, [dictationError])

  const termino = busqueda.trim()
  const buscando = termino.length >= NOTAS_BUSQUEDA_MIN
  const visibles = buscando ? (resultados ?? []) : (todas ?? [])

  const aplicarTodas = (lista: NotaPreview[]) => {
    setTodas(ordenar(lista))
  }

  /**
   * Recarga silenciosa tras una mutación, con guardia de secuencia. Con
   * búsqueda activa refresca TAMBIÉN la lista completa: una nota ajena
   * hallada por búsqueda puede no estar en `todas` y, al limpiar el
   * filtro, la lista quedaría sin ella.
   */
  const recargar = React.useCallback(async () => {
    const seq = ++cargaSeqRef.current
    const terminoVivo = termino
    const pedir = async (
      url: string,
      aplicar: (data: NotaPreview[]) => void
    ) => {
      const response = await fetch(url, { cache: "no-store" })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok || seq !== cargaSeqRef.current) return
      aplicar((body as { data: NotaPreview[] }).data)
    }
    try {
      await Promise.all([
        pedir("/api/notas", aplicarTodas),
        ...(buscando
          ? [pedir(`/api/notas?q=${encodeURIComponent(terminoVivo)}`, setResultados)]
          : []),
      ])
    } catch {
      // Refresco de fondo: el fallo se muestra en el siguiente intento real.
    }
  }, [buscando, termino])

  const cargarNotas = React.useCallback(async () => {
    const seq = ++cargaSeqRef.current
    setCargando(true)
    try {
      const response = await fetch("/api/notas", { cache: "no-store" })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "load_error")
      }
      if (seq !== cargaSeqRef.current) return
      aplicarTodas((body as { data: NotaPreview[] }).data)
      setAviso(null)
    } catch {
      if (seq !== cargaSeqRef.current) return
      setAviso({
        tipo: "error",
        texto: "No se pudieron cargar tus notas. Revisa tu conexión y reintenta.",
      })
    } finally {
      if (seq === cargaSeqRef.current) setCargando(false)
    }
  }, [])

  // Búsqueda con debounce: 2+ caracteres consultan al servidor; con menos
  // la vista deriva al listado completo sin tocar la red. La guardia de
  // secuencia descarta respuestas de consultas ya sustituidas.
  React.useEffect(() => {
    if (!buscando) return
    const seq = ++cargaSeqRef.current
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/notas?q=${encodeURIComponent(termino)}`,
          { cache: "no-store" }
        )
        const body = await leerRespuesta(response)
        if (!response.ok || !body?.ok) return
        if (seq !== cargaSeqRef.current) return
        setResultados((body as { data: NotaPreview[] }).data)
      } catch {
        // Sin resultados nuevos: el listado anterior sigue en pantalla.
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [buscando, termino])

  const toggleDictation = React.useCallback(() => {
    if (dictating) {
      stopDictation()
      return
    }
    if (!dictationSupported) {
      toast.error("Tu navegador no admite dictado por voz. Escribe tu nota.")
      return
    }
    if (guardando) return
    dictationBaseRef.current = borradorTexto
    startDictation()
  }, [
    dictating,
    dictationSupported,
    guardando,
    borradorTexto,
    startDictation,
    stopDictation,
  ])

  /** Texto editado a mano mientras se dicta: el dictado se cancela. */
  const editarBorradorTexto = (next: string) => {
    if (dictating) {
      dictationCancelledRef.current = true
      stopDictation()
      dictationBaseRef.current = ""
    }
    setBorradorTexto(next)
  }

  const abrirNueva = () => {
    setAvisoEditor(null)
    setConflicto(false)
    setBorradorTitulo("")
    setBorradorTexto("")
    setEditor({ modo: "nueva", nota: null })
  }

  const abrirEdicion = async (nota: NotaPreview) => {
    setAvisoEditor(null)
    setConflicto(false)
    setBorradorTitulo(nota.title)
    setBorradorTexto(nota.body)
    setEditor({ modo: "editar", nota: null, notaId: nota.id })
    setCargandoNota(true)
    try {
      const response = await fetch(`/api/notas/${nota.id}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "load_error")
      }
      const completa = (body as { data: Nota }).data
      setEditor((actual) =>
        actual && actual.modo === "editar" && actual.notaId === nota.id
          ? { ...actual, nota: completa }
          : actual
      )
      setBorradorTitulo(completa.title)
      setBorradorTexto(completa.body)
    } catch {
      toast.error("No se pudo abrir la nota. Intenta de nuevo.")
      setEditor(null)
    } finally {
      setCargandoNota(false)
    }
  }

  const cerrarEditor = () => {
    if (guardando || cargandoNota) return
    if (dictating) {
      dictationCancelledRef.current = true
      stopDictation()
      dictationBaseRef.current = ""
    }
    setEditor(null)
    setAvisoEditor(null)
    setConflicto(false)
  }

  const notaAbierta =
    editor && editor.modo === "editar" ? editor.nota : null

  const puedeGuardar =
    !guardando &&
    !cargandoNota &&
    !dictating &&
    (editor?.modo === "nueva"
      ? deriveTitle(borradorTitulo, borradorTexto) !== ""
      : notaAbierta !== null &&
        (borradorTitulo !== notaAbierta.title ||
          borradorTexto !== notaAbierta.body))

  const guardar = async () => {
    if (!editor || !puedeGuardar) return
    setGuardando(true)
    setAvisoEditor(null)
    try {
      const esNueva = editor.modo === "nueva"
      const response = await fetch(
        esNueva ? "/api/notas" : `/api/notas/${editor.notaId}`,
        {
          method: esNueva ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: borradorTitulo,
            body: borradorTexto,
            pinned: esNueva ? false : notaAbierta?.pinned === true,
            ...(esNueva ? {} : { version: notaAbierta?.version }),
          }),
        }
      )
      const body = await leerRespuesta(response)
      if (response.status === 409) {
        setConflicto(true)
        setAvisoEditor({
          tipo: "error",
          texto:
            body?.error?.message ??
            "La nota cambió en otro dispositivo o pestaña.",
        })
        return
      }
      if (!response.ok || !body?.ok) {
        setAvisoEditor({
          tipo: "error",
          texto:
            body?.error?.message ??
            "No se pudo guardar la nota. Intenta de nuevo.",
        })
        return
      }
      const guardada = (body as { data: Nota }).data
      const renglon = renglonDe(guardada)
      setTodas((actual) =>
        ordenar(
          actual
            ? esNueva
              ? [renglon, ...actual]
              : actual.map((n) => (n.id === renglon.id ? renglon : n))
            : [renglon]
        )
      )
      void recargar()
      toast.success(esNueva ? "Nota creada" : "Nota guardada")
      setEditor(null)
    } catch {
      setAvisoEditor({
        tipo: "error",
        texto:
          "No se pudo guardar la nota. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setGuardando(false)
    }
  }

  /** Trae la nota vigente al borrador (conflicto 409): nadie pierde nada,
   * se muestra la versión actual y se decide sobre ella. */
  const recargarNotaAbierta = async () => {
    if (!editor || editor.modo !== "editar") return
    setCargandoNota(true)
    try {
      const response = await fetch(`/api/notas/${editor.notaId}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "load_error")
      }
      const completa = (body as { data: Nota }).data
      setEditor((actual) =>
        actual && actual.modo === "editar"
          ? { ...actual, nota: completa }
          : actual
      )
      setBorradorTitulo(completa.title)
      setBorradorTexto(completa.body)
      setConflicto(false)
      setAvisoEditor(null)
    } catch {
      toast.error("No se pudo recargar la nota. Intenta de nuevo.")
    } finally {
      setCargandoNota(false)
    }
  }

  /** Fijar/soltar desde la fila: el cuerpo completo viaja del servidor al
   * PATCH (reemplazo total con CAS), nunca el preview truncado. */
  const toggleFijar = async (nota: NotaPreview) => {
    if (fijandoId) return
    setFijandoId(nota.id)
    try {
      const respuestaCompleta = await fetch(`/api/notas/${nota.id}`, {
        cache: "no-store",
      })
      const cuerpoCompleto = await leerRespuesta(respuestaCompleta)
      if (!respuestaCompleta.ok || !cuerpoCompleto?.ok) {
        throw new Error("load_error")
      }
      const completa = (cuerpoCompleto as { data: Nota }).data
      const response = await fetch(`/api/notas/${nota.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: completa.title,
          body: completa.body,
          pinned: !completa.pinned,
          version: completa.version,
        }),
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "patch_error")
      }
      const actualizada = renglonDe((body as { data: Nota }).data)
      setTodas((actual) =>
        actual
          ? ordenar(
              actual.map((n) => (n.id === actualizada.id ? actualizada : n))
            )
          : actual
      )
      void recargar()
    } catch {
      toast.error("No se pudo fijar la nota. Intenta de nuevo.")
      void recargar()
    } finally {
      setFijandoId(null)
    }
  }

  const confirmarEliminar = async () => {
    if (!pendienteEliminar || eliminando) return
    setEliminando(true)
    try {
      const response = await fetch(`/api/notas/${pendienteEliminar.id}`, {
        method: "DELETE",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "delete_error")
      }
      const id = pendienteEliminar.id
      setTodas((actual) =>
        actual ? actual.filter((n) => n.id !== id) : actual
      )
      void recargar()
      toast.success("Nota eliminada")
      setPendienteEliminar(null)
    } catch {
      toast.error("No se pudo eliminar la nota. Intenta de nuevo.")
    } finally {
      setEliminando(false)
    }
  }

  const total = todas?.length ?? 0
  const listaVacia = todas !== null && total === 0 && !buscando

  return (
    <div className="w-full max-w-xl">
      <Card className="ring-0">
        <CardHeader>
          <CardTitle>Notas</CardTitle>
          {todas !== null ? (
            <CardAction>
              <p className="text-xs tabular-nums text-muted-foreground">
                {total === 1 ? "1 nota" : `${total} notas`}
              </p>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <InputGroup className="flex-1">
              <InputGroupAddon align="inline-start">
                <SearchIcon
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Buscar en tus notas"
                placeholder="Buscar..."
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
              />
            </InputGroup>
            <Button onClick={abrirNueva}>
              <PlusIcon aria-hidden="true" />
              Nueva
            </Button>
          </div>

          {aviso ? (
            <Alert variant={aviso.tipo === "error" ? "destructive" : "info"}>
              <TriangleAlertIcon />
              <AlertDescription>
                {aviso.texto}
                {aviso.tipo === "error" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => void cargarNotas()}
                  >
                    Reintentar
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {cargando && todas === null ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null}

          {!cargando && todas === null && cargaFallida ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>
                No se pudieron cargar tus notas.
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void cargarNotas()}
                >
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {listaVacia ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <StickyNoteIcon />
                </EmptyMedia>
                <EmptyTitle>Aún no tienes notas</EmptyTitle>
                <EmptyDescription>
                  Guarda recordatorios, ideas y datos importantes en tu
                  cuenta.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNueva}>
                  <PlusIcon aria-hidden="true" />
                  Crear la primera nota
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {buscando && resultados !== null && resultados.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>Sin resultados</EmptyTitle>
                <EmptyDescription>
                  Ninguna nota coincide con tu búsqueda.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setBusqueda("")}>
                  Limpiar búsqueda
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {visibles.length > 0 ? (
            <ul className="flex flex-col">
              {visibles.map((nota) => (
                <li
                  key={nota.id}
                  className="flex items-start gap-2 border-b py-3 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => void abrirEdicion(nota)}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left"
                    aria-label={`Editar ${nota.title}`}
                  >
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="truncate text-sm font-medium">
                        {nota.title}
                      </span>
                      {nota.pinned ? (
                        <Badge variant="info-light" size="xs" radius="full">
                          Fijada
                        </Badge>
                      ) : null}
                    </span>
                    {nota.body ? (
                      <span className="line-clamp-2 text-sm/relaxed whitespace-pre-line text-muted-foreground">
                        {nota.body}
                      </span>
                    ) : null}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {fechaCorta(nota.updatedAt)}
                    </span>
                  </button>
                  <div className="flex flex-col items-center gap-1.5 self-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void toggleFijar(nota)}
                      disabled={fijandoId !== null}
                      aria-label={
                        nota.pinned
                          ? `Soltar ${nota.title}`
                          : `Fijar ${nota.title}`
                      }
                      aria-pressed={nota.pinned}
                      title={nota.pinned ? "Soltar" : "Fijar"}
                      className={cn(
                        "relative after:absolute after:-inset-2 after:content-['']",
                        nota.pinned
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {fijandoId === nota.id ? (
                        <Spinner className="size-3.5" />
                      ) : nota.pinned ? (
                        <PinOffIcon aria-hidden="true" />
                      ) : (
                        <PinIcon aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPendienteEliminar(nota)}
                      disabled={fijandoId !== null}
                      aria-label={`Eliminar ${nota.title}`}
                      title="Eliminar"
                      className="relative -mr-1 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Sheet
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) cerrarEditor()
        }}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg gap-0 rounded-t-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>
              {editor?.modo === "nueva" ? "Nueva nota" : "Editar nota"}
            </SheetTitle>
            <SheetDescription>
              El título es opcional: si lo dejas vacío se toma de la primera
              línea del texto.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            {cargandoNota && notaAbierta === null ? (
              <div className="flex flex-col gap-3" aria-hidden>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <>
                <Input
                  aria-label="Título de la nota"
                  placeholder="Título (opcional)"
                  value={borradorTitulo}
                  maxLength={NOTA_TITLE_MAX}
                  onChange={(event) => setBorradorTitulo(event.target.value)}
                />
                <div className="flex flex-col gap-1.5">
                  {/* El botón de dictar vive dentro de la caja, abajo a la
                      derecha (patrón de lista-compras). */}
                  <InputGroup>
                    <InputGroupTextarea
                      ref={textareaRef}
                      aria-label="Texto de la nota"
                      value={borradorTexto}
                      onChange={(event) =>
                        editarBorradorTexto(event.target.value)
                      }
                      maxLength={NOTA_BODY_MAX}
                      rows={8}
                      className="min-h-40"
                      placeholder="Escribe o dicta tu nota..."
                    />
                    <InputGroupAddon align="inline-end" className="self-end pb-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={toggleDictation}
                        aria-pressed={dictating}
                        aria-label={
                          dictating ? "Detener el dictado" : "Dictar la nota"
                        }
                        title={dictating ? "Detener el dictado" : "Dictar la nota"}
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
                  <p className="text-right text-xs tabular-nums text-muted-foreground">
                    {borradorTexto.length.toLocaleString("es-MX")} /{" "}
                    {NOTA_BODY_MAX.toLocaleString("es-MX")}
                  </p>
                </div>

                {avisoEditor ? (
                  <Alert
                    variant={avisoEditor.tipo === "error" ? "destructive" : "info"}
                  >
                    <TriangleAlertIcon />
                    <AlertDescription>
                      {avisoEditor.texto}
                      {conflicto ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => void recargarNotaAbierta()}
                          disabled={cargandoNota}
                        >
                          {cargandoNota ? (
                            <>
                              <Spinner className="size-3.5" />
                              Recargando…
                            </>
                          ) : (
                            "Recargar la nota actual"
                          )}
                        </Button>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="w-1/2"
                    onClick={cerrarEditor}
                    disabled={guardando || cargandoNota}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className="w-1/2"
                    onClick={() => void guardar()}
                    disabled={!puedeGuardar}
                  >
                    {guardando ? (
                      <>
                        <Spinner className="size-3.5" />
                        Guardando…
                      </>
                    ) : (
                      "Guardar"
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendienteEliminar !== null}
        onOpenChange={(open) => {
          if (!open && !eliminando) setPendienteEliminar(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta nota?</AlertDialogTitle>
            <AlertDialogDescription>
              «{pendienteEliminar?.title}» se borrará definitivamente. Esta
              acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminando}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmarEliminar()}
              disabled={eliminando}
            >
              {eliminando ? (
                <>
                  <Spinner className="size-3.5" />
                  Eliminando…
                </>
              ) : (
                "Sí, eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
