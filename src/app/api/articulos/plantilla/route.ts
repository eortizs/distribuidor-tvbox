import { plantillaCsv } from "@/lib/articulos"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { errorResponse } from "@/server/http"

export const instant = false

/**
 * GET /api/articulos/plantilla → CSV descargable de la plantilla de
 * importación: BOM UTF-8 (Excel la abre con los acentos correctos),
 * cabeceras canónicas —la misma lista que valida el importador, una sola
 * fuente en src/lib/articulos.ts— y un renglón de ejemplo. La sesión la
 * protege (requireApiUser), igual que el resto de APIs del panel.
 */
export async function GET() {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    return new Response(plantillaCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="plantilla-articulos.csv"',
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
