import { redirect } from "next/navigation"

import { PasswordForm } from "@/components/profile/password-form"
import { ProfileForm } from "@/components/profile/profile-form"
import { Badge } from "@/components/reui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/server/auth/guards"
import { getProfile } from "@/server/auth/profile"

export const instant = false

export const metadata = {
  title: "Perfil",
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(date)
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium break-all">{children}</span>
    </div>
  )
}

export default async function ProfilePage() {
  const sessionUser = await requireUser()
  const profile = await getProfile(sessionUser.id)
  if (!profile) {
    redirect("/login")
  }
  const { email, role, createdAt, account } = profile

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">Perfil</h1>
        <p className="text-muted-foreground text-sm">
          Tus datos de cuenta y opciones de seguridad.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Información personal</CardTitle>
              <CardDescription>
                Los cambios quedan registrados en el historial de la entidad
                Cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm
                key={
                  account ? `${account.entityId}:${account.version}` : email
                }
                email={email}
                fullName={account?.fullName ?? ""}
                phone={account?.phone ?? ""}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Seguridad</CardTitle>
              <CardDescription>
                Cambia tu contraseña periódicamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Detalles</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Fact label="Rol">
                <Badge
                  variant={role === "admin" ? "primary-light" : "info-light"}
                  size="sm"
                >
                  {role}
                </Badge>
              </Fact>
              <Fact label="Miembro desde">{formatDate(createdAt)}</Fact>
              <Fact label="Última actualización">
                {account ? formatDateTime(account.updatedAt) : "—"}
              </Fact>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
