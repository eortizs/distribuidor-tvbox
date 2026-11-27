import type { Metadata } from "next"

import { NotaDigitalView } from "@/components/herramientas/nota-digital/nota-digital-view"
import { ARTICULOS_MAX_POR_TENANT } from "@/lib/articulos"
import { toPaymentOrderListItem } from "@/lib/links-pago"
import type { NotaDigitalListItem } from "@/lib/nota-digital"
import { isOwnerRole } from "@/server/auth/types"
import { requireUser } from "@/server/auth/guards"
import { listarArticulos } from "@/server/articulos/repository"
import { listNotaOrders } from "@/server/nota-digital/repository"
import { resolvePaymentOrderWhatsAppNumber } from "@/server/links-pago/wa-link"
import { receiptScanConfigured } from "@/server/transferencias/scan"

export const metadata: Metadata = {
  title: "Nota Digital",
}

export default async function NotaDigitalPage() {
  const user = await requireUser("core")

  // Degrada a estado de error en la vista sin romper el render (misma
  // estrategia que /modulos/reporte-spei).
  const [loaded, catalogo] = await Promise.all([
    listNotaOrders({
      creatorUserId: isOwnerRole(user.role) ? undefined : user.id,
    }).catch(() => null),
    listarArticulos({
      status: "active",
      disponible: true,
      pageSize: ARTICULOS_MAX_POR_TENANT,
    }).catch(() => null),
  ])

  const notas: NotaDigitalListItem[] = (loaded ?? []).map((nota) => ({
    ...toPaymentOrderListItem(nota.order),
    items: nota.items,
  }))

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <h1 className="sr-only">Nota Digital</h1>
      <NotaDigitalView
        initialNotas={notas}
        initialArticulos={catalogo ? catalogo.articulos : null}
        isAdmin={isOwnerRole(user.role)}
        whatsappConfigured={
          (await resolvePaymentOrderWhatsAppNumber(user.tenantId ?? null)) !== null
        }
        scanConfigured={receiptScanConfigured()}
      />
    </div>
  )
}
