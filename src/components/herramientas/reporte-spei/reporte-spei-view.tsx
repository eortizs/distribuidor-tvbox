"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useTable, type ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

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
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  SpeiDayReport,
  SpeiDepositRow,
} from "@/server/mercadopago/spei"

/*
 * Vista del módulo «Reporte SPEI»: depósitos por transferencia bancaria
 * (SPEI a la CLABE) acreditados en Mercado Pago para un día calendario de
 * CDMX. El primer día llega servido por la RSC; cambiar de fecha o
 * refrescar consulta `GET /api/mercadopago/spei` en vivo.
 */

const TZ = "America/Mexico_City"

const horaFmt = new Intl.DateTimeFormat("es-MX", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

const montoFmt = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
})

const diaFmt = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

function fmtHora(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : horaFmt.format(date)
}

function diaLabel(day: string): string {
  return diaFmt.format(new Date(`${day}T12:00:00Z`))
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

async function copyText(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copiado al portapapeles`)
  } catch {
    toast.error("No se pudo copiar al portapapeles")
  }
}

export function ReporteSpeiView({
  initialReport,
  initialError,
  today,
}: {
  /** Reporte del día actual servido por la RSC; null si el primer fetch falló. */
  initialReport: SpeiDayReport | null
  /** Error del primer fetch server-side, para mostrarlo sin romper el render. */
  initialError: string | null
  /** Hoy en CDMX (`YYYY-MM-DD`): tope del selector y botón «Hoy». */
  today: string
}) {
  const [date, setDate] = useState(initialReport?.day ?? today)
  const [report, setReport] = useState<SpeiDayReport | null>(initialReport)
  const [error, setError] = useState<string | null>(initialError)
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** El primer render ya trae datos del servidor: no volver a pedirlos. */
  const skipFirstFetch = useRef(true)
  /** Secuencia de cargas: descarta respuestas que llegan tarde. */
  const loadSeq = useRef(0)

  const load = useCallback(async (day: string) => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/mercadopago/spei?fecha=${encodeURIComponent(day)}`,
        { cache: "no-store" }
      )
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: SpeiDayReport; error?: { message?: string } }
        | null
      if (seq !== loadSeq.current) return
      if (!response.ok || !payload?.ok || !payload.data) {
        setError(
          payload?.error?.message ??
            "No se pudo consultar Mercado Pago. Intenta de nuevo."
        )
        return
      }
      setReport(payload.data)
    } catch {
      if (seq !== loadSeq.current) return
      setError("No se pudo consultar Mercado Pago. Intenta de nuevo.")
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false
      return
    }
    void load(date)
  }, [date, load])

  const copyId = useCallback(async (id: string) => {
    setCopiedId(id)
    await copyText(id, "El ID de la operación")
    window.setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const columns = useMemo<
    ColumnDef<DataGridFeatures, SpeiDepositRow>[]
  >(
    () => [
      {
        accessorKey: "dateApproved",
        id: "dateApproved",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Hora" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {fmtHora(row.original.dateApproved)}
          </span>
        ),
        size: 110,
      },
      {
        accessorKey: "rail",
        id: "rail",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Vía" />
        ),
        cell: ({ row }) =>
          row.original.rail === "wallet" ? (
            <Badge size="sm" radius="full" variant="info-light">
              Billetera MP
            </Badge>
          ) : (
            <Badge size="sm" radius="full" variant="secondary">
              SPEI
            </Badge>
          ),
        size: 120,
      },
      {
        accessorKey: "amountMxn",
        id: "amountMxn",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Monto" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground text-sm font-medium tabular-nums">
            {montoFmt.format(row.original.amountMxn)}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "conceptCode",
        id: "concept",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Concepto" />
        ),
        cell: ({ row }) => {
          const code = row.original.conceptCode
          if (!code) {
            return <span className="text-muted-foreground text-xs">—</span>
          }
          return (
            <div
              className="flex flex-col"
              title={
                row.original.conceptAmbiguous
                  ? "Varios conceptos calzan con este depósito"
                  : undefined
              }
            >
              <span className="text-foreground font-mono text-xs font-medium tracking-wider">
                {code}
              </span>
              {row.original.conceptUserName ? (
                <span className="text-muted-foreground text-xs">
                  {row.original.conceptUserName}
                </span>
              ) : null}
            </div>
          )
        },
        size: 140,
      },
      {
        accessorKey: "id",
        id: "id",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="ID de operación" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">
            {row.original.id}
          </span>
        ),
        size: 200,
      },
      {
        accessorKey: "payerName",
        id: "payer",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Pagador" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground text-xs">
            {row.original.payerName ?? row.original.payerEmail ?? "—"}
          </span>
        ),
        size: 220,
      },
      {
        accessorKey: "externalReference",
        id: "externalReference",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Referencia" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-1 max-w-[200px] text-xs">
            {row.original.externalReference ?? "—"}
          </span>
        ),
        size: 200,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="relative after:content-[''] after:absolute after:-inset-2"
            onClick={() => void copyId(row.original.id)}
            aria-label={`Copiar ID de la operación ${row.original.id}`}
          >
            {copiedId === row.original.id ? (
              <CheckIcon className="size-4" aria-hidden="true" />
            ) : (
              <CopyIcon className="size-4" aria-hidden="true" />
            )}
          </Button>
        ),
        size: 60,
      },
    ],
    [copyId, copiedId]
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: report?.day === date ? report.deposits : [],
    getRowId: (row: SpeiDepositRow) => row.id,
  })

  // Solo los datos del día seleccionado alimentan resumen y tabla: si un
  // fetch falla o una respuesta tarde fue descartada, el reporte del otro
  // día NO se muestra bajo la etiqueta equivocada.
  const current = report !== null && report.day === date ? report : null
  const isToday = date === today

  return (
    <Frame spacing="default" className="w-full">
      <FrameHeader>
        <FrameTitle className="text-xl font-semibold">Reporte SPEI</FrameTitle>
        <FrameDescription>
          Depósitos acreditados en la cuenta de Mercado Pago por día calendario
          de Ciudad de México, en dos vías: SPEI a la CLABE y transferencia
          desde el saldo de otra cuenta MP. El concepto corresponde al código
          de pago que la app entrega al comprador; el «motivo» escrito a mano
          en el banco no lo expone la API de Mercado Pago.
        </FrameDescription>
      </FrameHeader>

      <FramePanel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              className="relative after:content-[''] after:absolute after:-inset-2"
              onClick={() => setDate(shiftDay(date, -1))}
              disabled={loading}
              aria-label="Día anterior"
            >
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
            </Button>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(event) => {
                const value = event.target.value
                if (value.length > 0) setDate(value)
              }}
              className="w-[160px]"
              aria-label="Día del reporte"
            />
            <Button
              variant="outline"
              size="icon-sm"
              className="relative after:content-[''] after:absolute after:-inset-2"
              onClick={() => setDate(shiftDay(date, 1))}
              disabled={loading || isToday}
              aria-label="Día siguiente"
            >
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDate(today)}
              disabled={loading || isToday}
            >
              Hoy
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(date)}
            disabled={loading}
          >
            <RefreshCwIcon
              className={loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            Actualizar
          </Button>
        </div>
      </FramePanel>

      <FramePanel>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Día</span>
            <span className="text-base font-medium capitalize">
              {diaLabel(date)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Depósitos</span>
            <span className="text-base font-medium tabular-nums">
              {current?.count ?? 0}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">
              Total depositado
            </span>
            <span className="text-base font-semibold tabular-nums">
              {montoFmt.format(current?.totalMxn ?? 0)}
            </span>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive" className="mt-3">
            <AlertTitle>No se pudo cargar el reporte</AlertTitle>
            <AlertDescription>
              {error} Usa «Actualizar» para reintentar.
            </AlertDescription>
          </Alert>
        ) : null}
        {current?.truncated ? (
          <div className="mt-3">
            <Badge variant="warning-light">
              El día superó el tope de consulta de Mercado Pago: se muestran
              los primeros {current.count} depósitos y el total puede ser
              parcial.
            </Badge>
          </div>
        ) : null}
      </FramePanel>

      <FramePanel className="p-0">
        <DataGrid
          table={table}
          recordCount={current?.deposits.length ?? 0}
          tableLayout={{ dense: true }}
          emptyMessage={
            loading
              ? "Consultando Mercado Pago…"
              : "Sin depósitos acreditados este día."
          }
        >
          <DataGridContainer>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
        </DataGrid>
      </FramePanel>
    </Frame>
  )
}
