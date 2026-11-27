import { IMPORT_MAX_BYTES, leerCsvArticulos } from "@/lib/articulos"
import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import {
  contarSkusExistentes,
  importarArticulos,
} from "@/server/articulos/repository"
import { errorResponse } from "@/server/http"
import { AppError } from "@/server/umejson/types"

export const instant = false

/**
 * POST /api/articulos/importar — importación CSV del catálogo en dos pasos
 * sobre el MISMO archivo (sin borrador en servidor):
 *
 *   - modo "preview": parsea, mapea cabeceras (con alias) y valida TODAS
 *     las filas sin escribir; devuelve el informe con errores por fila y el
 *     conteo EXACTO de nuevos/actualizados (consulta los SKU existentes).
 *   - modo "aplicar": re-valida el archivo que llega en esta petición (la
 *     vista previa no es confiable) y, solo si no hay errores, aplica el
 *     upsert en UNA transacción — todo o nada. Reenviar la misma petición
 *     es inocuo: el upsert por SKU deja los mismos datos.
 *
 * El CSV es aditivo y correctivo: los SKU existentes se ACTUALIZAN con los
 * datos del archivo y quedan activos; los nuevos se insertan. El archivo no
 * borra ni archiva nada que falte en él.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser("core")
    if (!user) return unauthorizedResponse()

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new AppError(
        400,
        "invalid_request",
        "Solicitud inválida: envía el archivo CSV como formulario."
      )
    }

    const modo = form.get("modo")
    if (modo !== "preview" && modo !== "aplicar") {
      throw new AppError(
        422,
        "modo_invalido",
        "El modo debe ser preview o aplicar."
      )
    }

    const archivo = form.get("archivo")
    if (!(archivo instanceof File)) {
      throw new AppError(
        422,
        "archivo_invalido",
        "Adjunta el archivo CSV a importar."
      )
    }
    if (archivo.size > IMPORT_MAX_BYTES) {
      throw new AppError(
        413,
        "archivo_grande",
        `El archivo supera el máximo de ${Math.round(
          IMPORT_MAX_BYTES / (1024 * 1024)
        )} MB. Divídelo en varios archivos.`
      )
    }

    let contenido: string
    try {
      contenido = await archivo.text()
    } catch {
      throw new AppError(
        422,
        "archivo_invalido",
        "No se pudo leer el archivo: guárdalo como CSV de texto (UTF-8)."
      )
    }

    const lectura = leerCsvArticulos(contenido)
    if (!lectura.ok) {
      throw new AppError(422, "archivo_invalido", lectura.error)
    }

    if (modo === "preview") {
      // Conteo exacto de nuevos vs actualizados para el diálogo: consulta
      // los SKU del archivo contra el catálogo SIN escribir nada.
      const existentes = await contarSkusExistentes(
        lectura.validas.map((articulo) => articulo.sku)
      )
      const nuevos = lectura.validas.filter(
        (articulo) => !existentes.has(articulo.sku)
      ).length
      const informe = {
        ...lectura.informe,
        nuevos,
        actualizados: lectura.validas.length - nuevos,
      }
      return Response.json(
        { ok: true, data: { modo, informe } },
        { headers: { "Cache-Control": "private, no-store" } }
      )
    }

    // Defensa en profundidad: «aplicar» jamás corre con errores en el
    // archivo, aunque el cliente los haya omitido.
    if (lectura.informe.errores > 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "importacion_con_errores",
            message:
              "El archivo tiene renglones con errores: corrígelos y vuelve a intentar la importación.",
            details: { informe: lectura.informe },
          },
        },
        { status: 422, headers: { "Cache-Control": "private, no-store" } }
      )
    }

    const { nuevos, actualizados } = await importarArticulos(
      lectura.validas,
      user.id
    )

    return Response.json(
      {
        ok: true,
        data: {
          modo,
          informe: {
            total: lectura.informe.total,
            nuevos,
            actualizados,
            errores: 0,
            filas: [],
          },
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return errorResponse(error)
  }
}
