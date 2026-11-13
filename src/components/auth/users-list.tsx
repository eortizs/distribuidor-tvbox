"use client"

import {
  Fragment,
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import { useRouter } from "next/navigation"
import {
  CoinsIcon,
  EllipsisVerticalIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TvIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  adjustUserSaldoAction,
  createUserAction,
  deleteUserAction,
  updateUserAction,
  type AdjustSaldoState,
  type CreateUserState,
  type DeleteUserState,
  type UpdateUserState,
} from "@/app/actions/users"
import {
  updateUserPermissionsAction,
  type UpdatePermissionsState,
} from "@/app/actions/permissions"
import {
  updateUserModulesAction,
} from "@/app/actions/modulos"
import { MODULOS } from "@/lib/modulos"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { DISTRIBUTOR_LINK_NONE } from "@/lib/distributor-link"
import { formatMxn } from "@/lib/finanzas"
import {
  parseAbonoAmount,
  SALDO_TIPOS,
  type SaldoTipo,
} from "@/lib/saldo"
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
  /** WhatsApp registrado del canal agente; null si la cuenta no lo usa. */
  whatsappPhone: string | null
  /** Claves de sección de la barra inferior que esta cuenta no ve. */
  deniedSections: string[]
  /** Hrefs de módulos del hub que esta cuenta no ve (ajustable desde Módulos). */
  hiddenModules: string[]
  /** Override de tope diario de cupones; null = usa el valor global. */
  couponDailyLimit: number | null
  /** Override de tope mensual (acumulado) de cupones; null = global. */
  couponMonthlyLimit: number | null
  /** La cuenta está ligada a Google (inicia sesión vía OAuth). */
  googleLinked: boolean
  /** Saldo en cupones disponible (MXN): licencias de FlujoTV. */
  saldoCupones: number
  /** Saldo en tokens disponible (MXN): herramientas con APIs. */
  saldoTokens: number
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
          <span className="text-foreground inline-flex items-center gap-2 font-medium">
            {row.original.username}
            {row.original.googleLinked ? (
              <Badge variant="secondary" size="sm">
                Google
              </Badge>
            ) : null}
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
        accessorKey: "whatsappPhone",
        id: "whatsappPhone",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="WhatsApp" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.whatsappPhone ?? "—"}
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
          <UserActionsMenu
            user={row.original}
            isSelf={row.original.id === currentUserId}
            couponDailyLimitDefault={couponDailyLimitDefault}
            couponMonthlyLimitDefault={couponMonthlyLimitDefault}
          />
        ),
        size: 80,
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

/**
 * Menú contextual de acciones de la fila (los tres puntos): agrupa todas las
 * acciones de la cuenta — Saldo, Permisos, Módulos (solo donde se pide),
 * Editar y Eliminar (esta solo para cuentas ajenas) — y abre el diálogo o
 * sheet correspondiente al elegirla.
 *
 * Compartido por `/users` y el módulo Distribuidores
 * (`/modulos/distribuidores`): el trigger es configurable por props para que
 * el módulo pueda pintar el mismo botón que el carrito de compra de
 * `/clientes` (mismo tamaño, posición y feedback de pulsación) con el icono
 * settings-2; sin props, el trigger es el de siempre en `/users`. La opción
 * Módulos (sheet con la visibilidad del hub por módulo) se activa con
 * `modulesManagement` y hoy solo la usa el módulo Distribuidores.
 */
export function UserActionsMenu({
  user,
  isSelf,
  couponDailyLimitDefault,
  couponMonthlyLimitDefault,
  modulesManagement = false,
  triggerIcon,
  triggerClassName,
}: {
  user: UserListItem
  /** La fila es la cuenta del propio admin: sin acción destructiva. */
  isSelf: boolean
  couponDailyLimitDefault: number
  couponMonthlyLimitDefault: number
  /** Muestra la opción Módulos (sheet de visibilidad por módulo). */
  modulesManagement?: boolean
  /** Contenido del trigger; por defecto los tres puntos de `/users`. */
  triggerIcon?: React.ReactNode
  /** Clases extra del trigger (tamaño, redondeo y feedback de `/clientes`). */
  triggerClassName?: string
}) {
  const [dialog, setDialog] = useState<
    "saldo" | "permisos" | "modulos" | "editar" | "eliminar" | null
  >(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Acciones de ${user.username}`}
              className={triggerClassName}
            />
          }
        >
          {triggerIcon ?? <EllipsisVerticalIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setDialog("saldo")}>
              <CoinsIcon aria-hidden="true" />
              <span>Saldo</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("permisos")}>
              <ShieldCheckIcon aria-hidden="true" />
              <span>Permisos</span>
            </DropdownMenuItem>
            {modulesManagement ? (
              <DropdownMenuItem onClick={() => setDialog("modulos")}>
                <LayersIcon aria-hidden="true" />
                <span>Módulos</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => setDialog("editar")}>
              <PencilIcon aria-hidden="true" />
              <span>Editar</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {!isSelf ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDialog("eliminar")}
                >
                  <Trash2Icon aria-hidden="true" />
                  <span>Eliminar</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <SaldoDialog
        user={user}
        open={dialog === "saldo"}
        onOpenChange={(open) => setDialog(open ? "saldo" : null)}
      />
      <PermissionsDialog
        user={user}
        couponDailyLimitDefault={couponDailyLimitDefault}
        couponMonthlyLimitDefault={couponMonthlyLimitDefault}
        open={dialog === "permisos"}
        onOpenChange={(open) => setDialog(open ? "permisos" : null)}
      />
      {modulesManagement ? (
        <ModulesSheet
          user={user}
          open={dialog === "modulos"}
          onOpenChange={(open) => setDialog(open ? "modulos" : null)}
        />
      ) : null}
      <EditUserDialog
        user={user}
        open={dialog === "editar"}
        onOpenChange={(open) => setDialog(open ? "editar" : null)}
      />
      {!isSelf ? (
        <DeleteUserDialog
          user={user}
          open={dialog === "eliminar"}
          onOpenChange={(open) => setDialog(open ? "eliminar" : null)}
        />
      ) : null}
    </>
  )
}

/**
 * Abono directo de saldo (solo admin): acredita tokens o cupones a la cuenta
 * sin checkout. Muestra los saldos vigentes y registra el ajuste con la
 * cuenta del admin como responsable.
 */
const adjustSaldoState: AdjustSaldoState = { error: null, success: null }

const SALDO_TIPO_MENU_META: Record<
  SaldoTipo,
  { label: string; description: string }
> = {
  tokens: {
    label: "Saldo en tokens",
    description: "Herramientas con APIs (fal.ai, OpenRouter…)",
  },
  cupones: {
    label: "Saldo en cupones",
    description: "Compra y renovación de licencias FlujoTV",
  },
}

function SaldoDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserListItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <SaldoForm user={user} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

function SaldoForm({
  user,
  onDone,
}: {
  user: UserListItem
  onDone: () => void
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(
    adjustUserSaldoAction,
    adjustSaldoState
  )
  const [tipo, setTipo] = useState<SaldoTipo>("tokens")
  const [amountInput, setAmountInput] = useState("")

  const amount = useMemo(() => parseAbonoAmount(amountInput), [amountInput])
  const amountOk = amount.ok ? amount : null

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
        <DialogTitle>Abonar saldo a {user.username}</DialogTitle>
        <DialogDescription>
          Acreditación directa en su cuenta, sin checkout ni pago. El
          movimiento queda registrado como ajuste con tu cuenta como
          responsable.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="contents">
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="tipo" value={tipo} />
        <input
          type="hidden"
          name="amount"
          value={amountOk ? String(amountOk.amount) : ""}
        />
        <FieldGroup>
          {/*
           * Saldos vigentes de la cuenta: el admin confirma el destino con
           * el número a la vista antes de abonar.
           */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/40 flex flex-col gap-0.5 rounded-lg p-2.5">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <CoinsIcon aria-hidden="true" className="size-3.5" />
                Saldo en tokens
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatMxn(user.saldoTokens)}
              </span>
            </div>
            <div className="bg-muted/40 flex flex-col gap-0.5 rounded-lg p-2.5">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <TvIcon aria-hidden="true" className="size-3.5" />
                Saldo en cupones
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatMxn(user.saldoCupones)}
              </span>
            </div>
          </div>
          <Field>
            <FieldLabel>Tipo de saldo</FieldLabel>
            <RadioGroup
              value={tipo}
              onValueChange={(value) => setTipo(value as SaldoTipo)}
              aria-label="Tipo de saldo a abonar"
            >
              <FieldGroup className="gap-0 rounded-lg border">
                {SALDO_TIPOS.map((option, index) => {
                  const meta = SALDO_TIPO_MENU_META[option]
                  const Icon = option === "tokens" ? CoinsIcon : TvIcon
                  return (
                    <Fragment key={option}>
                      {index > 0 ? <Separator /> : null}
                      <Field>
                        <FieldLabel
                          className="w-full cursor-pointer justify-between gap-3 px-3 py-2.5"
                          onClick={() => setTipo(option)}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Icon
                              aria-hidden="true"
                              className="size-4 shrink-0 opacity-60"
                            />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="text-foreground text-sm font-medium">
                                {meta.label}
                              </span>
                              <span className="text-muted-foreground truncate text-xs">
                                {meta.description}
                              </span>
                            </span>
                          </span>
                          <RadioGroupItem value={option} />
                        </FieldLabel>
                      </Field>
                    </Fragment>
                  )
                })}
              </FieldGroup>
            </RadioGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={`saldo-monto-${user.id}`}>
              Monto a abonar
            </FieldLabel>
            <InputGroup className="h-11">
              <InputGroupAddon align="inline-start" className="pl-3">
                <span
                  aria-hidden="true"
                  className="text-muted-foreground text-sm"
                >
                  $
                </span>
              </InputGroupAddon>
              <InputGroupInput
                id={`saldo-monto-${user.id}`}
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Monto a abonar en pesos mexicanos al saldo en ${tipo}`}
                className="font-semibold tabular-nums"
              />
            </InputGroup>
            {!amount.ok && amountInput.trim().length > 0 ? (
              <p className="text-destructive text-xs" role="alert">
                {amount.message}
              </p>
            ) : (
              <FieldDescription>
                Mayor a $0, con hasta 2 decimales. Se acredita al instante en
                el saldo elegido.
              </FieldDescription>
            )}
          </Field>
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button type="submit" disabled={isPending || !amountOk}>
            {isPending
              ? "Abonando…"
              : amountOk
                ? `Abonar ${formatMxn(amountOk.amount)}`
                : "Abonar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserListItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <EditUserForm user={user} onDone={() => onOpenChange(false)} />
      ) : null}
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
          <Field>
            <FieldLabel htmlFor={`edit-whatsapp-${user.id}`}>
              WhatsApp (agente)
            </FieldLabel>
            <Input
              id={`edit-whatsapp-${user.id}`}
              name="whatsappPhone"
              type="tel"
              inputMode="numeric"
              defaultValue={user.whatsappPhone ?? ""}
              placeholder="525540049353"
            />
            <p className="text-muted-foreground text-xs">
              Número con código de país, solo dígitos (11 a 15; p. ej.
              525540049353). Habilita el espejo de notificaciones y el agente
              de consultas por WhatsApp.
            </p>
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
  open,
  onOpenChange,
}: {
  user: UserListItem
  couponDailyLimitDefault: number
  couponMonthlyLimitDefault: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PermissionsForm
          user={user}
          couponDailyLimitDefault={couponDailyLimitDefault}
          couponMonthlyLimitDefault={couponMonthlyLimitDefault}
          onDone={() => onOpenChange(false)}
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

/**
 * Sheet de visibilidad de módulos (opción Módulos del menú): lista todos los
 * módulos ajustables del hub (`MODULOS` menos los `adminOnly`) con un switch
 * por módulo para hacerlo visible u oculto para esa cuenta. El guardado es
 * inmediato por switch (server action, solo admin): fallo revierte al estado
 * del servidor con toast; éxito refresca la RSC para que la fila — y el hub
 * del propio distribuidor, vía bus de tiempo real — queden sincronizados.
 */
function ModulesSheet({
  user,
  open,
  onOpenChange,
}: {
  user: UserListItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? <ModulesVisibilityList user={user} /> : null}
    </Sheet>
  )
}

/** Catálogo ajustable: todo el hub menos los módulos solo-admin. */
const MANAGEABLE_MODULES = MODULOS.filter((modulo) => !modulo.adminOnly)

function ModulesVisibilityList({ user }: { user: UserListItem }) {
  const router = useRouter()
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(user.hiddenModules)
  )
  const [pending, startTransition] = useTransition()

  const toggleModule = (href: string, visible: boolean) => {
    const next = new Set(hidden)
    if (visible) {
      next.delete(href)
    } else {
      next.add(href)
    }
    setHidden(next)
    startTransition(async () => {
      const visibleHrefs = MANAGEABLE_MODULES.filter(
        (modulo) => !next.has(modulo.href)
      ).map((modulo) => modulo.href)
      const result = await updateUserModulesAction(user.id, visibleHrefs)
      if (!result.ok) {
        toast.error(result.error)
        setHidden(new Set(user.hiddenModules))
        return
      }
      router.refresh()
    })
  }

  return (
    <SheetContent side="right" className="w-full sm:max-w-sm">
      <SheetHeader>
        <SheetTitle>Módulos de {user.username}</SheetTitle>
        <SheetDescription>
          Elige qué módulos del hub ve esta cuenta al entrar. Los cambios se
          aplican al instante.
        </SheetDescription>
      </SheetHeader>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        role="group"
        aria-label="Módulos del hub"
      >
        <div className="flex flex-col gap-1">
          {MANAGEABLE_MODULES.map((modulo) => {
            const id = `modulos-${user.id}-${modulo.href}`
            const visible = !hidden.has(modulo.href)
            return (
              <div key={modulo.href} className="flex items-center gap-3 py-1.5">
                <span
                  className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg"
                  aria-hidden="true"
                >
                  <modulo.icon className="text-muted-foreground size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <FieldLabel
                    htmlFor={id}
                    className="text-foreground text-sm font-medium"
                  >
                    {modulo.title}
                  </FieldLabel>
                  <p className="text-muted-foreground truncate text-xs">
                    {modulo.description}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={visible}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    toggleModule(modulo.href, checked)
                  }
                  aria-label={
                    visible
                      ? `Ocultar ${modulo.title} a ${user.username}`
                      : `Hacer visible ${modulo.title} a ${user.username}`
                  }
                />
              </div>
            )
          })}
        </div>
        {pending ? (
          <p className="text-muted-foreground mt-2 text-xs" role="status">
            Guardando…
          </p>
        ) : null}
      </div>
    </SheetContent>
  )
}

function DeleteUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserListItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DeleteUserForm user={user} onDone={() => onOpenChange(false)} />
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
