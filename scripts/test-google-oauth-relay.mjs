/**
 * Pruebas puras del relevo de Google OAuth hacia tenants
 * (src/server/auth/google-relay.ts) y de su composición con la resolución de
 * hosts (src/server/tenant/hosts.ts). Corre con Node directo (Node 24 elimina
 * tipos al importar .ts):
 *
 *   node scripts/test-google-oauth-relay.mjs
 */
import assert from "node:assert/strict"

import {
  OAUTH_CALLBACK_PATH,
  OAUTH_STATE_MAX_LENGTH,
  buildRelayTargetUrl,
  encodeTenantOAuthState,
  isTenantOAuthState,
  parseOAuthState,
  selectGoogleFlow,
  tenantSignupMode,
} from "../src/server/auth/google-relay.ts"
import {
  RESERVED_TENANT_SLUGS,
  isValidTenantSlug,
  resolveTenantHost,
  tenantHostForSlug,
} from "../src/server/tenant/hosts.ts"

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

// Nonce real: 32 bytes aleatorios en base64url (43 caracteres).
const NONCE = "Qm9ndXNfbm9uY2VfMzJieXRlc19iYXNlNjR1cmxfMjAx"
// Con la regla canónica del catálogo (la única que usa el servidor).
const parse = (state) => parseOAuthState(state, isValidTenantSlug)
const relay = (origin, params) =>
  buildRelayTargetUrl(origin, params, isValidTenantSlug)
const tenantState = (slug) => encodeTenantOAuthState(slug, NONCE)

// --- State: codec ------------------------------------------------------------
check("el state de tenant se codifica y se decodifica", () => {
  const state = tenantState("donpolo")
  assert.equal(state, `t.donpolo.${NONCE}`)
  assert.deepEqual(parse(state), {
    kind: "tenant",
    slug: "donpolo",
    nonce: NONCE,
  })
})

check("el state del panel legado (aleatorio base64url) es opaco", () => {
  const legacy = "ZW1OSVVnTnVBYzI4dDZaM0FWMF90YTk3NHEtRk5DT3dQdw"
  assert.deepEqual(parse(legacy), { kind: "opaque" })
})

check("state malformado se rechaza (null), nunca cae a opaco", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "x".repeat(OAUTH_STATE_MAX_LENGTH + 1),
    "t.",
    `t..${NONCE}`,
    `t.donpolo.`,
    `t.donpolo.${NONCE}.extra`,
    `t.donpolo.${NONCE}.`,
    `t.don polo.${NONCE}`,
    `t.donpolo/corto`,
    `t.donpolo.${"c".repeat(129)}`,
    `t.donpolo.${NONCE}!`,
    `t.donpolo/${NONCE}`,
  ]) {
    assert.equal(parse(bad), null, String(bad))
  }
})

check("el slug del state cumple la regla del catálogo", () => {
  for (const slug of [
    "-arranque",
    "final-",
    "DonPolo",
    "don_polo",
    "don.polo",
    "a".repeat(31),
    ...RESERVED_TENANT_SLUGS,
  ]) {
    assert.equal(parse(tenantState(slug)), null, slug)
  }
})

check("el codec exige el validador del llamador (sin regla duplicada)", () => {
  // Con un validador permisivo el codec solo aporta forma y longitudes.
  const lax = () => true
  assert.equal(parseOAuthState(`t.-arranque.${NONCE}`, lax)?.slug, "-arranque")
  assert.equal(parseOAuthState(`t.${"a".repeat(64)}.${NONCE}`, lax)?.kind, "tenant")
  assert.equal(parseOAuthState(`t.${"a".repeat(65)}.${NONCE}`, lax), null)
  const none = () => false
  assert.equal(parseOAuthState(tenantState("donpolo"), none), null)
  assert.deepEqual(parseOAuthState(NONCE, none), { kind: "opaque" })
})

check("el state del legado no puede confundirse con uno de tenant", () => {
  // base64url no lleva punto: el nonce jamás aporta el separador.
  assert.ok(!NONCE.includes("."))
  assert.equal(parse(NONCE).kind, "opaque")
})

check("isTenantOAuthState exige el slug del host", () => {
  const is = (state, slug) => isTenantOAuthState(state, slug, isValidTenantSlug)
  assert.equal(is(tenantState("donpolo"), "donpolo"), true)
  assert.equal(is(tenantState("donpolo"), "esmeralda"), false)
  assert.equal(is(tenantState("donpolo"), ""), false)
  assert.equal(is(NONCE, "donpolo"), false)
  assert.equal(is(null, "donpolo"), false)
})

// --- Selección de flujo ------------------------------------------------------
check("un tenant de negocio usa el cliente SPEILink", () => {
  assert.equal(
    selectGoogleFlow({
      hostKind: "tenant",
      allowedLegacyHost: false,
      legacyConfigured: true,
      speilinkConfigured: true,
    }),
    "speilink"
  )
})

check("sin cliente SPEILink el tenant no tiene flujo (botón oculto)", () => {
  assert.equal(
    selectGoogleFlow({
      hostKind: "tenant",
      allowedLegacyHost: true,
      legacyConfigured: true,
      speilinkConfigured: false,
    }),
    null
  )
})

check("el legado conserva su cliente; sin credenciales no hay flujo", () => {
  const base = { allowedLegacyHost: false, speilinkConfigured: true }
  assert.equal(
    selectGoogleFlow({ ...base, hostKind: "legacy", legacyConfigured: true }),
    "legacy"
  )
  assert.equal(
    selectGoogleFlow({ ...base, hostKind: "legacy", legacyConfigured: false }),
    null
  )
})

check("un host habilitado a mano se trata como legado", () => {
  assert.equal(
    selectGoogleFlow({
      hostKind: "unknown",
      allowedLegacyHost: true,
      legacyConfigured: true,
      speilinkConfigured: true,
    }),
    "legacy"
  )
})

check("plataforma, apex y hosts desconocidos no tienen flujo", () => {
  for (const hostKind of ["platform", "short", "unknown"]) {
    assert.equal(
      selectGoogleFlow({
        hostKind,
        allowedLegacyHost: false,
        legacyConfigured: true,
        speilinkConfigured: true,
      }),
      null,
      hostKind
    )
  }
})

// --- Relevo: URL de destino --------------------------------------------------
check("el relevo reenvía code y state al callback del tenant", () => {
  const state = tenantState("donpolo")
  const url = new URL(
    relay("https://donpolo.spei.link", { code: "4/0Ab_5qSm-9xY", state })
  )
  assert.equal(url.origin, "https://donpolo.spei.link")
  assert.equal(url.pathname, OAUTH_CALLBACK_PATH)
  assert.equal(url.searchParams.get("code"), "4/0Ab_5qSm-9xY")
  assert.equal(url.searchParams.get("state"), state)
})

check("el error del proveedor viaja al tenant para traducirlo ahí", () => {
  const url = new URL(
    relay("https://donpolo.spei.link", {
      code: null,
      state: tenantState("donpolo"),
      error: "access_denied",
    })
  )
  assert.equal(url.searchParams.get("error"), "access_denied")
  assert.equal(url.searchParams.has("code"), false)
})

check("solo viajan code, state y error", () => {
  const url = new URL(
    relay("https://donpolo.spei.link", {
      code: "abc",
      state: tenantState("donpolo"),
      error: undefined,
      redirect_uri: "https://evil.example",
      scope: "openid",
    })
  )
  assert.deepEqual([...url.searchParams.keys()].sort(), ["code", "state"])
})

check("sin state de tenant no hay destino (nunca a ciegas)", () => {
  const origin = "https://donpolo.spei.link"
  assert.equal(relay(origin, { code: "abc", state: null }), null)
  assert.equal(relay(origin, { code: "abc", state: NONCE }), null)
  assert.equal(relay(origin, { code: "abc", state: "t.donpolo.mal" }), null)
  assert.equal(relay(origin, { code: "abc", state: tenantState("-x") }), null)
  assert.equal(relay(origin, { code: "abc", state: tenantState("api") }), null)
})

check("parámetros fuera de forma cortan el relevo", () => {
  const origin = "https://donpolo.spei.link"
  const state = tenantState("donpolo")
  for (const code of [
    "x".repeat(2049),
    "abc def",
    "abc\ndef",
    "abc?x=1#y",
    "abc<script>",
    "código",
  ]) {
    assert.equal(relay(origin, { code, state }), null, JSON.stringify(code))
  }
  assert.equal(
    relay(origin, { code: "abc", state, error: "e".repeat(129) }),
    null
  )
  assert.equal(relay(origin, { code: "abc", state, error: "access denied" }), null)
  assert.equal(relay("no-es-un-origen", { state }), null)
})

// --- Composición con hosts: el destino SIEMPRE es un host de tenant válido --
withEnv({ NODE_ENV: "production", HOST_SLUG_PREFIX: undefined }, () => {
  check("producción: el state con slug válido resuelve al MISMO tenant", () => {
    for (const slug of ["donpolo", "esmeralda", "a1b", "tienda-del-centro"]) {
      assert.ok(isValidTenantSlug(slug), slug)
      const parsed = parse(tenantState(slug))
      assert.equal(parsed?.kind, "tenant", slug)
      const host = tenantHostForSlug(parsed.slug)
      assert.equal(host, `${slug}.spei.link`)
      assert.deepEqual(resolveTenantHost(host), { kind: "tenant", slug })
      const url = new URL(
        relay(`https://${host}`, { code: "abc", state: tenantState(slug) })
      )
      assert.equal(url.host, host)
    }
  })

  check("producción: el apex, la plataforma y el legado no son tenants", () => {
    assert.deepEqual(resolveTenantHost("spei.link"), { kind: "short" })
    assert.deepEqual(resolveTenantHost("platform.spei.link"), { kind: "platform" })
    assert.equal(resolveTenantHost("distribuidor-tvbox.people-ia.com").kind, "legacy")
  })

  check("producción: un host ajeno no puede colarse como slug", () => {
    assert.equal(parse(`t.distribuidor-tvbox.people-ia.com.${NONCE}`), null)
    assert.equal(parse(`t.evil.example.com.${NONCE}`), null)
    assert.equal(parse(`t.${encodeURI("https://evil.example")}.${NONCE}`), null)
    assert.equal(parse(`t.spei.link.${NONCE}`), null)
  })
})

withEnv({ NODE_ENV: "production", HOST_SLUG_PREFIX: "dev-" }, () => {
  check("staging: el destino lleva el prefijo del entorno", () => {
    const host = tenantHostForSlug("donpolo")
    assert.equal(host, "dev-donpolo.spei.link")
    assert.deepEqual(resolveTenantHost(host), { kind: "tenant", slug: "donpolo" })
    // Un slug con el prefijo ya dentro no es slug válido: no hay doble prefijo.
    assert.equal(isValidTenantSlug("dev-donpolo"), false)
    assert.equal(parse(tenantState("dev-donpolo")), null)
    assert.equal(resolveTenantHost(tenantHostForSlug("dev-donpolo")).kind, "unknown")
  })
})

withEnv({ NODE_ENV: "production", TENANT_BASE_HOST: "otro-dominio.mx" }, () => {
  check("el destino sigue al host base configurado, nunca a la petición", () => {
    const url = new URL(
      relay(`https://${tenantHostForSlug("donpolo")}`, {
        code: "abc",
        state: tenantState("donpolo"),
      })
    )
    assert.equal(url.host, "donpolo.otro-dominio.mx")
  })
})

// --- Alta por Google en tenants ---------------------------------------------
check("el alta abierta es el default; `invite` la cierra", () => {
  assert.equal(tenantSignupMode(undefined), "open")
  assert.equal(tenantSignupMode(""), "open")
  assert.equal(tenantSignupMode("open"), "open")
  assert.equal(tenantSignupMode(" Invite "), "invite")
  assert.equal(tenantSignupMode("cualquier-otra-cosa"), "open")
})

console.log(`\n${passed} pruebas del relevo de Google OAuth pasaron.`)
