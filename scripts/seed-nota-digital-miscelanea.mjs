#!/usr/bin/env node
/**
 * Datos sintéticos de MISCELÁNEA para probar la NOTA DIGITAL en el tenant
 * legado. EJECUCIÓN MANUAL — NO se siembra en el deploy. Idempotente: upsert
 * por (tenant_id, sku), así que re-ejecutarlo no duplica ni rompe precios
 * editados a mano (el precio del archivo SÍ se reescribe: es la fuente).
 *
 *   node scripts/seed-nota-digital-miscelanea.mjs
 *
 * Corre con el DUEÑO (DATABASE_URL_ADMIN): es una herramienta de prueba, no
 * una escritura de la app. Imprime el conteo insertado/actualizado.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const envPath = path.join(root, ".env")
try {
  const env = readFileSync(envPath, "utf8")
  for (const key of ["DATABASE_URL_ADMIN", "DATABASE_URL", "LEGACY_TENANT_ID"]) {
    const line = env.split("\n").find((row) => row.startsWith(`${key}=`))
    if (line) process.env[key] ??= line.slice(`${key}=`.length).trim()
  }
} catch {
  // Sin .env: se valida abajo.
}

const adminUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL
const LEGACY = process.env.LEGACY_TENANT_ID || "8e83b5cc-9f43-28b2-a8f3-2882fef090a8"
if (!adminUrl) {
  console.error("DATABASE_URL_ADMIN (o DATABASE_URL) es requerido")
  process.exit(1)
}

/** Mismo set que assets/miscelanea-ejemplo.csv (importable desde Alta de Artículos). */
const ARTICULOS = [
  ["MISC-001", "Refresco 600 ml", "pieza", 18, "Bebidas"],
  ["MISC-002", "Agua natural 1 L", "pieza", 12, "Bebidas"],
  ["MISC-003", "Leche entera 1 L", "pieza", 27, "Lácteos"],
  ["MISC-004", "Pan de dulce", "pieza", 15, "Panadería"],
  ["MISC-005", "Tortilla de maíz", "kg", 38, "Panadería"],
  ["MISC-006", "Huevo fresca", "kg", 92, "Abarrotes"],
  ["MISC-007", "Arroz blanco", "kg", 34, "Abarrotes"],
  ["MISC-008", "Frijol negro", "kg", 58, "Abarrotes"],
  ["MISC-009", "Aceite vegetal 1 L", "pieza", 62, "Abarrotes"],
  ["MISC-010", "Azúcar refinada 1 kg", "pieza", 29, "Abarrotes"],
  ["MISC-011", "Jabón de barra", "pieza", 14, "Limpieza"],
  ["MISC-012", "Detergente líquido 1 L", "pieza", 55, "Limpieza"],
  ["MISC-013", "Papel higiénico 4 rollos", "paquete", 68, "Limpieza"],
  ["MISC-014", "Recarga de tiempo aire 50 MXN", "servicio", 50, "Servicios"],
  ["MISC-015", "Recarga de tiempo aire 100 MXN", "servicio", 100, "Servicios"],
  ["MISC-016", "Café de grano", "kg", 210, "Bebidas"],
  ["MISC-017", "Mermelada de fresa 250 g", "pieza", 45, "Abarrotes"],
  ["MISC-018", "Galletas de mantequilla 200 g", "paquete", 39, "Abarrotes"],
]

const client = new Client({ connectionString: adminUrl })
await client.connect()
try {
  await client.query("BEGIN")
  let nuevos = 0
  let actualizados = 0
  for (const [sku, nombre, um, precio, categoria] of ARTICULOS) {
    const result = await client.query(
      `INSERT INTO articulos
         (tenant_id, sku, nombre, descripcion, um, precio_unitario, categoria, disponible, status)
       VALUES ($1::uuid, $2, $3, '', $4, $5, $6, true, 'active')
       ON CONFLICT (tenant_id, sku) DO UPDATE
          SET nombre = EXCLUDED.nombre, um = EXCLUDED.um,
              precio_unitario = EXCLUDED.precio_unitario,
              categoria = EXCLUDED.categoria, disponible = true,
              status = 'active', updated_at = now()
       RETURNING (xmax = 0) AS insertado`,
      [LEGACY, sku, nombre, um, precio, categoria]
    )
    if (result.rows[0]?.insertado === true) nuevos += 1
    else actualizados += 1
  }
  await client.query("COMMIT")
  console.log(
    `Miscelánea sembrada en el tenant ${LEGACY}: ${nuevos} nuevos, ${actualizados} actualizados (${ARTICULOS.length} SKU).`
  )
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  console.error("Error sembrando miscelánea:", error.message)
  process.exit(1)
} finally {
  await client.end()
}
