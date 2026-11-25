#!/usr/bin/env node
/**
 * Verificación RLS del sistema de afiliados (plan speilink-afiliados §8).
 * Bajo demanda y en staging (NO va en la cadena: crea filas de prueba).
 *
 * Conecta con el DUEÑO (DATABASE_URL_ADMIN; las fixtures necesitan INSERT en
 * users/tenants/affiliates sin RLS y la limpieza necesita DELETE, que el rol
 * de la app no tiene) y deja DOS afiliados de prueba + un negocio referido
 * a A. Después, con el ROL DE LA APP (DATABASE_URL, speilink_app), afirma:
 *   1. Contexto de afiliado A: ve SU fila y NO la de B.
 *   2. A NO puede actualizar `affiliates` (ni la suya ni la ajena).
 *   3. A ve SOLO sus negocios referidos (el legado queda invisible).
 *   4. Sin contexto: 0 filas.
 * Limpieza final con el dueño.
 *
 *   node scripts/verify-afiliados.mjs
 * Exit 0 = aislamiento efectivo; exit 1 con el detalle de los fallos.
 */
import { randomBytes } from "node:crypto"
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

// Códigos de prueba únicos dentro del alfabeto sin 0/O/1/I.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function testCode(prefix) {
  let code = prefix
  while (code.length < 4) {
    code += ALPHABET[randomBytes(1)[0] % ALPHABET.length]
  }
  return code.slice(0, 4)
}

const CODE_A = testCode("T")
const CODE_B = testCode("V")
const affiliateA = crypto.randomUUID()
const affiliateB = crypto.randomUUID()
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
const tenantReferred = crypto.randomUUID()

const failures = []
function fail(what) {
  failures.push(what)
  console.error(`FAIL ${what}`)
}

const owner = new Client({ connectionString: adminUrl })
const app = new Client({ connectionString: appUrl })

try {
  await owner.connect()
  await app.connect()

  // ------------------------------------------------------------------
  // Fixtures con el dueño (bypass RLS): dos afiliados + negocio referido.
  // ------------------------------------------------------------------
  await owner.query("BEGIN")
  await owner.query("SELECT set_config('app.platform', 'on', true)")
  await owner.query(
    `INSERT INTO users (id, username, password_hash, role, tenant_id)
     VALUES ($1, $2, 'x', 'afiliado', NULL)`,
    [userA, `rls-af-a-${Date.now()}@verify.local`]
  )
  await owner.query(
    `INSERT INTO users (id, username, password_hash, role, tenant_id)
     VALUES ($1, $2, 'x', 'afiliado', NULL)`,
    [userB, `rls-af-b-${Date.now()}@verify.local`]
  )
  await owner.query(
    `INSERT INTO affiliates (id, user_id, code, status, full_name)
     VALUES ($1, $2, $3, 'active', 'Afiliado A (probe)')`,
    [affiliateA, userA, CODE_A]
  )
  await owner.query(
    `INSERT INTO affiliates (id, user_id, code, status, full_name)
     VALUES ($1, $2, $3, 'active', 'Afiliado B (probe)')`,
    [affiliateB, userB, CODE_B]
  )
  await owner.query(
    `INSERT INTO tenants (id, slug, name, kind, status, modules, referred_by_affiliate_id)
     VALUES ($1, $2, $3, 'business', 'active', ARRAY['core']::text[], $4)`,
    [tenantReferred, `rls-af-a-${Date.now()}`, "Negocio del afiliado A (probe)", affiliateA]
  )
  await owner.query("COMMIT")

  // ------------------------------------------------------------------
  // Aserciones con el ROL DE LA APP (RLS efectivo).
  // ------------------------------------------------------------------

  // 1+4. Sin contexto: 0 filas en ambas tablas.
  await app.query(
    "SELECT set_config('app.tenant_id','',false), set_config('app.platform','',false), set_config('app.affiliate_id','',false)"
  )
  const anonAffiliates = await app.query("SELECT count(*)::int AS n FROM affiliates")
  if (anonAffiliates.rows[0].n !== 0) {
    fail(`affiliates sin contexto se ven ${anonAffiliates.rows[0].n} filas (debe ser 0)`)
  }
  const anonTenants = await app.query("SELECT count(*)::int AS n FROM tenants")
  if (anonTenants.rows[0].n !== 0) {
    fail(`tenants sin contexto se ven ${anonTenants.rows[0].n} filas (debe ser 0)`)
  }

  // Contexto de afiliado A.
  await app.query("SELECT set_config('app.affiliate_id', $1, false)", [affiliateA])

  const ownRow = await app.query(
    "SELECT code FROM affiliates WHERE id = $1",
    [affiliateA]
  )
  if (!ownRow.rowCount) fail("affiliates: A no ve SU fila bajo su contexto")
  const otherRow = await app.query(
    "SELECT count(*)::int AS n FROM affiliates WHERE id = $1",
    [affiliateB]
  )
  if (otherRow.rows[0].n !== 0) {
    fail("affiliates: A VE la fila de B (FUGA)")
  }

  // 2. Sin UPDATE: sin política para afiliado, USING filtra → 0 filas.
  const selfUpdate = await app.query(
    "UPDATE affiliates SET full_name = 'hack' WHERE id = $1",
    [affiliateA]
  )
  if ((selfUpdate.rowCount ?? 0) !== 0) {
    fail(`affiliates: A actualizó su fila (rowCount=${selfUpdate.rowCount})`)
  }
  const crossUpdate = await app.query(
    "UPDATE affiliates SET click_count = 99999 WHERE id = $1",
    [affiliateB]
  )
  if ((crossUpdate.rowCount ?? 0) !== 0) {
    fail(`affiliates: A actualizó la fila de B (rowCount=${crossUpdate.rowCount})`)
  }

  // 3. Negocios: solo el referido a A; el legado queda invisible.
  const referred = await app.query(
    "SELECT count(*)::int AS n FROM tenants WHERE id = $1",
    [tenantReferred]
  )
  if (referred.rows[0].n !== 1) {
    fail("tenants: A no ve el negocio referido a él")
  }
  const legacyVisible = await app.query(
    "SELECT count(*)::int AS n FROM tenants WHERE id = $1",
    [LEGACY]
  )
  if (legacyVisible.rows[0].n !== 0) {
    fail("tenants: A VE el tenant legado (FUGA)")
  }
  const totalVisible = await app.query("SELECT count(*)::int AS n FROM tenants")
  if (totalVisible.rows[0].n !== 1) {
    fail(`tenants: A ve ${totalVisible.rows[0].n} tenants (debe ver 1: el suyo)`)
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} fallos de aislamiento`)
    process.exitCode = 1
  } else {
    console.log(
      "Afiliados verificados: RLS aísla la fila propia, bloquea escrituras y acota los negocios referidos."
    )
  }
} finally {
  // ------------------------------------------------------------------
  // Limpieza con el dueño (el rol de la app no tiene DELETE).
  // ------------------------------------------------------------------
  try {
    await owner.query("BEGIN")
    await owner.query("SELECT set_config('app.platform', 'on', true)")
    await owner.query("DELETE FROM tenants WHERE id = $1", [tenantReferred])
    await owner.query("DELETE FROM affiliates WHERE id IN ($1, $2)", [affiliateA, affiliateB])
    await owner.query("DELETE FROM users WHERE id IN ($1, $2)", [userA, userB])
    await owner.query("COMMIT")
  } catch (cleanupError) {
    console.error(
      "Limpieza incompleta (revisar filas rls-af-*):",
      cleanupError instanceof Error ? cleanupError.message : cleanupError
    )
    process.exitCode ??= 1
  }
  await owner.end().catch(() => undefined)
  await app.end().catch(() => undefined)
}
