#!/usr/bin/env node
/**
 * Verificación SQL de la NOTA DIGITAL (bajo demanda / staging; NO va en la
 * cadena de despliegue). Crea fixtures con el DUEÑO y afirma con el ROL DE
 * LA APP (speilink_app, RLS efectivo) bajo el tenant legado:
 *   1. RLS habilitado en nota_digital_items; sin contexto y con tenant ajeno
 *      no se ven las filas; con el contexto propio se ven.
 *   2. INSERT cross-tenant es rechazado (WITH CHECK).
 *   3. UPDATE y DELETE están REVOCADOS a la app (los renglones son inmutables).
 *   4. El CHECK de origin de payment_orders ACEPTA 'nota' y rechaza un valor
 *      inventado.
 *   5. Atomicidad: la orden + sus renglones se leen juntos en orden por
 *      posicion, y un renglón con orden inexistente viola la FK.
 *
 *   node scripts/verify-nota-digital.mjs
 * Exit 0 = contrato y aislamiento efectivos; exit 1 con el detalle.
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
const CODIGO = "ZZNV"
const orderId = crypto.randomUUID()
const itemId = crypto.randomUUID()
const codigosCreados = [CODIGO]

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

  const usuario = await owner.query(
    "SELECT id::text FROM users WHERE tenant_id = $1::uuid LIMIT 1",
    [LEGACY]
  )
  if (!usuario.rows[0]) {
    throw new Error("No hay usuario en el tenant legado para la fixture")
  }
  const creatorId = usuario.rows[0].id

  await owner.query("BEGIN")
  await owner.query("SELECT set_config('app.tenant_id', $1, true)", [LEGACY])
  await owner.query(
    `INSERT INTO payment_orders
       (id, code, creator_user_id, amount_mxn, note, bank_name, bank_account, bank_holder, origin)
     VALUES ($1::uuid, $2, $3::uuid, 145, NULL, 'Banco', '000000000000000000', 'Titular', 'nota')`,
    [orderId, CODIGO, creatorId]
  )
  await owner.query(
    `INSERT INTO nota_digital_items
       (id, payment_order_id, sku, nombre, um, precio_unitario, cantidad, importe_linea, posicion)
     VALUES ($1::uuid, $2::uuid, 'ZZVERIFY-N-1', 'Artículo probe 1', 'pieza', 55, 1, 55, 0),
            ($3::uuid, $2::uuid, 'ZZVERIFY-N-2', 'Artículo probe 2', 'pieza', 35, 2, 70, 1)`,
    [itemId, orderId, crypto.randomUUID()]
  )
  await owner.query("COMMIT")

  // 1. RLS habilitado y aislamiento.
  const rel = await app.query(
    "SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='nota_digital_items'"
  )
  if (rel.rows[0]?.relrowsecurity !== true) {
    fail("nota_digital_items no tiene RLS habilitado")
  } else {
    ok("RLS habilitado en nota_digital_items")
  }

  await app.query(
    "SELECT set_config('app.tenant_id','',false), set_config('app.platform','',false)"
  )
  const anon = await app.query("SELECT count(*)::int AS n FROM nota_digital_items")
  if (anon.rows[0].n !== 0) fail(`sin contexto se ven ${anon.rows[0].n} renglones`)
  else ok("sin contexto el rol de la app no ve renglones")

  await app.query("SELECT set_config('app.tenant_id', $1, false)", [AJENO])
  const ajeno = await app.query(
    "SELECT count(*)::int AS n FROM nota_digital_items WHERE id = $1",
    [itemId]
  )
  if (ajeno.rows[0].n !== 0) fail("un tenant ajeno VE el renglón del legado (FUGA)")
  else ok("un contexto ajeno no ve el renglón del legado")

  await app.query("SELECT set_config('app.tenant_id', $1, false)", [LEGACY])
  const propio = await app.query(
    `SELECT count(*)::int AS n FROM nota_digital_items WHERE payment_order_id = $1`,
    [orderId]
  )
  if (propio.rows[0].n !== 2) fail(`bajo el tenant propio solo se ven ${propio.rows[0].n} renglones`)
  else ok("el tenant propio ve sus 2 renglones")

  // 2. WITH CHECK: INSERT con tenant ajeno explícito.
  const cross = await app.query(
    `INSERT INTO nota_digital_items
       (tenant_id, payment_order_id, sku, nombre, um, precio_unitario, cantidad, importe_linea, posicion)
     VALUES ($1::uuid, $2::uuid, 'ZZVERIFY-N-X', 'Intruso', 'pieza', 1, 1, 1, 9)`,
    [AJENO, orderId]
  ).then(() => null).catch((error) => error)
  if (!cross || cross.code !== "42501") {
    fail(`INSERT cross-tenant no rechazado (${cross?.code ?? "sin error"})`)
  } else {
    ok("INSERT cross-tenant rechazado (WITH CHECK)")
  }

  // 3. UPDATE/DELETE revocados: los renglones son inmutables.
  for (const [comando, sql] of [
    ["UPDATE", "UPDATE nota_digital_items SET nombre = 'cambio' WHERE id = $1"],
    ["DELETE", "DELETE FROM nota_digital_items WHERE id = $1"],
  ]) {
    const intento = await app.query(sql, [itemId])
      .then(() => null).catch((error) => error)
    if (!intento || intento.code !== "42501") {
      fail(`${comando} no está revocado a la app (${intento?.code ?? "sin error"})`)
    } else {
      ok(`${comando} revocado a la app (renglones inmutables)`)
    }
  }

  // 4. CHECK de origin: 'nota' permitido, inventado rechazado.
  const codeNota = `ZN${Math.floor(Math.random() * 9000 + 1000)}`
  codigosCreados.push(codeNota)
  const insertNota = await app.query(
    `INSERT INTO payment_orders
       (code, creator_user_id, amount_mxn, note, bank_name, bank_account, bank_holder, origin)
     VALUES ($1, $2::uuid, 10, NULL, 'Banco', '000000000000000000', 'Titular', 'nota')
     RETURNING id::text`,
    [codeNota, creatorId]
  ).then((result) => result).catch((error) => error)
  if (!insertNota?.rows?.[0]) {
    fail(`el CHECK de origin rechazó 'nota' (${insertNota?.code ?? "sin error"})`)
  } else {
    ok("el CHECK de origin acepta 'nota'")
    const originLeido = await app.query(
      "SELECT origin FROM payment_orders WHERE id = $1",
      [insertNota.rows[0].id]
    )
    if (originLeido.rows[0]?.origin !== "nota") {
      fail("la orden nota se leyó con otro origin")
    } else {
      ok("mapRow/SQL leen fielmente origin='nota'")
    }
  }
  const codeInvalido = `ZX${Math.floor(Math.random() * 9000 + 1000)}`
  const originInvalido = await app.query(
    `INSERT INTO payment_orders
       (code, creator_user_id, amount_mxn, note, bank_name, bank_account, bank_holder, origin)
     VALUES ($1, $2::uuid, 10, NULL, 'Banco', '000000000000000000', 'Titular', 'inventado')`,
    [codeInvalido, creatorId]
  ).then(() => null).catch((error) => error)
  if (!originInvalido || originInvalido.code !== "23514") {
    fail(`un origin inventado no fue rechazado (${originInvalido?.code ?? "sin error"})`)
  } else {
    ok("origin inventado rechazado por CHECK")
  }

  // 5. Atomicidad/orden de los renglones y FK.
  const desglose = await app.query(
    `SELECT sku, importe_linea::text AS importe FROM nota_digital_items
      WHERE payment_order_id = $1 ORDER BY posicion ASC`,
    [orderId]
  )
  if (
    desglose.rows.length !== 2 ||
    desglose.rows[0].sku !== "ZZVERIFY-N-1" ||
    desglose.rows[1].sku !== "ZZVERIFY-N-2"
  ) {
    fail("los renglones no se leen en orden por posicion")
  } else {
    ok("desglose leído en orden por posicion")
  }
  const huérfano = await app.query(
    `INSERT INTO nota_digital_items
       (payment_order_id, sku, nombre, um, precio_unitario, cantidad, importe_linea, posicion)
     VALUES ($1::uuid, 'ZZVERIFY-N-H', 'Huérfano', 'pieza', 1, 1, 1, 9)`,
    [crypto.randomUUID()]
  ).then(() => null).catch((error) => error)
  if (!huérfano || huérfano.code !== "23503") {
    fail(`un renglón sin orden no violó la FK (${huérfano?.code ?? "sin error"})`)
  } else {
    ok("renglón huérfano rechazado por FK")
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} fallos`)
    process.exitCode = 1
  } else {
    console.log(
      "Nota Digital verificada: RLS aísla por tenant, renglones inmutables, CHECK de origin con 'nota' y desglose atómico."
    )
  }
} finally {
  try {
    await owner.query("BEGIN")
    await owner.query("SELECT set_config('app.platform', 'on', true)")
    await owner.query(
      `DELETE FROM nota_digital_items WHERE sku LIKE 'ZZVERIFY-N-%'`
    )
    await owner.query(
      `DELETE FROM payment_orders WHERE code = ANY($1)`,
      [codigosCreados]
    )
    await owner.query("COMMIT")
  } catch (cleanupError) {
    console.error(
      "Limpieza incompleta (revisar fixtures ZZVERIFY-N-*):",
      cleanupError instanceof Error ? cleanupError.message : cleanupError
    )
    process.exitCode ??= 1
  }
  await owner.end().catch(() => undefined)
  await app.end().catch(() => undefined)
}
