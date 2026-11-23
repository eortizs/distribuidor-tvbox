#!/usr/bin/env node
/**
 * Clasifica las rutas API por módulo de tenant (§4.5 del plan) y añade el
 * argumento obligatorio a requireApiUser / requireAdminApiUser en cada
 * route.ts. Uso: node scripts/classify-api-guards.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { execSync } from "node:child_process"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const FLUJO = [
  "flujotv",
  "cupones",
  "paquetes",
  "saldo",
  "reembolsos",
  "clientes/chips",
  "clientes/filters",
  "clientes/metadata",
]
const FLUJO_PREFIX = ["mercadopago/orders"]
const GENERAL = [
  "alertas",
  "animaciones",
  "asistente",
  "conectores",
  "entities",
  "finanzas",
  "images",
  "lista-compras",
  "notas",
  "notificaciones",
  "tickets",
  "v1",
]
const GENERAL_PREFIX = ["push"]

function classify(routePath) {
  const p = routePath
  if (p === "mercadopago/webhook") return "webhook" // sin guard
  if (FLUJO.some((f) => p === f || p.startsWith(f + "/"))) return "flujo"
  if (FLUJO_PREFIX.some((f) => p.startsWith(f))) return "flujo"
  if (GENERAL.some((f) => p === f || p.startsWith(f + "/"))) return "general"
  if (GENERAL_PREFIX.some((f) => p.startsWith(f))) return "general"
  // auth, files, realtime, whatsapp, mercadopago/spei → núcleo
  return "core"
}

const routes = execSync(
  `find src/app/api -name route.ts`, { cwd: root, encoding: "utf8" }
).trim().split("\n")

const dry = process.argv.includes("--dry")
const counts = { flujo: 0, general: 0, core: 0, webhook: 0, unguarded: 0 }

for (const file of routes) {
  const routePath = file
    .replace("src/app/api/", "")
    .replace(/\/route\.ts$/, "")
  const mod = classify(routePath)
  counts[mod] += 1
  let s = readFileSync(path.join(root, file), "utf8")
  const hasGuard =
    /requireApiUser\(/.test(s) || /requireAdminApiUser\(/.test(s)
  if (!hasGuard) {
    counts.unguarded += 0 // rutas sin guard: se reportan aparte abajo
    console.log(`SIN GUARD  ${routePath}`)
    continue
  }
  const updated = s
    .replace(/requireApiUser\(\)/g, `requireApiUser("${mod}")`)
    .replace(/requireAdminApiUser\(\)/g, `requireAdminApiUser("${mod}")`)
  if (updated !== s) {
    console.log(`${mod.padEnd(8)} ${routePath}`)
    if (!dry) writeFileSync(path.join(root, file), updated)
  } else {
    console.log(`YA-OK     ${routePath}`)
  }
}

console.log(counts)
