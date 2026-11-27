#!/usr/bin/env node
/**
 * Verificación SQL del catálogo de artículos (AL FINAL, bajo demanda y en
 * staging: crea filas de prueba). NO va en la cadena de despliegue.
 *
 * Conecta con el DUEÑO (DATABASE_URL_ADMIN) para las fixtures/limpieza — el
 * rol de la app NO tiene DELETE en articulos por diseño — y con el ROL DE
 * LA APP (DATABASE_URL, speilink_app) para afirmar, bajo el tenant legado:
 *   1. Sin contexto: 0 filas; contexto ajeno: 0 filas; contexto propio: ve
 *      las fixtures.
 *   2. INSERT con tenant_id ajeno explícito es rechazado (WITH CHECK).
 *   3. UNIQUE (tenant_id, sku) aplica con la fila ACTIVA y también
 *      ARCHIVADA (23505).
 *   4. Upsert por SKU: el primer INSERT crea (xmax=0), el conflicto
 *      ACTUALIZA y sube `version` (importación idempotente).
 *   5. DELETE está REVOCADO a la app (42501): archivar es un UPDATE.
 *
 *   node scripts/verify-articulos.mjs
 * Exit 0 = aislamiento y contrato efectivos; exit 1 con el detalle.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function loadEnv() {
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
}

loadEnv()
const adminUrl = process.env.DATABASE_URL_ADMIN
const appUrl = process.env.DATABASE_URL
if (!adminUrl || !appUrl) {
  console.error(
    "DATABASE_URL_ADMIN (dueño, fixtures) y DATABASE_URL (rol app, aserciones) son requeridos"
  )
  process.exit(1)
}

const LEGACY = process.env.LEGACY_TENANT_ID || "8e83b5cc-9f43-28b2-a8f3-2882fef090a8"
const AJENO = "11111111-1111-4111-8111-111111111111"

// SKUs de prueba: prefijo inequívoco para no chocar con datos reales.
const SKU_A = `ZZVERIFY-${Date.now()}-A`
const SKU_B = `ZZVERIFY-${Date.now()}-B`
const idA = crypto.randomUUID()
const idB = crypto.randomUUID()

const failures = []
function fail(what) {
  failures.push(what)
  console.error(`FAIL ${what}`)
}
function ok(what) {
  console.log(`ok - ${what}`)
}

const owner = new Client({ connectionString: adminUrl })
const app = new Client({ connectionString: appUrl })

try {
  await owner.connect()
  await app.connect()

  // ------------------------------------------------------------------
  // Fixtures con el dueño (bypass RLS): dos artículos del tenant legado.
  // ------------------------------------------------------------------
  await owner.query("BEGIN")
  await owner.query("SELECT set_config('app.tenant_id', $1, true)", [LEGACY])
  await owner.query(
    `INSERT INTO articulos (id, sku, nombre, descripcion, um, precio_unitario, categoria, disponible)
     VALUES ($1, $2, 'Artículo probe A', '', 'pieza', 10.00, 'Verificación', true)`,
    [idA, SKU_A]
  )
  await owner.query(
    `INSERT INTO articulos (id, sku, nombre, descripcion, um, precio_unitario, disponible, status)
     VALUES ($1, $2, 'Artículo probe B', '', 'pieza', 20.00, false, 'archived')`,
    [idB, SKU_B]
  )
  await owner.query("COMMIT")

  // ------------------------------------------------------------------
  // Aserciones con el ROL DE LA APP (RLS efectivo).
  // ------------------------------------------------------------------

  // 1. Sin contexto: 0 filas.
  await app.query(
    "SELECT set_config('app.tenant_id','',false), set_config('app.platform','',false)"
  )
  const anon = await app.query("SELECT count(*)::int AS n FROM articulos")
  if (anon.rows[0].n !== 0) {
    fail(`articulos sin contexto se ven ${anon.rows[0].n} filas (debe ser 0)`)
  } else {
    ok("sin contexto el rol de la app no ve filas")
  }

  // Contexto ajeno: 0 filas (la fixture del legado es invisible).
  await app.query("SELECT set_config('app.tenant_id', $1, false)", [AJENO])
  const ajeno = await app.query("SELECT count(*)::int AS n FROM articulos WHERE id = $1", [idA])
  if (ajeno.rows[0].n !== 0) {
    fail(`un tenant ajeno VE la fila del legado (FUGA)`)
  } else {
    ok("un contexto ajeno no ve la fila del legado")
  }

  // 2. WITH CHECK: INSERT con tenant ajeno explícito lanza.
  await app.query("SELECT set_config('app.tenant_id', $1, false)", [LEGACY])
  const crossInsert = await app.query(
    `INSERT INTO articulos (tenant_id, sku, nombre, um, precio_unitario)
     VALUES ($1, $2, 'intruso', 'pieza', 1.00)`,
    [AJENO, `${SKU_A}-X`]
  ).then(() => null).catch((error) => error)
  if (!crossInsert || crossInsert.code !== "42501") {
    fail(
      `INSERT con tenant ajeno no fue rechazado por WITH CHECK (${crossInsert?.code ?? "sin error"})`
    )
  } else {
    ok("INSERT cross-tenant rechazado (WITH CHECK)")
  }

  // 3. UNIQUE (tenant_id, sku): activa…
  const dupActiva = await app.query(
    `INSERT INTO articulos (sku, nombre, um, precio_unitario)
     VALUES ($1, 'duplicada', 'pieza', 1.00)`,
    [SKU_A]
  ).then(() => null).catch((error) => error)
  if (!dupActiva || dupActiva.code !== "23505") {
    fail(`SKU duplicado ACTIVO no lanzó 23505 (${dupActiva?.code ?? "sin error"})`)
  } else {
    ok("UNIQUE (tenant_id, sku) rechaza duplicado activo")
  }

  // …y también la ARCHIVADA (la unicidad incluye archivados).
  const dupArchivada = await app.query(
    `INSERT INTO articulos (sku, nombre, um, precio_unitario)
     VALUES ($1, 'duplicada de archivada', 'pieza', 1.00)`,
    [SKU_B]
  ).then(() => null).catch((error) => error)
  if (!dupArchivada || dupArchivada.code !== "23505") {
    fail(`SKU duplicado ARCHIVADO no lanzó 23505 (${dupArchivada?.code ?? "sin error"})`)
  } else {
    ok("UNIQUE (tenant_id, sku) aplica también con archivados")
  }

  // 4. Upsert por SKU: primera vez inserta (xmax=0), segunda actualiza y
  // sube la versión — el contrato de la importación.
  const primera = await app.query(
    `INSERT INTO articulos (sku, nombre, um, precio_unitario)
     VALUES ($1, 'upsert v1', 'pieza', 5.00)
     ON CONFLICT (tenant_id, sku) DO UPDATE
       SET nombre = EXCLUDED.nombre, version = articulos.version + 1
     RETURNING id, version, (xmax = 0) AS insertado`,
    [`${SKU_A}-UPSERT`]
  )
  const filaPrimera = primera.rows[0]
  // `version` es bigint: pg lo entrega como string; el mapper de la app lo
  // coerza con Number().
  if (filaPrimera.insertado !== true || Number(filaPrimera.version) !== 1) {
    fail(`el primer upsert debía insertar con version 1 (${JSON.stringify(filaPrimera)})`)
  } else {
    ok("upsert nuevo: inserta con version 1")
  }
  const segunda = await app.query(
    `INSERT INTO articulos (sku, nombre, um, precio_unitario)
     VALUES ($1, 'upsert v2', 'pieza', 6.00)
     ON CONFLICT (tenant_id, sku) DO UPDATE
       SET nombre = EXCLUDED.nombre, version = articulos.version + 1
     RETURNING id, version, (xmax = 0) AS insertado, nombre`,
    [`${SKU_A}-UPSERT`]
  )
  const filaSegunda = segunda.rows[0]
  if (
    filaSegunda.insertado !== false ||
    Number(filaSegunda.version) !== 2 ||
    filaSegunda.nombre !== "upsert v2"
  ) {
    fail(`el conflicto debía actualizar a version 2 (${JSON.stringify(filaSegunda)})`)
  } else {
    ok("upsert existente: actualiza y sube la version")
  }

  // 5. DELETE revocado a la app (archivar es un UPDATE).
  const intentoDelete = await app.query("DELETE FROM articulos WHERE id = $1", [idA])
    .then(() => null).catch((error) => error)
  if (!intentoDelete || intentoDelete.code !== "42501") {
    fail(
      `DELETE no está revocado a la app (${intentoDelete?.code ?? "sin error, rowCount borrado"})`
    )
  } else {
    ok("DELETE revocado a la app (archivar es UPDATE)")
  }

  // El UPDATE sí funciona (archivar de verdad) bajo el contexto propio.
  const archivar = await app.query(
    "UPDATE articulos SET status = 'archived', version = version + 1 WHERE id = $1 RETURNING status",
    [idA]
  )
  if (archivar.rows[0]?.status !== "archived") {
    fail("el rol de la app no pudo archivar bajo su contexto")
  } else {
    ok("UPDATE de archivado funciona bajo el contexto propio")
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} fallos`)
    process.exitCode = 1
  } else {
    console.log(
      "Artículos verificados: RLS aísla por tenant, UNIQUE cubre archivados, upsert y REVOKE DELETE efectivos."
    )
  }
} finally {
  // ------------------------------------------------------------------
  // Limpieza con el dueño (el rol de la app no tiene DELETE).
  // ------------------------------------------------------------------
  try {
    await owner.query("BEGIN")
    await owner.query("SELECT set_config('app.platform', 'on', true)")
    await owner.query(
      "DELETE FROM articulos WHERE sku LIKE 'ZZVERIFY-%'"
    )
    await owner.query("COMMIT")
  } catch (cleanupError) {
    console.error(
      "Limpieza incompleta (revisar SKUs ZZVERIFY-*):",
      cleanupError instanceof Error ? cleanupError.message : cleanupError
    )
    process.exitCode ??= 1
  }
  await owner.end().catch(() => undefined)
  await app.end().catch(() => undefined)
}
