"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { BoxesIcon, RefreshCwIcon } from "lucide-react"
import {
  ColumnDef,
  PaginationState,
  useTable,
} from "@tanstack/react-table"

export interface EntityListItem {
  id: string
  entityName: string
  state: string
  version: number
  updatedAt: string
}

interface ListResponse {
  ok: boolean
  data?: {
    items: {
      id: string
      entityName: string
      version: number
      updatedAt: string
      doc: { state?: { current?: string } }
    }[]
    total: number
  }
  error?: { code: string; message: string }
}

type FetchState = "loading" | "success" | "error"

const stateBadgeVariant: Record<
  string,
  "success-light" | "warning-light" | "info-light"
> = {
  active: "success-light",
  draft: "warning-light",
  validation_required: "info-light",
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso))
}

export function EntityList() {
  const router = useRouter()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [entityName, setEntityName] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [debouncedEntityName, setDebouncedEntityName] = useState("")
  const [items, setItems] = useState<EntityListItem[]>([])
  const [total, setTotal] = useState(0)
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch || entityName !== debouncedEntityName) {
        setDebouncedSearch(search)
        setDebouncedEntityName(entityName)
        setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        setFetchState("loading")
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, entityName, debouncedSearch, debouncedEntityName])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(pagination.pageIndex * pagination.pageSize),
    })
    if (debouncedEntityName) params.set("entityName", debouncedEntityName)
    if (debouncedSearch) params.set("q", debouncedSearch)

    fetch(`/api/entities?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => res.json() as Promise<ListResponse>)
      .then((json) => {
        if (!json.ok || !json.data) {
          throw new Error(json.error?.message ?? "Failed to load entities")
        }
        setItems(
          json.data.items.map((item) => ({
            id: item.id,
            entityName: item.entityName,
            state: item.doc.state?.current ?? "active",
            version: item.version,
            updatedAt: item.updatedAt,
          }))
        )
        setTotal(json.data.total)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load entities"
        )
        setFetchState("error")
      })
    return () => controller.abort()
  }, [pagination, debouncedSearch, debouncedEntityName, reloadToken])

  const retry = useCallback(() => {
    setFetchState("loading")
    setReloadToken((token) => token + 1)
  }, [])

  const handlePaginationChange = useCallback(
    (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      setFetchState("loading")
      setPagination((prev) =>
        typeof updater === "function" ? updater(prev) : updater
      )
    },
    []
  )

  const columns = useMemo<ColumnDef<DataGridFeatures, EntityListItem>[]>(
    () => [
      {
        accessorKey: "entityName",
        id: "entityName",
        header: "Entity",
        enableHiding: false,
        cell: ({ row }) => (
          <Link
            href={`/entities/${row.original.id}`}
            className="text-foreground hover:text-primary font-medium"
          >
            {row.original.entityName}
          </Link>
        ),
        size: 220,
      },
      {
        accessorKey: "state",
        id: "state",
        header: "State",
        cell: ({ row }) => (
          <Badge
            variant={stateBadgeVariant[row.original.state] ?? "info-light"}
            size="sm"
          >
            {row.original.state}
          </Badge>
        ),
        size: 160,
      },
      {
        accessorKey: "version",
        id: "version",
        header: "Version",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.version}</span>
        ),
        size: 90,
      },
      {
        accessorKey: "updatedAt",
        id: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {formatDateTime(row.original.updatedAt)}
          </span>
        ),
        size: 180,
      },
      {
        accessorKey: "id",
        id: "id",
        header: "ID",
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono text-xs">
            {row.original.id.slice(0, 13)}…
          </span>
        ),
        size: 150,
      },
    ],
    []
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: items,
    manualPagination: true,
    rowCount: total,
    getRowId: (row: EntityListItem) => row.id,
    state: { pagination },
    onPaginationChange: handlePaginationChange,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search entities…"
          className="max-w-xs"
        />
        <Input
          value={entityName}
          onChange={(event) => setEntityName(event.target.value)}
          placeholder="Filter by entityName"
          className="max-w-48"
        />
      </div>
      {fetchState === "error" ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RefreshCwIcon />
            </EmptyMedia>
            <EmptyTitle>Could not load entities</EmptyTitle>
            <EmptyDescription>{errorMessage}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DataGrid
          table={table}
          recordCount={total}
          isLoading={fetchState === "loading"}
          tableLayout={{ dense: true }}
          onRowClick={(row) => router.push(`/entities/${row.id}`)}
          emptyMessage={
            fetchState === "success" &&
            !debouncedSearch &&
            !debouncedEntityName ? (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BoxesIcon />
                  </EmptyMedia>
                  <EmptyTitle>No entities yet</EmptyTitle>
                  <EmptyDescription>
                    Create your first umeJSON entity to see it here.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" render={<Link href="/entities/new" />}>
                    New entity
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              "No entities match your filters"
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
    </div>
  )
}
