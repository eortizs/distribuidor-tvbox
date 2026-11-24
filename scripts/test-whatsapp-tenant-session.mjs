#!/usr/bin/env node
/**
 * Pruebas puras de la sesión WhatsApp por tenant (Fase 2A §4.5): carpeta de
 * credenciales por tenant (el LEGADO NO SE MUOVE) y guarda de reset.
 * Corre con Node directo:
 *
 *   node scripts/test-whatsapp-tenant-session.mjs
 */
import assert from "node:assert/strict"

import {
  LEGACY_AUTH_FOLDER,
  authFolderForTenant,
  createWhatsAppSession,
  maskNumber,
} from "../src/server/whatsapp/session.ts"

const LEGACY_TENANT_ID = "8e83b5cc-9f43-28b2-a8f3-2882fef090a8"

let passed = 0
function check(name, run) {
  run()
  passed += 1
}

// Carpeta por tenant: el legado conserva su carpeta histórica.
check("el legado usa storage/whatsapp-session", () => {
  assert.equal(
    authFolderForTenant(LEGACY_TENANT_ID, "legacy"),
    "storage/whatsapp-session"
  )
  assert.equal(LEGACY_AUTH_FOLDER, "storage/whatsapp-session")
})
check("un negocio usa su id (inmutable, seguro en rutas)", () => {
  const id = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  assert.equal(
    authFolderForTenant(id, "business"),
    `storage/whatsapp-sessions/${id}`
  )
})
check("la carpeta de negocio nunca contiene ..", () => {
  const id = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  const folder = authFolderForTenant(id, "business")
  assert.ok(!folder.includes(".."))
  assert.ok(folder.split("/").every((seg) => seg.length > 0))
})

// Sesión nueva: estado inicial y cachés PROPIOS (no globales compartidos).
check("sesión nueva disabled con cachés independientes", () => {
  const a = createWhatsAppSession({ tenantId: "a", kind: "business" })
  const b = createWhatsAppSession({ tenantId: "b", kind: "business" })
  assert.equal(a.status, "disabled")
  assert.equal(a.socket, null)
  assert.notEqual(a.jidCache, b.jidCache)
  assert.notEqual(a.inboundBuckets, b.inboundBuckets)
  assert.notEqual(a.messageStore, b.messageStore)
  assert.notEqual(a.msgRetryCounterCache, b.msgRetryCounterCache)
  assert.equal(a.kind, "business")
})
check("sesión legado con su carpeta histórica", () => {
  const s = createWhatsAppSession({ tenantId: LEGACY_TENANT_ID, kind: "legacy" })
  assert.equal(s.authFolder, "storage/whatsapp-session")
  assert.equal(s.kind, "legacy")
})

// Máscara del número para la UI (jamás el número completo).
check("máscara del número", () => {
  assert.equal(maskNumber("525540049353"), "525•••353")
  assert.equal(maskNumber("12345"), "•••")
})

if (process.exitCode) {
  console.error(`\n${passed} pruebas OK, con fallos`)
  process.exit(1)
}
console.log(`${passed} pruebas OK`)
