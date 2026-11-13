import { PaquetesView } from "@/components/herramientas/paquetes/paquetes-view"
import { requireUser } from "@/server/auth/guards"
import { resolveClientScope } from "@/server/flujotv/scope"
import {
  licensePriceMxnOrNull,
  transferBankDataOrNull,
} from "@/server/mercadopago/config"
import { getSaldosActual } from "@/server/saldo/service"

export const metadata = {
  title: "Paquetes FlujoTV",
}

/**
 * Módulo de compra de paquetes (3, 6 y 12 meses con meses de regalo), con la
 * misma estructura de la compra de licencias individuales de `/clientes`:
 * listado con alcance por perfil (el distribuidor solo ve sus clientes),
 * precio unitario y datos bancarios desde `.env`, y el retorno del checkout
 * de Mercado Pago por query (`orden` + `estado`) para el aviso y el sondeo.
 * `saldoCupones` es el saldo en cupones actual del comprador (la billetera
 * que el cupón debita para pagar licencias de FlujoTV): la ventana de pago
 * lo muestra y el servidor exige saldo suficiente antes de aceptar el canje.
 */
export default async function PaquetesFlujoTvPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string; estado?: string }>
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams])
  const [scope, saldos] = await Promise.all([
    resolveClientScope(user),
    getSaldosActual(user.id),
  ])
  const distribuidorName = scope.kind === "distributor" ? scope.name : null

  return (
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <h1 className="sr-only">Paquetes FlujoTV</h1>
      <PaquetesView
        distribuidorName={distribuidorName}
        priceMxn={licensePriceMxnOrNull()}
        returnOrder={params.orden?.trim() || null}
        returnState={params.estado?.trim() || null}
        transferBank={transferBankDataOrNull()}
        saldoCupones={saldos.cupones}
      />
    </div>
  )
}
