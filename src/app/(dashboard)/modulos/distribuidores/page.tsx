import { DistribuidoresView } from "@/components/herramientas/distribuidores/distribuidores-view"
import type { UserListItem } from "@/components/auth/users-list"
import { requireRole } from "@/server/auth/guards"
import { listDeniedSectionsByUser } from "@/server/auth/permissions"
import { listUsers } from "@/server/auth/users"
import {
  couponQaDailyLimit,
  couponQaMonthlyLimit,
} from "@/server/mercadopago/config"
import { listHiddenModulesByUser } from "@/server/modulos/visibility"

export const metadata = {
  title: "Distribuidores",
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(date)
}

/**
 * Módulo Distribuidores (solo admin): el listado de `/users` filtrado a las
 * cuentas con rol `distribuidor`, servido ya filtrado desde el servidor.
 * Trae además las secciones denegadas por cuenta (diálogo Permisos), los
 * módulos ocultos por cuenta (sheet Módulos) y los topes globales de cupón,
 * exactamente igual que la página de Usuarios.
 */
export default async function DistribuidoresPage() {
  const session = await requireRole("admin")
  const [users, deniedByUser, hiddenModulesByUser] = await Promise.all([
    listUsers(),
    listDeniedSectionsByUser(),
    listHiddenModulesByUser(),
  ])

  const distribuidores: UserListItem[] = users
    .filter((user) => user.role === "distribuidor")
    .map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      entityCount: user.entityCount,
      distribuidorName: user.distribuidorName,
      whatsappPhone: user.whatsappPhone,
      deniedSections: deniedByUser.get(user.id) ?? [],
      hiddenModules: hiddenModulesByUser.get(user.id) ?? [],
      couponDailyLimit: user.couponDailyLimit,
      couponMonthlyLimit: user.couponMonthlyLimit,
      googleLinked: user.googleLinked,
      saldoCupones: user.saldoCupones,
      saldoTokens: user.saldoTokens,
      createdAt: user.createdAt.toISOString(),
      createdAtLabel: formatDate(user.createdAt),
    }))

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <h1 className="sr-only">Distribuidores</h1>
      <DistribuidoresView
        users={distribuidores}
        currentUserId={session.id}
        couponDailyLimitDefault={couponQaDailyLimit()}
        couponMonthlyLimitDefault={couponQaMonthlyLimit()}
      />
    </div>
  )
}
