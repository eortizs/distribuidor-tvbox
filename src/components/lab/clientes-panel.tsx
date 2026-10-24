"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PackageOpenIcon,
  RefreshCwIcon,
} from "lucide-react"

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
import type {
  FilterField,
  FilterQuery,
} from "@/components/reui/filters/filters-types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  formatDaysRemaining,
  formatFlujoDate,
  statusBadgeVariant,
  type FlujoClient,
} from "@/lib/flujotv"

import { fetchFlujoClients } from "./flujo-api"
import { applyFilterQuery } from "./filter-utils"
import { LAB_FILTER_LABELS, LAB_GRID_I18N } from "./lab-i18n"

const CLIENT_FIELDS: FilterField[] = [
  { id: "usuario", label: "Usuario", type: "text" },
  { id: "correo", label: "Correo", type: "text" },
  {
    id: "estado",
    label: "Estado",
    type: "select",
    options: [
      { value: "activo", label: "Activo" },
      { value: "vencido", label: "Vencido" },
      { value: "pendiente", label: "Pendiente" },
      { value: "prueba", label: "Prueba" },
    ],
  },
  { id: "plan", label: "Plan", type: "text" },
]

type FetchState = "loading" | "success" | "error"

interface ClientesPanelProps {
  reloadToken: number
  onRenew: (userName: string) => void
}

export function ClientesPanel({ reloadToken, onRenew }: ClientesPanelProps) {
  const [clients, setClients] = useState<FlujoClient[]>([])
  const [endpoint, setEndpoint] = useState<string>("")
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [includeCredentials, setIncludeCredentials] = useState(false)
  const [query, setQuery] = useState<FilterQuery>(() => createFilterQuery())
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [reloadCount, setReloadCount] = useState(0)

  const requestCounter = useRef(0)

  useEffect(() => {
    // Solo se rearma la petición cuando el texto realmente cambia: si no, el
    // temporizador dejaría la tabla en estado de carga sin volver a preguntar.
    if (searchInput === search) return
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setFetchState("loading")
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput, search])

  useEffect(() => {
    const requestId = ++requestCounter.current
    fetchFlujoClients({
      query: search.trim() || undefined,
      includeCredentials,
    })
      .then((data) => {
        if (requestId !== requestCounter.current) return
        setClients(data.clients)
        setEndpoint(data.endpoint)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((error: unknown) => {
        if (requestId !== requestCounter.current) return
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los clientes."
        )
        setFetchState("error")
      })
  }, [search, includeCredentials, reloadToken, reloadCount])

  const reload = useCallback(() => {
    setFetchState("loading")
    setReloadCount((token) => token + 1)
  }, [])

  const filtered = useMemo(
    () =>
      applyFilterQuery(clients, query, {
        usuario: (row) => row.userName,
        correo: (row) => row.email,
        estado: (row) => row.statusLabel,
        plan: (row) => row.plan,
      }),
    [clients, query]
  )

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const columns = useMemo<
    ColumnDef<DataGridFeatures, FlujoClient>[]
  >(
    () => [
      {
        accessorKey: "userName",
        id: "userName",
        header: "Usuario",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground truncate font-medium">
              {row.original.userName}
            </span>
            {row.original.notes ? (
              <span className="text-muted-foreground truncate text-xs">
                {row.original.notes}
              </span>
            ) : null}
          </div>
        ),
        size: 200,
      },
      {
        accessorKey: "email",
        id: "email",
        header: "Correo",
        cell: ({ row }) => (
          <span className="text-muted-foreground truncate text-sm">
            {row.original.email ?? "—"}
          </span>
        ),
        size: 220,
      },
      {
        accessorKey: "statusLabel",
        id: "statusLabel",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant={statusBadgeVariant(row.original.status)} size="sm">
            {row.original.statusLabel}
          </Badge>
        ),
        size: 120,
      },
      {
        accessorKey: "plan",
        id: "plan",
        header: "Plan",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.plan ?? "—"}
          </span>
        ),
        size: 130,
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
        size: 140,
      },
      {
        accessorKey: "daysRemaining",
        id: "daysRemaining",
        header: "Días",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
            {formatDaysRemaining(row.original.daysRemaining)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: "password",
        id: "password",
        header: "Credenciales",
        enableSorting: false,
        cell: ({ row }) => {
          const password = row.original.password
          if (!password) {
            return (
              <span className="text-muted-foreground/60 text-sm">—</span>
            )
          }
          const isRevealed = Boolean(revealed[row.original.id])
          return (
            <div className="flex items-center gap-1">
              <span className="font-mono text-xs">
                {isRevealed ? password : "•".repeat(10)}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={
                  isRevealed
                    ? `Ocultar la clave de ${row.original.userName}`
                    : `Mostrar la clave de ${row.original.userName}`
                }
                onClick={() => toggleReveal(row.original.id)}
              >
                {isRevealed ? (
                  <EyeOffIcon aria-hidden="true" />
                ) : (
                  <EyeIcon aria-hidden="true" />
                )}
              </Button>
            </div>
          )
        },
        size: 170,
      },
      {
        accessorKey: "id",
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-end">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onRenew(row.original.userName)}
              aria-label={`Renovar la licencia de ${row.original.userName}`}
            >
              <KeyRoundIcon aria-hidden="true" />
              Renovar
            </Button>
          </div>
        ),
        size: 120,
      },
    ],
    [onRenew, revealed, toggleReveal]
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filtered,
    getRowId: (row: FlujoClient) => row.id,
  })

  const hasFilters = query.rules.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full max-w-md">
          <FieldLabel htmlFor="flujo-busqueda">Buscar en el panel</FieldLabel>
          <Input
            id="flujo-busqueda"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Usuario o correo…"
            aria-label="Buscar clientes en el panel de FlujoTV"
          />
        </Field>
        <div className="flex items-center gap-2 pb-0.5">
          <Checkbox
            id="flujo-credenciales"
            checked={includeCredentials}
            onCheckedChange={(checked) => {
              setFetchState("loading")
              setIncludeCredentials(checked === true)
            }}
          />
          <label
            htmlFor="flujo-credenciales"
            className="text-muted-foreground text-sm select-none"
          >
            Incluir credenciales
          </label>
        </div>
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

      <Filters
        fields={CLIENT_FIELDS}
        query={query}
        onQueryChange={setQuery}
        labels={LAB_FILTER_LABELS}
        size="sm"
        showClear
      />

      {fetchState === "error" ? (
        <Empty className="border border-dashed" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCwIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No se pudieron cargar los clientes</EmptyTitle>
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
            fetchState === "success" && !hasFilters ? (
              <Empty className="border-0" role="status">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PackageOpenIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>El panel no devolvió clientes</EmptyTitle>
                  <EmptyDescription>
                    Ajusta la búsqueda o refresca los datos del panel para
                    sincronizarlos.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              "Ningún cliente coincide con los filtros."
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
          {filtered.length} de {clients.length} clientes · endpoint{" "}
          <span className="font-mono">{endpoint}</span>
        </p>
      ) : null}
    </div>
  )
}
