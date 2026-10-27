"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { RefreshCwIcon, StoreIcon } from "lucide-react"

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
import type { FlujoReseller, FlujoResellersResponse } from "@/lib/flujotv"

import { fetchFlujoResellers } from "./flujo-api"
import { applyFilterQuery } from "./filter-utils"
import { LAB_FILTER_LABELS, LAB_GRID_I18N } from "./lab-i18n"

const RESELLER_FIELDS: FilterField[] = [
  { id: "reseller", label: "Reseller", type: "text" },
]

type FetchState = "loading" | "success" | "error"

interface ResellersPanelProps {
  reloadToken: number
}

export function ResellersPanel({ reloadToken }: ResellersPanelProps) {
  const [resellers, setResellers] = useState<FlujoReseller[]>([])
  const [meta, setMeta] = useState<Omit<
    FlujoResellersResponse,
    "resellers" | "endpoint"
  > | null>(null)
  const [endpoint, setEndpoint] = useState<string>("")
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery())
  const [reloadCount, setReloadCount] = useState(0)

  const requestCounter = useRef(0)

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoResellers()
      .then((data) => {
        if (requestId !== requestCounter.current) return
        setResellers(data.resellers)
        setMeta({
          totalResellers: data.totalResellers,
          clientsWithoutDistributor: data.clientsWithoutDistributor,
          fromCache: data.fromCache,
          cacheAge: data.cacheAge,
          searchTerm: data.searchTerm,
        })
        setEndpoint(data.endpoint)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((error: unknown) => {
        if (requestId !== requestCounter.current) return
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la disponibilidad de resellers."
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
      applyFilterQuery(resellers, query, {
        reseller: (row) => row.name,
      }),
    [resellers, query]
  )

  const columns = useMemo<ColumnDef<DataGridFeatures, FlujoReseller>[]>(
    () => [
      {
        accessorKey: "name",
        id: "name",
        header: "Reseller",
        enableHiding: false,
        cell: ({ row }) => (
          <span className="text-foreground truncate font-medium">
            {row.original.name}
          </span>
        ),
        size: 220,
      },
      {
        accessorKey: "activeClients",
        id: "activeClients",
        header: "Clientes activos",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap tabular-nums">
            {row.original.activeClients ?? "—"}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: "inactiveClients",
        id: "inactiveClients",
        header: "Clientes inactivos",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) => (
          <span
            className={
              row.original.inactiveClients
                ? "text-destructive text-sm whitespace-nowrap tabular-nums"
                : "text-muted-foreground text-sm whitespace-nowrap tabular-nums"
            }
          >
            {row.original.inactiveClients ?? "—"}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "clientsCount",
        id: "clientsCount",
        header: "Clientes asignados",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap tabular-nums">
            {row.original.clientsCount ?? "—"}
          </span>
        ),
        size: 170,
      },
    ],
    []
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filtered,
    getRowId: (row: FlujoReseller) => row.id,
  })

  // Solo se llega aquí con lectura exitosa: `success: false` lanza en el
  // servidor. `from_cache: false` significa que la API no tenía caché.
  const cacheLabel =
    meta === null
      ? null
      : meta.fromCache === true
        ? `caché de la API${meta.cacheAge ? ` (${meta.cacheAge})` : ""}`
        : meta.fromCache === false
          ? "sin caché"
          : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Filters
          fields={RESELLER_FIELDS}
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
            <EmptyTitle>No se pudo cargar la disponibilidad</EmptyTitle>
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
            resellers.length === 0 ? (
              <Empty className="border-0" role="status">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <StoreIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>Sin resellers registrados</EmptyTitle>
                  <EmptyDescription>
                    La disponibilidad de resellers aparecerá aquí.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              "Ningún reseller coincide con los filtros."
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
          {filtered.length} de {resellers.length} resellers
          {meta?.clientsWithoutDistributor !== null &&
          meta?.clientsWithoutDistributor !== undefined
            ? ` · ${meta.clientsWithoutDistributor} clientes sin distribuidor`
            : ""}
          {meta?.searchTerm ? ` · búsqueda «${meta.searchTerm}»` : ""}
          {cacheLabel ? ` · ${cacheLabel}` : ""}
          {endpoint ? (
            <>
              {" · endpoint "}
              <span className="font-mono">{endpoint}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
