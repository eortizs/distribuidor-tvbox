"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  createUserAction,
  deleteUserAction,
  updateUserAction,
  type CreateUserState,
  type DeleteUserState,
  type UpdateUserState,
} from "@/app/actions/users"
import {
  updateUserPermissionsAction,
  type UpdatePermissionsState,
} from "@/app/actions/permissions"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { DISTRIBUTOR_LINK_NONE } from "@/lib/distributor-link"
import { navSections } from "@/components/dashboard/nav-config"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ColumnDef,
  useTable,
} from "@tanstack/react-table"

export interface UserListItem {
  id: string
  username: string
  role: "admin" | "distribuidor"
  entityCount: number
  /** Reseller FlujoTV ligado a esta cuenta; null si todavía no tiene. */
  distribuidorName: string | null
  /** Claves de sección de la barra inferior que esta cuenta no ve. */
  deniedSections: string[]
  /** Override de tope diario de cupones; null = usa el valor global. */
  couponDailyLimit: number | null
  /** Override de tope mensual (acumulado) de cupones; null = global. */
  couponMonthlyLimit: number | null
  createdAt: string
  createdAtLabel: string
}

type RoleFilter = "all" | "admin" | "distribuidor"

const createState: CreateUserState = { error: null, success: null }
const updateState: UpdateUserState = { error: null, success: null }
const deleteState: DeleteUserState = { error: null, success: null }

export function UsersManager({
  users,
  currentUserId,
  couponDailyLimitDefault,
  couponMonthlyLimitDefault,
}: {
  users: UserListItem[]
  currentUserId: string
  /** Tope diario global del servidor (`COUPON_QA_DAILY_LIMIT`, default 3). */
  couponDailyLimitDefault: number
  /** Tope mensual global del servidor (`COUPON_QA_MONTHLY_LIMIT`, default 10). */
  couponMonthlyLimitDefault: number
}) {
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all")

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter(
      (user) =>
        (query === "" || user.username.toLowerCase().includes(query)) &&
        (roleFilter === "all" || user.role === roleFilter)
    )
  }, [users, search, roleFilter])

  const columns = useMemo<ColumnDef<DataGridFeatures, UserListItem>[]>(
    () => [
      {
        accessorKey: "username",
        id: "username",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Email" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground font-medium">
            {row.original.username}
          </span>
        ),
        size: 280,
      },
      {
        accessorKey: "role",
        id: "role",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Role" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={row.original.role === "admin" ? "primary-light" : "info-light"}
            size="sm"
          >
            {row.original.role}
          </Badge>
        ),
        size: 140,
      },
      {
        accessorKey: "distribuidorName",
        id: "distribuidorName",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Distributor" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.distribuidorName ?? "—"}
          </span>
        ),
        size: 150,
      },
      {
        accessorKey: "entityCount",
        id: "entityCount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Entities" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.entityCount}</span>
        ),
        size: 110,
      },
      {
        accessorKey: "createdAt",
        id: "createdAt",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.createdAtLabel}
          </span>
        ),
        size: 160,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <PermissionsDialog
              user={row.original}
              couponDailyLimitDefault={couponDailyLimitDefault}
              couponMonthlyLimitDefault={couponMonthlyLimitDefault}
            />
            <EditUserDialog user={row.original} />
            {row.original.id !== currentUserId ? (
              <DeleteUserDialog user={row.original} />
            ) : null}
          </div>
        ),
        size: 130,
      },
    ],
    [currentUserId, couponDailyLimitDefault, couponMonthlyLimitDefault]
  )

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: filteredUsers,
    getRowId: (row: UserListItem) => row.id,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search users…"
          className="max-w-xs"
        />
        <Select
          value={roleFilter}
          onValueChange={(value) => setRoleFilter(value as RoleFilter)}
        >
          <SelectTrigger className="w-40" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="distribuidor">distribuidor</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataGrid
        table={table}
        recordCount={filteredUsers.length}
        tableLayout={{ dense: true }}
        emptyMessage="No users match your filters"
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
    </div>
  )
}

export function CreateUserButton() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon aria-hidden="true" />
        New user
      </DialogTrigger>
      {open ? <CreateUserForm onDone={() => setOpen(false)} /> : null}
    </Dialog>
  )
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    createUserAction,
    createState
  )

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
      onDone()
    }
  }, [state.success, router, onDone])

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>New user</DialogTitle>
        <DialogDescription>
          Passwords are hashed with scrypt; share it securely once.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="contents">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-username">Email address</FieldLabel>
            <Input
              id="new-username"
              name="username"
              type="email"
              placeholder="name@tvbox.network"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">Password</FieldLabel>
            <Input id="new-password" name="password" type="password" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-role">Role</FieldLabel>
            <Select name="role" defaultValue="distribuidor">
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="distribuidor">distribuidor</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create user"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function EditUserDialog({ user }: { user: UserListItem }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <PencilIcon />
        <span className="sr-only">Edit {user.username}</span>
      </DialogTrigger>
      {open ? <EditUserForm user={user} onDone={() => setOpen(false)} /> : null}
    </Dialog>
  )
}

function EditUserForm({
  user,
  onDone,
}: {
  user: UserListItem
  onDone: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    updateUserAction,
    updateState
  )
  const [resellers, setResellers] = useState<string[]>([])
  const [resellersState, setResellersState] = useState<
    "loading" | "ready" | "error"
  >("loading")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/flujotv/resellers", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }
        return (await response.json()) as {
          ok?: boolean
          data?: { resellers?: { name?: unknown }[] }
        }
      })
      .then((payload) => {
        if (controller.signal.aborted) return
        const names = (payload.data?.resellers ?? [])
          .map((row) => (typeof row?.name === "string" ? row.name.trim() : ""))
          .filter((name) => name !== "")
        setResellers([...new Set(names)].sort((a, b) => a.localeCompare(b, "es")))
        setResellersState("ready")
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setResellersState("error")
      })
    return () => controller.abort()
  }, [])

  const currentDistribuidor = user.distribuidorName ?? ""
  const distributorOptions = useMemo(
    () =>
      [...new Set([currentDistribuidor, ...resellers])]
        .filter((name) => name !== "")
        .sort((a, b) => a.localeCompare(b, "es")),
    [currentDistribuidor, resellers]
  )

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
      onDone()
    }
  }, [state.success, router, onDone])

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit user</DialogTitle>
        <DialogDescription>
          Change the login email, role, linked distributor or set a new
          password. Leave the password blank to keep the current one.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="contents">
        <input type="hidden" name="userId" value={user.id} />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`edit-username-${user.id}`}>
              Email address
            </FieldLabel>
            <Input
              id={`edit-username-${user.id}`}
              name="username"
              type="email"
              defaultValue={user.username}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`edit-role-${user.id}`}>Role</FieldLabel>
            <Select name="role" defaultValue={user.role}>
              <SelectTrigger id={`edit-role-${user.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="distribuidor">distribuidor</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`edit-distribuidor-${user.id}`}>
              Distributor
            </FieldLabel>
            <Select
              name="distribuidorName"
              defaultValue={currentDistribuidor || DISTRIBUTOR_LINK_NONE}
            >
              <SelectTrigger
                id={`edit-distribuidor-${user.id}`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DISTRIBUTOR_LINK_NONE}>Not linked</SelectItem>
                {distributorOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {resellersState === "loading" ? (
              <FieldDescription>Loading FlujoTV resellers…</FieldDescription>
            ) : null}
            {resellersState === "error" ? (
              <FieldDescription>
                Could not load the FlujoTV reseller list; the current link is
                kept.
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`edit-password-${user.id}`}>
              New password
            </FieldLabel>
            <Input
              id={`edit-password-${user.id}`}
              name="newPassword"
              type="password"
              placeholder="Leave blank to keep current"
            />
          </Field>
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function PermissionsDialog({
  user,
  couponDailyLimitDefault,
  couponMonthlyLimitDefault,
}: {
  user: UserListItem
  couponDailyLimitDefault: number
  couponMonthlyLimitDefault: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <ShieldCheckIcon />
        <span className="sr-only">Permisos de {user.username}</span>
      </DialogTrigger>
      {open ? (
        <PermissionsForm
          user={user}
          couponDailyLimitDefault={couponDailyLimitDefault}
          couponMonthlyLimitDefault={couponMonthlyLimitDefault}
          onDone={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  )
}

const permissionsState: UpdatePermissionsState = { error: null, success: null }

/** Ayuda breve por sección de la barra inferior (clave de nav-config). */
const sectionHints: Record<string, string> = {
  inicio: "Pantalla principal del panel",
  clientes: "Clientes del panel de FlujoTV",
  finanzas: "Estado de cuenta y gastos",
  modulos: "Imágenes, animación y calculadora",
  soporte: "Asistente, configuración y Lab",
}

function PermissionsForm({
  user,
  couponDailyLimitDefault,
  couponMonthlyLimitDefault,
  onDone,
}: {
  user: UserListItem
  couponDailyLimitDefault: number
  couponMonthlyLimitDefault: number
  onDone: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    updateUserPermissionsAction,
    permissionsState
  )
  const [visible, setVisible] = useState<string[]>(() =>
    navSections
      .filter((section) => !user.deniedSections.includes(section.key))
      .map((section) => section.key)
  )

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
      onDone()
    }
  }, [state.success, router, onDone])

  const toggleSection = (key: string, checked: boolean) => {
    setVisible((prev) =>
      checked ? [...prev, key] : prev.filter((value) => value !== key)
    )
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Permisos</DialogTitle>
        <DialogDescription>
          Elige qué secciones de la barra inferior ve {user.username} al
          entrar. Esto controla la navegación, no las URLs.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="contents">
        <input type="hidden" name="userId" value={user.id} />
        {visible.map((key) => (
          <input key={key} type="hidden" name="sections" value={key} />
        ))}
        <div
          className="flex flex-col gap-1"
          role="group"
          aria-label="Secciones de la aplicación"
        >
          {navSections.map((section) => {
            const id = `perm-${user.id}-${section.key}`
            return (
              <div key={section.key} className="flex items-center gap-3 py-1.5">
                <span
                  className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg"
                  aria-hidden="true"
                >
                  <section.icon className="text-muted-foreground size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <FieldLabel
                    htmlFor={id}
                    className="text-foreground text-sm font-medium"
                  >
                    {section.title}
                  </FieldLabel>
                  <p className="text-muted-foreground text-xs">
                    {sectionHints[section.key]}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={visible.includes(section.key)}
                  onCheckedChange={(next) => toggleSection(section.key, next)}
                />
              </div>
            )
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`coupon-limit-${user.id}`}>
              Cupones por día
            </FieldLabel>
            <Input
              id={`coupon-limit-${user.id}`}
              name="couponDailyLimit"
              type="number"
              min={1}
              max={1000}
              step={1}
              inputMode="numeric"
              defaultValue={user.couponDailyLimit ?? ""}
              placeholder={`${couponDailyLimitDefault} (global)`}
            />
            <FieldDescription>
              Tope de canjes en 24 h. Vacío usa el global del servidor.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`coupon-monthly-limit-${user.id}`}>
              Cupones por mes
            </FieldLabel>
            <Input
              id={`coupon-monthly-limit-${user.id}`}
              name="couponMonthlyLimit"
              type="number"
              min={1}
              max={1000}
              step={1}
              inputMode="numeric"
              defaultValue={user.couponMonthlyLimit ?? ""}
              placeholder={`${couponMonthlyLimitDefault} (global)`}
            />
            <FieldDescription>
              Acumulado de 30 días. Vacío usa el global del servidor.
            </FieldDescription>
          </Field>
        </div>
        {visible.length === 0 ? (
          <p className="text-destructive text-sm" role="alert">
            Deja al menos una sección visible
          </p>
        ) : null}
        {user.role === "admin" ? (
          <p className="text-muted-foreground text-xs">
            Las cuentas admin siempre ven todas las secciones.
          </p>
        ) : null}
        {state.error ? (
          <p className="text-destructive text-sm" role="alert">
            {state.error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button type="submit" disabled={isPending || visible.length === 0}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function DeleteUserDialog({ user }: { user: UserListItem }) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Trash2Icon />
        <span className="sr-only">Delete {user.username}</span>
      </AlertDialogTrigger>
      {open ? (
        <DeleteUserForm user={user} onDone={() => setOpen(false)} />
      ) : null}
    </AlertDialog>
  )
}

function DeleteUserForm({
  user,
  onDone,
}: {
  user: UserListItem
  onDone: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    deleteUserAction,
    deleteState
  )

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
      onDone()
    }
  }, [state.success, router, onDone])

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {user.username}?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes the login and archives the {user.entityCount}{" "}
          {user.entityCount === 1 ? "entity" : "entities"} owned by this user,
          including their account entity. This cannot be undone from the
          dashboard.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <form action={formAction} className="contents">
        <input type="hidden" name="userId" value={user.id} />
        {state.error ? (
          <p className="text-destructive text-sm" role="alert">
            {state.error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction type="submit" variant="destructive" disabled={isPending}>
            {isPending ? "Deleting…" : "Delete user"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  )
}
