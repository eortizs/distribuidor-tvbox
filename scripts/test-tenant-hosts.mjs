/**
 * Pruebas puras de hosts de tenant (src/server/tenant/hosts.ts) y de la
 * clasificación de módulos (src/lib/tenant-modules.ts). Corre con Node
 * directo (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-tenant-hosts.mjs
 */
import assert from "node:assert/strict"

import {
  isValidTenantSlug,
  resolveTenantHost,
  tenantHostForSlug,
  RESERVED_TENANT_SLUGS,
} from "../src/server/tenant/hosts.ts"
import {
  modulesForKind,
  routeModuleForPath,
  tenantAllows,
} from "../src/lib/tenant-modules.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
}

function withEnv(env, fn) {
  const old = {}
  for (const [k, v] of Object.entries(env)) {
    old[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// --- Hosts: producción ------------------------------------------------------
withEnv({ NODE_ENV: "production", TENANT_HOST_ROUTING: undefined, HOST_SLUG_PREFIX: undefined }, () => {
  check("el dominio corto resuelve `short`", () => {
    assert.deepEqual(resolveTenantHost("spei.link"), { kind: "short" })
    assert.deepEqual(resolveTenantHost("spei.link:443"), { kind: "short" })
  })

  check("el host de plataforma resuelve `platform`", () => {
    assert.deepEqual(resolveTenantHost("platform.spei.link"), { kind: "platform" })
  })

  check("el host legado resuelve `legacy`", () => {
    assert.deepEqual(resolveTenantHost("distribuidor-tvbox.people-ia.com"), { kind: "legacy" })
  })

  check("subdominios de tenant con slug válido", () => {
    assert.deepEqual(resolveTenantHost("donpolo.spei.link"), { kind: "tenant", slug: "donpolo" })
    assert.deepEqual(resolveTenantHost("esmeralda.spei.link"), { kind: "tenant", slug: "esmeralda" })
  })

  check("slug inexistente o reservado es fail-closed (unknown)", () => {
    assert.deepEqual(resolveTenantHost("noexiste.spei.link"), { kind: "tenant", slug: "noexiste" })
    assert.deepEqual(resolveTenantHost("api.spei.link"), { kind: "unknown" })
    for (const reserved of RESERVED_TENANT_SLUGS) {
      if (reserved === "platform") {
        // El host de plataforma gana por encima del parseo de slug.
        assert.deepEqual(
          resolveTenantHost(`${reserved}.spei.link`),
          { kind: "platform" },
          reserved
        )
        continue
      }
      assert.deepEqual(
        resolveTenantHost(`${reserved}.spei.link`),
        { kind: "unknown" },
        reserved
      )
    }
  })

  check("hosts desconocidos en producción son unknown (fail-closed)", () => {
    assert.deepEqual(resolveTenantHost("otro.people-ia.com"), { kind: "unknown" })
    assert.deepEqual(resolveTenantHost("malformado"), { kind: "unknown" })
    assert.deepEqual(resolveTenantHost(""), { kind: "unknown" })
  })

  check("slugs válidos según la regla del catálogo", () => {
    assert.ok(isValidTenantSlug("donpolo"))
    assert.ok(isValidTenantSlug("a1b"))
    assert.ok(!isValidTenantSlug("-arranque"))
    assert.ok(!isValidTenantSlug("final-"))
    assert.ok(!isValidTenantSlug("A"))
    assert.ok(!isValidTenantSlug("a".repeat(31)))
    assert.ok(!isValidTenantSlug("api"))
  })

  check("host de tenant con prefijo vacío", () => {
    assert.equal(tenantHostForSlug("donpolo"), "donpolo.spei.link")
  })
})

// --- Hosts: staging con prefijo dev- ---------------------------------------
withEnv({ NODE_ENV: "production", HOST_SLUG_PREFIX: "dev-" }, () => {
  check("staging: dev-<slug> es tenant; <slug> pelado es unknown", () => {
    assert.deepEqual(resolveTenantHost("dev-donpolo.spei.link"), { kind: "tenant", slug: "donpolo" })
    assert.deepEqual(resolveTenantHost("donpolo.spei.link"), { kind: "unknown" })
  })

  check("staging: dev-tvbox es el legado de staging", () => {
    assert.deepEqual(resolveTenantHost("dev-tvbox.spei.link"), { kind: "legacy" })
  })

  check("staging: host de tenant lleva prefijo", () => {
    assert.equal(tenantHostForSlug("donpolo"), "dev-donpolo.spei.link")
  })
})

// --- Interruptor de emergencia ---------------------------------------------
withEnv({ TENANT_HOST_ROUTING: "off" }, () => {
  check("TENANT_HOST_ROUTING=off trata todo como legado", () => {
    assert.deepEqual(resolveTenantHost("donpolo.spei.link"), { kind: "legacy" })
    assert.deepEqual(resolveTenantHost("spei.link"), { kind: "legacy" })
  })
})

// --- Módulos ----------------------------------------------------------------
check("el legado permite los tres módulos", () => {
  assert.deepEqual(modulesForKind("legacy"), ["core", "general", "flujo"])
})

check("un negocio solo núcleo", () => {
  assert.deepEqual(modulesForKind("business"), ["core"])
})

check("tenantAllows decide por lista de módulos", () => {
  assert.equal(tenantAllows(["core"], "core"), true)
  assert.equal(tenantAllows(["core"], "flujo"), false)
  assert.equal(tenantAllows(["core", "general"], "general"), true)
  assert.equal(tenantAllows(null, "flujo"), true)
})

check("clasificación de rutas por prefijo", () => {
  assert.equal(routeModuleForPath("/api/mercadopago/spei"), "core")
  assert.equal(routeModuleForPath("/api/whatsapp/state"), "core")
  assert.equal(routeModuleForPath("/users"), "core")
  assert.equal(routeModuleForPath("/perfil"), "core")
  assert.equal(routeModuleForPath("/api/flujotv/clients"), "flujo")
  assert.equal(routeModuleForPath("/clientes"), "flujo")
  assert.equal(routeModuleForPath("/api/transferencias/orders"), "flujo")
  assert.equal(routeModuleForPath("/api/notas"), "general")
  assert.equal(routeModuleForPath("/modulos/alertas"), "general")
  assert.equal(routeModuleForPath("/api/tickets"), "general")
})

console.log(`\n${passed} pruebas de hosts de tenant pasaron.`)
