import {isOwnerRole, isBranchRole } from "@/server/auth/types"
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
import { findUserById } from "@/server/auth/users"
import { getUserMpTokenStatus } from "@/server/mercadopago/tokens"
import {
  getTenantBanking,
  getTenantMpTokenStatus,
} from "@/server/tenants/business"
import { effectiveDbContext } from "@/server/tenant/context"

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
  const sessionUser = await requireUser("core")
  const [profile, userRow, mpToken] = await Promise.all([
    getProfile(sessionUser.id),
    findUserById(sessionUser.id),
    // Metadatos del token propio (jamás el token: es write-only).
    getUserMpTokenStatus(sessionUser.id).catch(() => null),
  ])
  if (!profile) {
    redirect("/login")
  }
  const { email, role, createdAt, account } = profile

  // Datos del NEGOCIO del tenant de la cuenta (Fase 3 §3.4): propietario
  // edita; sucursal ve en modo lectura. Plataforma (sin tenant): sin tarjeta.
  const context = await effectiveDbContext()
  const tenantId = context?.tenantId ?? null
  const [business, businessMpToken] = tenantId
    ? await Promise.all([
        getTenantBanking(tenantId).catch(() => null),
        getTenantMpTokenStatus(tenantId).catch(() => null),
      ])
    : [null, null]

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
                  variant={isOwnerRole(role) ? "primary-light" : "info-light"}
                  size="sm"
                >
                  {isOwnerRole(role)
                    ? "Propietario"
                    : isBranchRole(role)
                      ? "Sucursal"
                      : role}
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
          <div className="flex flex-col gap-6">
            <ProfileForm
              key={account ? `${account.entityId}:${account.version}` : email}
              fullName={account?.fullName ?? ""}
              whatsappPhone={userRow?.whatsappPhone ?? ""}
              bankName={account?.bankName ?? ""}
              bankHolder={account?.bankHolder ?? ""}
              bankClabe={account?.bankClabe ?? ""}
              mpToken={mpToken}
              business={
                business
                  ? {
                      bankName: business.bankName ?? "",
                      bankHolder: business.bankHolder ?? "",
                      bankClabe: business.bankClabe ?? "",
                    }
                  : null
              }
              businessMpToken={businessMpToken}
              canEditBusiness={isOwnerRole(role)}
              showBusinessCard={tenantId !== null}
            />
          </div>
        </TabsContent>

        <TabsContent value="seguridad" keepMounted>
          <PasswordForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
