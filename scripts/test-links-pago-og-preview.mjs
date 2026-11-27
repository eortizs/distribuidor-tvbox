/**
 * Pruebas de la logica pura de la vista previa (Open Graph) del link corto
 * de pago (src/lib/links-pago-og.ts): deteccion del rastreador que arma la
 * tarjeta de WhatsApp (`isPreviewCrawler`) y la pagina con las etiquetas
 * Open Graph (`buildPaymentOrderOgHtml`, titulo con el importe, descripcion
 * con como pagar, imagen absoluta y escape HTML). Corre con Node directo
 * (Node 24 elimina tipos al importar .ts):
 *
 *   node scripts/test-links-pago-og-preview.mjs
 */
import assert from "node:assert/strict"

import {
  PAYMENT_ORDER_OG_DESCRIPTION,
  PAYMENT_ORDER_OG_IMAGE_ALT,
  PAYMENT_ORDER_OG_SITE_NAME,
  PAYMENT_QR_OG_DESCRIPTION,
  PAYMENT_QR_OG_TITLE,
  buildPaymentOrderOgHtml,
  buildPaymentQrOgHtml,
  isPreviewCrawler,
  paymentOrderOgTitle,
} from "../src/lib/links-pago-og.ts"

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

/* --------------------------- isPreviewCrawler ---------------------------- */

check("la app de WhatsApp (movil) es rastreador de vista previa", () => {
  assert.equal(isPreviewCrawler("WhatsApp/2.23.20.0"), true)
  assert.equal(isPreviewCrawler("WhatsApp/2.19.81 A"), true)
})

check("WhatsApp Web (servidor) es rastreador de vista previa", () => {
  assert.equal(
    isPreviewCrawler(
      "WhatsApp/2.23.20.0 N"
    ),
    true
  )
})

check("el rastreador de Meta (facebookexternalhit) es rastreador", () => {
  assert.equal(
    isPreviewCrawler(
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
    ),
    true
  )
})

check("Telegram y Slack tambien arman tarjeta", () => {
  assert.equal(isPreviewCrawler("TelegramBot (like TwitterBot)"), true)
  assert.equal(
    isPreviewCrawler("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"),
    true
  )
})

check("el navegador de la persona NO es rastreador (iPhone Safari)", () => {
  assert.equal(
    isPreviewCrawler(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    ),
    false
  )
})

check("el navegador de la persona NO es rastreador (Android Chrome)", () => {
  assert.equal(
    isPreviewCrawler(
      "Mozilla/5.0 (Linux; Android 14; SM-A125M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36"
    ),
    false
  )
})

check("user-agent ausente o vacio no es rastreador", () => {
  assert.equal(isPreviewCrawler(null), false)
  assert.equal(isPreviewCrawler(undefined), false)
  assert.equal(isPreviewCrawler(""), false)
})

check("la deteccion no distingue mayusculas/minusculas", () => {
  assert.equal(isPreviewCrawler("WHATSAPP/2.23.20.0"), true)
})

/* ------------------------------ textos de la tarjeta ---------------------- */

check("el titulo lleva la marca y el importe", () => {
  assert.equal(
    paymentOrderOgTitle("$100.00 MXN"),
    "Link de pago SPEILink por $100.00 MXN"
  )
})

check(
  "la descripcion explica como pagar (concepto, CLABE, SPEI y comprobante)",
  () => {
    assert.match(PAYMENT_ORDER_OG_DESCRIPTION, /concepto de pago/)
    assert.match(PAYMENT_ORDER_OG_DESCRIPTION, /CLABE/)
    assert.match(PAYMENT_ORDER_OG_DESCRIPTION, /SPEI/)
    assert.match(PAYMENT_ORDER_OG_DESCRIPTION, /comprobante/)
  }
)

/* --------------------------- buildPaymentOrderOgHtml ---------------------- */

const INPUT = {
  amountLabel: "$100.00 MXN",
  canonicalUrl: "https://spei.link/Z93K",
  imageUrl: "https://spei.link/spei-link-og.png",
  waUrl: "https://wa.me/525540049353?text=Solicito%20un%20link%20de%20pago",
}

check("la pagina declara og:title con el importe", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(
    html,
    /<meta property="og:title" content="Link de pago SPEILink por \$100\.00 MXN" \/>/
  )
})

check("la pagina declara og:image ABSOLUTA con el badge", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/spei\.link\/spei-link-og\.png" \/>/
  )
  assert.match(html, /<meta property="og:image:width" content="480" \/>/)
  assert.match(html, /<meta property="og:image:height" content="480" \/>/)
})

check("la pagina declara og:url y canonical con el link corto", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(
    html,
    /<meta property="og:url" content="https:\/\/spei\.link\/Z93K" \/>/
  )
  assert.match(html, /<link rel="canonical" href="https:\/\/spei\.link\/Z93K" \/>/)
})

check("la pagina declara la descripcion con como pagar", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(html, /<meta property="og:description" content="[^"]+" \/>/)
  assert.ok(html.includes(PAYMENT_ORDER_OG_DESCRIPTION))
})

check("la pagina declara la tarjeta de Twitter (summary con imagen)", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(html, /<meta name="twitter:card" content="summary" \/>/)
  assert.match(html, /<meta name="twitter:image" content="https:\/\/spei\.link\/spei-link-og\.png" \/>/)
})

check("el cuerpo repite el importe y el boton abre el chat de WhatsApp", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(html, /<h1>Link de pago por \$100\.00 MXN<\/h1>/)
  assert.match(html, /<a class="cta" href="https:\/\/wa\.me\/525540049353\?text=[^"]*">/)
})

check("el cuerpo explico los pasos del pago en pantalla", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.match(html, /<li>Abre el chat de WhatsApp y solicita tu pago\.<\/li>/)
  assert.match(html, /<li>Recibe tu concepto de pago y la CLABE\.<\/li>/)
  assert.match(html, /<li>Transfiere por SPEI y envía el comprobante\.<\/li>/)
})

check("la pagina NO lleva scripts ni meta refresh (el rastreador no se va)", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.ok(!html.includes("<script"))
  assert.ok(!html.includes("http-equiv=\"refresh\""))
})

check("los valores dinamicos se escapan en el HTML", () => {
  const html = buildPaymentOrderOgHtml({
    ...INPUT,
    waUrl: "https://wa.me/525540049353?text=a&text=b",
    canonicalUrl: 'https://spei.link/Z93K" onload="x',
  })
  assert.ok(html.includes("href=\"https://wa.me/525540049353?text=a&amp;text=b\""))
  assert.ok(html.includes('content="https://spei.link/Z93K&quot; onload=&quot;x"'))
  assert.ok(!html.includes('onload="x"'))
})

check("la imagen declara su texto alternativo de marca", () => {
  const html = buildPaymentOrderOgHtml(INPUT)
  assert.ok(html.includes(PAYMENT_ORDER_OG_IMAGE_ALT))
  assert.equal(PAYMENT_ORDER_OG_SITE_NAME, "SPEILink")
})

/* ----------------------- QR fijo de cobro (sin importe) ------------------ */

const QR_INPUT = {
  canonicalUrl: "https://spei.link/cobro/K7QM2P",
  imageUrl: "https://spei.link/spei-link-og.png",
  waUrl: "https://wa.me/525540049353?text=Solicito%20realizar%20un%20pago.",
}

check("QR fijo: el titulo dice que el monto lo define el pagador", () => {
  const html = buildPaymentQrOgHtml(QR_INPUT)
  assert.equal(PAYMENT_QR_OG_TITLE, "Link de pago SPEILink: tú defines el monto")
  assert.ok(
    html.includes(
      `<meta property="og:title" content="Link de pago SPEILink: tú defines el monto" />`
    )
  )
  assert.ok(!html.includes("$100.00"))
})

check("QR fijo: la descripcion explica el pago libre (monto que quieras, CLABE, comprobante)", () => {
  assert.match(PAYMENT_QR_OG_DESCRIPTION, /el monto que quieras/)
  assert.match(PAYMENT_QR_OG_DESCRIPTION, /CLABE/)
  assert.match(PAYMENT_QR_OG_DESCRIPTION, /comprobante/)
  // Pago libre: no se pide declarar monto ni concepto por chat.
  assert.doesNotMatch(PAYMENT_QR_OG_DESCRIPTION, /escribe por WhatsApp/)
  const html = buildPaymentQrOgHtml(QR_INPUT)
  assert.ok(html.includes(PAYMENT_QR_OG_DESCRIPTION))
})

check("QR fijo: canonical y og:url apuntan a spei.link/cobro/<codigo>", () => {
  const html = buildPaymentQrOgHtml(QR_INPUT)
  assert.ok(
    html.includes('<meta property="og:url" content="https://spei.link/cobro/K7QM2P" />')
  )
  assert.ok(
    html.includes('<link rel="canonical" href="https://spei.link/cobro/K7QM2P" />')
  )
})

check("QR fijo: los pasos en pantalla son recibir la CLABE, transferir lo que quiera y enviar el comprobante", () => {
  const html = buildPaymentQrOgHtml(QR_INPUT)
  assert.match(html, /<h1>Paga por WhatsApp: tú defines el monto<\/h1>/)
  assert.match(html, /<li>Recibe la CLABE y transfiere por SPEI el monto que quieras\.<\/li>/)
  assert.match(html, /<li>Envía el comprobante por WhatsApp y recibe la confirmación\.<\/li>/)
})

check("QR fijo: sin scripts, con badge y boton al chat de WhatsApp", () => {
  const html = buildPaymentQrOgHtml(QR_INPUT)
  assert.ok(!html.includes("<script"))
  assert.ok(
    html.includes(
      '<meta property="og:image" content="https://spei.link/spei-link-og.png" />'
    )
  )
  assert.match(html, /<a class="cta" href="https:\/\/wa\.me\/525540049353\?text=[^"]*">/)
})

console.log(`\n${passed} pruebas OK`)
