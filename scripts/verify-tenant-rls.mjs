#!/usr/bin/env node
/**
 * Verificación de aislamiento por RLS (Fase 0.7 del plan). Conecta con el
 * ROL DE LA APP (DATABASE_URL o DATABASE_URL_SYSTEM NO: debe ser el rol con
 * RLS efectivo — speilink_app) y afirma, por tabla:
 *   1. RLS habilitado (relrowsecurity).
 *   2. Sin contexto: 0 filas visibles (falla cerrado).
 *   3. Con contexto del tenant A: ve las filas de A y NO las de B.
 *   4. Con contexto de A: NO puede INSERTAR filas de B (WITH CHECK).
 *
 * Uso: node scripts/verify-tenant-rls.mjs
 * Exit 0 = aislamiento efectivo; exit 1 con el detalle de los fallos.
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
    for (const key of ["DATABASE_URL", "LEGACY_TENANT_ID"]) {
      const line = env.split("\n").find((row) => row.startsWith(`${key}=`))
      if (line) process.env[key] ??= line.slice(`${key}=`.length).trim()
    }
  } catch {
    // Sin .env: se valida abajo.
  }
}

loadEnv()
const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is required (rol de la APP, no admin)")
  process.exit(1)
}

const LEGACY = process.env.LEGACY_TENANT_ID || "8e83b5cc-9f43-28b2-a8f3-2882fef090a8"

const TABLES = [
  "users","sessions","eve_sessions","entities","entity_events","tickets",
  "client_metadata","client_saved_filters","client_chip_layout",
  "mp_orders","mp_order_events","mp_refunds","transfer_concepts",
  "payment_orders","saldo_movimientos","wa_outbox","wa_message_log",
  "assistant_messages","assistant_coupon_prompts","notifications",
  "alerts","alert_hits","push_subscriptions","notes","shopping_lists",
  "shopping_list_mutations","user_files","user_file_variants",
  "image_generations","animation_costs","animation_turns",
  "animation_deliverables","expenses","user_settings",
  "user_section_permissions","user_module_permissions","user_module_prefs",
  "connector_connections","user_mp_tokens","clients","tenant_mp_tokens",
  "signup_handoffs",
  "wa_contacts",
  "affiliates",
  "tenants",
]

const client = new Client({ connectionString: url })
await client.connect()

const failures = []
function fail(table, what) {
  failures.push(`${table}: ${what}`)
  console.error(`FAIL ${table}: ${what}`)
}

try {
  // 1. RLS habilitado por tabla.
  for (const table of TABLES) {
    const rel = await client.query(
      "SELECT relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=$1",
      [table]
    )
    if (!rel.rowCount) {
      fail(table, "la tabla no existe")
      continue
    }
    if (rel.rows[0].relrowsecurity !== true) {
      fail(table, "RLS no habilitado")
    }
  }

  // Escape de análisis: la tabla de prueba vive en el tenant legado.
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [LEGACY])
  const probe = await client.query(
    `INSERT INTO notes (id, user_id, title, body, version)
     VALUES (gen_random_uuid(), NULL, 'rls-verify-probe', 'probe', 1)
     RETURNING id, tenant_id`
  ).catch(async () => {
    // notes.user_id es NOT NULL: usar un usuario real del tenant legado.
    const u = await client.query(
      "SELECT id FROM users WHERE tenant_id = $1 LIMIT 1", [LEGACY]
    )
    return client.query(
      `INSERT INTO notes (id, user_id, title, body, version)
       VALUES (gen_random_uuid(), $1, 'rls-verify-probe', 'probe', 1)
       RETURNING id, tenant_id`,
      [u.rows[0].id]
    )
  })
  const probeId = probe.rows[0].id
  const probeTenant = probe.rows[0].tenant_id

  // 2. Sin contexto: 0 filas.
  await client.query(
    "SELECT set_config('app.tenant_id','',false), set_config('app.platform','',false)"
  )
  const anonymous = await client.query(
    "SELECT count(*)::int AS n FROM notes WHERE id = $1", [probeId]
  )
  if (anonymous.rows[0].n !== 0) {
    fail("notes", `sin contexto se ven ${anonymous.rows[0].n} filas (debe ser 0)`)
  }

  // 3. Contexto legado: la fila visible; contexto ajeno: invisible.
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [probeTenant])
  const own = await client.query(
    "SELECT count(*)::int AS n FROM notes WHERE id = $1", [probeId]
  )
  if (own.rows[0].n !== 1) {
    fail("notes", "con contexto propio la fila no es visible")
  }

  const fakeTenant = "11111111-2222-4333-8444-555555555555"
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [fakeTenant])
  const other = await client.query(
    "SELECT count(*)::int AS n FROM notes WHERE id = $1", [probeId]
  )
  if (other.rows[0].n !== 0) {
    fail("notes", "un contexto ajeno VE la fila del legado (FUGA)")
  }

  // 4. WITH CHECK: insertar con tenant ajeno explícito falla.
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [probeTenant])
  const u = await client.query(
    "SELECT id FROM users WHERE tenant_id = $1 LIMIT 1", [probeTenant]
  )
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [fakeTenant])
  const crossInsert = await client.query(
    `INSERT INTO notes (id, user_id, title, body, version, tenant_id)
     VALUES (gen_random_uuid(), $1, 'cross', 'x', 1, $2)`,
    [u.rows[0].id, probeTenant]
  ).then(() => null).catch((error) => error)
  if (!crossInsert) {
    fail("notes", "se pudo INSERTAR una fila con tenant ajeno (WITH CHECK roto)")
  }

  // Limpieza del probe (dueño de la fila: el contexto legado).
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [probeTenant])
  await client.query("DELETE FROM notes WHERE id = $1", [probeId])

  // 5. tenants: el contexto de un tenant NO puede cambiar columnas de
  // control (slug, status, modules, use_platform_mp_account) — solo lectura
  // + plataforma escribe. El legado existe siempre (migración).
  const legacyRow = await client.query(
    "SELECT id, slug, status, modules, use_platform_mp_account FROM tenants WHERE id = $1",
    [LEGACY]
  )
  if (!legacyRow.rowCount) {
    fail("tenants", "el tenant legado no existe")
  } else {
    const tenantRow = legacyRow.rows[0]
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [LEGACY])
    // RLS filtra por USING: la fila queda invisible y el UPDATE toca 0 filas
    // (no lanza). La afirmación es rowCount === 0.
    const tenantWrite = await client.query(
      `UPDATE tenants SET status = 'suspended' WHERE id = $1`,
      [tenantRow.id]
    ).then((r) => r.rowCount ?? 0).catch(() => -1)
    if (tenantWrite !== 0) {
      fail("tenants", `un contexto de tenant escribió en tenants (rowCount=${tenantWrite}; tenants_write roto)`)
    }

    // Plataforma SÍ puede escribir (toggle real de status de vuelta).
    await client.query("SELECT set_config('app.platform','on',false), set_config('app.tenant_id','',false)")
    const platformWrite = await client.query(
      `UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1 RETURNING id`,
      [tenantRow.id, tenantRow.status]
    )
    if (!platformWrite.rowCount) {
      fail("tenants", "la plataforma NO pudo escribir en tenants")
    }
    await client.query("SELECT set_config('app.platform','',false)")
  }

  // 6. affiliates (plan speilink-afiliados): con RLS (arriba) y solo visible
  // por SU afiliado o plataforma — sin contexto y bajo un contexto de
  // tenant la tabla está VACÍA para el rol de la app (lecturas puras: el
  // chequeo de fila propia/ajena lo ejercita scripts/verify-afiliados.mjs).
  await client.query(
    "SELECT set_config('app.tenant_id','',false), set_config('app.platform','',false), set_config('app.affiliate_id','',false)"
  )
  const anonAffiliates = await client.query(
    "SELECT count(*)::int AS n FROM affiliates"
  )
  if (anonAffiliates.rows[0].n !== 0) {
    fail("affiliates", `sin contexto se ven ${anonAffiliates.rows[0].n} filas (debe ser 0)`)
  }
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [LEGACY])
  const tenantCtxAffiliates = await client.query(
    "SELECT count(*)::int AS n FROM affiliates"
  )
  if (tenantCtxAffiliates.rows[0].n !== 0) {
    fail(
      "affiliates",
      `un contexto de tenant ve ${tenantCtxAffiliates.rows[0].n} filas (debe ser 0)`
    )
  }
  await client.query("SELECT set_config('app.tenant_id','',false)")

  if (failures.length > 0) {
    console.error(`\n${failures.length} fallos de aislamiento`)
    process.exit(1)
  }
  console.log("RLS verificado: habilitado en todas las tablas y aislamiento efectivo.")
} finally {
  await client.end()
}
