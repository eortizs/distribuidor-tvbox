"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCwIcon, ReceiptTextIcon } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ColumnDef,
  useTable,
} from "@tanstack/react-table"

import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  formatDay,
  formatMxn,
  formatMonthKey,
  mxToday,
  type ExpenseSummary,
  type ExpenseSummaryBucket,
} from "@/lib/finanzas"

type Period = "mes" | "3m" | "year"

interface SummaryResponse {
  ok: boolean
  data?: ExpenseSummary
  error?: { message: string }
}

const PERIOD_OPTIONS: { value: Period; label: string; months: number }[] = [
  { value: "mes", label: "Este mes", months: 1 },
  { value: "3m", label: "Últimos 3 meses", months: 3 },
  { value: "year", label: "Este año", months: 0 },
]

function resolveRange(period: Period): { from: string; to: string } {
  const today = mxToday()
  const [y, m] = today.split("-").map(Number)
  if (period === "mes") {
    return { from: `${today.slice(0, 7)}-01`, to: today }
  }
  if (period === "3m") {
    const start = new Date(Date.UTC(y, m - 3, 1))
    const from = start.toISOString().slice(0, 10)
    return { from, to: today }
  }
  return { from: `${y}-01-01`, to: today }
}

function monthsInPeriod(period: Period): number {
  if (period === "mes") return 1
  if (period === "3m") return 3
  return Number(mxToday().slice(5, 7))
}

const chartConfig = {
  total: {
    label: "Gastos",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

export function EstadoCuentaView() {
  const [period, setPeriod] = useState<Period>("year")
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [fetchState, setFetchState] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const range = useMemo(() => resolveRange(period), [period])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ from: range.from, to: range.to })
    fetch(`/api/finanzas/estado-de-cuenta?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => res.json() as Promise<SummaryResponse>)
      .then((json) => {
        if (!json.ok || !json.data) {
          throw new Error(json.error?.message ?? "No se pudo cargar el estado de cuenta.")
        }
        setSummary(json.data)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "No se pudo cargar el estado de cuenta."
        )
        setFetchState("error")
      })
    return () => controller.abort()
  }, [range, reloadToken])

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const months = monthsInPeriod(period)
  const average =
    summary && summary.byMonth.length > 0
      ? summary.totalMxn / Math.max(months, 1)
      : 0

  const chartData = useMemo(
    () =>
      (summary?.byMonth ?? []).map((bucket) => ({
        month: formatMonthKey(bucket.key),
        total: bucket.totalMxn,
      })),
    [summary]
  )

  const columns = useMemo<
    ColumnDef<DataGridFeatures, ExpenseSummaryBucket>[]
  >(
    () => [
      {
        accessorKey: "key",
        id: "category",
        header: "Categoría",
        enableHiding: false,
        cell: ({ row }) => (
          <Badge variant="outline" size="sm">
            {row.original.key}
          </Badge>
        ),
        size: 160,
      },
      {
        accessorKey: "count",
        id: "count",
        header: "Gastos",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) => (
          <span className="text-foreground tabular-nums">{row.original.count}</span>
        ),
        size: 110,
      },
      {
        accessorKey: "totalMxn",
        id: "totalMxn",
        header: "Total MXN",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) => (
          <span className="text-foreground font-medium tabular-nums">
            {formatMxn(row.original.totalMxn)}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "usdPending",
        id: "usdPending",
        header: "USD pendiente",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) =>
          row.original.usdPending > 0 ? (
            <span className="text-foreground tabular-nums">
              ${row.original.usdPending.toLocaleString("es-MX")} USD
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
        size: 140,
      },
    ],
    []
  )

  const categoryTable = useTable({
    features: dataGridFeatures,
    columns,
    data: summary?.byCategory ?? [],
    getRowId: (row: ExpenseSummaryBucket) => row.key,
  })

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">
            Estado de cuenta
          </h1>
          <p className="text-muted-foreground text-sm">
            Resumen de tus gastos del periodo, convertidos a MXN con el tipo de
            cambio Banxico de cada día.
          </p>
        </div>
        <Select
          value={period}
          onValueChange={(value) => {
            setPeriod((value ?? "year") as Period)
            setFetchState("loading")
          }}
        >
          <SelectTrigger className="w-48" aria-label="Periodo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fetchState === "error" ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCwIcon />
            </EmptyMedia>
            <EmptyTitle>No se pudo cargar el estado de cuenta</EmptyTitle>
            <EmptyDescription>{errorMessage}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={retry}>
              Reintentar
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              title="Total del periodo (MXN)"
              value={
                fetchState === "loading" ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  formatMxn(summary?.totalMxn ?? 0)
                )
              }
              meta={`Del ${formatDay(range.from)} al ${formatDay(range.to)}`}
            />
            <Kpi
              title="Gastos del periodo"
              value={
                fetchState === "loading" ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  String(summary?.count ?? 0)
                )
              }
              meta={
                (summary?.usdPendingCount ?? 0) > 0
                  ? `${summary?.usdPendingCount} en USD sin conversión`
                  : "Todos convertidos a MXN"
              }
            />
            <Kpi
              title="Promedio mensual"
              value={
                fetchState === "loading" ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  formatMxn(Math.round(average * 100) / 100)
                )
              }
              meta="Sobre meses transcurridos del periodo"
            />
            <Kpi
              title="Categoría principal"
              value={
                fetchState === "loading" ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  (summary?.byCategory[0]?.key ?? "Sin gastos")
                )
              }
              meta={
                fetchState === "success" && summary?.byCategory[0]
                  ? formatMxn(summary.byCategory[0].totalMxn)
                  : "Aún sin datos en este periodo"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card className="w-full xl:col-span-3">
              <CardHeader>
                <CardTitle>Gastos por mes</CardTitle>
                <CardDescription>
                  Equivalentes en MXN, mes calendario (Ciudad de México).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {fetchState === "loading" ? (
                  <Skeleton className="h-64 w-full" />
                ) : chartData.length === 0 ? (
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ReceiptTextIcon />
                      </EmptyMedia>
                      <EmptyTitle>Sin gastos en el periodo</EmptyTitle>
                      <EmptyDescription>
                        Cuando registres gastos verás aquí su distribución
                        mensual.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" render={<Link href="/finanzas/gastos" />}>
                        Ir a Gastos
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <ChartContainer config={chartConfig} className="h-64 w-full">
                    <BarChart
                      accessibilityLayer
                      data={chartData}
                      margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tickFormatter={(value) =>
                          `$${Number(value).toLocaleString("es-MX")}`
                        }
                      />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent indicator="dot" />}
                      />
                      <Bar
                        dataKey="total"
                        fill="var(--color-total)"
                        radius={4}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="w-full xl:col-span-2">
              <CardHeader>
                <CardTitle>Desglose por categoría</CardTitle>
                <CardDescription>
                  Distribución del gasto del periodo por categoría.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {fetchState === "loading" ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : (summary?.byCategory.length ?? 0) === 0 ? (
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <ReceiptTextIcon />
                      </EmptyMedia>
                      <EmptyTitle>Nada que desglosar</EmptyTitle>
                      <EmptyDescription>
                        Registra gastos para ver el desglose por categoría.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" render={<Link href="/finanzas/gastos" />}>
                        Ir a Gastos
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <DataGrid
                    table={categoryTable}
                    recordCount={summary?.byCategory.length ?? 0}
                    tableLayout={{ dense: true }}
                  >
                    <DataGridContainer>
                      <DataGridScrollArea>
                        <DataGridTable />
                      </DataGridScrollArea>
                    </DataGridContainer>
                  </DataGrid>
                )}
              </CardContent>
            </Card>
          </div>

          {(summary?.usdPendingCount ?? 0) > 0 ? (
            <p className="text-muted-foreground text-xs">
              Hay {summary?.usdPendingCount} gasto(s) en USD por{" "}
              ${summary?.usdPending.toLocaleString("es-MX")} sin tipo de cambio
              disponible al registrarse; no están incluidos en los totales en
              MXN. Edítalos en Gastos para recalcular la conversión.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function Kpi({
  title,
  value,
  meta,
}: {
  title: string
  value: React.ReactNode
  meta: string
}) {
  return (
    <Card className="w-full">
      <CardContent className="flex flex-col gap-2.5">
        <h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
        <span className="text-foreground text-2xl font-medium tracking-tight tabular-nums">
          {value}
        </span>
        <Separator />
        <p className="text-muted-foreground text-xs">{meta}</p>
      </CardContent>
    </Card>
  )
}
