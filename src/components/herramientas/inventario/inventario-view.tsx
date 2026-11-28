"use client"

import * as React from "react"
import type { ReactNode } from "react"

import { toast } from "sonner"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  HistoryIcon,
  InfoIcon,
  PackageOpenIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import {
  Alert,
  AlertDescription,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import {
  InventarioAccordion,
  agruparLotes,
  type ArticuloRef,
  type GrupoInventario,
} from "@/components/herramientas/inventario/inventario-accordion"
import { ARTICULOS_PAGE_SIZE_MAX, normalizarTexto, umEtiqueta, type Articulo } from "@/lib/articulos"
import {
  CONDICIONES,
  INVENTARIO_DIAS_POR_VENCER,
  condicionEtiqueta,
  formatearCantidad,
  formatearDelta,
  formatearFechaHora,
  kindEtiqueta,
  validarLoteInput,
  validarLoteMetaInput,
  validarMovimientoInput,
  type Condicion,
  type KindMovimiento,
  type LoteInventario,
  type MovimientoInventario,
  type ResumenInventario,
} from "@/lib/inventario"
import { useRealtimeEvent } from "@/hooks/use-realtime"

/*
 * Vista del módulo «Inventario»: existencias POR LOTES ligadas al catálogo,
 * COMPARTIDAS por todo el negocio (propietario y sucursales; RLS). El stock
 * NUNCA se edita a mano: solo cambia con movimientos de entrada/salida/ajuste
 * que el servidor registra en el kardex en la misma transacción. La edición
 * de metadatos del lote exige la `version` conocida (409 con la vigente).
 */

type Aviso = { texto: string } | null

type FiltroCondicionUI = "all" | Condicion
type FiltroCaducidadUI = "all" | "vencidos" | "por_vencer"

interface BorradorNuevo {
  articuloId: string
  lote: string
  caducidad: string
  condicion: Condicion
  ubicacion: string
  cantidad: string
}

interface BorradorMeta {
  lote: string
  caducidad: string
  condicion: Condicion
  ubicacion: string
}

const BORRADOR_NUEVO_VACIO: BorradorNuevo = {
  articuloId: "",
  lote: "",
  caducidad: "",
  condicion: "nuevo",
  ubicacion: "",
  cantidad: "",
}

type RespuestaInventario = {
  ok?: boolean
  data?: unknown
  total?: number
  resumen?: ResumenInventario
  error?: { code?: string; message?: string; details?: unknown }
} | null

async function leerRespuesta(response: Response): Promise<RespuestaInventario> {
  try {
    return (await response.json()) as NonNullable<RespuestaInventario>
  } catch {
    return null
  }
}

function InfoHint({
  label,
  titulo,
  children,
}: {
  label: string
  titulo: string
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="relative after:content-[''] after:absolute after:-inset-2 shrink-0"
          />
        }
      >
        <InfoIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="max-w-[16rem]">
        <PopoverHeader>
          <PopoverTitle>{titulo}</PopoverTitle>
          <PopoverDescription className="text-sm leading-snug">
            {children}
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}

function textoDeError(body: RespuestaInventario, fallback: string): string {
  return body?.error?.message ?? fallback
}

export function InventarioView({
  inicial,
  resumenInicial,
  cargaFallida: cargaFallidaInicial,
}: {
  /** Primer listado servido por la RSC; null si el primer fetch falló. */
  inicial: { lotes: LoteInventario[]; total: number } | null
  /** Resumen del encabezado servido por la RSC. */
  resumenInicial: ResumenInventario | null
  /** El primer fetch server-side falló: la vista ofrece reintentar. */
  cargaFallida: boolean
}) {
  // Snapshot del servidor: se ADOPTA en render cada vez que la RSC entrega
  // uno nuevo (patrón «adjust state when a prop changes», sin effects) —
  // así el refresh de realtime llega sin segunda descarga. Con filtros
  // activos se ignora (el snapshot es SIN filtrar) y manda el propio fetch.
  const [servidor, setServidor] = React.useState(inicial)
  const [lotes, setLotes] = React.useState<LoteInventario[] | null>(
    inicial?.lotes ?? null
  )
  const [total, setTotal] = React.useState(inicial?.total ?? 0)
  const [resumen, setResumen] = React.useState<ResumenInventario | null>(
    resumenInicial
  )
  const [cargaFallida, setCargaFallida] = React.useState(cargaFallidaInicial)
  const [aviso, setAviso] = React.useState<Aviso>(null)
  // Catálogo para el picker de «Nuevo lote»: bajo demanda (hasta 5 000
  // artículos NO viajan en props de la RSC en cada refresh). null = sin
  // cargar todavía; un evento realtime `articulos` lo invalida.
  const [catalogo, setCatalogo] = React.useState<Articulo[] | null>(null)

  // Filtros y consulta de servidor.
  const [busqueda, setBusqueda] = React.useState("")
  const [terminoAplicado, setTerminoAplicado] = React.useState("")
  const [condicionFiltro, setCondicionFiltro] =
    React.useState<FiltroCondicionUI>("all")
  const [caducidadFiltro, setCaducidadFiltro] =
    React.useState<FiltroCaducidadUI>("all")

  // Sheet «Nuevo lote».
  const [nuevoAbierto, setNuevoAbierto] = React.useState(false)
  const [borradorNuevo, setBorradorNuevo] =
    React.useState<BorradorNuevo>(BORRADOR_NUEVO_VACIO)
  const [articuloElegido, setArticuloElegido] =
    React.useState<ArticuloRef | null>(null)
  const [busquedaArticulo, setBusquedaArticulo] = React.useState("")
  const [guardandoNuevo, setGuardandoNuevo] = React.useState(false)
  const [avisoNuevo, setAvisoNuevo] = React.useState<Aviso>(null)
  const [errorNuevoCampo, setErrorNuevoCampo] = React.useState<string | null>(
    null
  )

  // Sheet «Movimiento».
  const [movimientoLote, setMovimientoLote] =
    React.useState<LoteInventario | null>(null)
  const [movimientoKind, setMovimientoKind] =
    React.useState<KindMovimiento>("entrada")
  const [movimientoCantidad, setMovimientoCantidad] = React.useState("")
  const [movimientoMotivo, setMovimientoMotivo] = React.useState("")
  const [guardandoMovimiento, setGuardandoMovimiento] = React.useState(false)
  const [avisoMovimiento, setAvisoMovimiento] = React.useState<Aviso>(null)

  // Sheet «Editar lote» (metadatos; la cantidad cambia con movimientos).
  const [editarLote, setEditarLote] = React.useState<LoteInventario | null>(
    null
  )
  const [borradorMeta, setBorradorMeta] = React.useState<BorradorMeta | null>(
    null
  )
  const [guardandoMeta, setGuardandoMeta] = React.useState(false)
  const [avisoMeta, setAvisoMeta] = React.useState<Aviso>(null)
  const [conflictoMeta, setConflictoMeta] = React.useState(false)

  // Sheet «Kardex».
  const [kardexFiltro, setKardexFiltro] = React.useState<{
    titulo: string
    loteId?: string
    articuloId?: string
  } | null>(null)
  const [movimientos, setMovimientos] = React.useState<MovimientoInventario[]>(
    []
  )
  const [movimientosTotal, setMovimientosTotal] = React.useState(0)
  const [kardexPage, setKardexPage] = React.useState(1)
  const [cargandoKardex, setCargandoKardex] = React.useState(false)
  const [cargandoMasKardex, setCargandoMasKardex] = React.useState(false)
  const [avisoKardex, setAvisoKardex] = React.useState<Aviso>(null)

  // Guardias de secuencia: una respuesta tardía jamás pinta una consulta vieja.
  const cargaSeqRef = React.useRef(0)
  const kardexSeqRef = React.useRef(0)
  const datosListosRef = React.useRef(inicial !== null)
  const skipPrimeraCarga = React.useRef(true)

  // Adopción del snapshot del servidor EN RENDER (no en effects): cuando la
  // RSC entrega un snapshot nuevo (refresh de realtime) y NO hay filtros
  // activos, se adopta directo — sin segunda descarga. Con filtros activos
  // el snapshot SIN filtrar se ignora y manda el fetch del cliente.
  const sinFiltros =
    terminoAplicado === "" &&
    condicionFiltro === "all" &&
    caducidadFiltro === "all"
  if (servidor !== inicial) {
    setServidor(inicial)
    if (sinFiltros) {
      setLotes(inicial?.lotes ?? null)
      setTotal(inicial?.total ?? 0)
      setResumen(resumenInicial)
      setCargaFallida(false)
    }
  }

  const load = React.useCallback(async (): Promise<LoteInventario[] | null> => {
    const seq = ++cargaSeqRef.current
    try {
      const params = new URLSearchParams()
      if (terminoAplicado) params.set("q", terminoAplicado)
      if (condicionFiltro !== "all") params.set("condicion", condicionFiltro)
      if (caducidadFiltro !== "all") params.set("caducidad", caducidadFiltro)
      const response = await fetch(`/api/inventario?${params.toString()}`, {
        cache: "no-store",
      })
      const body = await leerRespuesta(response)
      if (seq !== cargaSeqRef.current) return null
      if (!response.ok || !body?.ok) throw new Error("load_error")
      const lista = (body.data ?? []) as LoteInventario[]
      setLotes(lista)
      setTotal(typeof body.total === "number" ? body.total : lista.length)
      if (body.resumen) setResumen(body.resumen)
      setCargaFallida(false)
      setAviso(null)
      datosListosRef.current = true
      return lista
    } catch {
      if (seq !== cargaSeqRef.current) return null
      if (!datosListosRef.current) {
        setCargaFallida(true)
      } else {
        setAviso({
          texto: "No se pudo refrescar el inventario. Revisa tu conexión.",
        })
      }
      return null
    }
  }, [terminoAplicado, condicionFiltro, caducidadFiltro])

  // Búsqueda con debounce (el timer mantiene el setState fuera del cuerpo
  // sincrónico del efecto: regla react-hooks/set-state-in-effect).
  const terminoAplicadoRef = React.useRef("")
  React.useEffect(() => {
    const trimmed = busqueda.trim()
    const timer = setTimeout(() => {
      if (terminoAplicadoRef.current === trimmed) return
      terminoAplicadoRef.current = trimmed
      setTerminoAplicado(trimmed)
    }, 300)
    return () => clearTimeout(timer)
  }, [busqueda])

  // Recarga al cambiar filtros. El primer render ya trae datos del servidor.
  React.useEffect(() => {
    if (skipPrimeraCarga.current) {
      skipPrimeraCarga.current = false
      return
    }
    void load()
  }, [load])

  // Tiempo real: otra pestaña o dispositivo movió el inventario compartido.
  // `inventario` SIN filtros: el refresh del provider re-entrega el snapshot
  // y la adopción de arriba actualiza el listado (sin segunda descarga).
  // CON filtros: el snapshot llega sin filtrar, así que aquí va el fetch.
  // `articulos` (catálogo): invalida el picker; si el sheet está abierto,
  // lo recarga al instante.
  const loadRef = React.useRef(load)
  React.useEffect(() => {
    loadRef.current = load
  }, [load])
  const sinFiltrosRef = React.useRef(sinFiltros)
  React.useEffect(() => {
    sinFiltrosRef.current = sinFiltros
  }, [sinFiltros])
  const nuevoAbiertoRef = React.useRef(nuevoAbierto)
  React.useEffect(() => {
    nuevoAbiertoRef.current = nuevoAbierto
  }, [nuevoAbierto])

  const cargarCatalogo = React.useCallback(async (): Promise<Articulo[]> => {
    try {
      const response = await fetch(
        `/api/articulos?status=active&pageSize=${ARTICULOS_PAGE_SIZE_MAX}`,
        { cache: "no-store" }
      )
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) throw new Error("catalogo_error")
      const lista = (body.data ?? []) as Articulo[]
      setCatalogo(lista)
      return lista
    } catch {
      setCatalogo([])
      setAvisoNuevo({
        texto:
          "No se pudo cargar el catálogo para elegir el artículo. Cierra e intenta de nuevo.",
      })
      return []
    }
  }, [])
  const cargarCatalogoRef = React.useRef(cargarCatalogo)
  React.useEffect(() => {
    cargarCatalogoRef.current = cargarCatalogo
  }, [cargarCatalogo])

  const alEventoRealtime = React.useCallback(
    (message: { kind: string }) => {
      if (message.kind === "articulos") {
        setCatalogo(null)
        if (nuevoAbiertoRef.current) void cargarCatalogoRef.current()
        return
      }
      if (!sinFiltrosRef.current) void loadRef.current()
    },
    []
  )
  useRealtimeEvent(["inventario", "articulos"], alEventoRealtime)

  const grupos = React.useMemo(
    () => (lotes ? agruparLotes(lotes) : []),
    [lotes]
  )

  /* ------------------------------ nuevo lote ------------------------------ */

  const abrirNuevo = React.useCallback(
    (articulo?: ArticuloRef) => {
      setErrorNuevoCampo(null)
      setAvisoNuevo(null)
      setBusquedaArticulo("")
      if (articulo) {
        setArticuloElegido(articulo)
        setBorradorNuevo({
          ...BORRADOR_NUEVO_VACIO,
          articuloId: articulo.id,
        })
      } else {
        setArticuloElegido(null)
        setBorradorNuevo(BORRADOR_NUEVO_VACIO)
      }
      setNuevoAbierto(true)
      // Catálogo bajo demanda: solo se descarga la primera vez que se abre
      // el sheet (y tras un evento `articulos` que lo invalide).
      if (catalogo === null) void cargarCatalogo()
    },
    [catalogo, cargarCatalogo]
  )

  const cerrarNuevo = React.useCallback(() => {
    if (guardandoNuevo) return
    setNuevoAbierto(false)
    setBorradorNuevo(BORRADOR_NUEVO_VACIO)
    setArticuloElegido(null)
    setBusquedaArticulo("")
    setErrorNuevoCampo(null)
    setAvisoNuevo(null)
  }, [guardandoNuevo])

  const crearNuevo = React.useCallback(async () => {
    if (guardandoNuevo) return
    const validacion = validarLoteInput({
      articuloId: borradorNuevo.articuloId,
      lote: borradorNuevo.lote,
      caducidad: borradorNuevo.caducidad,
      condicion: borradorNuevo.condicion,
      ubicacion: borradorNuevo.ubicacion,
      cantidadInicial: borradorNuevo.cantidad,
    })
    if (!validacion.ok) {
      setErrorNuevoCampo(validacion.campo ?? null)
      setAvisoNuevo(validacion.campo ? null : { texto: validacion.error })
      return
    }
    setErrorNuevoCampo(null)
    setAvisoNuevo(null)
    setGuardandoNuevo(true)
    try {
      const response = await fetch("/api/inventario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validacion.lote),
      })
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        setAvisoNuevo({ texto: textoDeError(body, "No se pudo crear el lote. Intenta de nuevo.") })
        return
      }
      toast.success("Lote creado")
      setNuevoAbierto(false)
      setBorradorNuevo(BORRADOR_NUEVO_VACIO)
      setArticuloElegido(null)
      void load()
    } catch {
      setAvisoNuevo({
        texto:
          "No se pudo crear el lote. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setGuardandoNuevo(false)
    }
  }, [borradorNuevo, guardandoNuevo, load])

  // Selector de artículo: índice normalizado una sola vez, búsqueda local
  // (≥ 2 letras) recortada a 20 resultados — ligero con catálogos de 5 000.
  const indiceArticulos = React.useMemo(
    () =>
      (catalogo ?? []).map((articulo) => ({
        articulo,
        clave: normalizarTexto(
          `${articulo.nombre} ${articulo.sku} ${articulo.categoria ?? ""}`
        ),
      })),
    [catalogo]
  )
  const resultadosArticulo = React.useMemo(() => {
    const termino = normalizarTexto(busquedaArticulo.trim())
    if (termino.length < 2) return []
    const encontrados = indiceArticulos
      .filter((item) => item.clave.includes(termino))
      .map((item) => item.articulo)
    return encontrados.slice(0, 20)
  }, [indiceArticulos, busquedaArticulo])

  const elegirArticulo = React.useCallback((articulo: ArticuloRef) => {
    setArticuloElegido(articulo)
    setBorradorNuevo((prev) => ({ ...prev, articuloId: articulo.id }))
    setBusquedaArticulo("")
    setErrorNuevoCampo(null)
  }, [])

  /* ------------------------------ movimiento ------------------------------ */

  const abrirMovimiento = React.useCallback(
    (lote: LoteInventario, kind: KindMovimiento) => {
      setMovimientoLote(lote)
      setMovimientoKind(kind)
      setMovimientoCantidad("")
      setMovimientoMotivo("")
      setAvisoMovimiento(null)
    },
    []
  )

  const cerrarMovimiento = React.useCallback(() => {
    if (guardandoMovimiento) return
    setMovimientoLote(null)
    setMovimientoCantidad("")
    setMovimientoMotivo("")
    setAvisoMovimiento(null)
  }, [guardandoMovimiento])

  const registrarMovimiento = React.useCallback(async () => {
    if (!movimientoLote || guardandoMovimiento) return
    const validacion = validarMovimientoInput({
      kind: movimientoKind,
      cantidad: movimientoCantidad,
      cantidadObjetivo: movimientoCantidad,
      motivo: movimientoMotivo,
    })
    if (!validacion.ok) {
      setAvisoMovimiento({ texto: validacion.error })
      return
    }
    setAvisoMovimiento(null)
    setGuardandoMovimiento(true)
    try {
      const response = await fetch(
        `/api/inventario/lotes/${movimientoLote.id}/movimientos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validacion.movimiento),
        }
      )
      const body = await leerRespuesta(response)
      if (!response.ok || !body?.ok) {
        setAvisoMovimiento({
          texto: textoDeError(body, "No se pudo registrar el movimiento. Intenta de nuevo."),
        })
        return
      }
      toast.success(`${kindEtiqueta(movimientoKind)} registrada`)
      setMovimientoLote(null)
      setMovimientoCantidad("")
      setMovimientoMotivo("")
      void load()
    } catch {
      setAvisoMovimiento({
        texto:
          "No se pudo registrar el movimiento. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setGuardandoMovimiento(false)
    }
  }, [
    movimientoLote,
    movimientoKind,
    movimientoCantidad,
    movimientoMotivo,
    guardandoMovimiento,
    load,
  ])

  /* ----------------------------- editar lote ----------------------------- */

  const abrirEdicion = React.useCallback((lote: LoteInventario) => {
    setEditarLote(lote)
    setBorradorMeta({
      lote: lote.lote ?? "",
      caducidad: lote.caducidad ?? "",
      condicion: lote.condicion,
      ubicacion: lote.ubicacion ?? "",
    })
    setAvisoMeta(null)
    setConflictoMeta(false)
  }, [])

  const cerrarEdicion = React.useCallback(() => {
    if (guardandoMeta) return
    setEditarLote(null)
    setBorradorMeta(null)
    setAvisoMeta(null)
    setConflictoMeta(false)
  }, [guardandoMeta])

  const guardarMeta = React.useCallback(async () => {
    if (!editarLote || !borradorMeta || guardandoMeta) return
    const validacion = validarLoteMetaInput({
      lote: borradorMeta.lote,
      caducidad: borradorMeta.caducidad,
      condicion: borradorMeta.condicion,
      ubicacion: borradorMeta.ubicacion,
    })
    if (!validacion.ok) {
      setAvisoMeta({ texto: validacion.error })
      return
    }
    setAvisoMeta(null)
    setConflictoMeta(false)
    setGuardandoMeta(true)
    try {
      const response = await fetch(`/api/inventario/lotes/${editarLote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lote: validacion.meta.lote,
          caducidad: validacion.meta.caducidad,
          condicion: validacion.meta.condicion,
          ubicacion: validacion.meta.ubicacion,
          version: editarLote.version,
        }),
      })
      const body = await leerRespuesta(response)
      if (response.status === 409) {
        setConflictoMeta(true)
        setAvisoMeta({
          texto:
            body?.error?.message ??
            "El lote cambió en otro dispositivo o pestaña.",
        })
        return
      }
      if (!response.ok || !body?.ok) {
        setAvisoMeta({
          texto: textoDeError(body, "No se pudo guardar el lote. Intenta de nuevo."),
        })
        return
      }
      toast.success("Lote guardado")
      setEditarLote(null)
      setBorradorMeta(null)
      void load()
    } catch {
      setAvisoMeta({
        texto:
          "No se pudo guardar el lote. Revisa tu conexión e intenta de nuevo.",
      })
    } finally {
      setGuardandoMeta(false)
    }
  }, [borradorMeta, editarLote, guardandoMeta, load])

  /** Trae la versión vigente del lote al borrador (conflicto 409). */
  const recargarLoteAbierto = React.useCallback(async () => {
    if (!editarLote) return
    setGuardandoMeta(true)
    try {
      const lista = await load()
      const fresco = lista?.find((lote) => lote.id === editarLote.id) ?? null
      if (!fresco) {
        toast.error(
          "El lote ya no aparece con los filtros actuales: limpia la búsqueda para recargarlo."
        )
        setEditarLote(null)
        setBorradorMeta(null)
        return
      }
      setEditarLote(fresco)
      setBorradorMeta({
        lote: fresco.lote ?? "",
        caducidad: fresco.caducidad ?? "",
        condicion: fresco.condicion,
        ubicacion: fresco.ubicacion ?? "",
      })
      setConflictoMeta(false)
      setAvisoMeta(null)
    } finally {
      setGuardandoMeta(false)
    }
  }, [editarLote, load])

  /* -------------------------------- kardex -------------------------------- */

  const fetchKardex = React.useCallback(
    async (
      filtro: { loteId?: string; articuloId?: string },
      page: number,
      anexar: boolean
    ) => {
      const seq = ++kardexSeqRef.current
      if (anexar) setCargandoMasKardex(true)
      else setCargandoKardex(true)
      setAvisoKardex(null)
      try {
        const params = new URLSearchParams()
        if (filtro.loteId) params.set("loteId", filtro.loteId)
        if (filtro.articuloId) params.set("articuloId", filtro.articuloId)
        params.set("page", String(page))
        const response = await fetch(
          `/api/inventario/movimientos?${params.toString()}`,
          { cache: "no-store" }
        )
        const body = await leerRespuesta(response)
        if (seq !== kardexSeqRef.current) return
        if (!response.ok || !body?.ok) throw new Error("kardex_error")
        const nuevas = (body.data ?? []) as MovimientoInventario[]
        setMovimientos((prev) => (anexar ? [...prev, ...nuevas] : nuevas))
        setMovimientosTotal(
          typeof body.total === "number" ? body.total : nuevas.length
        )
        setKardexPage(page)
      } catch {
        if (seq !== kardexSeqRef.current) return
        setAvisoKardex({
          texto: "No se pudo cargar el kardex. Revisa tu conexión e intenta de nuevo.",
        })
        if (!anexar) {
          setMovimientos([])
          setMovimientosTotal(0)
        }
      } finally {
        if (seq === kardexSeqRef.current) {
          setCargandoKardex(false)
          setCargandoMasKardex(false)
        }
      }
    },
    []
  )

  const abrirKardex = React.useCallback(
    (filtro: { titulo: string; loteId?: string; articuloId?: string }) => {
      setKardexFiltro(filtro)
      setMovimientos([])
      setMovimientosTotal(0)
      void fetchKardex(
        { loteId: filtro.loteId, articuloId: filtro.articuloId },
        1,
        false
      )
    },
    [fetchKardex]
  )

  const cerrarKardex = React.useCallback(() => {
    if (cargandoKardex || cargandoMasKardex) return
    setKardexFiltro(null)
    setMovimientos([])
    setMovimientosTotal(0)
    setAvisoKardex(null)
  }, [cargandoKardex, cargandoMasKardex])

  const cargarMasKardex = React.useCallback(() => {
    if (!kardexFiltro || cargandoMasKardex) return
    void fetchKardex(
      { loteId: kardexFiltro.loteId, articuloId: kardexFiltro.articuloId },
      kardexPage + 1,
      true
    )
  }, [kardexFiltro, kardexPage, cargandoMasKardex, fetchKardex])

  // Handlers ESTABLES para el acordeón memoizado: props con identidad nueva
  // por render (arrows inline) anularían el memo y re-reconciliarían la
  // lista completa en cada pulsación del buscador.
  const abrirKardexDeLote = React.useCallback(
    (lote: LoteInventario) => abrirKardex({ titulo: lote.nombre, loteId: lote.id }),
    [abrirKardex]
  )
  const abrirKardexDeArticulo = React.useCallback(
    (grupo: GrupoInventario) =>
      abrirKardex({ titulo: grupo.nombre, articuloId: grupo.articuloId }),
    [abrirKardex]
  )

  /* -------------------------------- render -------------------------------- */

  const conFiltros =
    terminoAplicado !== "" ||
    condicionFiltro !== "all" ||
    caducidadFiltro !== "all"

  const umDelMovimiento = movimientoLote
    ? umEtiqueta(movimientoLote.um)
    : ""
  const umEditar = editarLote ? umEtiqueta(editarLote.um) : ""

  const movimientosRestantes =
    kardexFiltro !== null ? movimientosTotal - movimientos.length : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <h2 className="text-xl font-semibold">Inventario</h2>
        <InfoHint label="Más información sobre Inventario" titulo="Inventario">
          Existencias por lotes ligadas al catálogo: cada lote tiene su
          cantidad, caducidad, condición y ubicación. El stock solo cambia con
          entradas, salidas y ajustes que quedan registrados en el kardex.
          Compartido: propietario y sucursales ven y gestionan lo mismo.
        </InfoHint>
      </div>

      {resumen ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5">
            <span className="text-muted-foreground text-xs">
              Unidades en stock
            </span>
            <span className="text-base font-medium tabular-nums">
              {formatearCantidad(resumen.unidadesTotales)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5">
            <span className="text-muted-foreground text-xs">
              Por vencer ({INVENTARIO_DIAS_POR_VENCER} días)
            </span>
            <span
              className={
                resumen.lotesPorVencer > 0
                  ? "text-base font-medium tabular-nums text-warning-foreground"
                  : "text-base font-medium tabular-nums"
              }
            >
              {resumen.lotesPorVencer.toLocaleString("es-MX")}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5">
            <span className="text-muted-foreground text-xs">
              Lotes vencidos
            </span>
            <span
              className={
                resumen.lotesVencidos > 0
                  ? "text-destructive text-base font-medium tabular-nums"
                  : "text-base font-medium tabular-nums"
              }
            >
              {resumen.lotesVencidos.toLocaleString("es-MX")}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5">
            <span className="text-muted-foreground text-xs">
              Unidades dañadas
            </span>
            <span className="text-base font-medium tabular-nums">
              {formatearCantidad(resumen.unidadesDanadas)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <InputGroup className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted">
            <InputGroupAddon align="inline-start" className="pl-3.5">
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Buscar en el inventario"
              placeholder="Buscar por artículo, SKU, lote o ubicación…"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              className="h-full text-base"
            />
            {busqueda ? (
              <InputGroupAddon align="inline-end" className="mr-0 pr-2.5">
                <InputGroupButton
                  size="icon-sm"
                  className="size-9 rounded-full"
                  onClick={() => setBusqueda("")}
                  aria-label="Limpiar búsqueda"
                >
                  <XIcon aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={condicionFiltro}
            onValueChange={(value) =>
              setCondicionFiltro((value ?? "all") as FiltroCondicionUI)
            }
          >
            <SelectTrigger className="w-36" aria-label="Filtrar por condición">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda condición</SelectItem>
              {CONDICIONES.map((opcion) => (
                <SelectItem key={opcion.code} value={opcion.code}>
                  {opcion.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={caducidadFiltro}
            onValueChange={(value) =>
              setCaducidadFiltro((value ?? "all") as FiltroCaducidadUI)
            }
          >
            <SelectTrigger className="w-44" aria-label="Filtrar por caducidad">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda caducidad</SelectItem>
              <SelectItem value="por_vencer">
                Por vencer ({INVENTARIO_DIAS_POR_VENCER} días)
              </SelectItem>
              <SelectItem value="vencidos">Vencidos</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="ml-auto" onClick={() => abrirNuevo()}>
            <PlusIcon aria-hidden="true" />
            Nuevo lote
          </Button>
        </div>
        {lotes !== null ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {total.toLocaleString("es-MX")}{" "}
            {total === 1 ? "lote" : "lotes"}
          </p>
        ) : null}
        {aviso ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{aviso.texto}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {lotes === null && !cargaFallida ? (
        <div className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : lotes === null || lotes.length === 0 ? (
        <Empty className="border-0 py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageOpenIcon />
            </EmptyMedia>
            <EmptyTitle>
              {cargaFallida
                ? "No se pudo cargar el inventario"
                : conFiltros
                  ? "Sin lotes con esos filtros"
                  : "Tu inventario está vacío"}
            </EmptyTitle>
            <EmptyDescription>
              {cargaFallida
                ? "Revisa tu conexión e inténtalo de nuevo."
                : conFiltros
                  ? "Prueba con otra búsqueda o filtro."
                  : "Crea el primer lote desde tu catálogo de artículos."}
            </EmptyDescription>
          </EmptyHeader>
          {cargaFallida ? (
            <Button variant="outline" onClick={() => void load()}>
              Reintentar
            </Button>
          ) : (
            <Button onClick={() => abrirNuevo()}>
              <PlusIcon aria-hidden="true" />
              Nuevo lote
            </Button>
          )}
        </Empty>
      ) : (
        <InventarioAccordion
          grupos={grupos}
          onMovimiento={abrirMovimiento}
          onEditar={abrirEdicion}
          onKardexLote={abrirKardexDeLote}
          onKardexArticulo={abrirKardexDeArticulo}
          onNuevoLote={abrirNuevo}
        />
      )}

      {/* ---------------------------- nuevo lote ---------------------------- */}
      <Sheet
        open={nuevoAbierto}
        onOpenChange={(open) => {
          if (!open) cerrarNuevo()
        }}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg gap-0 rounded-t-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>Nuevo lote</SheetTitle>
            <SheetDescription>
              Cada lote lleva su propia cantidad, caducidad, condición y
              ubicación. La cantidad inicial queda registrada como la entrada
              de alta del lote.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            {borradorNuevo.articuloId && articuloElegido ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {articuloElegido.nombre}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {articuloElegido.sku}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="relative after:absolute after:content-[''] after:-inset-2"
                  onClick={() => {
                    setArticuloElegido(null)
                    setBorradorNuevo((prev) => ({
                      ...prev,
                      articuloId: "",
                    }))
                  }}
                  aria-label="Cambiar artículo"
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <InputGroup className="rounded-lg">
                  <InputGroupAddon align="inline-start">
                    <SearchIcon aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Buscar artículo del catálogo"
                    placeholder="Artículo del catálogo…"
                    value={busquedaArticulo}
                    onChange={(event) => setBusquedaArticulo(event.target.value)}
                  />
                </InputGroup>
                {catalogo === null ? (
                  <p
                    role="status"
                    className="text-muted-foreground flex items-center gap-2 text-sm"
                  >
                    <Spinner className="size-3.5" />
                    Cargando el catálogo…
                  </p>
                ) : resultadosArticulo.length > 0 ? (
                  <ul className="max-h-56 overflow-y-auto rounded-lg border">
                    {resultadosArticulo.map((articulo) => (
                      <li key={articulo.id}>
                        <button
                          type="button"
                          onClick={() => elegirArticulo(articulo)}
                          className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                        >
                          <span className="w-full truncate text-sm font-medium">
                            {articulo.nombre}
                          </span>
                          <span className="text-muted-foreground w-full truncate text-xs">
                            {articulo.sku} · {umEtiqueta(articulo.um)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {busquedaArticulo.trim().length >= 2
                      ? "Sin artículos del catálogo con ese nombre o SKU."
                      : "Escribe al menos 2 letras para buscar en tu catálogo."}
                  </p>
                )}
                {errorNuevoCampo === "articuloId" ? (
                  <p role="alert" className="text-destructive text-xs">
                    Elige el artículo del catálogo para este lote.
                  </p>
                ) : null}
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Input
                  aria-label="Código de lote"
                  placeholder="Código de lote (opcional)"
                  value={borradorNuevo.lote}
                  maxLength={60}
                  onChange={(event) =>
                    setBorradorNuevo((prev) => ({
                      ...prev,
                      lote: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex w-40 flex-col gap-1.5">
                <Input
                  aria-label="Fecha de caducidad"
                  type="date"
                  value={borradorNuevo.caducidad}
                  onChange={(event) =>
                    setBorradorNuevo((prev) => ({
                      ...prev,
                      caducidad: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {errorNuevoCampo === "caducidad" ? (
              <p role="alert" className="text-destructive -mt-2 text-xs">
                La caducidad debe ser una fecha válida.
              </p>
            ) : null}

            <div className="flex gap-2">
              <Select
                value={borradorNuevo.condicion}
                onValueChange={(value) =>
                  setBorradorNuevo((prev) => ({
                    ...prev,
                    condicion: (value ?? "nuevo") as Condicion,
                  }))
                }
              >
                <SelectTrigger className="flex-1" aria-label="Condición del lote">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDICIONES.map((opcion) => (
                    <SelectItem key={opcion.code} value={opcion.code}>
                      {opcion.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Cantidad inicial del lote"
                inputMode="decimal"
                placeholder="Cantidad inicial"
                value={borradorNuevo.cantidad}
                onChange={(event) =>
                  setBorradorNuevo((prev) => ({
                    ...prev,
                    cantidad: event.target.value,
                  }))
                }
                className="w-36"
              />
            </div>
            {errorNuevoCampo === "cantidadInicial" ? (
              <p role="alert" className="text-destructive -mt-2 text-xs">
                La cantidad inicial debe ser un número con hasta 3 decimales.
              </p>
            ) : null}

            <Input
              aria-label="Ubicación del lote"
              placeholder="Ubicación (opcional): anaquel, bodega A…"
              value={borradorNuevo.ubicacion}
              maxLength={120}
              onChange={(event) =>
                setBorradorNuevo((prev) => ({
                  ...prev,
                  ubicacion: event.target.value,
                }))
              }
            />

            {avisoNuevo ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>{avisoNuevo.texto}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="w-1/2"
                onClick={cerrarNuevo}
                disabled={guardandoNuevo}
              >
                Cancelar
              </Button>
              <Button
                className="w-1/2"
                onClick={() => void crearNuevo()}
                disabled={guardandoNuevo || !borradorNuevo.articuloId}
              >
                {guardandoNuevo ? (
                  <>
                    <Spinner className="size-3.5" />
                    Guardando…
                  </>
                ) : (
                  "Crear lote"
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------------------------- movimiento ---------------------------- */}
      <Sheet
        open={movimientoLote !== null}
        onOpenChange={(open) => {
          if (!open) cerrarMovimiento()
        }}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg gap-0 rounded-t-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>
              {movimientoLote
                ? `${kindEtiqueta(movimientoKind)} — ${movimientoLote.nombre}`
                : "Movimiento"}
            </SheetTitle>
            <SheetDescription>
              {movimientoLote
                ? `Lote ${movimientoLote.lote ?? "sin código"} · ${condicionEtiqueta(movimientoLote.condicion)} · registrado: ${formatearCantidad(movimientoLote.cantidad)} ${umDelMovimiento}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            <div className="flex gap-2" role="group" aria-label="Tipo de movimiento">
              {(
                [
                  { kind: "entrada", label: "Entrada", icono: <ArrowDownToLineIcon aria-hidden="true" /> },
                  { kind: "salida", label: "Salida", icono: <ArrowUpFromLineIcon aria-hidden="true" /> },
                  { kind: "ajuste", label: "Ajustar", icono: <SlidersHorizontalIcon aria-hidden="true" /> },
                ] as const
              ).map((opcion) => (
                <Button
                  key={opcion.kind}
                  type="button"
                  variant={movimientoKind === opcion.kind ? "default" : "outline"}
                  className="flex-1"
                  aria-pressed={movimientoKind === opcion.kind}
                  onClick={() => setMovimientoKind(opcion.kind)}
                >
                  {opcion.icono}
                  {opcion.label}
                </Button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <Input
                aria-label={
                  movimientoKind === "ajuste"
                    ? "Conteo físico del lote"
                    : "Cantidad del movimiento"
                }
                inputMode="decimal"
                placeholder={
                  movimientoKind === "ajuste"
                    ? `Conteo físico (a cuánto queda, en ${umDelMovimiento})`
                    : `Cantidad en ${umDelMovimiento}`
                }
                value={movimientoCantidad}
                onChange={(event) => setMovimientoCantidad(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {movimientoKind === "ajuste"
                  ? `El ajuste fija el lote al conteo físico (registrado hoy: ${movimientoLote ? formatearCantidad(movimientoLote.cantidad) : "0"}).`
                  : movimientoKind === "salida"
                    ? "La salida no puede pasar de la cantidad registrada del lote."
                    : "La entrada suma a la cantidad registrada del lote."}
              </p>
            </div>

            <Input
              aria-label="Motivo del movimiento"
              placeholder="Motivo (opcional): compra, merma, conteo físico…"
              value={movimientoMotivo}
              maxLength={200}
              onChange={(event) => setMovimientoMotivo(event.target.value)}
            />

            {avisoMovimiento ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>{avisoMovimiento.texto}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="w-1/2"
                onClick={cerrarMovimiento}
                disabled={guardandoMovimiento}
              >
                Cancelar
              </Button>
              <Button
                className="w-1/2"
                onClick={() => void registrarMovimiento()}
                disabled={guardandoMovimiento || !movimientoLote}
              >
                {guardandoMovimiento ? (
                  <>
                    <Spinner className="size-3.5" />
                    Registrando…
                  </>
                ) : movimientoKind === "entrada" ? (
                  "Registrar entrada"
                ) : movimientoKind === "salida" ? (
                  "Registrar salida"
                ) : (
                  "Guardar ajuste"
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ----------------------------- editar lote ----------------------------- */}
      <Sheet
        open={editarLote !== null}
        onOpenChange={(open) => {
          if (!open) cerrarEdicion()
        }}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg gap-0 rounded-t-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>
              {editarLote ? `Editar lote — ${editarLote.nombre}` : "Editar lote"}
            </SheetTitle>
            <SheetDescription>
              Aquí se corrigen el código, la caducidad, la condición y la
              ubicación del lote. La cantidad no se edita: solo cambia con
              entradas, salidas y ajustes del kardex.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            <div className="flex gap-2">
              <Input
                aria-label="Código de lote"
                placeholder="Código de lote (opcional)"
                value={borradorMeta?.lote ?? ""}
                maxLength={60}
                onChange={(event) =>
                  setBorradorMeta((prev) =>
                    prev ? { ...prev, lote: event.target.value } : prev
                  )
                }
              />
              <Input
                aria-label="Fecha de caducidad"
                type="date"
                value={borradorMeta?.caducidad ?? ""}
                onChange={(event) =>
                  setBorradorMeta((prev) =>
                    prev ? { ...prev, caducidad: event.target.value } : prev
                  )
                }
                className="w-40 shrink-0"
              />
            </div>

            <Select
              value={borradorMeta?.condicion ?? "nuevo"}
              onValueChange={(value) =>
                setBorradorMeta((prev) =>
                  prev
                    ? { ...prev, condicion: (value ?? "nuevo") as Condicion }
                    : prev
                )
              }
            >
              <SelectTrigger className="w-full" aria-label="Condición del lote">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDICIONES.map((opcion) => (
                  <SelectItem key={opcion.code} value={opcion.code}>
                    {opcion.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              aria-label="Ubicación del lote"
              placeholder="Ubicación (opcional): anaquel, bodega A…"
              value={borradorMeta?.ubicacion ?? ""}
              maxLength={120}
              onChange={(event) =>
                setBorradorMeta((prev) =>
                  prev ? { ...prev, ubicacion: event.target.value } : prev
                )
              }
            />

            {avisoMeta ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>
                  {avisoMeta.texto}
                  {conflictoMeta ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void recargarLoteAbierto()}
                    >
                      Recargar el lote actual
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="w-1/2"
                onClick={cerrarEdicion}
                disabled={guardandoMeta}
              >
                Cancelar
              </Button>
              <Button
                className="w-1/2"
                onClick={() => void guardarMeta()}
                disabled={guardandoMeta || !borradorMeta}
              >
                {guardandoMeta ? (
                  <>
                    <Spinner className="size-3.5" />
                    Guardando…
                  </>
                ) : (
                  "Guardar"
                )}
              </Button>
            </div>
            {editarLote ? (
              <p className="text-muted-foreground text-xs">
                Registrado: {formatearCantidad(editarLote.cantidad)}{" "}
                {umEditar}. La cantidad se corrige con Entrada, Salida o
                Ajustar desde la lista.
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* -------------------------------- kardex -------------------------------- */}
      <Sheet
        open={kardexFiltro !== null}
        onOpenChange={(open) => {
          if (!open) cerrarKardex()
        }}
      >
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg gap-0 rounded-t-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle className="flex items-center gap-2">
              <HistoryIcon aria-hidden="true" className="size-4" />
              Kardex — {kardexFiltro?.titulo}
            </SheetTitle>
            <SheetDescription>
              Historial de movimientos, del más reciente al más antiguo. El
              kardex no se borra: una corrección es un movimiento de ajuste.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-6">
            {cargandoKardex ? (
              <div className="flex flex-col gap-3" aria-hidden>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : movimientos.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">
                {avisoKardex
                  ? avisoKardex.texto
                  : "Sin movimientos registrados todavía."}
              </p>
            ) : (
              <ul className="flex max-h-[45dvh] flex-col divide-y overflow-y-auto">
                {movimientos.map((movimiento) => {
                  const variante =
                    movimiento.kind === "entrada"
                      ? "success-light"
                      : movimiento.kind === "salida"
                        ? "outline"
                        : "info-light"
                  const tono =
                    movimiento.delta > 0
                      ? "text-success"
                      : movimiento.delta < 0
                        ? "text-destructive"
                        : ""
                  return (
                    <li
                      key={movimiento.id}
                      className="flex items-start justify-between gap-3 py-2.5 first:pt-1 last:pb-1"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={variante} size="sm">
                            {kindEtiqueta(movimiento.kind)}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {formatearFechaHora(movimiento.createdAt)}
                          </span>
                        </div>
                        {movimiento.motivo ? (
                          <p className="text-sm break-words">
                            {movimiento.motivo}
                          </p>
                        ) : null}
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {formatearCantidad(movimiento.cantidadAntes)} →{" "}
                          {formatearCantidad(movimiento.cantidadDespues)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-semibold tabular-nums ${tono}`}
                      >
                        {formatearDelta(movimiento.delta)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            {movimientosRestantes > 0 ? (
              <Button
                variant="outline"
                onClick={cargarMasKardex}
                disabled={cargandoMasKardex}
              >
                {cargandoMasKardex ? (
                  <>
                    <Spinner className="size-3.5" />
                    Cargando…
                  </>
                ) : (
                  `Mostrar más (${movimientosRestantes.toLocaleString("es-MX")} restantes)`
                )}
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="w-full"
              onClick={cerrarKardex}
              disabled={cargandoKardex || cargandoMasKardex}
            >
              Cerrar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
