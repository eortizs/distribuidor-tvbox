"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { PackageOpenIcon, RefreshCwIcon } from "lucide-react"

import { Badge } from "@/components/reui/badge"
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { Filters } from "@/components/reui/filters/filters"
import { createFilterQuery } from "@/components/reui/filters/filters-query"
import type { FilterField, FilterQuery } from "@/components/reui/filters/filters-types"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { formatFlujoDate, statusBadgeVariant, type FlujoLicenseRecord } from "@/lib/flujotv"

import { fetchFlujoLicenses } from "./flujo-api"
import { applyFilterQuery } from "./filter-utils"
import { LAB_FILTER_LABELS, LAB_GRID_I18N } from "./lab-i18n"

const LICENSE_FIELDS: FilterField[] = [
  { id: "usuario", label: "Usuario", type: "text" },
  {
    id: "estado",
    label: "Estado",
    type: "select",
    options: [
      { value: "activo", label: "Activo" },
      { value: "vencido", label: "Vencido" },
      { value: "pendiente", label: "Pendiente" },
    ],
  },
  {
    id: "meses",
    label: "Meses",
    type: "select",
    options: [
      { value: "1", label: "1 mes" },
      { value: "3", label: "3 meses" },
      { value: "6", label: "6 meses" },
      { value: "12", label: "12 meses" },
    ],
  },
]

type FetchState = "loading" | "success" | "error"

interface LicenciasPanelProps {
  reloadToken: number
}

export function LicenciasPanel({ reloadToken }: LicenciasPanelProps) {
  const [licenses, setLicenses] = useState<FlujoLicenseRecord[]>([])
  const [endpoint, setEndpoint] = useState<string>("")
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery())
  const [reloadCount, setReloadCount] = useState(0)

  const requestCounter = useRef(0)

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoLicenses()
      .then((data) => {
        if (requestId !== requestCounter.current) return
        setLicenses(data.licenses)
        setEndpoint(data.endpoint)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((error: unknown) => {
        if (requestId !== requestCounter.current) return
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el historial de licencias."
        )
        setFetchState("error")
      })
  }, [reloadToken, reloadCount])

  const reload = useCallback(() => {
    setFetchState("loading")
    setReloadCount((token) => token + 1)
  }, [])

  const filtered = useMemo(
    () =>
      applyFilterQuery(licenses, query, {
        usuario: (row) => row.userName,
        estado: (row) => row.status,
        meses: (row) => row.months,
      }),
    [licenses, query]
  )

  const columns = useMemo<ColumnDef<DataGridFeatures, FlujoLicenseRecord>[]>(
    () => [
      {
        accessorKey: "userName",
        id: "userName",
        header: "Usuario",
        enableHiding: false,
        cell: ({ row }) => (
          <span className="text-foreground truncate font-medium">
            {row.original.userName ?? "—"}
          </span>
        ),
        size: 200,
      },
      {
        accessorKey: "months",
        id: "months",
        header: "Meses",
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap tabular-nums">
            {row.original.months ?? "—"}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: "amount",
        id: "amount",
        header: "Monto",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap tabular-nums">
            {row.original.amount === null
              ? "—"
              : `${row.original.amount}${
                  row.original.currency ? ` ${row.original.currency}` : ""
                }`}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: "issuedAt",
        id: "issuedAt",
        header: "Emitida",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm whitespace-nowrap">
            {formatFlujoDate(row.original.issuedAt)}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "expiresAt",
        id: "expiresAt",
        header: "Vence",
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap">
            {formatFlujoDate(row.original.expiresAt)}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "status",
        id: "status",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant={statusBadgeVariant(row.original.status)} size="sm">
            {row.original.status ?? "sin estado"}
          </Badge>
        ),
        size: 130,
      },
    ],
    []
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filtered,
    getRowId: (row: FlujoLicenseRecord) => row.id,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Filters
          fields={LICENSE_FIELDS}
          query={query}
          onQueryChange={setQuery}
          labels={LAB_FILTER_LABELS}
          size="sm"
          showClear
        />
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={fetchState === "loading"}
        >
          <RefreshCwIcon aria-hidden="true" />
          Recargar
        </Button>
      </div>

      {fetchState === "error" ? (
        <Empty className="border border-dashed" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCwIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No se pudo cargar el historial</EmptyTitle>
            <EmptyDescription>{errorMessage}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={reload}>
              Reintentar
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DataGrid
          table={table}
          recordCount={filtered.length}
          isLoading={fetchState === "loading"}
          i18n={LAB_GRID_I18N}
          tableLayout={{ dense: true }}
          emptyMessage={
            fetchState === "success" ? (
              <Empty className="border-0" role="status">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PackageOpenIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>Sin movimientos de licencia</EmptyTitle>
                  <EmptyDescription>
                    El historial de renovaciones aparecerá aquí.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              "Ningún registro coincide con los filtros."
            )
          }
        >
          <div className="w-full space-y-2.5">
            <DataGridContainer>
              <DataGridScrollArea>
                <DataGridTable />
              </DataGridScrollArea>
            </DataGridContainer>
            <DataGridPagination />
          </div>
        </DataGrid>
      )}

      {fetchState === "success" ? (
        <p className="text-muted-foreground text-xs">
          {filtered.length} de {licenses.length} movimientos · endpoint{" "}
          <span className="font-mono">{endpoint}</span>
        </p>
      ) : null}
    </div>
  )
}
