import { CreateUserForm } from "@/components/auth/create-user-form"
import { Badge } from "@/components/reui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireRole } from "@/server/auth/guards"
import { listUsers } from "@/server/auth/users"

export const metadata = {
  title: "Users",
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)
}

export default async function UsersPage() {
  await requireRole("admin")
  const users = await listUsers()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          Admin and distributor accounts with access to this dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>
              Distributors only see the entities they created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {users.map((user, index) => (
                <li
                  key={user.id}
                  className={
                    index > 0 ? "border-t py-3 first:pt-0" : "py-3 first:pt-0"
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{user.username}</span>
                    <Badge
                      variant={
                        user.role === "admin" ? "primary-light" : "info-light"
                      }
                      size="sm"
                    >
                      {user.role}
                    </Badge>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {user.entityCount}{" "}
                      {user.entityCount === 1 ? "entity" : "entities"} · created{" "}
                      {formatDate(user.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New user</CardTitle>
            <CardDescription>
              Passwords are hashed with scrypt; share it securely once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateUserForm />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
