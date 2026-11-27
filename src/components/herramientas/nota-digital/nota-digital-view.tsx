"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTable, type ColumnDef } from "@tanstack/react-table"
import {
  ChevronRightIcon,
  MinusIcon,
  PlusIcon,
  QrCodeIcon,
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
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/reui/autocomplete"
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

import { LinkCreadoDialog } from "@/components/herramientas/links-pago/link-creado-dialog"
import {
  cancelPaymentOrderAction,
  getPaymentOrderLinkAction,
  resolvePaymentOrderAction,
  type CreatedPaymentOrder,
} from "@/app/actions/links-pago"
import { createNotaDigitalAction } from "@/app/actions/nota-digital"
import type { Articulo } from "@/lib/articulos"
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
  isAdmin: boolean
  whatsappConfigured: boolean
  scanConfigured: boolean
}

function maskPhone(phone: string | null): string {
  if (!phone) return "—"
  return phone.length <= 4 ? phone : `${phone.slice(0, 3)}•••${phone.slice(-3)}`
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
  isAdmin,
  whatsappConfigured,
  scanConfigured,
}: NotaDigitalViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [notas, setNotas] = useState(initialNotas)
  const [serverNotas, setServerNotas] = useState(initialNotas)
  // Adopta el snapshot nuevo del servidor DURANTE el render (patrón de
  // links-pago-view): sin effects, router.refresh() del realtime 'payment_order'
  // trae la fila cambiada y la vista la pinta sin recargar.
  if (serverNotas !== initialNotas) {
    setServerNotas(initialNotas)
    setNotas(initialNotas)
  }

  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedPaymentOrder | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<NotaDigitalListItem | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [cancelTarget, setCancelTarget] = useState<NotaDigitalListItem | null>(null)
  const [linkOrderId, setLinkOrderId] = useState<string | null>(null)
  const seqRef = useRef(0)

  // El timer mantiene el setState fuera del cuerpo sincrónico del efecto
  // (regla react-hooks/set-state-in-effect): la búsqueda corre 300 ms después
  // de dejar de escribir, con guardia de secuencia para descartar respuestas
  // tardías de un término anterior.
  useEffect(() => {
    const termino = busqueda.trim()
    const timer = setTimeout(() => {
      if (termino.length < 2) {
        setResultados([])
        setBuscando(false)
        return
      }
      const seq = ++seqRef.current
      setBuscando(true)
      const params = new URLSearchParams({
        q: termino,
        status: "active",
        disponible: "true",
        pageSize: "20",
      })
      fetch(`/api/articulos?${params.toString()}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((json: { data?: Articulo[] }) => {
          if (seq !== seqRef.current) return
          setResultados(Array.isArray(json?.data) ? json.data : [])
        })
        .catch(() => {
          if (seq === seqRef.current) setResultados([])
        })
        .finally(() => {
          if (seq === seqRef.current) setBuscando(false)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [busqueda])

  function agregarAlCarrito(articulo: Articulo) {
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
    setResultados([])
    setFormError(null)
  }

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
      <Frame className="flex flex-1 flex-col">
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Nueva nota digital</FrameTitle>
          <FrameDescription>
            Arma la comanda con artículos de tu catálogo y genera un link de
            pago con QR. Cuando se confirme el depósito, el pagador recibe su
            nota desglosada por WhatsApp.
          </FrameDescription>
        </FrameHeader>

        <div className="p-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="buscar-articulo-nota">Buscar artículos o servicios</Label>
            <Autocomplete
              items={resultados}
              value={busqueda}
              onValueChange={setBusqueda}
              autoHighlight="always"
              itemToStringValue={(articulo) => articulo.nombre}
            >
              <AutocompleteInput
                id="buscar-articulo-nota"
                aria-label="Buscar artículos o servicios del catálogo"
                placeholder="Escribe el nombre o SKU (mínimo 2 letras)"
              />
              <AutocompleteContent>
                <AutocompleteEmpty>
                  {buscando
                    ? "Buscando…"
                    : resultados.length === 0
                      ? "Sin artículos disponibles con esa búsqueda."
                      : "Sin resultados."}
                </AutocompleteEmpty>
                <AutocompleteList>
                  {(articulo) => (
                    <AutocompleteItem
                      key={articulo.id}
                      value={articulo}
                      className="min-h-11"
                      onClick={() => agregarAlCarrito(articulo)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {articulo.nombre}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {articulo.sku} · {articulo.um} ·{" "}
                          {paymentOrderMoney(articulo.precioUnitario)}
                        </span>
                      </span>
                      <PlusIcon className="size-4" aria-hidden="true" />
                    </AutocompleteItem>
                  )}
                </AutocompleteList>
              </AutocompleteContent>
            </Autocomplete>
          </div>

          {cart.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              Aún no hay renglones. Busca un artículo y toca el resultado para
              agregarlo a la comanda.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {cart.map((item) => (
                <li
                  key={item.articulo.id}
                  className="bg-muted/50 flex items-center gap-3 rounded-lg p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.articulo.nombre}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {item.articulo.sku} ·{" "}
                      {paymentOrderMoney(item.articulo.precioUnitario)} c/u
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Quitar una unidad de ${item.articulo.nombre}`}
                      className="relative after:content-[''] after:absolute after:-inset-2"
                      onClick={() => cambiarCantidad(item.articulo.id, -1)}
                    >
                      <MinusIcon />
                    </Button>
                    <Input
                      type="number"
                      min="0.001"
                      max="9999.999"
                      step="0.1"
                      value={String(item.cantidad)}
                      aria-label={`Cantidad de ${item.articulo.nombre}`}
                      className="h-9 w-20 text-center tabular-nums"
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
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Agregar una unidad de ${item.articulo.nombre}`}
                      className="relative after:content-[''] after:absolute after:-inset-2"
                      onClick={() => cambiarCantidad(item.articulo.id, 1)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                    {paymentOrderMoney(calcularLinea(item.articulo.precioUnitario, item.cantidad))}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Quitar ${item.articulo.nombre} de la comanda`}
                    className="relative after:content-[''] after:absolute after:-inset-2"
                    onClick={() =>
                      setCart((prev) =>
                        prev.filter((cartItem) => cartItem.articulo.id !== item.articulo.id)
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {formError ? (
            <Alert variant="destructive" className="mt-4">
              <TriangleAlertIcon />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {!whatsappConfigured ? (
            <Alert className="mt-4">
              <TriangleAlertIcon />
              <AlertTitle>Canal no vinculado</AlertTitle>
              <AlertDescription>
                Vincula el WhatsApp de tu negocio en Módulos → WhatsApp para
                poder crear notas digitales.
              </AlertDescription>
            </Alert>
          ) : null}
          {!scanConfigured ? (
            <p className="text-muted-foreground mt-3 text-xs">
              Sin modelo de lectura de comprobantes, las notas quedan en
              revisión manual para que las confirmes desde el detalle.
            </p>
          ) : null}
        </div>

        <FrameFooter className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-sm">Total</span>
            <span className="text-xl font-semibold tabular-nums">
              {paymentOrderMoney(total)}
            </span>
          </div>
          <Button size="lg" onClick={crearNota} disabled={!puedeCrear || isPending}>
            {isPending && cart.length > 0 ? "Creando…" : "Crear link de pago"}
          </Button>
        </FrameFooter>
      </FramePanel>

      <FramePanel className="p-0">
        <FrameHeader>
          <FrameTitle>Mis notas digitales</FrameTitle>
          <FrameDescription>
            Folio, estado y total de cada comanda. Toca una fila para ver el
            desglose y sus acciones.
          </FrameDescription>
        </FrameHeader>
        <DataGrid
          table={table}
          recordCount={notas.length}
          onRowClick={(nota) => setSelectedId(nota.id)}
          tableLayout={{ dense: true }}
          emptyMessage="Aún no hay notas digitales. Arma tu primera comanda arriba."
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

      {selected ? (
        <FramePanel>
          <FrameHeader className="flex-row items-start justify-between gap-3">
            <div>
              <FrameTitle>Nota {selected.code}</FrameTitle>
              <FrameDescription>
                {dateFormatter.format(new Date(selected.createdAt))} ·{" "}
                {isAdmin && selected.creatorUsername
                  ? `${selected.creatorUsername} · `
                  : ""}
                <Badge
                  variant={STATUS_BADGE[selected.status].variant}
                  size="sm"
                >
                  {paymentOrderStatusLabel(selected.status)}
                </Badge>
              </FrameDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar el detalle"
              className="relative after:content-[''] after:absolute after:-inset-2"
              onClick={() => setSelectedId(null)}
            >
              <XIcon />
            </Button>
          </FrameHeader>

          {selected.items.length === 0 ? (
            <Skeleton className="mx-5 h-20" />
          ) : (
            <ul className="mx-5 flex flex-col gap-2">
              {selected.items.map((linea, indice) => (
                <li
                  key={`${linea.sku}-${indice}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {cantidadTexto(linea.cantidad)} {linea.um} × {linea.nombre}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {paymentOrderMoney(linea.precioUnitario)} c/u
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {paymentOrderMoney(linea.importeLinea)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-muted-foreground text-sm">
              Pagador: {maskPhone(selected.payerPhone)}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {paymentOrderMoney(selected.amountMxn)}
            </span>
          </div>

          <FrameFooter className="flex flex-wrap items-center justify-end gap-2">
            {activa ? (
              <Button
                variant="outline"
                size="lg"
                onClick={() => abrirLink(selected)}
                disabled={linkOrderId === selected.id || isPending}
              >
                <QrCodeIcon data-icon="inline-start" />
                {linkOrderId === selected.id ? "Cargando…" : "Ver QR y link"}
              </Button>
            ) : null}
            {activa ? (
              <>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    setRejectReason("")
                    setRejectTarget(selected)
                  }}
                  disabled={busyOrderId === selected.id || isPending}
                >
                  Rechazar
                </Button>
                <Button
                  size="lg"
                  onClick={() => resolver(selected, "approve")}
                  disabled={busyOrderId === selected.id || isPending}
                >
                  Marcar pagada
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => setCancelTarget(selected)}
                  disabled={busyOrderId === selected.id || isPending}
                >
                  Cancelar
                </Button>
              </>
            ) : null}
          </FrameFooter>
        </FramePanel>
      ) : null}
    </Frame>

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
