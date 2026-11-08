"use client"

import * as React from "react"

import { cn } from "cn"
import {
  camposFaltantesParaConfirmar,
  ETIQUETA_ESTADO,
  MAX_ARCHIVO_BYTES,
  MAX_IMPUESTOS,
  MAX_PRODUCTOS,
  resumenTicket,
  vacioDatosTicket,
  type DatosTicket,
  type ImpuestoTicket,
  type ProductoTicket,
  type TicketVista,
} from "@/lib/tickets"
import { useFileUpload, formatBytes } from "@/hooks/use-file-upload"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CameraIcon,
  FolderOpenIcon,
  PlusIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

/**
 * Módulo Alta de tickets: dos vías de captura (cámara del celular o archivo),
 * análisis con IA y revisión editable por el propietario. La subida guarda la
 * foto y el registro ANTES de analizar; un fallo del modelo nunca pierde la
 * foto y el análisis se puede reintentar.
 */

type Nota =
  | { tipo: "error" | "info"; texto: string }
  | { tipo: "conflicto"; texto: string }
  | null

interface ListaEstado {
  items: TicketVista[]
  total: number
}

async function leerRespuesta(response: Response) {
  try {
    return (await response.json()) as {
      ok?: boolean
      data?: unknown
      duplicado?: boolean
      error?: { code?: string; message?: string }
    }
  } catch {
    return null
  }
}

/** El cliente valida el formato de los montos; el servidor normaliza. */
function montoEditable(value: string): boolean {
  const clean = value.replace(/[$\s,]/g, "").trim()
  return clean === "" || /^\d+(\.\d+)?$/.test(clean)
}

function montosDeFormularioValidos(datos: DatosTicket): string | null {
  const campos: [string, string | null][] = [
    ["subtotal", datos.subtotal],
    ["descuentos", datos.descuentos],
    ["propina", datos.propina],
    ["total", datos.total],
  ]
  for (const [nombre, valor] of campos) {
    if (valor !== null && !montoEditable(valor)) {
      return `El monto de «${nombre}» no es un número válido.`
    }
  }
  for (const impuesto of datos.impuestos) {
    if (!montoEditable(impuesto.importe)) {
      return `El importe del impuesto «${impuesto.nombre}» no es válido.`
    }
  }
  for (const producto of datos.productos) {
    for (const campo of ["precioUnitario", "descuento", "importe"] as const) {
      const valor = producto[campo]
      if (valor !== null && !montoEditable(valor)) {
        return `El monto de «${campo}» en «${producto.descripcion}» no es válido.`
      }
    }
  }
  return null
}

function BadgeEstado({ estado }: { estado: TicketVista["estado"] }) {
  if (estado === "confirmado") {
    return (
      <Badge variant="success-light" size="sm">
        {ETIQUETA_ESTADO.confirmado}
      </Badge>
    )
  }
  if (estado === "revision") {
    return (
      <Badge variant="info-light" size="sm">
        {ETIQUETA_ESTADO.revision}
      </Badge>
    )
  }
  return (
    <Badge variant="warning-light" size="sm">
      {ETIQUETA_ESTADO.borrador}
    </Badge>
  )
}

export function Tickets({
  inicial,
  cargaFallida,
}: {
  inicial: ListaEstado | null
  cargaFallida: boolean
}) {
  const [lista, setLista] = React.useState<ListaEstado | null>(inicial)
  const [listaFallida, setListaFallida] = React.useState(cargaFallida)
  const [cargandoLista, setCargandoLista] = React.useState(false)
  const [cargandoMas, setCargandoMas] = React.useState(false)

  const [seleccion, setSeleccion] = React.useState<TicketVista | null>(null)
  const [form, setForm] = React.useState<DatosTicket | null>(null)

  // Captura: dos entradas independientes sobre el mismo hook (cámara con
  // capture="environment"; selector sin capture). El estado del hook no se
  // usa: el archivo vivo vive en `archivo` con su preview local.
  const [archivo, setArchivo] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<string | null>(null)
  const previewRef = React.useRef<string | null>(null)

  const [guardando, setGuardando] = React.useState(false)
  const [analizando, setAnalizando] = React.useState(false)
  const [guardandoCambios, setGuardandoCambios] = React.useState(false)
  const [confirmando, setConfirmando] = React.useState(false)
  const [cargandoTicket, setCargandoTicket] = React.useState(false)
  const [nota, setNota] = React.useState<Nota>(null)
  const [zoom, setZoom] = React.useState(false)

  const idBase = React.useId()
  const campo = React.useCallback(
    (nombre: string) => `${idBase}-${nombre}`,
    [idBase]
  )

  const revocarPreview = React.useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
  }, [])

  const agregarArchivo = React.useCallback(
    (nuevos: { file: File | { name: string } }[]) => {
      const primero = nuevos[0]?.file
      if (!(primero instanceof File)) return
      revocarPreview()
      const url = URL.createObjectURL(primero)
      previewRef.current = url
      setArchivo(primero)
      setPreview(url)
      setNota(null)
    },
    [revocarPreview]
  )

  const [, camara] = useFileUpload({
    accept: "image/*",
    multiple: false,
    maxSize: MAX_ARCHIVO_BYTES,
    onFilesAdded: agregarArchivo,
  })
  const [, selector] = useFileUpload({
    accept: "image/*",
    multiple: false,
    maxSize: MAX_ARCHIVO_BYTES,
    onFilesAdded: agregarArchivo,
  })

  React.useEffect(() => {
    return () => revocarPreview()
  }, [revocarPreview])

  // El formulario vive aparte de la selección: un PATCH fallido no descarta
  // los cambios locales (el 409 ofrece recargar de forma explícita). Toda
  // transición de selección pasa por aquí para reiniciar el formulario de
  // forma explícita, sin efectos que sincronicen estado.
  const aplicarSeleccion = React.useCallback((vista: TicketVista | null) => {
    setSeleccion(vista)
    setForm(vista ? structuredClone(vista.datos ?? vacioDatosTicket()) : null)
  }, [])

  const ocupado =
    guardando ||
    analizando ||
    guardandoCambios ||
    confirmando ||
    cargandoTicket

  const refreshLista = React.useCallback(async (limite = 20) => {
    setCargandoLista(true)
    try {
      const response = await fetch(`/api/tickets?limit=${limite}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) throw new Error("load_error")
      setLista(body.data as ListaEstado)
      setListaFallida(false)
    } catch {
      setListaFallida(true)
    } finally {
      setCargandoLista(false)
    }
  }, [])

  const cargarMas = React.useCallback(async () => {
    if (!lista || cargandoMas) return
    setCargandoMas(true)
    try {
      const response = await fetch(
        `/api/tickets?offset=${lista.items.length}&limit=20`,
        { cache: "no-store" }
      )
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) throw new Error("load_error")
      const pagina = body.data as ListaEstado
      const ids = new Set(lista.items.map((item) => item.entityId))
      setLista({
        items: [
          ...lista.items,
          ...pagina.items.filter((item) => !ids.has(item.entityId)),
        ],
        total: pagina.total,
      })
    } catch {
      toast.error("No se pudo cargar el historial. Intenta de nuevo.")
    } finally {
      setCargandoMas(false)
    }
  }, [lista, cargandoMas])

  const analizar = React.useCallback(
    async (entityId: string) => {
      setAnalizando(true)
      setNota(null)
      try {
        const response = await fetch(`/api/tickets/${entityId}/extraer`, {
          method: "POST",
        })
        const body = await leerRespuesta(response)
        if (!response.ok || !body?.ok) {
          setNota({
            tipo: "error",
            texto:
              body?.error?.message ??
              "El análisis no se pudo completar. Puedes reintentarlo o llenar los datos a mano.",
          })
          // El servidor marcó el intento como fallido: refrescar la vista.
          const refresco = await fetch(`/api/tickets/${entityId}`, {
            cache: "no-store",
          })
          const refrescoBody = await leerRespuesta(refresco)
          if (refresco.ok && refrescoBody?.ok) {
            aplicarSeleccion(refrescoBody.data as TicketVista)
          }
          return
        }
        const vista = body.data as TicketVista
        aplicarSeleccion(vista)
        if (vista.datos === null) {
          setNota({
            tipo: "info",
            texto:
              "La imagen no parece un ticket de compra o gasto. Puedes llenar los datos a mano.",
          })
        }
      } catch {
        setNota({
          tipo: "error",
          texto:
            "No se pudo analizar la foto. Revisa tu conexión e intenta de nuevo.",
        })
      } finally {
        setAnalizando(false)
        void refreshLista()
      }
    },
    [refreshLista, aplicarSeleccion]
  )

  const guardarYAnalizar = React.useCallback(async () => {
    if (!archivo || ocupado) return
    const requestId = crypto.randomUUID()
    setGuardando(true)
    setNota(null)
    let entityId: string | null = null
    try {
      const formData = new FormData()
      formData.append("file", archivo)
      formData.append("requestId", requestId)
      const response = await fetch("/api/tickets", {
        method: "POST",
        body: formData,
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        setNota({
          tipo: "error",
          texto:
            body?.error?.message ??
            "No se pudo guardar la foto. Intenta de nuevo.",
        })
        return
      }
      const vista = body.data as TicketVista
      entityId = vista.entityId
      revocarPreview()
      setArchivo(null)
      setPreview(null)
      camara.clearFiles()
      selector.clearFiles()
      aplicarSeleccion(vista)
      if (body.duplicado === true) {
        toast.info("Este archivo ya estaba guardado: te muestro ese ticket.")
        void refreshLista()
        return
      }
      await analizar(entityId)
    } catch {
      setNota({
        tipo: "error",
        texto:
          "No se pudo guardar la foto. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setGuardando(false)
    }
  }, [archivo, ocupado, revocarPreview, camara, selector, analizar, refreshLista, aplicarSeleccion])

  const cargarTicket = React.useCallback(
    async (entityId: string) => {
      if (ocupado) return
      setCargandoTicket(true)
      setNota(null)
      try {
        const response = await fetch(`/api/tickets/${entityId}`, {
          cache: "no-store",
        })
        const body = await leerRespuesta(response)
        if (!response.ok || !body?.ok) {
          toast.error("No se pudo abrir el ticket. Intenta de nuevo.")
          return
        }
        aplicarSeleccion(body.data as TicketVista)
      } catch {
        toast.error("No se pudo abrir el ticket. Intenta de nuevo.")
      } finally {
        setCargandoTicket(false)
      }
    },
    [ocupado, aplicarSeleccion]
  )

  const enviarPatch = React.useCallback(
    async (confirmar: boolean) => {
      if (!seleccion || !form) return
      const errorMonto = montosDeFormularioValidos(form)
      if (errorMonto) {
        setNota({ tipo: "error", texto: errorMonto })
        return
      }
      if (confirmar) setConfirmando(true)
      else setGuardandoCambios(true)
      setNota(null)
      try {
        const response = await fetch(`/api/tickets/${seleccion.entityId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: seleccion.version,
            datos: form,
            confirmar,
          }),
        })
        const body = await leerRespuesta(response)
        if (response.status === 409) {
          setNota({
            tipo: "conflicto",
            texto:
              "El ticket cambió en otro dispositivo o pestaña. Puedes recargarlo (se descartan tus cambios) o seguir editando y copiar lo que necesites.",
          })
          return
        }
        if (!response.ok || !body?.ok) {
          setNota({
            tipo: "error",
            texto:
              body?.error?.message ??
              "No se pudieron guardar los cambios. Intenta de nuevo.",
          })
          return
        }
        const vista = body.data as TicketVista
        aplicarSeleccion(vista)
        void refreshLista()
        toast.success(
          confirmar ? "Ticket confirmado." : "Cambios guardados."
        )
      } catch {
        setNota({
          tipo: "error",
          texto:
            "No se pudieron guardar los cambios. Revisa tu conexión e intenta de nuevo.",
        })
      } finally {
        setConfirmando(false)
        setGuardandoCambios(false)
      }
    },
    [seleccion, form, refreshLista, aplicarSeleccion]
  )

  const nuevoTicket = React.useCallback(() => {
    aplicarSeleccion(null)
    setNota(null)
  }, [aplicarSeleccion])

  const quitarArchivo = React.useCallback(() => {
    revocarPreview()
    setArchivo(null)
    setPreview(null)
    camara.clearFiles()
    selector.clearFiles()
    setNota(null)
  }, [revocarPreview, camara, selector])

  // ---------------------------- Derivados --------------------------------

  const resumen = seleccion ? resumenTicket(seleccion.datos) : null
  const faltantesForm = form ? camposFaltantesParaConfirmar(form) : []
  const sinCambios =
    seleccion !== null &&
    form !== null &&
    JSON.stringify(form) === JSON.stringify(seleccion.datos ?? vacioDatosTicket())
  // Confirmar un ticket completo sin editarlo es la acción normal: solo
  // exige que el formulario tenga los cuatro campos obligatorios.
  const puedeConfirmar =
    seleccion !== null &&
    seleccion.estado !== "confirmado" &&
    form !== null &&
    faltantesForm.length === 0
  const mostrarFormulario =
    seleccion !== null &&
    (seleccion.datos !== null ||
      seleccion.scanEstado === "failed" ||
      seleccion.scanEstado === "succeeded")

  const editarForm = (patch: Partial<DatosTicket>) => {
    setForm((actual) => (actual ? { ...actual, ...patch } : actual))
  }
  const editarProducto = (indice: number, patch: Partial<ProductoTicket>) => {
    setForm((actual) => {
      if (!actual) return actual
      return {
        ...actual,
        productos: actual.productos.map((producto, i) =>
          i === indice ? { ...producto, ...patch } : producto
        ),
      }
    })
  }
  const agregarProducto = () => {
    setForm((actual) => {
      if (!actual || actual.productos.length >= MAX_PRODUCTOS) return actual
      return {
        ...actual,
        productos: [
          ...actual.productos,
          {
            descripcion: "",
            cantidad: null,
            unidad: null,
            precioUnitario: null,
            descuento: null,
            importe: null,
          },
        ],
      }
    })
  }
  const quitarProducto = (indice: number) => {
    setForm((actual) => {
      if (!actual) return actual
      return {
        ...actual,
        productos: actual.productos.filter((_, i) => i !== indice),
      }
    })
  }
  const editarImpuesto = (indice: number, patch: Partial<ImpuestoTicket>) => {
    setForm((actual) => {
      if (!actual) return actual
      return {
        ...actual,
        impuestos: actual.impuestos.map((impuesto, i) =>
          i === indice ? { ...impuesto, ...patch } : impuesto
        ),
      }
    })
  }
  const agregarImpuesto = () => {
    setForm((actual) => {
      if (!actual || actual.impuestos.length >= MAX_IMPUESTOS) return actual
      return {
        ...actual,
        impuestos: [...actual.impuestos, { nombre: "", tasa: null, importe: "" }],
      }
    })
  }
  const quitarImpuesto = (indice: number) => {
    setForm((actual) => {
      if (!actual) return actual
      return {
        ...actual,
        impuestos: actual.impuestos.filter((_, i) => i !== indice),
      }
    })
  }

  const esBorradorSinAnalizar =
    seleccion !== null &&
    seleccion.estado === "borrador" &&
    seleccion.datos === null

  return (
    <div className="w-full max-w-2xl">
      <Card className="ring-0">
        <CardHeader>
          <CardTitle>Alta de tickets</CardTitle>
          <CardDescription>
            Sube la foto de un ticket de compra o gasto y la IA extrae sus
            datos para que los revises y los confirmes.
          </CardDescription>
          {seleccion ? (
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={nuevoTicket}
                disabled={ocupado}
              >
                Nuevo ticket
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {seleccion === null ? (
            <section className="flex flex-col gap-3" aria-label="Agregar una foto">
              {!archivo ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => camara.openFileDialog()}>
                      <CameraIcon data-icon="inline-start" />
                      Tomar foto
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => selector.openFileDialog()}
                    >
                      <FolderOpenIcon data-icon="inline-start" />
                      Elegir archivo
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    «Tomar foto» abre la cámara en el celular; en computadora
                    se abre el selector de archivos. Imágenes JPEG, PNG o WebP
                    de hasta {formatBytes(MAX_ARCHIVO_BYTES)}.
                  </p>
                </>
              ) : (
                <figure className="flex flex-col gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview ?? undefined}
                    alt="Vista previa del ticket seleccionado"
                    className="max-h-96 w-full rounded-lg border border-border object-contain"
                  />
                  <figcaption className="truncate text-xs text-muted-foreground">
                    {archivo.name} · {formatBytes(archivo.size)}
                  </figcaption>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={quitarArchivo}
                      disabled={guardando}
                    >
                      <XIcon data-icon="inline-start" />
                      Quitar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => camara.openFileDialog()}
                      disabled={guardando}
                    >
                      <CameraIcon data-icon="inline-start" />
                      Otra foto
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selector.openFileDialog()}
                      disabled={guardando}
                    >
                      <FolderOpenIcon data-icon="inline-start" />
                      Otro archivo
                    </Button>
                    <Button
                      className="ml-auto"
                      onClick={() => void guardarYAnalizar()}
                      disabled={guardando}
                    >
                      {guardando ? (
                        <>
                          <Spinner className="size-3.5" />
                          Guardando…
                        </>
                      ) : (
                        "Guardar y analizar"
                      )}
                    </Button>
                  </div>
                </figure>
              )}
              {/* Las dos entradas viven siempre montadas: cada botón abre la
                  suya. La de cámara sugiere la cámara trasera del celular. */}
              <input
                {...camara.getInputProps({
                  capture: "environment",
                  className: "sr-only",
                  tabIndex: -1,
                  "aria-hidden": true,
                })}
              />
              <input
                {...selector.getInputProps({
                  className: "sr-only",
                  tabIndex: -1,
                  "aria-hidden": true,
                })}
              />
            </section>
          ) : null}

          {seleccion ? (
            <section className="flex flex-col gap-4" aria-label="Ticket seleccionado">
              <div className="flex flex-wrap items-center gap-2">
                <BadgeEstado estado={seleccion.estado} />
                {seleccion.scanEstado === "failed" && seleccion.estado === "borrador" ? (
                  <Badge variant="destructive-light" size="sm">
                    Error de lectura
                  </Badge>
                ) : null}
                {esBorradorSinAnalizar && seleccion.scanEstado !== "failed" ? (
                  <Badge variant="info-light" size="sm">
                    {seleccion.scanEstado === "processing" || analizando
                      ? "Analizando…"
                      : "Pendiente de analizar"}
                  </Badge>
                ) : null}
                {resumen ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {resumen.titulo} · {resumen.detalle}
                  </p>
                ) : null}
              </div>

              {/* Foto: abrir la vista ampliada con un botón explícito. */}
              <figure className="flex flex-col gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={seleccion.imagenUrl}
                  alt="Foto del ticket guardado"
                  loading="lazy"
                  className="max-h-80 w-full rounded-lg border border-border object-contain"
                />
                <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
                  Foto guardada con el ticket
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setZoom(true)}
                  >
                    Ampliar
                  </Button>
                </figcaption>
              </figure>

              {analizando || seleccion.scanEstado === "processing" ? (
                <Alert variant="info">
                  <Spinner className="size-4" />
                  <AlertDescription>
                    Analizando la foto con IA. Suele tardar unos segundos.
                  </AlertDescription>
                </Alert>
              ) : null}

              {seleccion.scanEstado === "failed" && seleccion.estado === "borrador" ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>No se pudo leer el ticket</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    {seleccion.scanError ?? "El análisis no produjo resultados."}
                    <span className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void analizar(seleccion.entityId)}
                        disabled={ocupado}
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        Reintentar análisis
                      </Button>
                    </span>
                  </AlertDescription>
                </Alert>
              ) : null}

              {esBorradorSinAnalizar &&
              seleccion.scanEstado === "pending" &&
              !analizando ? (
                <Button
                  onClick={() => void analizar(seleccion.entityId)}
                  disabled={ocupado}
                >
                  Analizar foto
                </Button>
              ) : null}

              {seleccion.advertencias.length > 0 ? (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>Avisos del análisis</AlertTitle>
                  <AlertDescription>
                    <ul className="list-inside list-disc flex-col gap-1">
                      {seleccion.advertencias.map((aviso, i) => (
                        <li key={i}>{aviso}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {seleccion.discrepancias.length > 0 ? (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>Revisa los montos</AlertTitle>
                  <AlertDescription>
                    <ul className="list-inside list-disc flex-col gap-1">
                      {seleccion.discrepancias.map((aviso, i) => (
                        <li key={i}>{aviso}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {nota ? (
                nota.tipo === "conflicto" ? (
                  <Alert variant="warning">
                    <TriangleAlertIcon />
                    <AlertTitle>Cambios en otro dispositivo</AlertTitle>
                    <AlertDescription className="flex flex-col gap-2">
                      {nota.texto}
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setNota(null)
                            void cargarTicket(seleccion.entityId)
                          }}
                          disabled={ocupado}
                        >
                          Recargar ticket
                        </Button>
                      </span>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant={nota.tipo === "error" ? "destructive" : "info"}>
                    <TriangleAlertIcon />
                    <AlertDescription>{nota.texto}</AlertDescription>
                  </Alert>
                )
              ) : null}

              {mostrarFormulario && form ? (
                <>
                  <section className="flex flex-col gap-3" aria-label="Datos del ticket">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Datos del ticket
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={campo("comercio")}>Comercio</Label>
                        <Input
                          id={campo("comercio")}
                          value={form.comercio.nombre ?? ""}
                          onChange={(e) =>
                            editarForm({
                              comercio: { ...form.comercio, nombre: e.target.value || null },
                            })
                          }
                          maxLength={120}
                          placeholder="Oxxo, Walmart…"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={campo("rfc")}>RFC (si aparece)</Label>
                        <Input
                          id={campo("rfc")}
                          value={form.comercio.rfc ?? ""}
                          onChange={(e) =>
                            editarForm({
                              comercio: { ...form.comercio, rfc: e.target.value || null },
                            })
                          }
                          maxLength={15}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={campo("fecha")}>Fecha</Label>
                        <Input
                          id={campo("fecha")}
                          type="date"
                          value={form.fecha ?? ""}
                          onChange={(e) => editarForm({ fecha: e.target.value || null })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={campo("hora")}>Hora</Label>
                        <Input
                          id={campo("hora")}
                          type="time"
                          value={form.hora ?? ""}
                          onChange={(e) => editarForm({ hora: e.target.value || null })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={campo("folio")}>Folio</Label>
                        <Input
                          id={campo("folio")}
                          value={form.folio ?? ""}
                          onChange={(e) => editarForm({ folio: e.target.value || null })}
                          maxLength={60}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={campo("moneda")}>Moneda (ISO)</Label>
                        <Input
                          id={campo("moneda")}
                          value={form.moneda ?? ""}
                          onChange={(e) =>
                            editarForm({
                              moneda: e.target.value.toUpperCase().slice(0, 3) || null,
                            })
                          }
                          maxLength={3}
                          placeholder="MXN"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={campo("formaPago")}>Forma de pago</Label>
                        <Input
                          id={campo("formaPago")}
                          value={form.formaPago ?? ""}
                          onChange={(e) =>
                            editarForm({ formaPago: e.target.value || null })
                          }
                          maxLength={60}
                          placeholder="Efectivo, tarjeta…"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="flex flex-col gap-2" aria-label="Partidas">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Partidas ({form.productos.length} de {MAX_PRODUCTOS} máx.)
                    </h3>
                    {form.productos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Sin partidas. Agrega los renglones que se leyeron o
                        necesites registrar.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {form.productos.map((producto, i) => (
                          <li
                            key={i}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2"
                          >
                            <Input
                              aria-label={`Descripción de la partida ${i + 1}`}
                              value={producto.descripcion}
                              onChange={(e) =>
                                editarProducto(i, { descripcion: e.target.value })
                              }
                              maxLength={500}
                              placeholder="Descripción"
                              className="min-w-40 flex-1"
                            />
                            <Input
                              aria-label={`Cantidad de la partida ${i + 1}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              value={producto.cantidad ?? ""}
                              onChange={(e) =>
                                editarProducto(i, {
                                  cantidad:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value) || null,
                                })
                              }
                              placeholder="Cant."
                              className="w-16"
                            />
                            <Input
                              aria-label={`Unidad de la partida ${i + 1}`}
                              value={producto.unidad ?? ""}
                              onChange={(e) =>
                                editarProducto(i, {
                                  unidad: e.target.value || null,
                                })
                              }
                              maxLength={20}
                              placeholder="Unidad"
                              className="w-20"
                            />
                            <Input
                              aria-label={`Precio unitario de la partida ${i + 1}`}
                              inputMode="decimal"
                              value={producto.precioUnitario ?? ""}
                              onChange={(e) =>
                                editarProducto(i, {
                                  precioUnitario: e.target.value || null,
                                })
                              }
                              placeholder="Precio"
                              className="w-24"
                            />
                            <Input
                              aria-label={`Descuento de la partida ${i + 1}`}
                              inputMode="decimal"
                              value={producto.descuento ?? ""}
                              onChange={(e) =>
                                editarProducto(i, {
                                  descuento: e.target.value || null,
                                })
                              }
                              placeholder="Desc."
                              className="w-20"
                            />
                            <Input
                              aria-label={`Importe de la partida ${i + 1}`}
                              inputMode="decimal"
                              value={producto.importe ?? ""}
                              onChange={(e) =>
                                editarProducto(i, {
                                  importe: e.target.value || null,
                                })
                              }
                              placeholder="Importe"
                              className="w-24"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Quitar la partida ${i + 1}`}
                              onClick={() => quitarProducto(i)}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <XIcon aria-hidden="true" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={agregarProducto}
                        disabled={
                          ocupado || form.productos.length >= MAX_PRODUCTOS
                        }
                      >
                        <PlusIcon data-icon="inline-start" />
                        Agregar partida
                      </Button>
                    </span>
                  </section>

                  <section className="flex flex-col gap-2" aria-label="Impuestos">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Impuestos
                    </h3>
                    {form.impuestos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Sin impuestos registrados.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {form.impuestos.map((impuesto, i) => (
                          <li
                            key={i}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <Input
                              aria-label={`Nombre del impuesto ${i + 1}`}
                              value={impuesto.nombre}
                              onChange={(e) =>
                                editarImpuesto(i, { nombre: e.target.value })
                              }
                              maxLength={40}
                              placeholder="IVA"
                              className="min-w-24 flex-1"
                            />
                            <Input
                              aria-label={`Tasa del impuesto ${i + 1}`}
                              value={impuesto.tasa ?? ""}
                              onChange={(e) =>
                                editarImpuesto(i, {
                                  tasa: e.target.value || null,
                                })
                              }
                              maxLength={10}
                              placeholder="16%"
                              className="w-20"
                            />
                            <Input
                              aria-label={`Importe del impuesto ${i + 1}`}
                              inputMode="decimal"
                              value={impuesto.importe}
                              onChange={(e) =>
                                editarImpuesto(i, {
                                  importe: e.target.value,
                                })
                              }
                              placeholder="0.00"
                              className="w-24"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Quitar el impuesto ${i + 1}`}
                              onClick={() => quitarImpuesto(i)}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <XIcon aria-hidden="true" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={agregarImpuesto}
                        disabled={
                          ocupado || form.impuestos.length >= MAX_IMPUESTOS
                        }
                      >
                        <PlusIcon data-icon="inline-start" />
                        Agregar impuesto
                      </Button>
                    </span>
                  </section>

                  <section className="flex flex-col gap-3" aria-label="Totales">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Totales
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ["subtotal", "Subtotal"],
                          ["descuentos", "Descuentos"],
                          ["propina", "Propina"],
                          ["total", "Total"],
                        ] as const
                      ).map(([clave, etiqueta]) => (
                        <div key={clave} className="flex flex-col gap-1.5">
                          <Label htmlFor={campo(clave)}>{etiqueta}</Label>
                          <Input
                            id={campo(clave)}
                            inputMode="decimal"
                            value={form[clave] ?? ""}
                            onChange={(e) =>
                              editarForm({ [clave]: e.target.value || null })
                            }
                            placeholder="0.00"
                            className={cn(clave === "total" && "font-medium tabular-nums")}
                          />
                        </div>
                      ))}
                    </div>
                  </section>

                  <section
                    className="flex flex-wrap items-center gap-2"
                    aria-label="Acciones del ticket"
                  >
                    <Button
                      variant="outline"
                      onClick={() => void enviarPatch(false)}
                      disabled={ocupado || sinCambios}
                    >
                      {guardandoCambios ? (
                        <>
                          <Spinner className="size-3.5" />
                          Guardando…
                        </>
                      ) : (
                        "Guardar cambios"
                      )}
                    </Button>
                    {seleccion.estado !== "confirmado" ? (
                      <Button
                        className="ml-auto"
                        onClick={() => void enviarPatch(true)}
                        disabled={ocupado || !puedeConfirmar}
                      >
                        {confirmando ? (
                          <>
                            <Spinner className="size-3.5" />
                            Confirmando…
                          </>
                        ) : (
                          "Confirmar ticket"
                        )}
                      </Button>
                    ) : (
                      <p className="ml-auto text-xs text-muted-foreground">
                        Confirmado el{" "}
                        {new Date(seleccion.updatedAt).toLocaleString("es-MX")}
                      </p>
                    )}
                  </section>

                  {seleccion.estado !== "confirmado" && faltantesForm.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      Falta por confirmar:
                      {faltantesForm.map((nombre) => (
                        <Badge key={nombre} variant="outline" size="sm">
                          {nombre}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <Accordion>
                    <AccordionItem>
                      <AccordionTrigger>Datos guardados (JSON)</AccordionTrigger>
                      <AccordionContent>
                        <pre
                          tabIndex={0}
                          className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"
                        >
                          {JSON.stringify(
                            {
                              datos: seleccion.datos,
                              advertencias: seleccion.advertencias,
                              extraccion: seleccion.extraccion,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              ) : null}
            </section>
          ) : null}

          {/* ---------------------------- Historial -------------------------- */}
          <section className="flex flex-col gap-2" aria-label="Historial de tickets">
            <h3 className="text-xs font-medium text-muted-foreground">
              Tus tickets
            </h3>
            {listaFallida && !lista ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription className="flex flex-col gap-2">
                  No se pudo cargar tu historial de tickets.
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshLista()}
                      disabled={cargandoLista}
                    >
                      Reintentar
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}

            {cargandoLista && !lista ? (
              <div className="flex flex-col gap-2" aria-hidden>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : null}

            {lista && lista.items.length === 0 && seleccion === null ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ReceiptTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>Aún no hay tickets</EmptyTitle>
                  <EmptyDescription>
                    Toma una foto del ticket o elige un archivo para empezar.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}

            {lista && lista.items.length > 0 ? (
              <>
                <ul className="flex flex-col">
                  {lista.items.map((ticket) => {
                    const resumenFila = resumenTicket(ticket.datos)
                    const activo = seleccion?.entityId === ticket.entityId
                    return (
                      <li key={ticket.entityId}>
                        <button
                          type="button"
                          onClick={() => void cargarTicket(ticket.entityId)}
                          disabled={ocupado}
                          aria-current={activo ? "true" : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                            activo && "bg-muted"
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${ticket.imagenUrl}?variant=thumb`}
                            alt=""
                            loading="lazy"
                            className="size-10 shrink-0 rounded-md border border-border object-cover"
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium">
                              {resumenFila.titulo}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {resumenFila.detalle}
                            </span>
                          </span>
                          {ticket.scanEstado === "failed" &&
                          ticket.estado === "borrador" ? (
                            <Badge variant="destructive-light" size="sm">
                              Error de lectura
                            </Badge>
                          ) : (
                            <BadgeEstado estado={ticket.estado} />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {lista.items.length < lista.total ? (
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void cargarMas()}
                      disabled={cargandoMas || ocupado}
                    >
                      {cargandoMas ? (
                        <>
                          <Spinner className="size-3.5" />
                          Cargando…
                        </>
                      ) : (
                        "Cargar más"
                      )}
                    </Button>
                  </span>
                ) : null}
              </>
            ) : null}
          </section>
        </CardContent>
      </Card>

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Foto del ticket</DialogTitle>
            <DialogDescription>
              La foto original guardada con el ticket.
            </DialogDescription>
          </DialogHeader>
          {seleccion ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={seleccion.imagenUrl}
              alt="Foto del ticket ampliada"
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
