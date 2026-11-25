import type { Metadata } from "next"

import { Landing } from "@/components/short/landing"
import { shortLinkBaseUrl } from "@/server/site-url"

const TITLE = "SPEILink — Links de pago por WhatsApp con confirmación automática"
const DESCRIPTION =
  "Crea links de pago para WhatsApp y recibe el 100% de tu dinero directo en tu cuenta. Cada pago se valida con su concepto de pago y depósito bancario."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(shortLinkBaseUrl()),
  alternates: { canonical: "/" },
  icons: { icon: "/spei-link-favicon.ico" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "SPEILink",
    locale: "es_MX",
    type: "website",
    images: [
      {
        url: "/spei-link-og.png",
        width: 480,
        height: 480,
        alt: "SPEILink - Links de pago por WhatsApp",
      },
    ],
  },
}

/**
 * Landing pública común (§6.5 del plan de afiliados): envoltorio estático
 * que prerenderiza el cuerpo compartido (`Landing`) con `affiliate=null` —
 * SIN APIs de request ni BD, para que `/short` siga en `○` y el HTML
 * prerenderizado no cambie. La variante de afiliado vive en
 * `/short/afiliado/[code]` (dinámica; solo la produce el proxy).
 */
export default function ShortLandingPage() {
  return <Landing affiliate={null} />
}
