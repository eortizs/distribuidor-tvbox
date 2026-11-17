import type { Metadata } from "next"

import { OrdenPagoView } from "@/components/herramientas/orden-de-pago/orden-de-pago-view"
import { toPaymentOrderListItem } from "@/lib/orden-pago"
import { requireUser } from "@/server/auth/guards"
import { listPaymentOrders } from "@/server/orden-pago/repository"
import { receiptScanConfigured } from "@/server/transferencias/scan"
import { whatsappAgentNumber } from "@/server/whatsapp/config"

export const metadata: Metadata = {
  title: "Orden de pago",
}

export default async function OrdenPagoPage() {
  const user = await requireUser()

  // Distribuidor: solo sus órdenes; admin: todas (con quién las creó).
  const orders = await listPaymentOrders({
    creatorUserId: user.role === "admin" ? undefined : user.id,
  })

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <h1 className="sr-only">Orden de pago</h1>
      <OrdenPagoView
        initialOrders={orders.map(toPaymentOrderListItem)}
        isAdmin={user.role === "admin"}
        whatsappConfigured={whatsappAgentNumber() !== null}
        scanConfigured={receiptScanConfigured()}
      />
    </div>
  )
}
