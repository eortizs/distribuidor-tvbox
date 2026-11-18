import { NextResponse, connection } from "next/server"

import { publicSiteUrl } from "@/server/site-url"

/*
 * Raíz del dominio corto de ligas de pago (spei.link/): no hay página de
 * inicio que mantener — el visitante va al panel. El proxy reescribe aquí
 * las peticiones del dominio corto sin gate de sesión.
 */

export async function GET() {
  await connection()
  const response = NextResponse.redirect(publicSiteUrl(), 302)
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("X-Robots-Tag", "noindex")
  return response
}
