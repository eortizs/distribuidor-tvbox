#!/usr/bin/env node
/**
 * Crea la PRIMERA cuenta de plataforma (users.tenant_id NULL, role
 * 'plataforma'). Sin ella la consola platform.spei.link no tiene quién
 * entre. Reusa el formato de hashPassword de la app (scrypt N/r/p iguales).
 *
 *   node scripts/create-platform-admin.mjs <correo> [contraseña]
 *
 * Sin contraseña se genera una temporal y se imprime UNA VEZ.
 * Conexión: DATABASE_URL_ADMIN (dueño) con app.platform='on' — la cuenta de
 * plataforma tiene tenant_id NULL y el CHECK/RLS de users lo exige.
 */
import { randomBytes, scrypt } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Client } from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function loadEnv() {
  const envPath = path.join(root, ".env")
  try {
    const env = readFileSync(envPath, "utf8")
    for (const key of ["DATABASE_URL_ADMIN", "DATABASE_URL"]) {
      const line = env.split("\n").find((row) => row.startsWith(`${key}=`))
      if (line) process.env[key] ??= line.slice(`${key}=`.length).trim()
      if (process.env[key]) break
    }
  } catch {
    // Sin .env: se valida abajo.
  }
}

loadEnv()
const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL_ADMIN (o DATABASE_URL) is required")
  process.exit(1)
}

const email = (process.argv[2] || "").trim().toLowerCase()
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/create-platform-admin.mjs <correo> [contraseña]")
  process.exit(1)
}

const SCRYPT_N = 16384
const SCRYPT_r = 8
const SCRYPT_p = 1

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16)
    scrypt(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p }, (error, key) =>
      error ? reject(error) : resolve(`scrypt:${SCRYPT_N}:${SCRYPT_r}:${SCRYPT_p}:${salt.toString("base64")}:${key.toString("base64")}`)
    )
  })
}

const password = process.argv[3] || randomBytes(9).toString("base64url")
const hash = await hashPassword(password)

const client = new Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query("SELECT set_config('app.platform', 'on', true)")
  const existing = await client.query("SELECT id, role, tenant_id FROM users WHERE username = $1", [email])
  if (existing.rowCount) {
    const row = existing.rows[0]
    if (row.tenant_id !== null) {
      console.error(`El correo ${email} pertenece al tenant ${row.tenant_id}: no puede ser cuenta de plataforma.`)
      await client.query("ROLLBACK")
      process.exit(1)
    }
    await client.query("UPDATE users SET password_hash = $2, role = 'plataforma' WHERE id = $1", [row.id, hash])
    console.log(`Contraseña actualizada para la cuenta de plataforma existente ${email}.`)
  } else {
    const id = crypto.randomUUID()
    await client.query(
      `INSERT INTO users (id, username, password_hash, role, tenant_id)
       VALUES ($1, $2, $3, 'plataforma', NULL)`,
      [id, email, hash]
    )
    // SIN entidad Cuenta espejo: entities exige tenant_id NOT NULL y la
    // cuenta de plataforma no pertenece a ningún tenant (el umeJSON espeja
    // solo cuentas con alcance de negocio).
    console.log(`Cuenta de plataforma creada: ${email}`)
  }
  await client.query("COMMIT")
  if (!process.argv[3]) {
    console.log(`\nCONTRASEÑA TEMPORAL (mostrada UNA vez; cámbiala al entrar):\n${password}\n`)
  }
} catch (error) {
  await client.query("ROLLBACK")
  console.error("Fallo:", error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  await client.end()
}
