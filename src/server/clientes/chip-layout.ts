import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

/**
 * Orden manual de la hilera de filtros de `/clientes` («Reordenar» del chip):
 * lista de claves de chips en el orden elegido, por usuario (tabla
 * `client_chip_layout`). Las claves son `preset:<valor>` para las vistas
 * preconfiguradas y `filter:<uuid>` para los filtros guardados; claves
 * desconocidas se ignoran al leer y chips nuevos se agregan al final, así
 * que el layout guardado nunca rompe la pantalla.
 */

const CHIP_KEY_RE =
  /^(preset:[a-z][a-z-]*|filter:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const CHIP_LAYOUT_MAX = 64

/** Lee el orden guardado del usuario; [] si nunca lo reordenó. */
export async function getChipLayout(userId: string): Promise<string[]> {
  const result = await pool.query(
    "SELECT chip_order FROM client_chip_layout WHERE user_id = $1",
    [userId]
  )
  const order = result.rows[0]?.chip_order
  if (!Array.isArray(order)) return []
  return order.filter((key): key is string => typeof key === "string")
}

/**
 * Guarda el orden completo de la hilera: valida cada clave, deduplica
 * (vale la primera aparición) y hace upsert. Lanza 422 ante claves
 * inválidas o una lista fuera de rango.
 */
export async function setChipLayout(
  userId: string,
  order: string[]
): Promise<void> {
  if (order.length > CHIP_LAYOUT_MAX) {
    throw new AppError(
      422,
      "invalid_layout",
      `El orden no puede pasar de ${CHIP_LAYOUT_MAX} chips.`
    )
  }
  const cleaned: string[] = []
  const seen = new Set<string>()
  for (const key of order) {
    if (typeof key !== "string" || !CHIP_KEY_RE.test(key)) {
      throw new AppError(
        422,
        "invalid_chip_key",
        "Hay claves de chip inválidas en el orden enviado."
      )
    }
    if (!seen.has(key)) {
      seen.add(key)
      cleaned.push(key)
    }
  }
  await pool.query(
    `INSERT INTO client_chip_layout (user_id, chip_order)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE
        SET chip_order = EXCLUDED.chip_order,
            updated_at = now()`,
    [userId, JSON.stringify(cleaned)]
  )
}
