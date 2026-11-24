#!/usr/bin/env node
/**
 * Clasifica páginas y acciones de servidor por módulo de tenant (§4.5) y
 * añade el argumento obligatorio a requireUser / requireRole. Uso:
 *   node scripts/classify-page-guards.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Página/ruta → módulo (regla §4.5). El resto de /modulos → general. */
const PAGE_MODULES = [
  ["/clientes", "core"],
  ["/onboarding", "core"],
  ["/modulos/abonar-saldo", "flujo"],
  ["/modulos/actualizacion-flujotv", "flujo"],
  ["/modulos/paquetes-flujotv", "flujo"],
  ["/modulos/distribuidores", "flujo"],
  ["/modulos/calculadora", "core"],
  ["/modulos/links-de-pago", "core"],
  ["/modulos/reporte-spei", "core"],
  ["/modulos/whatsapp", "core"],
  ["/users", "core"],
  ["/profile", "core"],
  ["/(dashboard)/layout", "core"],
  ["/soporte/lab/flujotv", "flujo"],
  ["/modulos", "general"],
  ["/modulos/alertas", "general"],
  ["/modulos/alta-de-tickets", "general"],
  ["/modulos/conectores", "general"],
  ["/modulos/imagenes", "general"],
  ["/modulos/lista-de-compras", "general"],
  ["/modulos/notas", "general"],
  ["/soporte/asistente", "general"],
  ["/soporte/configuracion", "general"],
]

/** Archivo de acción → módulo (dominio al que sirven). */
const ACTION_MODULES = [
  ["src/app/actions/configuracion.ts", "general"],
  ["src/app/actions/flujotv-app.ts", "flujo"],
  ["src/app/actions/licencias.ts", "flujo"],
  ["src/app/actions/links-pago.ts", "core"],
  ["src/app/actions/modulos.ts", "general"],
  ["src/app/actions/onboarding.ts", "core"],
  ["src/app/actions/onboarding-signup.ts", "core"],
  ["src/app/actions/profile.ts", "core"],
]

function classifyPage(file) {
  for (const [prefix, mod] of PAGE_MODULES) {
    if (file.includes(prefix)) return mod
  }
  return null
}

function classifyAction(file) {
  for (const [f, mod] of ACTION_MODULES) {
    if (file.endsWith(f)) return mod
  }
  return null
}

const dry = process.argv.includes("--dry")
const out = execSync(
  `grep -rl "requireUser(\\|requireRole(" src/app --include='*.tsx' --include='*.ts' | grep -v api/ | grep -v node_modules`,
  { cwd: root, encoding: "utf8" }
)
const files = out.trim().split("\n").filter(Boolean)

for (const file of files) {
  const mod = file.endsWith(".tsx") ? classifyPage(file) : classifyAction(file)
  if (!mod) {
    console.log(`SIN CLASIFICAR ${file}`)
    continue
  }
  let s = readFileSync(path.join(root, file), "utf8")
  const updated = s
    .replace(/requireUser\(\)/g, `requireUser("${mod}")`)
    .replace(/requireRole\("admin"\)/g, `requireRole("admin", "${mod}")`)
    .replace(/requireRole\("distribuidor"\)/g, `requireRole("distribuidor", "${mod}")`)
  if (updated !== s) {
    console.log(`${mod.padEnd(8)} ${file}`)
    if (!dry) writeFileSync(path.join(root, file), updated)
  } else {
    console.log(`YA-OK    ${file}`)
  }
}
