#!/usr/bin/env node
/**
 * Ejecuta todos los scripts/test-*.mjs en secuencia y reporta un resumen.
 * Exit 0 solo si TODAS las suites pasan (la primera que lanza corta el lote
 * y su error sale en el resumen). Sin argumentos ejecuta el set completo;
 * con argumentos corre solo esos scripts (p. ej. `run-tests.mjs test-notas`).
 */
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const scriptsDir = path.join(root, "scripts")

const filter = process.argv.slice(2)
const all = readdirSync(scriptsDir)
  .filter((name) => /^test-.*\.mjs$/.test(name))
  .sort()
const chosen = filter.length > 0
  ? all.filter((name) => filter.some((f) => name.startsWith(f) || name === f))
  : all

if (chosen.length === 0) {
  console.error("No test scripts matched:", filter.join(" ") || "(all)")
  process.exit(1)
}

const results = []
let failed = false
for (const name of chosen) {
  const started = Date.now()
  const proc = spawnSync(process.execPath, [path.join(scriptsDir, name)], {
    stdio: "inherit",
    env: process.env,
  })
  const ok = proc.status === 0
  results.push({ name, ok, ms: Date.now() - started })
  if (!ok) failed = true
}

console.log("\n=== Resumen de pruebas ===")
for (const { name, ok, ms } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (${ms} ms)`)
}
process.exit(failed ? 1 : 0)
