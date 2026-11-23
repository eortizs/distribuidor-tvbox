#!/usr/bin/env node
/**
 * Interruptor de emergencia del aislamiento (Fase 0.8 / §10 del plan).
 *
 *   node scripts/rls-toggle.mjs enable|disable
 *
 * `disable` desactiva RLS (y elimina las políticas) en TODAS las tablas del
 * modelo de tenancy: el rol de la app vuelve a ver todo — útil SOLO como
 * rollback inmediato ante un fallo grave de contexto. `enable` restaura.
 * Requiere credenciales del DUEÑO de las tablas (DATABASE_URL_ADMIN).
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
    for (const key of ["DATABASE_URL_ADMIN", "DATABASE_URL"]) {
      const line = env.split("\n").find((row) => row.startsWith(`${key}=`))
      if (line) process.env[key] ??= line.slice(`${key}=`.length).trim()
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

const mode = process.argv[2]
if (mode !== "enable" && mode !== "disable") {
  console.error("Usage: node scripts/rls-toggle.mjs enable|disable")
  process.exit(1)
}

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
  "connector_connections","user_mp_tokens","tenants",
]

const client = new Client({ connectionString: url })
await client.connect()
try {
  for (const table of TABLES) {
    if (mode === "disable") {
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`)
      await client.query(`DROP POLICY IF EXISTS tenants_read ON "${table}"`)
      await client.query(`DROP POLICY IF EXISTS tenants_write ON "${table}"`)
      await client.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`)
    } else {
      await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      if (table === "tenants") {
        await client.query(`DROP POLICY IF EXISTS tenants_read ON tenants`)
        await client.query(`CREATE POLICY tenants_read ON tenants
          USING (
            id::text = NULLIF(current_setting('app.tenant_id', true), '')
            OR COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on'
          )`)
        await client.query(`DROP POLICY IF EXISTS tenants_write ON tenants`)
        await client.query(`CREATE POLICY tenants_write ON tenants
          USING (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on')
          WITH CHECK (COALESCE(NULLIF(current_setting('app.platform', true), ''), 'off') = 'on')`)
        continue
      }
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`)
      await client.query(`CREATE POLICY tenant_isolation ON "${table}"
         USING (app_tenant_ok(tenant_id))
         WITH CHECK (app_tenant_ok(tenant_id))`)
    }
    console.log(`${mode}: ${table}`)
  }
  console.log(`RLS ${mode === "enable" ? "restaurado" : "desactivado"} en ${TABLES.length} tablas.`)
} finally {
  await client.end()
}
