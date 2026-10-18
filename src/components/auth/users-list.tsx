"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import {
  createUserAction,
  deleteUserAction,
  updateUserAction,
  type CreateUserState,
  type DeleteUserState,
  type UpdateUserState,
} from "@/app/actions/users"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
}: {
  users: UserListItem[]
  currentUserId: string
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
            <EditUserDialog user={row.original} />
            {row.original.id !== currentUserId ? (
              <DeleteUserDialog user={row.original} />
            ) : null}
          </div>
        ),
        size: 100,
      },
    ],
    [currentUserId]
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
          Change the login email, role or set a new password. Leave the
          password blank to keep the current one.
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
