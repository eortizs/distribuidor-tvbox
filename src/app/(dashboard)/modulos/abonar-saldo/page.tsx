import { AbonarSaldoView } from "@/components/herramientas/saldo/abonar-saldo-view"
import { requireUser } from "@/server/auth/guards"
import {
  isCouponQaEnabled,
  transferBankDataOrNull,
} from "@/server/mercadopago/config"
import { getSaldoSnapshot } from "@/server/saldo/service"

export const metadata = {
  title: "Abonar saldo",
}

/**
 * Módulo «Abonar saldo» (`/modulos/abonar-saldo`): el comprador define el
 * monto y paga con el mismo checkout de las renovaciones (Mercado Pago,
 * transferencia o cupón), pero el cumplimiento acredita saldo en su cuenta
 * del panel en vez de renovar una licencia. El saldo y los movimientos se
 * leen del servidor (`users.saldo` + `saldo_movimientos`); el retorno del
 * checkout de Mercado Pago vuelve por query (`orden` + `estado`) para el
 * aviso y el sondeo, igual que en `/clientes`.
 */
export default async function AbonarSaldoPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string; estado?: string }>
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams])
  const snapshot = await getSaldoSnapshot(user.id)

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <h1 className="sr-only">Abonar saldo</h1>
      <AbonarSaldoView
        saldoInicial={snapshot.saldo}
        movimientos={snapshot.movimientos}
        buyerUsername={user.username}
        couponEnabled={isCouponQaEnabled()}
        transferBank={transferBankDataOrNull()}
        returnOrder={params.orden?.trim() || null}
        returnState={params.estado?.trim() || null}
      />
    </div>
  )
}
