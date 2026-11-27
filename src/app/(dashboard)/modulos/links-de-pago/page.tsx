import { isOwnerRole } from "@/server/auth/types"
import type { Metadata } from "next"

import { LinksPagoView } from "@/components/herramientas/links-pago/links-pago-view"
import { toPaymentOrderListItem } from "@/lib/links-pago"
import { requireUser } from "@/server/auth/guards"
import {
  findPaymentQrCodeOfUser,
  listPaymentOrders,
} from "@/server/links-pago/repository"
import { renderPaymentQrLink } from "@/server/links-pago/qr-asset"
import { resolvePaymentOrderWhatsAppNumber } from "@/server/links-pago/wa-link"
import { receiptScanConfigured } from "@/server/transferencias/scan"

export const metadata: Metadata = {
  title: "SPEILink",
}

export default async function LinksPagoPage() {
  const user = await requireUser("core")

  // Distribuidor: solo sus órdenes; admin: todas (con quién las creó).
  const orders = await listPaymentOrders({
    creatorUserId: isOwnerRole(user.role) ? undefined : user.id,
  })

  // QR FIJO: quien ya tiene código entra con el QR armado; quien no, ve el
  // botón que lo asigna (ninguna escritura en el GET).
  const qrCode = await findPaymentQrCodeOfUser(user.id).catch(() => null)
  const initialQr = qrCode
    ? await renderPaymentQrLink(qrCode, user.tenantId ?? null).catch(
        () => null
      )
    : null

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">SPEILink</h1>
      <LinksPagoView
        initialOrders={orders.map(toPaymentOrderListItem)}
        initialQr={initialQr}
        isAdmin={isOwnerRole(user.role)}
        // POR TENANT (§4.5 2B): el canal es el WhatsApp del negocio (legado:
        // el del env). Sin él la creación está bloqueada con guía.
        whatsappConfigured={
          (await resolvePaymentOrderWhatsAppNumber(user.tenantId ?? null)) !== null
        }
        scanConfigured={receiptScanConfigured()}
      />
    </div>
  )
}
