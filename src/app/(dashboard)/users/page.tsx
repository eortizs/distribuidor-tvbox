import { CreateUserButton, UsersManager } from "@/components/auth/users-list"
import { requireRole } from "@/server/auth/guards"
import { listUsers } from "@/server/auth/users"

export const metadata = {
  title: "Users",
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)
}

export default async function UsersPage() {
  const session = await requireRole("admin")
  const users = await listUsers()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">Users</h1>
          <p className="text-muted-foreground text-sm">
            Admin and distributor accounts with access to this dashboard.
          </p>
        </div>
        <CreateUserButton />
      </div>
      <UsersManager
        users={users.map((user) => ({
          id: user.id,
          username: user.username,
          role: user.role,
          entityCount: user.entityCount,
          createdAt: user.createdAt.toISOString(),
          createdAtLabel: formatDate(user.createdAt),
        }))}
        currentUserId={session.id}
      />
    </div>
  )
}
