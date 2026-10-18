"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MoreHorizontalIcon,
  PackageOpenIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import {
  ColumnDef,
  PaginationState,
  useTable,
} from "@tanstack/react-table"

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
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  EXPENSE_CATEGORIES,
  formatAmount,
  formatDay,
  formatMxn,
  mxToday,
  type Expense,
  type ExpenseCurrency,
  type ExpenseSummary,
} from "@/lib/finanzas"

interface ListResponse {
  ok: boolean
  data?: { items: Expense[]; total: number }
  error?: { message: string }
}

interface SummaryResponse {
  ok: boolean
  data?: ExpenseSummary
  error?: { message: string }
}

type FetchState = "loading" | "success" | "error"

type FormState = {
  description: string
  category: string
  amount: string
  currency: ExpenseCurrency
  spentOn: string
  notes: string
}

const emptyForm = (): FormState => ({
  description: "",
  category: "",
  amount: "",
  currency: "MXN",
  spentOn: mxToday(),
  notes: "",
})

function moneySkeleton() {
  return <Skeleton className="h-4 w-20" />
}

export function GastosView() {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [category, setCategory] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const [items, setItems] = useState<Expense[]>([])
  const [total, setTotal] = useState(0)
  const [fetchState, setFetchState] = useState<FetchState>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [summaryState, setSummaryState] = useState<FetchState>("loading")

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const requestCounter = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search)
        setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, debouncedSearch])

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++requestCounter.current
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(pagination.pageIndex * pagination.pageSize),
    })
    if (debouncedSearch) params.set("q", debouncedSearch)
    if (category !== "all") params.set("category", category)
    if (from) params.set("from", from)
    if (to) params.set("to", to)

    fetch(`/api/finanzas/gastos?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => res.json() as Promise<ListResponse>)
      .then((json) => {
        if (requestId !== requestCounter.current) return
        if (!json.ok || !json.data) {
          throw new Error(json.error?.message ?? "No se pudieron cargar los gastos.")
        }
        setItems(json.data.items)
        setTotal(json.data.total)
        setErrorMessage(null)
        setFetchState("success")
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setErrorMessage(
          err instanceof Error ? err.message : "No se pudieron cargar los gastos."
        )
        setFetchState("error")
      })
    return () => controller.abort()
  }, [pagination, debouncedSearch, category, from, to, reloadToken])

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/finanzas/estado-de-cuenta", { signal: controller.signal })
      .then((res) => res.json() as Promise<SummaryResponse>)
      .then((json) => {
        if (!json.ok || !json.data) {
          throw new Error(json.error?.message ?? "No se pudo cargar el resumen.")
        }
        setSummary(json.data)
        setSummaryState("success")
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setSummaryState("error")
      })
    return () => controller.abort()
  }, [reloadToken])

  const reloadAll = useCallback(() => {
    setFetchState("loading")
    setSummaryState("loading")
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setReloadToken((token) => token + 1)
  }, [])

  const retry = useCallback(() => {
    setFetchState("loading")
    setReloadToken((token) => token + 1)
  }, [])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm(emptyForm())
    setFormError(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((expense: Expense) => {
    setEditing(expense)
    setForm({
      description: expense.description,
      category: expense.category,
      amount: String(expense.amount),
      currency: expense.currency,
      spentOn: expense.spentOn,
      notes: expense.notes ?? "",
    })
    setFormError(null)
    setFormOpen(true)
  }, [])

  async function saveExpense(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)

    const payload = {
      description: form.description,
      category: form.category,
      amount: Number(form.amount.replace(/,/g, "")),
      currency: form.currency,
      spentOn: form.spentOn,
      notes: form.notes.trim().length > 0 ? form.notes.trim() : null,
    }

    try {
      const response = await fetch(
        editing ? `/api/finanzas/gastos/${editing.id}` : "/api/finanzas/gastos",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const json = (await response.json()) as ListResponse & { data?: Expense }
      if (!json.ok) {
        throw new Error(json.error?.message ?? "No se pudo guardar el gasto.")
      }
      toast.success(
        editing
          ? "Gasto actualizado"
          : `Gasto registrado por ${formatAmount(json.data?.amount ?? 0, json.data?.currency ?? "MXN")}`
      )
      setFormOpen(false)
      reloadAll()
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No se pudo guardar el gasto."
      )
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      const response = await fetch(`/api/finanzas/gastos/${deleting.id}`, {
        method: "DELETE",
      })
      const json = (await response.json()) as { ok: boolean; error?: { message: string } }
      if (!json.ok) {
        throw new Error(json.error?.message ?? "No se pudo eliminar el gasto.")
      }
      toast.success("Gasto eliminado")
      setDeleting(null)
      reloadAll()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo eliminar el gasto."
      )
    } finally {
      setDeletingBusy(false)
    }
  }

  const currentMonth = mxToday().slice(0, 7)
  const monthBucket = summary?.byMonth.find((b) => b.key === currentMonth)

  const columns = useMemo<
    ColumnDef<DataGridFeatures, Expense>[]
  >(() => {
    return [
      {
        accessorKey: "spentOn",
        id: "spentOn",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="text-foreground text-sm whitespace-nowrap">
            {formatDay(row.original.spentOn)}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: "description",
        id: "description",
        header: "Descripción",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground truncate font-medium">
              {row.original.description}
            </span>
            {row.original.notes ? (
              <span className="text-muted-foreground truncate text-xs">
                {row.original.notes}
              </span>
            ) : null}
          </div>
        ),
        size: 260,
      },
      {
        accessorKey: "category",
        id: "category",
        header: "Categoría",
        cell: ({ row }) => (
          <Badge variant="outline" size="sm">
            {row.original.category}
          </Badge>
        ),
        size: 130,
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
          <span className="text-foreground font-medium whitespace-nowrap tabular-nums">
            {formatAmount(row.original.amount, row.original.currency)}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: "exchangeRate",
        id: "exchangeRate",
        header: "Tipo de cambio",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) =>
          row.original.currency === "USD" && row.original.exchangeRate ? (
            <span className="text-muted-foreground tabular-nums">
              {row.original.exchangeRate.toFixed(4)}
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
        size: 130,
      },
      {
        accessorKey: "mxnEquivalent",
        id: "mxnEquivalent",
        header: "Equivalente MXN",
        meta: {
          headerClassName: "text-end [&>div]:justify-end",
          cellClassName: "text-end",
        },
        cell: ({ row }) =>
          row.original.mxnEquivalent !== null ? (
            <span className="text-foreground font-medium whitespace-nowrap tabular-nums">
              {formatMxn(row.original.mxnEquivalent)}
            </span>
          ) : (
            <Badge variant="warning-light" size="sm">
              Sin conversión
            </Badge>
          ),
        size: 160,
      },
      {
        accessorKey: "id",
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-me-1.5"
                    aria-label={`Acciones para ${row.original.description}`}
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => openEdit(row.original)}>
                    <PencilIcon aria-hidden="true" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(row.original)}
                  >
                    <Trash2Icon aria-hidden="true" />
                    Eliminar
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        size: 60,
      },
    ]
  }, [openEdit])

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: items,
    manualPagination: true,
    rowCount: total,
    getRowId: (row: Expense) => row.id,
    state: { pagination },
    onPaginationChange: setPagination,
  })

  const filtersActive =
    debouncedSearch !== "" || category !== "all" || from !== "" || to !== ""

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Gastos</h1>
          <p className="text-muted-foreground text-sm">
            Registra y controla los gastos de tu operación; el asistente los
            usa para tus reportes.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon aria-hidden="true" />
          Registrar gasto
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Gastos de este mes"
          value={
            summaryState === "loading"
              ? moneySkeleton()
              : summaryState === "error"
                ? "—"
                : formatMxn(monthBucket?.totalMxn ?? 0)
          }
          meta={`Total del año: ${
            summaryState === "success" ? formatMxn(summary?.totalMxn ?? 0) : "—"
          }`}
        />
        <KpiCard
          title="Movimientos del mes"
          value={
            summaryState === "loading"
              ? moneySkeleton()
              : summaryState === "error"
                ? "—"
                : String(monthBucket?.count ?? 0)
          }
          meta={`Gastos en el año: ${summaryState === "success" ? (summary?.count ?? 0) : "—"}`}
        />
        <KpiCard
          title="Categoría principal"
          value={
            summaryState === "loading"
              ? moneySkeleton()
              : (summary?.byCategory[0]?.key ?? "Sin gastos")
          }
          meta={
            summaryState === "success" && summary?.byCategory[0]
              ? `${formatMxn(summary.byCategory[0].totalMxn)} en el año`
              : "Aún sin datos"
          }
        />
        <KpiCard
          title="USD pendiente de conversión"
          value={
            summaryState === "loading"
              ? moneySkeleton()
              : summaryState === "error"
                ? "—"
                : `$${(summary?.usdPending ?? 0).toLocaleString("es-MX", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} USD`
          }
          meta={
            (summary?.usdPendingCount ?? 0) > 0
              ? `${summary?.usdPendingCount} gasto(s) sin tipo de cambio`
              : "Todo convertido a MXN"
          }
          tone={(summary?.usdPendingCount ?? 0) > 0 ? "warning" : "default"}
        />
      </div>

      <Card className="w-full">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por descripción o notas…"
              className="max-w-xs"
              aria-label="Buscar gastos"
            />
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value ?? "all")
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            >
              <SelectTrigger className="w-44" aria-label="Filtrar por categoría">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {EXPENSE_CATEGORIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                }}
                className="w-40"
                aria-label="Fecha inicial"
              />
              <span className="text-muted-foreground text-xs">a</span>
              <Input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                }}
                className="w-40"
                aria-label="Fecha final"
              />
              {filtersActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("")
                    setCategory("all")
                    setFrom("")
                    setTo("")
                    reloadAll()
                  }}
                >
                  Limpiar
                </Button>
              ) : null}
            </div>
          </div>

          {fetchState === "error" ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RefreshCwIcon />
                </EmptyMedia>
                <EmptyTitle>No se pudieron cargar los gastos</EmptyTitle>
                <EmptyDescription>{errorMessage}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" variant="outline" onClick={retry}>
                  Reintentar
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <DataGrid
              table={table}
              recordCount={total}
              isLoading={fetchState === "loading"}
              tableLayout={{ dense: true }}
              emptyMessage={
                fetchState === "success" && !filtersActive ? (
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <PackageOpenIcon />
                      </EmptyMedia>
                      <EmptyTitle>Aún no hay gastos registrados</EmptyTitle>
                      <EmptyDescription>
                        Registra tu primer gasto desde el botón «Registrar
                        gasto» o pídeselo al asistente por chat.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" onClick={openCreate}>
                        <PlusIcon aria-hidden="true" />
                        Registrar gasto
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  "Ningún gasto coincide con los filtros."
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
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar gasto" : "Registrar gasto"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Actualiza los datos del gasto; la conversión a MXN se recalcula si cambian monto, moneda o fecha."
                : "El gasto queda guardado en tu cuenta y disponible para el asistente y tu estado de cuenta."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveExpense} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="gasto-descripcion">Descripción</FieldLabel>
              <Input
                id="gasto-descripcion"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Ej. Compra de 10 TVBox"
                maxLength={300}
                required
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="gasto-monto">Monto</FieldLabel>
                <Input
                  id="gasto-monto"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  placeholder="0.00"
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Moneda</FieldLabel>
                <Select
                  value={form.currency}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      currency: (value ?? "MXN") as ExpenseCurrency,
                    }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Moneda">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MXN">MXN — Peso mexicano</SelectItem>
                    <SelectItem value="USD">USD — Dólar</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="gasto-fecha">Fecha del gasto</FieldLabel>
                <Input
                  id="gasto-fecha"
                  type="date"
                  value={form.spentOn}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, spentOn: event.target.value }))
                  }
                  max={mxToday()}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Categoría</FieldLabel>
                <Select
                  value={form.category}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, category: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Categoría">
                    <SelectValue placeholder="Selecciona una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="gasto-notas">Notas (opcional)</FieldLabel>
              <Textarea
                id="gasto-notas"
                value={form.notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, notes: event.target.value }))
                }
                placeholder="Proveedor, método de pago, contexto…"
                maxLength={1000}
                rows={2}
              />
            </Field>
            {formError ? (
              <p className="text-destructive text-sm">{formError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {editing ? "Guardar cambios" : "Registrar gasto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleting?.description}» por{" "}
              {deleting
                ? formatAmount(deleting.amount, deleting.currency)
                : ""}{" "}
              se quitará de tus reportes y estado de cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
              disabled={deletingBusy}
            >
              {deletingBusy ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function KpiCard({
  title,
  value,
  meta,
  tone = "default",
}: {
  title: string
  value: React.ReactNode
  meta: string
  tone?: "default" | "warning"
}) {
  return (
    <Card className="w-full">
      <CardContent className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
          {tone === "warning" ? (
            <Badge variant="warning-light" size="xs">
              Revisar
            </Badge>
          ) : null}
        </div>
        <span className="text-foreground text-2xl font-medium tracking-tight tabular-nums">
          {value}
        </span>
        <Separator />
        <p className="text-muted-foreground text-xs">{meta}</p>
      </CardContent>
    </Card>
  )
}
