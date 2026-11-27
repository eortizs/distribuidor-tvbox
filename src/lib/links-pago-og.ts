/*
 * Vista previa (Open Graph) del link corto de pago: cuando alguien comparte
 * `spei.link/<CÓDIGO>` por WhatsApp, la app pide la metadata de la página
 * y arma la tarjeta con el título, la descripción y la imagen (og:image).
 * Sin esto la tarjeta cae en la página de wa.me y muestra el logo de
 * WhatsApp con el texto genérico de "Compartir en WhatsApp".
 *
 * Módulo PURO (sin imports de runtime): lo usa el handler del shortener
 * (`/short/[code]`) y lo prueban los scripts de Node sin build.
 */

/** Nombre del sitio en la tarjeta (og:site_name). */
export const PAYMENT_ORDER_OG_SITE_NAME = "SPEILink"

/** Texto alternativo de la imagen de la tarjeta. */
export const PAYMENT_ORDER_OG_IMAGE_ALT =
  "SPEILink - Links de pago por WhatsApp"

/**
 * Explicación BREVE de cómo realizar el pago: es el texto que el pagador
 * lee en la tarjeta de WhatsApp antes de abrir el link.
 */
export const PAYMENT_ORDER_OG_DESCRIPTION =
  "Abre el link, recibe por WhatsApp tu concepto de pago y la CLABE, transfiere por SPEI y envía el comprobante."

/** Título de la tarjeta: el link de pago y su importe. */
export function paymentOrderOgTitle(amountLabel: string): string {
  return `Link de pago ${PAYMENT_ORDER_OG_SITE_NAME} por ${amountLabel}`
}

/**
 * Tokens de user-agent de los rastreadores que arman la vista previa de un
 * link. WhatsApp usa "WhatsApp/2.x" tanto en el móvil (la propia app pide la
 * metadata al compartir) como en el servidor (WhatsApp Web); el resto son
 * las apps de mensajería y los proxies de imagen que piden la misma metadata.
 */
const PREVIEW_CRAWLER_TOKENS = [
  "whatsapp",
  "facebookexternalhit",
  "facebookcatalog",
  "facebot",
  "meta-externalagent",
  "meta-externalfetcher",
  "twitterbot",
  "slackbot",
  "slack-imgproxy",
  "discordbot",
  "telegrambot",
  "linkedinbot",
  "pinterest",
  "redditbot",
  "embedly",
  "quora link preview",
  "skypeuripreview",
  "flipboard",
  "outbrain",
  "vkshare",
  "nuzzel",
  "sempler",
  "googlebot",
  "googleimageproxy",
  "bingbot",
  "applebot",
  "yandexbot",
  "duckduckbot",
  "baiduspider",
  "seznambot",
  "crawler",
  "spider",
  "headlesschrome",
  "puppeteer",
  "playwright",
  "curl/",
  "wget/",
  "python-requests",
  "http-client",
  "okhttp",
  "apache-httpclient",
]

/**
 * True si la petición la hace un rastreador de vista previa (WhatsApp
 * entre ellos). Esos clientes reciben la página con la metadata de Open
 * Graph; la persona que abre el link NO (ella sigue con el redirect al
 * chat de WhatsApp, sin pasar por una página intermedia).
 */
export function isPreviewCrawler(
  userAgent: string | null | undefined
): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return PREVIEW_CRAWLER_TOKENS.some((token) => ua.includes(token))
}

/** Escapa los valores dinámicos que se inyectan en el HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export interface PaymentOrderOgInput {
  /** Importe ya formateado (p. ej. "$100.00 MXN"). */
  amountLabel: string
  /** URL canónica del link corto (spei.link/<código>). */
  canonicalUrl: string
  /** URL ABSOLUTA de la imagen de la tarjeta (el badge de SPEILink). */
  imageUrl: string
  /** Destino del botón: el chat de WhatsApp con la solicitud prellenada. */
  waUrl: string
}

/**
 * Título y descripción de la tarjeta del QR FIJO de cobro: ahí no hay
 * importe (es un pago libre: el pagador transfiere lo que quiera), así que
 * la tarjeta explica eso en lugar de anunciar un monto.
 */
export const PAYMENT_QR_OG_TITLE = "Link de pago SPEILink: tú defines el monto"
export const PAYMENT_QR_OG_DESCRIPTION =
  "Abre el link, recibe por WhatsApp la CLABE, transfiere por SPEI el monto que quieras y envía el comprobante."

interface OgPageInput {
  title: string
  description: string
  canonicalUrl: string
  imageUrl: string
  waUrl: string
  /** Encabezado visible de la tarjeta en pantalla (sin etiquetas). */
  heading: string
  /** Pasos del pago que se listan en pantalla. */
  steps: string[]
}

/**
 * Página de la vista previa: las etiquetas Open Graph (que es lo que lee el
 * rastreador) y, debajo, la misma explicación en pantalla con el botón para
 * continuar por WhatsApp (por si el link se abre a mano). Sin scripts: un
 * rastreador que ejecutará JavaScript seguiría la redirección y volvería a
 * la tarjeta genérica de wa.me.
 */
function buildOgPage(input: OgPageInput): string {
  const title = escapeHtml(input.title)
  const description = escapeHtml(input.description)
  const canonicalUrl = escapeHtml(input.canonicalUrl)
  const imageUrl = escapeHtml(input.imageUrl)
  const waUrl = escapeHtml(input.waUrl)
  const steps = input.steps
    .map((step) => `        <li>${escapeHtml(step)}</li>`)
    .join("\n")

  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${PAYMENT_ORDER_OG_SITE_NAME}" />
    <meta property="og:locale" content="es_MX" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="480" />
    <meta property="og:image:height" content="480" />
    <meta property="og:image:alt" content="${escapeHtml(PAYMENT_ORDER_OG_IMAGE_ALT)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0b1f3a; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 10px 30px rgba(0, 51, 102, .10); padding: 28px 24px; max-width: 22rem; text-align: center; margin: 16px; }
      .marca { width: 140px; height: 140px; }
      h1 { font-size: 1.15rem; line-height: 1.35; margin: 16px 0 20px; }
      ol { text-align: left; margin: 0 0 24px; padding-left: 20px; color: #334155; font-size: .95rem; line-height: 1.6; }
      ol li { margin-bottom: 8px; }
      .cta { display: block; background: linear-gradient(180deg, #1872cc, #003366); color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 10px; padding: 13px 16px; }
      .pie { color: #64748b; font-size: .75rem; margin: 16px 0 0; }
    </style>
  </head>
  <body>
    <main class="card">
      <img class="marca" src="${imageUrl}" width="140" height="140" alt="${escapeHtml(PAYMENT_ORDER_OG_IMAGE_ALT)}" />
      <h1>${escapeHtml(input.heading)}</h1>
      <ol>
${steps}
      </ol>
      <a class="cta" href="${waUrl}">Continuar por WhatsApp</a>
      <p class="pie">spei.link - Links de pago por WhatsApp</p>
    </main>
  </body>
</html>`
}

/** Vista previa del link de pago con importe (spei.link/<CÓDIGO>). */
export function buildPaymentOrderOgHtml(input: PaymentOrderOgInput): string {
  return buildOgPage({
    title: paymentOrderOgTitle(input.amountLabel),
    description: PAYMENT_ORDER_OG_DESCRIPTION,
    canonicalUrl: input.canonicalUrl,
    imageUrl: input.imageUrl,
    waUrl: input.waUrl,
    heading: `Link de pago por ${input.amountLabel}`,
    steps: [
      "Abre el chat de WhatsApp y solicita tu pago.",
      "Recibe tu concepto de pago y la CLABE.",
      "Transfiere por SPEI y envía el comprobante.",
    ],
  })
}

export interface PaymentQrOgInput {
  /** URL canónica del link corto (spei.link/cobro/<código>). */
  canonicalUrl: string
  /** URL ABSOLUTA de la imagen de la tarjeta (el badge de SPEILink). */
  imageUrl: string
  /** Destino del botón: el chat de WhatsApp con la solicitud prellenada. */
  waUrl: string
}

/** Vista previa del QR fijo de cobro (spei.link/cobro/<CÓDIGO>): sin importe. */
export function buildPaymentQrOgHtml(input: PaymentQrOgInput): string {
  return buildOgPage({
    title: PAYMENT_QR_OG_TITLE,
    description: PAYMENT_QR_OG_DESCRIPTION,
    canonicalUrl: input.canonicalUrl,
    imageUrl: input.imageUrl,
    waUrl: input.waUrl,
    heading: "Paga por WhatsApp: tú defines el monto",
    steps: [
      "Abre el chat de WhatsApp y solicita tu pago.",
      "Recibe la CLABE y transfiere por SPEI el monto que quieras.",
      "Envía el comprobante por WhatsApp y recibe la confirmación.",
    ],
  })
}
