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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
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

      <Tabs defaultValue="detalles">
        <TabsList variant="line" className="mb-3.5 w-full">
          <TabsTrigger value="detalles">Detalles</TabsTrigger>
          <TabsTrigger value="informacion">Información</TabsTrigger>
          <TabsTrigger value="seguridad">Seguridad</TabsTrigger>
        </TabsList>

        <TabsContent value="detalles" keepMounted>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Detalles</CardTitle>
              <CardDescription className="text-sm">
                Información general de tu cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Fact label="Email">
                <span className="break-all">{email}</span>
              </Fact>
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
        </TabsContent>

        <TabsContent value="informacion" keepMounted>
          <ProfileForm
            key={account ? `${account.entityId}:${account.version}` : email}
            email={email}
            fullName={account?.fullName ?? ""}
            phone={account?.phone ?? ""}
          />
        </TabsContent>

        <TabsContent value="seguridad" keepMounted>
          <PasswordForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
