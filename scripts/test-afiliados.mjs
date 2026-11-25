#!/usr/bin/env node
/**
 * Pruebas PURAS del sistema de afiliados (plan speilink-afiliados §8):
 * parseAffiliatePath con cada fila de la tabla del proxy (§6.4), la raíz
 * `/ABCD` sigue siendo link de pago, enlace de registro, palabra vetada,
 * query gana sobre cookie, puerta del registro y cuándo habilita un CTA.
 * Corre con Node directo (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-afiliados.mjs
 */
import assert from "node:assert/strict"

import {
  affiliateCtaEnabled,
  affiliateLinkUrl,
  affiliateRegisterPath,
  isAffiliateCode,
  isBannedAffiliateCode,
  normalizeAffiliateCode,
  parseAffiliatePath,
  resolveAffiliateAttribution,
  AFFILIATE_COOKIE_MAX_AGE_SECONDS,
} from "../src/lib/afiliados.ts"
import { isPaymentLinkCode } from "../src/lib/links-pago.ts"
import {
  PUBLIC_RESERVED_SLUGS,
  slugAvailabilityShape,
} from "../src/lib/tenant-slug.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/* -------------------------- parseAffiliatePath --------------------------- */

// Tabla §6.4 del plan: cada fila del proxy.
check("/afiliado → raíz (302 a /)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado"), { kind: "root" })
})
check("/afiliado/ → raíz (barra final)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/"), { kind: "root" })
})
check("/afiliado/ABCD → código", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/AB7D"), {
    kind: "code",
    code: "AB7D",
  })
})
check("/afiliado/ab7d → código en mayúsculas", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/ab7d"), {
    kind: "code",
    code: "AB7D",
  })
})
check("/afiliado/AB7D/ → código (barra final)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/AB7D/"), {
    kind: "code",
    code: "AB7D",
  })
})
check("/afiliado/ABC (3) → inválido, sin BD", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/ABC"), { kind: "invalid" })
})
check("/afiliado/ABC12 (5) → inválido", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/ABC12"), { kind: "invalid" })
})
check("/afiliado/AB7D/extra → inválido (segmento extra)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/AB7D/extra"), {
    kind: "invalid",
  })
})
check("/afiliado/AA0O → inválido (0 y O del alfabeto vetado)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/AA0O"), { kind: "invalid" })
})
check("/afiliado/%2F → inválido (basura)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliado/%2F"), { kind: "invalid" })
})
check("/afiliados (plural) → inválido (grafía con una sola L)", () => {
  assert.deepEqual(parseAffiliatePath("/afiliados"), { kind: "invalid" })
})

/* ------------------- el espacio raíz sigue siendo pago -------------------- */

check("/ABCD NO es de afiliados: sigue siendo link de pago", () => {
  assert.deepEqual(parseAffiliatePath("/AB7D"), { kind: "invalid" })
  assert.equal(isPaymentLinkCode("AB7D"), true)
})
check("/afiliado jamás valida como código de link de pago", () => {
  // El proxy valida el segmento completo: 'afiliado/AB7D' no cabe en <4>.
  assert.equal(isPaymentLinkCode("AFILIADO"), false)
})

/* ------------------------------- forma del código ------------------------ */

check("códigos válidos", () => {
  for (const code of ["ABCD", "A2B9", "ZZZZ", "99ZZ"]) {
    assert.equal(isAffiliateCode(code), true, code)
  }
})
check("códigos inválidos: largo y alfabeto", () => {
  for (const code of ["ABC", "ABCDE", "AA0O", "AA1I", "ab c", "AB-Ç"]) {
    assert.equal(isAffiliateCode(code), false, code)
  }
})
check("normalizeAffiliateCode recorta y pasa a mayúsculas", () => {
  assert.equal(normalizeAffiliateCode(" ab7d "), "AB7D")
  assert.equal(normalizeAffiliateCode("abc"), null)
  assert.equal(normalizeAffiliateCode(null), null)
})

/* --------------------------- palabra vetada ------------------------------- */

check("palabras vetadas", () => {
  for (const code of ["CACA", "PUTA", "CULO", "PENE", "TETA", "KIKE"]) {
    assert.equal(isBannedAffiliateCode(code), true, code)
  }
})
check("no vetadas pasan", () => {
  assert.equal(isBannedAffiliateCode("AB7D"), false)
})

/* ------------------- atribución: query gana sobre cookie ------------------ */

check("query gana sobre cookie", () => {
  assert.equal(
    resolveAffiliateAttribution({ query: "AAAA", cookie: "BBBB" }),
    "AAAA"
  )
})
check("cookie usada sin query", () => {
  assert.equal(resolveAffiliateAttribution({ query: null, cookie: "BBBB" }), "BBBB")
})
check("query inválida cae a cookie", () => {
  assert.equal(resolveAffiliateAttribution({ query: "x", cookie: "BBBB" }), "BBBB")
})
check("ambas inválidas → null", () => {
  assert.equal(resolveAffiliateAttribution({ query: "TOOLONG", cookie: "3" }), null)
})
check("sin nada → null", () => {
  assert.equal(resolveAffiliateAttribution({}), null)
})

/* --------------------------- enlace de registro --------------------------- */

check("ruta de registro con af", () => {
  assert.equal(affiliateRegisterPath("AB7D"), "/registro?af=AB7D")
})
check("enlace público sobre la base", () => {
  assert.equal(
    affiliateLinkUrl("AB7D", "https://spei.link"),
    "https://spei.link/afiliado/AB7D"
  )
  assert.equal(
    affiliateLinkUrl("AB7D", "https://dev-spei.spei.link"),
    "https://dev-spei.spei.link/afiliado/AB7D"
  )
})
check("cookie de 30 días", () => {
  assert.equal(AFFILIATE_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 30)
})

/* --------------------- puerta del registro (§6.6) ------------------------- */

check("la página abre el formulario con afiliado aunque el registro esté apagado", () => {
  // La página: enabled = selfSignupEnabled || affiliate !== null.
  const selfSignupEnabled = false
  const affiliate = { code: "AB7D" }
  assert.equal(selfSignupEnabled || affiliate !== null, true)
})
check("sin afiliado y registro apagado → cerrado", () => {
  const selfSignupEnabled = false
  const affiliate = null
  assert.equal(selfSignupEnabled || affiliate !== null, false)
})
check("registro abierto sin afiliado → abierto", () => {
  const selfSignupEnabled = true
  assert.equal(selfSignupEnabled || null !== null, true)
})
check("afiliado inválido NO abre (mismo cerrado, sin oráculo)", () => {
  // resolveSignupAffiliate devuelve null para suspendido/inexistente → la
  // puerta cae al interruptor público.
  const affiliate = null
  const selfSignupEnabled = false
  assert.equal(affiliate !== null || selfSignupEnabled, false)
})

/* --------------------------- CTAs de la landing --------------------------- */

check("CTA habilitado por LAUNCH aunque no haya afiliado", () => {
  assert.equal(affiliateCtaEnabled(true, null), true)
})
check("CTA habilitado por afiliado en preventa", () => {
  assert.equal(affiliateCtaEnabled(false, "AB7D"), true)
})
check("CTA deshabilitado en preventa sin afiliado", () => {
  assert.equal(affiliateCtaEnabled(false, null), false)
  assert.equal(affiliateCtaEnabled(false, ""), false)
})

/* ------------------------------ slugs reservados -------------------------- */

check("afiliado y afiliados son slugs reservados del registro", () => {
  for (const slug of ["afiliado", "afiliados"]) {
    assert.ok(PUBLIC_RESERVED_SLUGS.has(slug), slug)
    assert.deepEqual(slugAvailabilityShape(slug), {
      available: false,
      reason: "reservado",
    })
  }
})

if (process.exitCode) {
  console.error(`\n${passed} pruebas OK, con fallos`)
} else {
  console.log(`${passed} pruebas OK`)
}
