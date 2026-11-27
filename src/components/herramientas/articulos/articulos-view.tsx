"use client"

import * as React from "react"

import { toast } from "sonner"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import {
  useTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table"

import {
  ARTICULO_DESCRIPCION_MAX,
  IMPORT_MAX_BYTES,
  umEtiqueta,
  UM_OPCIONES,
  UM_OTRO,
  validarArticuloInput,
  type Articulo,
  type InformeImportacion,
  type ValidacionArticulo,
} from "@/lib/articulos"
import {
  Alert,
  AlertDescription,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/reui/autocomplete"
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header"
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
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
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { formatBytes, useFileUpload } from "@/hooks/use-file-upload"
import { useRealtimeEvent } from "@/hooks/use-realtime"

/*
 * Vista del módulo «Alta de Artículos/Servicios»: catálogo COMPARTIDO por
 * todo el negocio (propietario y sucursales ven y editan lo mismo; RLS).
 * El servidor es la fuente de verdad: paginación, orden y búsqueda son de
 * servidor; cada edición exige la `version` conocida y un 409 ofrece
 * recargar la fila vigente en lugar de pisar cambios ajenos. La importación
 * CSV es de dos pasos sobre el MISMO archivo — vista previa con errores por
 * fila y conteo exacto, y «aplicar» que re-valida en el servidor y escribe
 * todo o nada.
 */

type Aviso = { texto: string } | null

type FiltroEstado = "active" | "archived" | "all"

type AccionFila = { articulo: Articulo; accion: "archivar" | "restaurar" }

interface Borrador {
  sku: string
  nombre: string
  descripcion: string
  umElegido: string
  umOtro: string
  precio: string
  categoria: string
  disponible: boolean
}

const BORRADOR_NUEVO: Borrador = {
  sku: "",
  nombre: "",
  descripcion: "",
  umElegido: "pieza",
  umOtro: "",
  precio: "",
  categoria: "",
  disponible: true,
}

async function leerRespuesta(response: Response) {
  try {
    return (await response.json()) as {
      ok?: boolean
      data?: unknown
      total?: number
      error?: { code?: string; message?: string; details?: unknown }
    }
  } catch {
    return null
  }
}

/**
 * Fecha corta determinista (misma en servidor y cliente): CDMX fija. Los
 * formateadores viven a nivel de módulo — construir un Intl por fila y
 * render es caro en móvil.
 */
const montoFmt = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
})

const fechaFmt = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Mexico_City",
})

function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? "—" : fechaFmt.format(fecha)
}

function borradorDe(articulo: Articulo): Borrador {
  const esCodigoFijo = UM_OPCIONES.some(
    (opcion) => opcion.code === articulo.um
  )
  return {
    sku: articulo.sku,
    nombre: articulo.nombre,
    descripcion: articulo.descripcion,
    umElegido: esCodigoFijo ? articulo.um : UM_OTRO,
    umOtro: esCodigoFijo ? "" : articulo.um,
    precio: articulo.precioUnitario.toFixed(2),
    categoria: articulo.categoria ?? "",
    disponible: articulo.disponible,
  }
}

function borradorIgual(a: Borrador, b: Borrador): boolean {
  return (
    a.sku === b.sku &&
    a.nombre === b.nombre &&
    a.descripcion === b.descripcion &&
    a.umElegido === b.umElegido &&
    a.umOtro === b.umOtro &&
    a.precio === b.precio &&
    a.categoria === b.categoria &&
    a.disponible === b.disponible
  )
}

/** Borrador → entrada cruda para el validador compartido con el servidor. */
function entradaDeBorrador(borrador: Borrador): Record<string, unknown> {
  return {
    sku: borrador.sku,
    nombre: borrador.nombre,
    descripcion: borrador.descripcion,
    um: borrador.umElegido === UM_OTRO ? borrador.umOtro : borrador.umElegido,
    precioUnitario: borrador.precio,
    categoria: borrador.categoria,
    disponible: borrador.disponible,
  }
}

export function ArticulosView({
  inicial,
  categoriasIniciales,
  cargaFallida: cargaFallidaInicial,
}: {
  /** Primer listado servido por la RSC; null si el primer fetch falló. */
  inicial: { articulos: Articulo[]; total: number } | null
  /** Categorías ya usadas, para las sugerencias del formulario. */
  categoriasIniciales: string[]
  /** El primer fetch server-side falló: la vista ofrece reintentar. */
  cargaFallida: boolean
}) {
  const [filas, setFilas] = React.useState<Articulo[] | null>(
    inicial?.articulos ?? null
  )
  const [total, setTotal] = React.useState(inicial?.total ?? 0)
  const [cargando, setCargando] = React.useState(false)
  const [cargaFallida, setCargaFallida] = React.useState(cargaFallidaInicial)
  const [aviso, setAviso] = React.useState<Aviso>(null)
  const [categorias, setCategorias] = React.useState(categoriasIniciales)

  // Filtros y consulta de servidor.
  const [busqueda, setBusqueda] = React.useState("")
  const [terminoAplicado, setTerminoAplicado] = React.useState("")
  const [estadoFiltro, setEstadoFiltro] = React.useState<FiltroEstado>("active")
  const [categoriaFiltro, setCategoriaFiltro] = React.useState("")
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "updatedAt", desc: true },
  ])

  // Editor (sheet).
  const [editor, setEditor] = React.useState<
    { modo: "nueva" } | { modo: "editar"; id: string } | null
  >(null)
  const [borrador, setBorrador] = React.useState<Borrador>(BORRADOR_NUEVO)
  const [articuloAbierto, setArticuloAbierto] = React.useState<Articulo | null>(
    null
  )
  const [cargandoArticulo, setCargandoArticulo] = React.useState(false)
  const [guardando, setGuardando] = React.useState(false)
  const [erroresCampo, setErroresCampo] = React.useState<
    Record<string, string>
  >({})
  const [avisoEditor, setAvisoEditor] = React.useState<Aviso>(null)
  const [conflicto, setConflicto] = React.useState(false)

  // Archivar/restaurar.
  const [pendienteAccion, setPendienteAccion] = React.useState<AccionFila | null>(
    null
  )
  const [aplicandoAccion, setAplicandoAccion] = React.useState(false)

  // Importación (sheet de dos pasos).
  const [importacionAbierta, setImportacionAbierta] = React.useState(false)
  const [archivoCsv, setArchivoCsv] = React.useState<File | null>(null)
  const [informe, setInforme] = React.useState<InformeImportacion | null>(null)
  const [importando, setImportando] = React.useState<"no" | "preview" | "aplicar">(
    "no"
  )
  const [errorImportacion, setErrorImportacion] = React.useState<string | null>(
    null
  )

  // Guardias de secuencia: una respuesta tardía jamás pinta una consulta vieja.
  const cargaSeqRef = React.useRef(0)
  const datosListosRef = React.useRef(inicial !== null)
  const skipPrimeraCarga = React.useRef(true)

  const load = React.useCallback(async () => {
    const seq = ++cargaSeqRef.current
    setCargando(true)
    try {
      const params = new URLSearchParams()
      if (terminoAplicado) params.set("q", terminoAplicado)
      params.set("status", estadoFiltro)
      if (categoriaFiltro) params.set("categoria", categoriaFiltro)
      params.set("page", String(pagination.pageIndex + 1))
      params.set("pageSize", String(pagination.pageSize))
      const orden = sorting[0]
      if (orden) {
        params.set("sort", orden.id)
        params.set("dir", orden.desc ? "desc" : "asc")
      }
      const response = await fetch(`/api/articulos?${params.toString()}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (seq !== cargaSeqRef.current) return
      if (!response.ok || !body?.ok || typeof body.total !== "number") {
        throw new Error("load_error")
      }
      setFilas(body.data as Articulo[])
      setTotal(body.total)
      setCargaFallida(false)
      setAviso(null)
      datosListosRef.current = true
    } catch {
      if (seq !== cargaSeqRef.current) return
      if (!datosListosRef.current) {
        setCargaFallida(true)
      } else {
        setAviso({
          texto: "No se pudo refrescar el catálogo. Revisa tu conexión.",
        })
      }
    } finally {
      if (seq === cargaSeqRef.current) setCargando(false)
    }
  }, [terminoAplicado, estadoFiltro, categoriaFiltro, pagination, sorting])

  // Búsqueda con debounce (el timer mantiene el setState fuera del cuerpo
  // sincrónico del efecto: regla react-hooks/set-state-in-effect). Al aplicar
  // un término nuevo la página vuelve a 1: sin esto, buscar desde la página
  // 2+ pedía una página que ya no existe y mostraba un vacío falso con
  // total 0 (el total viaja en la primera fila devuelta).
  const terminoAplicadoRef = React.useRef("")
  React.useEffect(() => {
    const trimmed = busqueda.trim()
    const timer = setTimeout(() => {
      if (terminoAplicadoRef.current === trimmed) return
      terminoAplicadoRef.current = trimmed
      setTerminoAplicado(trimmed)
      setPagination((prev) =>
        prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }
      )
    }, 300)
    return () => clearTimeout(timer)
  }, [busqueda])

  // Recarga al cambiar filtros/página/orden. El primer render ya trae datos
  // del servidor: no volver a pedirlos.
  React.useEffect(() => {
    if (skipPrimeraCarga.current) {
      skipPrimeraCarga.current = false
      return
    }
    void load()
  }, [load])

  // Tiempo real: otra pestaña o dispositivo mutó el catálogo compartido.
  const loadRef = React.useRef(load)
  React.useEffect(() => {
    loadRef.current = load
  }, [load])
  const alEventoRealtime = React.useCallback(() => {
    void loadRef.current()
  }, [])
  useRealtimeEvent(["articulos"], alEventoRealtime)

  // Sugerencias/filtro de categorías siguiendo el ESTADO que se está viendo:
  // en «Archivados» una categoría cuyos artículos están todos archivados
  // seguiría filtrando (el flujo de restauración la necesita).
  const recargarCategorias = React.useCallback(async () => {
    try {
      const response = await fetch(
        `/api/articulos/categorias?estado=${estadoFiltro}`,
        { cache: "no-store" }
      )
      const body = await leerRespuesta(response)
      if (response.ok && body?.ok) setCategorias(body.data as string[])
    } catch {
      // Las sugerencias viejas siguen siendo útiles.
    }
  }, [estadoFiltro])

  const skipCategorias = React.useRef(true)
  React.useEffect(() => {
    if (skipCategorias.current) {
      skipCategorias.current = false
      return
    }
    void recargarCategorias()
  }, [recargarCategorias])

  const resetPagina = React.useCallback(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  /* ------------------------------ editor ------------------------------ */

  const abrirNueva = React.useCallback(() => {
    setErroresCampo({})
    setAvisoEditor(null)
    setConflicto(false)
    setArticuloAbierto(null)
    setBorrador(BORRADOR_NUEVO)
    setEditor({ modo: "nueva" })
  }, [])

  const abrirEdicion = React.useCallback(async (articulo: Articulo) => {
    setErroresCampo({})
    setAvisoEditor(null)
    setConflicto(false)
    setBorrador(borradorDe(articulo))
    setEditor({ modo: "editar", id: articulo.id })
    setCargandoArticulo(true)
    try {
      const response = await fetch(`/api/articulos/${articulo.id}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "load_error")
      }
      const completa = body.data as Articulo
      setArticuloAbierto(completa)
      setBorrador(borradorDe(completa))
    } catch {
      toast.error("No se pudo abrir el artículo. Intenta de nuevo.")
      setEditor(null)
    } finally {
      setCargandoArticulo(false)
    }
  }, [])

  const cerrarEditor = React.useCallback(() => {
    if (guardando || cargandoArticulo) return
    setEditor(null)
    setArticuloAbierto(null)
    setErroresCampo({})
    setAvisoEditor(null)
    setConflicto(false)
  }, [guardando, cargandoArticulo])

  const esNueva = editor?.modo === "nueva"
  const sinCambios =
    !esNueva &&
    articuloAbierto !== null &&
    borradorIgual(borrador, borradorDe(articuloAbierto))
  const puedeGuardar =
    !guardando &&
    !cargandoArticulo &&
    (esNueva || articuloAbierto !== null) &&
    !sinCambios

  const guardar = React.useCallback(async () => {
    if (!editor || !puedeGuardar) return
    const validacion: ValidacionArticulo = validarArticuloInput(
      entradaDeBorrador(borrador)
    )
    if (!validacion.ok) {
      const errores: Record<string, string> = {}
      if (validacion.campo) errores[validacion.campo] = validacion.error
      else setAvisoEditor({ texto: validacion.error })
      setErroresCampo(errores)
      return
    }
    setErroresCampo({})
    setAvisoEditor(null)
    setGuardando(true)
    try {
      const esAlta = editor.modo === "nueva"
      const response = await fetch(
        esAlta ? "/api/articulos" : `/api/articulos/${editor.id}`,
        {
          method: esAlta ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...validacion.articulo,
            ...(esAlta ? {} : { version: articuloAbierto?.version }),
          }),
        }
      )
      const body = await leerRespuesta(response)
      if (response.status === 409) {
        setConflicto(true)
        setAvisoEditor({
          texto:
            body?.error?.message ??
            "El artículo cambió en otro dispositivo o pestaña.",
        })
        return
      }
      if (!response.ok || !body?.ok) {
        setAvisoEditor({
          texto:
            body?.error?.message ??
            "No se pudo guardar el artículo. Intenta de nuevo.",
        })
        return
      }
      toast.success(esAlta ? "Artículo creado" : "Artículo guardado")
      setEditor(null)
      setArticuloAbierto(null)
      void load()
      void recargarCategorias()
    } catch {
      setAvisoEditor({
        texto:
          "No se pudo guardar el artículo. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setGuardando(false)
    }
  }, [
    editor,
    puedeGuardar,
    borrador,
    articuloAbierto,
    load,
    recargarCategorias,
  ])

  /** Trae la versión vigente al borrador (conflicto 409): nadie pierde nada. */
  const recargarArticuloAbierto = React.useCallback(async () => {
    if (!editor || editor.modo !== "editar") return
    setCargandoArticulo(true)
    try {
      const response = await fetch(`/api/articulos/${editor.id}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "load_error")
      }
      const completa = body.data as Articulo
      setArticuloAbierto(completa)
      setBorrador(borradorDe(completa))
      setConflicto(false)
      setErroresCampo({})
      setAvisoEditor(null)
    } catch {
      toast.error("No se pudo recargar el artículo. Intenta de nuevo.")
    } finally {
      setCargandoArticulo(false)
    }
  }, [editor])

  /* --------------------------- archivar/restaurar --------------------------- */

  const confirmarAccion = React.useCallback(async () => {
    if (!pendienteAccion || aplicandoAccion) return
    setAplicandoAccion(true)
    const { articulo, accion } = pendienteAccion
    try {
      const response = await fetch(`/api/articulos/${articulo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: articulo.sku,
          nombre: articulo.nombre,
          descripcion: articulo.descripcion,
          um: articulo.um,
          precioUnitario: articulo.precioUnitario,
          categoria: articulo.categoria,
          disponible: articulo.disponible,
          version: articulo.version,
          status: accion === "archivar" ? "archived" : "active",
        }),
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error?.code ?? "patch_error")
      }
      toast.success(
        accion === "archivar"
          ? "Artículo archivado"
          : "Artículo restaurado"
      )
      setPendienteAccion(null)
      void load()
    } catch {
      toast.error("No se pudo actualizar el artículo. Intenta de nuevo.")
      void load()
    } finally {
      setAplicandoAccion(false)
    }
  }, [pendienteAccion, aplicandoAccion, load])

  /* ------------------------------- importación ------------------------------ */

  const ejecutarPreview = React.useCallback(async (archivo: File) => {
    setImportando("preview")
    setErrorImportacion(null)
    setInforme(null)
    try {
      const form = new FormData()
      form.set("modo", "preview")
      form.set("archivo", archivo)
      const response = await fetch("/api/articulos/importar", {
        method: "POST",
        body: form,
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        setErrorImportacion(
          body?.error?.message ??
            "No se pudo analizar el archivo. Intenta de nuevo."
        )
        return
      }
      setInforme((body.data as { informe: InformeImportacion }).informe)
    } catch {
      setErrorImportacion(
        "No se pudo analizar el archivo. Revisa tu conexión e intenta de nuevo."
      )
    } finally {
      setImportando("no")
    }
  }, [])

  const alCambiarArchivos = React.useCallback(
    (files: { file: File | { name: string } }[]) => {
      const primero = files[0]?.file
      if (!(primero instanceof File)) {
        setArchivoCsv(null)
        setInforme(null)
        return
      }
      if (primero.size > IMPORT_MAX_BYTES) {
        setArchivoCsv(null)
        setInforme(null)
        setErrorImportacion(
          `El archivo supera el máximo de ${formatBytes(
            IMPORT_MAX_BYTES
          )}. Divídelo en varios archivos.`
        )
        return
      }
      setErrorImportacion(null)
      setInforme(null)
      setArchivoCsv(primero)
      // Archivo elegido → vista previa automática (el servidor valida TODO):
      // desde el handler del usuario, no desde un efecto.
      void ejecutarPreview(primero)
    },
    [ejecutarPreview]
  )

  const [, uploadActions] = useFileUpload({
    accept: ".csv,text/csv",
    multiple: false,
    onFilesChange: alCambiarArchivos,
  })

  const cerrarImportacion = React.useCallback(() => {
    if (importando !== "no") return
    setImportacionAbierta(false)
    setArchivoCsv(null)
    setInforme(null)
    setErrorImportacion(null)
    uploadActions.clearFiles()
  }, [importando, uploadActions])

  const aplicarImportacion = React.useCallback(async () => {
    if (
      !archivoCsv ||
      !informe ||
      informe.errores > 0 ||
      importando !== "no"
    ) {
      return
    }
    setImportando("aplicar")
    setErrorImportacion(null)
    try {
      const form = new FormData()
      form.set("modo", "aplicar")
      form.set("archivo", archivoCsv)
      const response = await fetch("/api/articulos/importar", {
        method: "POST",
        body: form,
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        const detalles = body?.error?.details as
          | { informe?: InformeImportacion }
          | undefined
        if (detalles?.informe) setInforme(detalles.informe)
        setErrorImportacion(
          body?.error?.message ??
            "No se pudo aplicar la importación. Intenta de nuevo."
        )
        return
      }
      const resultado = (body.data as { informe: InformeImportacion }).informe
      toast.success(
        `Importación aplicada: ${resultado.nuevos.toLocaleString(
          "es-MX"
        )} nuevos, ${resultado.actualizados.toLocaleString(
          "es-MX"
        )} actualizados.`
      )
      setImportacionAbierta(false)
      setArchivoCsv(null)
      setInforme(null)
      uploadActions.clearFiles()
      void load()
      void recargarCategorias()
    } catch {
      setErrorImportacion(
        "No se pudo aplicar la importación. Revisa tu conexión e intenta de nuevo."
      )
    } finally {
      setImportando("no")
    }
  }, [
    archivoCsv,
    informe,
    importando,
    load,
    recargarCategorias,
    uploadActions,
  ])

  /* --------------------------------- tabla --------------------------------- */

  const abrirEdicionRef = React.useRef(abrirEdicion)
  React.useEffect(() => {
    abrirEdicionRef.current = abrirEdicion
  }, [abrirEdicion])

  const pedirAccion = React.useCallback(
    (articulo: Articulo, accion: "archivar" | "restaurar") => {
      setPendienteAccion({ articulo, accion })
    },
    []
  )

  const columns = React.useMemo<ColumnDef<DataGridFeatures, Articulo>[]>(
    () => [
      {
        accessorKey: "sku",
        id: "sku",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="SKU" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground font-mono text-xs font-medium tracking-wider">
            {row.original.sku}
          </span>
        ),
        size: 130,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        accessorKey: "nombre",
        id: "nombre",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Nombre" />
        ),
        cell: ({ row }) => (
          <div
            className="flex min-w-0 flex-col"
            title={row.original.descripcion || undefined}
          >
            <span className="text-foreground truncate text-sm font-medium">
              {row.original.nombre}
            </span>
            {row.original.descripcion ? (
              <span className="text-muted-foreground line-clamp-1 text-xs">
                {row.original.descripcion}
              </span>
            ) : null}
          </div>
        ),
        size: 260,
        meta: { skeleton: <Skeleton className="h-4 w-32" /> },
      },
      {
        accessorKey: "um",
        id: "um",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="U.M." />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {umEtiqueta(row.original.um)}
          </span>
        ),
        size: 100,
        meta: { skeleton: <Skeleton className="h-4 w-12" /> },
      },
      {
        accessorKey: "precioUnitario",
        id: "precioUnitario",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="P.U." />
        ),
        cell: ({ row }) => (
          <span className="text-foreground text-sm font-medium tabular-nums">
            {montoFmt.format(row.original.precioUnitario)}
          </span>
        ),
        size: 130,
        meta: { skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        accessorKey: "categoria",
        id: "categoria",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Categoría" />
        ),
        cell: ({ row }) =>
          row.original.categoria ? (
            <Badge size="xs" radius="full" variant="outline">
              {row.original.categoria}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
        size: 150,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        accessorKey: "disponible",
        id: "disponible",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) =>
          row.original.status === "archived" ? (
            <Badge size="xs" radius="full" variant="outline">
              Archivado
            </Badge>
          ) : row.original.disponible ? (
            <Badge size="xs" radius="full" variant="success-light">
              Disponible
            </Badge>
          ) : (
            <Badge size="xs" radius="full" variant="secondary">
              No disponible
            </Badge>
          ),
        size: 130,
        meta: { skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        accessorKey: "updatedAt",
        id: "updatedAt",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Actualizado" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {fechaCorta(row.original.updatedAt)}
          </span>
        ),
        size: 130,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const articulo = row.original
          const archivado = articulo.status === "archived"
          return (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative after:absolute after:content-[''] after:-inset-2"
                onClick={() => void abrirEdicionRef.current(articulo)}
                aria-label={`Editar ${articulo.nombre}`}
                title="Editar"
              >
                <PencilIcon className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={
                  archivado
                    ? "relative after:absolute after:content-[''] after:-inset-2 text-primary"
                    : "relative after:absolute after:content-[''] after:-inset-2 text-muted-foreground hover:text-foreground"
                }
                onClick={() =>
                  pedirAccion(articulo, archivado ? "restaurar" : "archivar")
                }
                aria-label={
                  archivado
                    ? `Restaurar ${articulo.nombre}`
                    : `Archivar ${articulo.nombre}`
                }
                title={archivado ? "Restaurar" : "Archivar"}
              >
                {archivado ? (
                  <ArchiveRestoreIcon className="size-4" aria-hidden="true" />
                ) : (
                  <ArchiveIcon className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          )
        },
        size: 100,
      },
    ],
    [pedirAccion]
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filas ?? [],
    getRowId: (row: Articulo) => row.id,
    manualPagination: true,
    manualSorting: true,
    autoResetPageIndex: false,
    rowCount: total,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater)
      resetPagina()
    },
    onPaginationChange: setPagination,
  })

  const itemsCategoria = React.useMemo(
    () => categorias.map((categoria) => ({ value: categoria })),
    [categorias]
  )

  const errorDeCampo = (campo: string): string | null =>
    erroresCampo[campo] ?? null

  const conFiltros =
    terminoAplicado !== "" ||
    estadoFiltro !== "active" ||
    categoriaFiltro !== ""

  const mensajeVacio = cargaFallida ? (
    <div className="flex flex-col items-center gap-2 py-2">
      <p className="text-muted-foreground text-sm">
        No se pudieron cargar los artículos.
      </p>
      <Button variant="outline" size="sm" onClick={() => void load()}>
        Reintentar
      </Button>
    </div>
  ) : filas !== null && total === 0 && conFiltros ? (
    "Sin artículos que coincidan con los filtros."
  ) : filas !== null && total === 0 ? (
    "Sin artículos en esta vista. Crea el primero con «Nuevo artículo» o importa tu catálogo por CSV."
  ) : (
    "Sin artículos que coincidan con los filtros."
  )

  return (
    <Frame spacing="default" className="w-full">
      <FrameHeader>
        <FrameTitle className="text-xl font-semibold">
          Alta de Artículos/Servicios
        </FrameTitle>
        <FrameDescription>
          Catálogo de productos y servicios del negocio: SKU, unidad de
          medida, precio unitario, categoría y disponibilidad. Es compartido:
          propietario y sucursales ven y editan lo mismo.
        </FrameDescription>
      </FrameHeader>

      <FramePanel>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-44 flex-1 sm:max-w-xs">
            <InputGroupAddon align="inline-start">
              <SearchIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Buscar artículos"
              placeholder="Buscar por SKU, nombre o categoría…"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
            />
          </InputGroup>
          <Select
            value={estadoFiltro}
            onValueChange={(value) => {
              setEstadoFiltro((value ?? "active") as FiltroEstado)
              resetPagina()
            }}
          >
            <SelectTrigger className="w-32" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activos</SelectItem>
              <SelectItem value="archived">Archivados</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          {categorias.length > 0 ? (
            <Select
              value={categoriaFiltro}
              onValueChange={(value) => {
                setCategoriaFiltro(value ?? "")
                resetPagina()
              }}
            >
              <SelectTrigger
                className="w-44"
                aria-label="Filtrar por categoría"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas las categorías</SelectItem>
                {categorias.map((categoria) => (
                  <SelectItem key={categoria} value={categoria}>
                    {categoria}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href="/api/articulos/plantilla"
                  download="plantilla-articulos.csv"
                />
              }
            >
              <DownloadIcon aria-hidden="true" />
              Plantilla CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setErrorImportacion(null)
              setInforme(null)
              setArchivoCsv(null)
              uploadActions.clearFiles()
              setImportacionAbierta(true)
            }}>
              <UploadIcon aria-hidden="true" />
              Importar CSV
            </Button>
            <Button size="sm" onClick={abrirNueva}>
              <PlusIcon aria-hidden="true" />
              Nuevo artículo
            </Button>
          </div>
        </div>
        {aviso ? (
          <Alert variant="destructive" className="mt-3">
            <TriangleAlertIcon />
            <AlertDescription>{aviso.texto}</AlertDescription>
          </Alert>
        ) : null}
      </FramePanel>

      <FramePanel className="p-0">
        <DataGrid
          table={table}
          recordCount={total}
          isLoading={cargando && filas === null}
          tableLayout={{ dense: true }}
          emptyMessage={mensajeVacio}
        >
          <DataGridContainer>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
          <div className="px-4 pb-3">
            <DataGridPagination />
          </div>
        </DataGrid>
      </FramePanel>

      {/* ------------------------------ editor ------------------------------ */}
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
              {esNueva ? "Nuevo artículo" : "Editar artículo"}
            </SheetTitle>
            <SheetDescription>
              El SKU es el identificador único del artículo en tu catálogo:
              no puede repetirse, aunque esté archivado.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            {cargandoArticulo && articuloAbierto === null && !esNueva ? (
              <div className="flex flex-col gap-3" aria-hidden>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Input
                    aria-label="SKU del artículo"
                    placeholder="SKU (identificador único)"
                    value={borrador.sku}
                    maxLength={40}
                    onChange={(event) =>
                      setBorrador((prev) => ({
                        ...prev,
                        sku: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                  {errorDeCampo("sku") ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errorDeCampo("sku")}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Input
                    aria-label="Nombre del artículo"
                    placeholder="Nombre del producto o servicio"
                    value={borrador.nombre}
                    maxLength={120}
                    onChange={(event) =>
                      setBorrador((prev) => ({
                        ...prev,
                        nombre: event.target.value,
                      }))
                    }
                  />
                  {errorDeCampo("nombre") ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errorDeCampo("nombre")}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <InputGroup>
                    <InputGroupTextarea
                      aria-label="Descripción del artículo"
                      value={borrador.descripcion}
                      onChange={(event) =>
                        setBorrador((prev) => ({
                          ...prev,
                          descripcion: event.target.value,
                        }))
                      }
                      maxLength={ARTICULO_DESCRIPCION_MAX}
                      rows={3}
                      placeholder="Descripción (opcional)"
                    />
                  </InputGroup>
                  <p className="text-right text-xs tabular-nums text-muted-foreground">
                    {borrador.descripcion.length.toLocaleString("es-MX")} /{" "}
                    {ARTICULO_DESCRIPCION_MAX.toLocaleString("es-MX")}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <Select
                      value={borrador.umElegido}
                      onValueChange={(value) => {
                        setBorrador((prev) => ({
                          ...prev,
                          umElegido: value ?? "pieza",
                        }))
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label="Unidad de medida"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UM_OPCIONES.map((opcion) => (
                          <SelectItem key={opcion.code} value={opcion.code}>
                            {opcion.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={UM_OTRO}>Otro…</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label="Precio unitario en pesos"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={borrador.precio}
                      onChange={(event) =>
                        setBorrador((prev) => ({
                          ...prev,
                          precio: event.target.value,
                        }))
                      }
                      className="w-32"
                    />
                  </div>
                  {borrador.umElegido === UM_OTRO ? (
                    <Input
                      aria-label="Unidad de medida personalizada"
                      placeholder="Escribe la unidad (p. ej. Metro cuadrado)"
                      value={borrador.umOtro}
                      maxLength={30}
                      onChange={(event) =>
                        setBorrador((prev) => ({
                          ...prev,
                          umOtro: event.target.value,
                        }))
                      }
                    />
                  ) : null}
                  {errorDeCampo("um") ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errorDeCampo("um")}
                    </p>
                  ) : null}
                  {errorDeCampo("precioUnitario") ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errorDeCampo("precioUnitario")}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Autocomplete
                    items={itemsCategoria}
                    value={borrador.categoria}
                    onValueChange={(value) =>
                      setBorrador((prev) => ({
                        ...prev,
                        categoria: value ?? "",
                      }))
                    }
                    autoHighlight="always"
                    itemToStringValue={(item) => item.value}
                  >
                    <AutocompleteInput
                      aria-label="Categoría del artículo"
                      placeholder="Categoría (opcional)"
                      showTrigger
                    />
                    <AutocompleteContent>
                      <AutocompleteEmpty>
                        Sin sugerencias: escribe la categoría libremente.
                      </AutocompleteEmpty>
                      <AutocompleteList>
                        {(item) => (
                          <AutocompleteItem
                            key={item.value}
                            value={item}
                            className="min-h-11"
                          >
                            {item.value}
                          </AutocompleteItem>
                        )}
                      </AutocompleteList>
                    </AutocompleteContent>
                  </Autocomplete>
                  {errorDeCampo("categoria") ? (
                    <p role="alert" className="text-destructive text-xs">
                      {errorDeCampo("categoria")}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">Disponible para vender</span>
                  <Switch
                    checked={borrador.disponible}
                    onCheckedChange={(checked) =>
                      setBorrador((prev) => ({
                        ...prev,
                        disponible: checked === true,
                      }))
                    }
                    aria-label="Disponible para vender"
                  />
                </div>

                {avisoEditor ? (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertDescription>
                      {avisoEditor.texto}
                      {conflicto ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => void recargarArticuloAbierto()}
                          disabled={cargandoArticulo}
                        >
                          {cargandoArticulo ? (
                            <>
                              <Spinner className="size-3.5" />
                              Recargando…
                            </>
                          ) : (
                            "Recargar el artículo actual"
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
                    disabled={guardando || cargandoArticulo}
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

      {/* ---------------------------- importación ---------------------------- */}
      <Sheet
        open={importacionAbierta}
        onOpenChange={(open) => {
          if (!open) cerrarImportacion()
        }}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg gap-0 rounded-t-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>Importar artículos (CSV)</SheetTitle>
            <SheetDescription>
              Descarga la plantilla, llena tus artículos y sube el archivo.
              Los SKU que ya existen se actualizan con los datos del archivo
              y quedan activos; los nuevos se agregan. Nada se borra ni se
              archiva. La importación es todo o nada: si hay errores no se
              escribe nada.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            <input
              {...uploadActions.getInputProps()}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            {archivoCsv ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  {archivoCsv.name}{" "}
                  <span className="text-muted-foreground text-xs">
                    ({formatBytes(archivoCsv.size)})
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative after:absolute after:content-[''] after:-inset-2"
                  onClick={() => {
                    setArchivoCsv(null)
                    setInforme(null)
                    setErrorImportacion(null)
                    uploadActions.clearFiles()
                  }}
                  aria-label="Quitar el archivo"
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={uploadActions.openFileDialog}
                disabled={importando !== "no"}
              >
                <UploadIcon aria-hidden="true" />
                Elegir archivo CSV
              </Button>
            )}

            {importando === "preview" ? (
              <p
                role="status"
                className="text-muted-foreground flex items-center gap-2 text-sm"
              >
                <Spinner className="size-3.5" />
                Analizando el archivo…
              </p>
            ) : null}

            {informe ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">
                      Renglones
                    </span>
                    <span className="text-base font-medium tabular-nums">
                      {informe.total}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">
                      Nuevos
                    </span>
                    <span className="text-base font-medium tabular-nums">
                      {informe.nuevos}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">
                      Actualizados
                    </span>
                    <span className="text-base font-medium tabular-nums">
                      {informe.actualizados}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">
                      Errores
                    </span>
                    <span
                      className={
                        informe.errores > 0
                          ? "text-destructive text-base font-medium tabular-nums"
                          : "text-base font-medium tabular-nums"
                      }
                    >
                      {informe.errores}
                    </span>
                  </div>
                </div>
                {informe.errores > 0 ? (
                  <div className="max-h-48 overflow-y-auto rounded-lg border">
                    <ul className="flex flex-col divide-y">
                      {informe.filas.map((error, indice) => (
                        <li
                          key={`${error.fila}-${indice}`}
                          className="flex flex-col gap-0.5 px-3 py-2"
                        >
                          <span className="text-xs font-medium">
                            Renglón {error.fila}
                            {error.sku ? ` · ${error.sku}` : ""}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {error.motivo}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {errorImportacion ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>{errorImportacion}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="w-1/2"
                onClick={cerrarImportacion}
                disabled={importando !== "no"}
              >
                Cancelar
              </Button>
              <Button
                className="w-1/2"
                onClick={() => void aplicarImportacion()}
                disabled={
                  !archivoCsv ||
                  !informe ||
                  informe.errores > 0 ||
                  importando !== "no"
                }
              >
                {importando === "aplicar" ? (
                  <>
                    <Spinner className="size-3.5" />
                    Aplicando…
                  </>
                ) : (
                  "Aplicar importación"
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ------------------------- archivar/restaurar ------------------------- */}
      <AlertDialog
        open={pendienteAccion !== null}
        onOpenChange={(open) => {
          if (!open && !aplicandoAccion) setPendienteAccion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendienteAccion?.accion === "archivar"
                ? "¿Archivar este artículo?"
                : "¿Restaurar este artículo?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendienteAccion?.accion === "archivar"
                ? `«${pendienteAccion?.articulo.nombre}» (SKU ${pendienteAccion?.articulo.sku}) saldrá del listado de activos. No se borra: puedes restaurarlo desde el filtro «Archivados».`
                : `«${pendienteAccion?.articulo.nombre}» (SKU ${pendienteAccion?.articulo.sku}) volverá a verse en el catálogo activo.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicandoAccion}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant={
                pendienteAccion?.accion === "archivar"
                  ? "destructive"
                  : "default"
              }
              onClick={() => void confirmarAccion()}
              disabled={aplicandoAccion}
            >
              {aplicandoAccion ? (
                <>
                  <Spinner className="size-3.5" />
                  Aplicando…
                </>
              ) : pendienteAccion?.accion === "archivar" ? (
                "Sí, archivar"
              ) : (
                "Restaurar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  )
}
