import type { Metadata } from "next"
import { headers } from "next/headers"
import { connection } from "next/server"

import { Landing } from "@/components/short/landing"
import {
  AFFILIATE_MODE_HEADER,
  isAffiliateMode,
} from "@/lib/afiliados"

/**
 * Landing del afiliado (§6.5 del plan de afiliados): SOLO la produce la
 * reescritura del proxy (`spei.link/afiliado/CÓDIGO` y `/` con cookie), que
 * además trae el código en la ruta y el modo en la cabecera (la cookie de
 * 30 días la fija el proxy en su respuesta). La página NO consulta BD: un
 * código aquí no es evidencia de nada — sin cabecera del proxy (petición
 * directa al panel, rastreador ajeno) se renderiza la landing común, jamás
 * una atribución inventada.
 */
export const instant = false

type Props = { params: Promise<{ code: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  return {
    title: "SPEILink — Links de pago por WhatsApp con confirmación automática",
    robots: { index: false, follow: true },
    alternates: { canonical: `/afiliado/${code}` },
    icons: { icon: "/spei-link-favicon.ico" },
  }
}

export default async function AffiliateLandingPage({ params }: Props) {
  await connection()
  const [{ code }, headerStore] = await Promise.all([params, headers()])
  const mode = headerStore.get(AFFILIATE_MODE_HEADER)
  const trusted = isAffiliateMode(mode)
  // Sin cabecera del proxy la petición no pasó por /afiliado: sin atribución.
  return <Landing affiliate={trusted ? { code } : null} />
}
