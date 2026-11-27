"use client"

import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTable, type ColumnDef } from "@tanstack/react-table"
import {
  ChevronRightIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  QrCodeIcon,
  ReceiptTextIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
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
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

import { LinkCreadoDialog } from "@/components/herramientas/links-pago/link-creado-dialog"
import { ArticulosAccordion } from "@/components/herramientas/articulos/articulos-accordion"
import {
  cancelPaymentOrderAction,
  getPaymentOrderLinkAction,
  resolvePaymentOrderAction,
  type CreatedPaymentOrder,
} from "@/app/actions/links-pago"
import { createNotaDigitalAction } from "@/app/actions/nota-digital"
import {
  ARTICULOS_BUSQUEDA_MIN,
  normalizarTexto,
  type Articulo,
} from "@/lib/articulos"
import {
  paymentOrderMoney,
  paymentOrderStatusLabel,
} from "@/lib/links-pago"
import {
  calcularLinea,
  cantidadTexto,
  NOTA_MAX_RENGLONES,
  totalDeLineas,
  type NotaDigitalListItem,
} from "@/lib/nota-digital"

/*
 * Vista del módulo NOTA DIGITAL: el tendero arma una comanda desde el
 * catálogo (Alta de Artículos), con un solo paso crea el link corto spei.link
 * con QR y, cuando el depósito se acredita, el pagador recibe su nota
 * desglosada por WhatsApp. El ciclo completo se reutiliza de SPEILink.
 */

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
})

const STATUS_BADGE: Record<
  NotaDigitalListItem["status"],
  { variant: "warning-light" | "success-light" | "destructive-light" | "secondary" }
> = {
  pending: { variant: "warning-light" },
  verifying: { variant: "warning-light" },
  paid: { variant: "success-light" },
  rejected: { variant: "destructive-light" },
  cancelled: { variant: "secondary" },
}

interface CartItem {
  articulo: Pick<
    Articulo,
    "id" | "sku" | "nombre" | "um" | "precioUnitario"
  >
  cantidad: number
}

interface NotaDigitalViewProps {
  initialNotas: NotaDigitalListItem[]
  /** Catálogo activo y disponible servido por la RSC; null = carga fallida. */
  initialArticulos: Articulo[] | null
  isAdmin: boolean
  whatsappConfigured: boolean
  scanConfigured: boolean
}

function maskPhone(phone: string | null): string {
  if (!phone) return "—"
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
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

/** Fila optimista para que la nota creada aparezca antes del RSC. */
function notaOptimista(
  order: CreatedPaymentOrder,
  cart: CartItem[]
): NotaDigitalListItem {
  return {
    id: order.orderId,
    code: order.code,
    creatorUsername: null,
    clientId: null,
    clientName: null,
    amountMxn: order.amountMxn,
    note: null,
    origin: "nota",
    status: "pending",
    bank: order.bank,
    payerPhone: null,
    payerName: null,
    linkOpenedAt: null,
    payerBoundAt: null,
    ticketFileId: null,
    scanStatus: null,
    scanResult: null,
    resolvedAt: null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    mpPaymentId: null,
    mpDepositAt: null,
    verifyingSince: null,
    depositChecks: 0,
    depositEscalatedAt: null,
    items: cart.map((item) => ({
      sku: item.articulo.sku,
      nombre: item.articulo.nombre,
      um: item.articulo.um,
      precioUnitario: item.articulo.precioUnitario,
      cantidad: item.cantidad,
      importeLinea: calcularLinea(item.articulo.precioUnitario, item.cantidad),
    })),
  }
}

export function NotaDigitalView({
  initialNotas,
  initialArticulos,
  isAdmin,
  whatsappConfigured,
  scanConfigured,
}: NotaDigitalViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<"crear" | "notas">("crear")

  const [notas, setNotas] = useState(initialNotas)
  const [serverNotas, setServerNotas] = useState(initialNotas)
  // Adopta el snapshot nuevo del servidor DURANTE el render (patrón de
  // links-pago-view): sin effects, router.refresh() del realtime 'payment_order'
  // trae la fila cambiada y la vista la pinta sin recargar.
  if (serverNotas !== initialNotas) {
    setServerNotas(initialNotas)
    setNotas(initialNotas)
  }

  const [articulos, setArticulos] = useState<Articulo[]>(initialArticulos ?? [])
  const [serverArticulos, setServerArticulos] = useState<Articulo[] | null>(
    initialArticulos
  )
  const catalogoFallido = initialArticulos === null
  // Adopción del snapshot de la RSC: el RealtimeProvider ya refresca la ruta
  // con cada evento `articulos`. El setState corre durante el render.
  if (serverArticulos !== initialArticulos) {
    setServerArticulos(initialArticulos)
    setArticulos(initialArticulos ?? [])
  }

  const [busqueda, setBusqueda] = useState("")
  const terminoDiferido = useDeferredValue(busqueda)
  // Índice normalizado calculado UNA vez por catálogo: escribir no vuelve a
  // normalizar 5000 descripciones en cada tecla.
  const indiceBusqueda = useMemo(
    () =>
      articulos.map((articulo) => ({
        articulo,
        texto: normalizarTexto(
          `${articulo.nombre} ${articulo.sku} ${articulo.categoria ?? ""} ${articulo.descripcion}`
        ),
      })),
    [articulos]
  )
  const articulosFiltrados = useMemo(() => {
    const termino = normalizarTexto(terminoDiferido.trim())
    if (termino.length < ARTICULOS_BUSQUEDA_MIN) return articulos
    return indiceBusqueda
      .filter((entrada) => entrada.texto.includes(termino))
      .map((entrada) => entrada.articulo)
  }, [articulos, indiceBusqueda, terminoDiferido])
  const [cart, setCart] = useState<CartItem[]>([])
  const cantidadesEnComanda = useMemo(
    () => new Map(cart.map((item) => [item.articulo.id, item.cantidad])),
    [cart]
  )
  const cantidadEnComanda = useCallback(
    (id: string) => cantidadesEnComanda.get(id) ?? 0,
    [cantidadesEnComanda]
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedPaymentOrder | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<NotaDigitalListItem | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [cancelTarget, setCancelTarget] = useState<NotaDigitalListItem | null>(null)
  const [linkOrderId, setLinkOrderId] = useState<string | null>(null)

  const agregarAlCarrito = useCallback((articulo: Articulo) => {
    if (cart.length >= NOTA_MAX_RENGLONES) {
      toast.error(`Una comanda puede tener hasta ${NOTA_MAX_RENGLONES} renglones.`)
      return
    }
    setCart((prev) => {
      const existente = prev.find((item) => item.articulo.id === articulo.id)
      if (existente) {
        return prev.map((item) =>
          item.articulo.id === articulo.id
            ? {
                ...item,
                cantidad: Math.min(9999.999, item.cantidad + 1),
              }
            : item
        )
      }
      return [
        ...prev,
        {
          articulo: {
            id: articulo.id,
            sku: articulo.sku,
            nombre: articulo.nombre,
            um: articulo.um,
            precioUnitario: articulo.precioUnitario,
          },
          cantidad: 1,
        },
      ]
    })
    setBusqueda("")
    setFormError(null)
  }, [cart])

  function cambiarCantidad(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.articulo.id === id
            ? {
                ...item,
                cantidad: Math.min(9999.999, Math.max(0, item.cantidad + delta)),
              }
            : item
        )
        .filter((item) => item.cantidad > 0)
    )
  }

  const lineas = useMemo(
    () =>
      cart.map((item) => ({
        sku: item.articulo.sku,
        nombre: item.articulo.nombre,
        um: item.articulo.um,
        precioUnitario: item.articulo.precioUnitario,
        cantidad: item.cantidad,
        importeLinea: calcularLinea(item.articulo.precioUnitario, item.cantidad),
      })),
    [cart]
  )
  const total = useMemo(() => totalDeLineas(lineas), [lineas])
  const totalValido = Number.isFinite(total) && total >= 1 && total <= 50000
  const puedeCrear = cart.length > 0 && totalValido && whatsappConfigured

  function crearNota() {
    if (!puedeCrear) return
    const items = cart.map((item) => ({
      articuloId: item.articulo.id,
      cantidad: item.cantidad,
    }))
    startTransition(async () => {
      const resultado = await createNotaDigitalAction({ items })
      if (resultado.error || !resultado.order) {
        const mensaje = resultado.error ?? "No se pudo crear la nota digital."
        setFormError(mensaje)
        toast.error(mensaje)
        return
      }
      setNotas((prev) => [notaOptimista(resultado.order!, cart), ...prev])
      setCreated(resultado.order)
      setCart([])
      setFormError(null)
      router.refresh()
    })
  }

  const selected = notas.find((nota) => nota.id === selectedId) ?? null
  const activa =
    selected?.status === "pending" || selected?.status === "verifying"

  function abrirLink(nota: NotaDigitalListItem) {
    setLinkOrderId(nota.id)
    startTransition(async () => {
      const resultado = await getPaymentOrderLinkAction({ orderId: nota.id })
      setLinkOrderId(null)
      if (resultado.error || !resultado.order) {
        toast.error(resultado.error ?? "No se pudo abrir el link.")
        return
      }
      setSelectedId(null)
      setCreated(resultado.order)
    })
  }

  function resolver(nota: NotaDigitalListItem, decision: "approve" | "reject", reason?: string) {
    setBusyOrderId(nota.id)
    startTransition(async () => {
      const resultado = await resolvePaymentOrderAction({
        orderId: nota.id,
        decision,
        reason,
      })
      setBusyOrderId(null)
      if (resultado.error) {
        toast.error(resultado.error)
        return
      }
      toast.success(
        decision === "approve" ? "Nota marcada como pagada." : "Nota rechazada."
      )
      setRejectTarget(null)
      setRejectReason("")
      setSelectedId(null)
      router.refresh()
    })
  }

  function cancelar(nota: NotaDigitalListItem) {
    setBusyOrderId(nota.id)
    startTransition(async () => {
      const resultado = await cancelPaymentOrderAction({ orderId: nota.id })
      setBusyOrderId(null)
      if (resultado.error) {
        toast.error(resultado.error)
        return
      }
      toast.success("Nota cancelada.")
      setCancelTarget(null)
      setSelectedId(null)
      router.refresh()
    })
  }

  const columnas = useMemo<ColumnDef<DataGridFeatures, NotaDigitalListItem>[]>(
    () => [
      {
        accessorKey: "code",
        id: "code",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Folio" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold tracking-wider">
            {row.original.code}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: "createdAt",
        id: "createdAt",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Fecha" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {dateFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "status",
        id: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => (
          <Badge variant={STATUS_BADGE[row.original.status].variant} size="sm">
            {paymentOrderStatusLabel(row.original.status)}
          </Badge>
        ),
        size: 150,
      },
      {
        accessorKey: "amountMxn",
        id: "amountMxn",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Total" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">
            {paymentOrderMoney(row.original.amountMxn)}
          </span>
        ),
        size: 130,
      },
      {
        id: "payerPhone",
        header: "Pagador",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {maskPhone(row.original.payerPhone)}
          </span>
        ),
        size: 140,
      },
      {
        id: "renglones",
        header: "Renglones",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {row.original.items.length}
          </span>
        ),
        size: 100,
      },
      {
        id: "detalle",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Ver detalle de la nota ${row.original.code}`}
            className="relative after:content-[''] after:absolute after:-inset-2"
            onClick={(event) => {
              event.stopPropagation()
              setSelectedId(row.original.id)
            }}
          >
            <ChevronRightIcon />
          </Button>
        ),
        size: 60,
      },
    ],
    []
  )

  const table = useTable({
    features: dataGridFeatures,
    columns: columnas,
    data: notas,
    getRowId: (nota: NotaDigitalListItem) => nota.id,
    initialState: { pagination: { pageIndex: 0, pageSize: 100 } },
  })

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "crear" | "notas")}>
        <TabsList variant="line" className="mb-4 w-full">
          <TabsTrigger value="crear">
            <PlusIcon /> Crear
          </TabsTrigger>
          <TabsTrigger value="notas">
            <ReceiptTextIcon /> Pedidos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="crear">
          <div className="flex flex-col gap-4">
            <div className="flex flex-row items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Nueva nota digital</h2>
              <InfoHint
                label="Más información sobre cómo funciona la nota digital"
                titulo="Nueva nota digital"
              >
                Arma la comanda con artículos de tu catálogo y genera un link
                de pago con QR. Cuando se confirme el depósito, el pagador
                recibe su nota desglosada por WhatsApp.
              </InfoHint>
            </div>

            <div className="flex items-center gap-2">
              <InputGroup className="h-12 min-w-0 max-w-xs flex-1 rounded-full border-0 bg-muted">
                <InputGroupAddon align="inline-start" className="pl-3.5">
                  <SearchIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="buscar-articulo-nota"
                  aria-label="Buscar artículos o servicios del catálogo"
                  placeholder="Busca por nombre, SKU, categoría o descripción"
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

            {catalogoFallido ? (
              <Empty className="border-0 py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TriangleAlertIcon />
                  </EmptyMedia>
                  <EmptyTitle>No se pudo cargar el catálogo</EmptyTitle>
                  <EmptyDescription>
                    Revisa tu conexión e inténtalo de nuevo.
                  </EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={() => router.refresh()}>
                  Reintentar
                </Button>
              </Empty>
            ) : articulos.length === 0 ? (
              <Empty className="border-0 py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ReceiptTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>Sin artículos en el catálogo</EmptyTitle>
                  <EmptyDescription>
                    Da de alta tus productos o servicios en Alta de Artículos
                    para poder armar la comanda.
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  variant="outline"
                  onClick={() => router.push("/modulos/alta-de-articulos")}
                >
                  Ir a Alta de Artículos
                </Button>
              </Empty>
            ) : articulosFiltrados.length === 0 ? (
              <p role="status" className="text-muted-foreground text-sm">
                Ningún artículo coincide con «{busqueda.trim()}».
              </p>
            ) : (
              <ArticulosAccordion
                articulos={articulosFiltrados}
                modo="seleccion"
                onAgregar={agregarAlCarrito}
                cantidadEnComanda={cantidadEnComanda}
                sinDivideres
              />
            )}

            <div className="flex flex-col gap-3">
              {cart.length === 0 ? (
                <Empty className="border-0 py-6">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ReceiptTextIcon />
                    </EmptyMedia>
                    <EmptyTitle>Aún no hay artículos</EmptyTitle>
                    <EmptyDescription>
                      Busca un artículo o servicio del catálogo y toca el
                      resultado para agregarlo.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {cart.map((item) => (
                    <li
                      key={item.articulo.id}
                      className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug break-words">
                            {item.articulo.nombre}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {item.articulo.sku} ·{" "}
                            {paymentOrderMoney(item.articulo.precioUnitario)} c/u
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Quitar ${item.articulo.nombre} de la comanda`}
                          className="relative after:content-[''] after:absolute after:-inset-2 shrink-0"
                          onClick={() =>
                            setCart((prev) =>
                              prev.filter(
                                (cartItem) =>
                                  cartItem.articulo.id !== item.articulo.id
                              )
                            )
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                        <InputGroup className="h-10 w-36 shrink-0">
                          <InputGroupButton
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Quitar una unidad de ${item.articulo.nombre}`}
                            className="relative after:content-[''] after:absolute after:-inset-2"
                            onClick={() => cambiarCantidad(item.articulo.id, -1)}
                          >
                            <MinusIcon />
                          </InputGroupButton>
                          <InputGroupInput
                            type="number"
                            min="0.001"
                            max="9999.999"
                            step="0.1"
                            value={String(item.cantidad)}
                            aria-label={`Cantidad de ${item.articulo.nombre}`}
                            className="text-center tabular-nums"
                            onChange={(event) => {
                              const valor = Number(event.target.value)
                              if (!Number.isFinite(valor)) return
                              const cantidad = Math.min(9999.999, Math.max(0, valor))
                              setCart((prev) =>
                                prev
                                  .map((cartItem) =>
                                    cartItem.articulo.id === item.articulo.id
                                      ? { ...cartItem, cantidad }
                                      : cartItem
                                  )
                                  .filter((cartItem) => cartItem.cantidad > 0)
                              )
                            }}
                          />
                          <InputGroupButton
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Agregar una unidad de ${item.articulo.nombre}`}
                            className="relative after:content-[''] after:absolute after:-inset-2"
                            onClick={() => cambiarCantidad(item.articulo.id, 1)}
                          >
                            <PlusIcon />
                          </InputGroupButton>
                        </InputGroup>
                        <span className="shrink-0 text-right text-base font-semibold tabular-nums">
                          {paymentOrderMoney(
                            calcularLinea(
                              item.articulo.precioUnitario,
                              item.cantidad
                            )
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {formError ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              {!whatsappConfigured ? (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>Canal no vinculado</AlertTitle>
                  <AlertDescription>
                    Vincula el WhatsApp de tu negocio en Módulos → WhatsApp para
                    poder crear notas digitales.
                  </AlertDescription>
                </Alert>
              ) : null}
              {!scanConfigured ? (
                <p className="text-muted-foreground text-xs">
                  Sin modelo de lectura de comprobantes, las notas quedan en
                  revisión manual para que las confirmes desde el detalle.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground text-sm">Total</span>
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {paymentOrderMoney(total)}
                </span>
              </div>
              <Button
                size="lg"
                className="w-full px-4 sm:w-auto"
                onClick={crearNota}
                disabled={!puedeCrear || isPending}
              >
                {isPending && cart.length > 0 ? "Creando…" : "Crear link de pago"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notas">
          <div className="flex flex-col gap-4">
            <div className="flex flex-row items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                Mis notas digitales
                {notas.length > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground text-sm">
                    {notas.length}
                  </span>
                )}
              </h2>
              <InfoHint
                label="Más información sobre el listado de notas"
                titulo="Mis notas digitales"
              >
                Folio, estado y total de cada comanda. Toca una fila para ver
                el desglose y sus acciones.
              </InfoHint>
            </div>
            <DataGrid
              table={table}
              recordCount={notas.length}
              onRowClick={(nota) => setSelectedId(nota.id)}
              tableLayout={{ dense: true }}
              emptyMessage="Aún no hay notas digitales. Crea la primera en «Crear»."
            >
              <DataGridContainer>
                <DataGridScrollArea>
                  <DataGridTable />
                </DataGridScrollArea>
              </DataGridContainer>
              <div className="px-0 pb-3">
                <DataGridPagination />
              </div>
            </DataGrid>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <SheetContent side="bottom" className="mx-auto max-w-lg gap-0 rounded-t-xl">
          <SheetHeader className="pr-12">
            <SheetTitle>Nota {selected?.code}</SheetTitle>
            <SheetDescription>
              {selected ? dateFormatter.format(new Date(selected.createdAt)) : ""} ·{" "}
              {isAdmin && selected?.creatorUsername
                ? `${selected.creatorUsername} · `
                : ""}
              {selected && (
                <Badge
                  variant={STATUS_BADGE[selected.status].variant}
                  size="sm"
                >
                  {paymentOrderStatusLabel(selected.status)}
                </Badge>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="max-h-[70dvh] overflow-y-auto px-4 pb-2">
            {selected && selected.items.length === 0 ? (
              <Skeleton className="h-20 w-full" aria-hidden />
            ) : (
              <ul className="flex flex-col divide-y">
                {selected?.items.map((linea, indice) => (
                  <li
                    key={`${linea.sku}-${indice}`}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug break-words">
                        {cantidadTexto(linea.cantidad)} {linea.um} × {linea.nombre}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {paymentOrderMoney(linea.precioUnitario)} c/u
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {paymentOrderMoney(linea.importeLinea)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {selected && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 mt-2">
                <span className="text-muted-foreground text-sm">
                  Pagador: {maskPhone(selected.payerPhone)}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {paymentOrderMoney(selected.amountMxn)}
                </span>
              </div>
            )}
          </div>

          <SheetFooter>
            {activa && (
              <>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={() => abrirLink(selected!)}
                  disabled={linkOrderId === selected!.id || isPending}
                >
                  <QrCodeIcon data-icon="inline-start" />
                  {linkOrderId === selected!.id ? "Cargando…" : "Ver QR y link"}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1"
                    onClick={() => {
                      setRejectReason("")
                      setRejectTarget(selected!)
                      setSelectedId(null)
                    }}
                    disabled={busyOrderId === selected!.id || isPending}
                  >
                    Rechazar
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1"
                    onClick={() => resolver(selected!, "approve")}
                    disabled={busyOrderId === selected!.id || isPending}
                  >
                    Marcar pagada
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    setCancelTarget(selected!)
                    setSelectedId(null)
                  }}
                  disabled={busyOrderId === selected!.id || isPending}
                >
                  Cancelar
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <LinkCreadoDialog
        order={created}
        origin="nota"
        onClose={() => setCreated(null)}
      />

      <AlertDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rechazar la nota {rejectTarget?.code}</AlertDialogTitle>
            <AlertDialogDescription>
              El pagador será avisado por WhatsApp. Describe el motivo para que
              pueda corregir su pago.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="motivo-rechazo-nota">Motivo</Label>
            <Input
              id="motivo-rechazo-nota"
              value={rejectReason}
              maxLength={300}
              placeholder="Ej. El comprobante no coincide con el monto"
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejectTarget) resolver(rejectTarget, "reject", rejectReason)
              }}
            >
              Rechazar nota
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar la nota {cancelTarget?.code}</AlertDialogTitle>
            <AlertDialogDescription>
              El código quedará libre. El pagador que llegue tarde verá que la
              nota ya no está activa. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cancelTarget) cancelar(cancelTarget)
              }}
            >
              Cancelar nota
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
