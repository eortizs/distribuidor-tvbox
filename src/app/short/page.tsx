import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  LockIcon,
  ShieldCheckIcon,
  WalletIcon,
  LandmarkIcon,
} from "lucide-react"

import { cn } from "cn"

import { shortLinkBaseUrl } from "@/server/site-url"

/*
 * Landing pública del dominio corto (spei.link/): el proxy reescribe la raíz
 * del dominio corto aquí (sin gate de sesión). Página estática de marketing —
 * sin acceso a datos ni APIs de request — que Next prerenderiza en el build.
 * Diseño visual orientado a ventas por especificación directa del dueño
 * (assets/landing_page.md): paleta azul marino #003366 + azul de marca
 * #1872cc, tarjetas blancas sobre fondo #F8FAFC y demostración de chat —
 * deliberadamente FUERA del sistema de componentes del panel.
 */

const TITLE = "SPEILink — Links de pago por WhatsApp con 0% de comisión"
const DESCRIPTION =
  "Crea links de pago para WhatsApp y recibe el 100% de tu dinero directo en tu cuenta. Cada pago se valida con su código de concepto."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(shortLinkBaseUrl()),
  alternates: { canonical: "/" },
  icons: { icon: "/spei-link-favicon.ico" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "SPEILink",
    locale: "es_MX",
    type: "website",
    images: [
      {
        url: "/spei-link-og.png",
        width: 480,
        height: 480,
        alt: "SPEILink - Links de pago por WhatsApp",
      },
    ],
  },
}

/*
 * Registro, inicio de sesión y soporte por WhatsApp deshabilitados: el
 * servicio aún no abre al público. Al lanzar, restaurar los `<a href>` con
 * `${publicSiteUrl()}/register`, `${publicSiteUrl()}/login` y el enlace
 * `https://wa.me/<WHATSAPP_AGENT_NUMBER>` del footer.
  */

/*
 * Enlace personal de Mercado Pago «Invita y Gana» del dueño. Los dos accesos
 * que apuntan a él (bloque de beneficios y FAQ) se habilitan con esta URL;
 * si se deja en null, se muestran deshabilitados como el resto de CTAs.
 */
const MP_REFERRAL_URL: string | null = "https://mpago.li/2KDRFs9"

const STEPS = [
  {
    step: "1",
    title: "Crea tu link",
    description:
      "Escribe el monto y genera tu link o QR desde la app; compártelo por WhatsApp o muéstralo en tu mostrador.",
  },
  {
    step: "2",
    title: "Tu cliente transfiere",
    description:
      "El cliente paga por SPEI directo a tu cuenta bancaria desde cualquier banco, sin descargar apps.",
  },
  {
    step: "3",
    title: <><BrandInline /> valida todo</>,
    description:
      "El cliente envía su comprobante por el chat y el sistema valida el código de concepto y el depósito real en tu cuenta.",
  },
]

const TRUST_POINTS = [
  {
    icon: LandmarkIcon,
    title: "Tu dinero, directo a tu cuenta",
    description: (
      <>
        Conectas tu cuenta de Mercado Pago con un clic —la única cuenta digital
        en México capaz de notificar y monitorear movimientos SPEI en tiempo real
        y sin costo de consulta—. <BrandInline /> solo lee la confirmación del
        depósito; tu dinero nunca pasa por intermediarios.
      </>
    ),
  },
  {
    icon: ShieldCheckIcon,
    title: "Validación real del saldo",
    description: (
      <>
        Una venta solo se confirma cuando el pago lleva el código de concepto
        y el depósito está realmente en tu cuenta. Si el dinero no cayó, no
        se confirma.
      </>
    ),
  },
  {
    icon: WalletIcon,
    title: "Compatible con toda la banca mexicana",
    description: (
      <>
        Tus clientes pagan desde BBVA, Banorte, Santander, Nu, Citibanamex o
        cualquier banco en México vía SPEI.
      </>
    ),
  },
]

const MP_BENEFITS = [
  {
    title: "Tus ventas generan ganancias diarias",
    description:
      "El dinero que recibes por tus ventas no se queda detenido; genera rendimientos todos los días de forma automática y siempre está disponible para que lo uses o lo transfieras cuando quieras.",
  },
  {
    title: "Sin costos de apertura ni mensualidades",
    description:
      "Abres tu cuenta en 3 minutos desde tu celular, sin saldos mínimos ni anualidades.",
  },
  {
    title: "Control total de tu dinero",
    description:
      "Recibe pagos desde cualquier banco de México vía SPEI y administra tus ingresos desde una sola app.",
  },
]

const CAROUSEL_SLIDES = [
  {
    src: "/carrusel/abarrotes.webp",
    alt: "Cajera cobrando en una tienda de abarrotes con un cartel que dice «Se aceptan transferencias con WhatsApp, usamos SPEILink»",
    title: "Abarrotes y tienditas",
    benefit: "Cobra directo en tu mostrador",
  },
  {
    src: "/carrusel/taller.webp",
    alt: "Mecánico sonriente mostrando en su celular un link de pago SPEILink con código QR por $2,300.00 MXN dentro de su taller",
    title: "Talleres y servicios",
    benefit: "Link con QR listo para compartir",
  },
  {
    src: "/carrusel/artesanias.webp",
    alt: "Artesana sonriente en su tienda de artesanías mexicanas con un cartel que dice «Se aceptan transferencias con WhatsApp»",
    title: "Artesanías y más",
    benefit: "Acepta transferencias sin comisión",
  },
]

const FAQ_ITEMS: { id: string; question: ReactNode; answer: ReactNode }[] = [
  {
    id: "que-necesito",
    question: "¿Qué necesito para empezar?",
    answer: (
      <>
        Solo registrarte gratis en <BrandInline /> y conectar tu cuenta de
        Mercado Pago (persona física o empresa). Si todavía no tienes una,{" "}
        <ReferralInlineText>
          puedes abrirla gratis en 3 minutos desde este enlace
        </ReferralInlineText>{" "}
        y empezar a recibir rendimientos diarios por el dinero de tus ventas.
      </>
    ),
  },
  {
    id: "porque-mercado-pago",
    question: "¿Por qué necesito usar una cuenta de Mercado Pago para recibir los pagos?",
    answer:
      "Porque actualmente es la única plataforma financiera en México que permite conectar y validar transferencias SPEI entrantes en tiempo real y sin costo por consulta. Otros bancos tradicionales cobran altas comisiones por acceso a sus sistemas de monitoreo, lo que nos obligaría a cobrarte por cada venta. Gracias a esto, tus clientes pueden pagarte desde cualquier banco (BBVA, Banorte, Nu, etc.) y tú recibes la confirmación al instante sin pagar comisiones.",
  },
  {
    id: "modelo-negocio",
    question: <>¿Cómo gana dinero <BrandInline /> si no cobra comisión?</>,
    answer:
      "Ofrecemos un plan gratuito para empezar y planes mensuales fijos para negocios con alto volumen.",
  },
  {
    id: "sin-concepto",
    question: "¿Qué pasa si mi cliente olvida poner el concepto de pago?",
    answer:
      "El pago no se puede identificar solo y queda pendiente de revisión. Por eso el chat siempre recuerda escribir el concepto de pago: con él, la confirmación es automática.",
  },
  {
    id: "mercado-pago-cliente",
    question: "¿Mis clientes necesitan tener Mercado Pago?",
    answer:
      "No. Pueden transferirte desde BBVA, Banorte, Santander, Nu, Citibanamex o cualquier banco en México vía SPEI.",
  },
]

/**
 * Marca verbal: «SPEIL» en bold e «ink» en light, de la sans del panel
 * (`font-sans` → Geist de Google Fonts, cargada por el root layout con
 * `next/font/google` y ya heredada por la landing). Sin espacio: la marca es
 * una sola palabra. El `ink` lleva margen negativo porque al cambiar de peso
 * en la junta (la «L» en bold y la «i» en light) las bearings de cada glifo
 * dejan un hueco que se lee como un espacio — sin este ajuste la marca
 * aparece como «SPEIL ink». El envoltorio `<span>` agrupa ambas piezas en
 * UN solo ítem: los padres flex con `gap-*` (micro-texto del hero, pregunta
 * FAQ) separarían «SPEIL» e «ink» con el gap del contenedor.
 */
function BrandInline() {
  return (
    <span>
      <span className="font-bold">SPEIL</span>
      <span className="-ml-[0.13em] font-light">ink</span>
    </span>
  )
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans tracking-tight", className)}>
      <BrandInline />
    </span>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="text-center text-xl font-extrabold tracking-tight text-[#003366]">
      {children}
    </h2>
  )
}

/** Botón CTA ancho con degradado azul marino → azul de marca (48 px). */
function GradientCta() {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#003366] to-[#1872cc] text-base font-semibold text-white opacity-60 shadow-lg shadow-[#003366]/25 focus-visible:outline-none"
    >
      Crear mi cuenta gratis
      <ArrowRightIcon className="size-4" aria-hidden="true" />
    </button>
  )
}

/**
 * Acceso al enlace de referido de Mercado Pago. Con URL es un enlace real; sin
 * ella, un botón deshabilitado con el mismo aspecto que el resto de CTAs.
 */
function MercadoPagoReferralCta() {
  const className =
    "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#003366] to-[#1872cc] text-base font-semibold text-white shadow-lg shadow-[#003366]/25 focus-visible:outline-none"
  return MP_REFERRAL_URL ? (
    <a
      href={MP_REFERRAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      Abre tu cuenta gratis de Mercado Pago
      <ArrowRightIcon className="size-4" aria-hidden="true" />
    </a>
  ) : (
    <button
      type="button"
      disabled
      className={cn(className, "cursor-not-allowed opacity-60")}
    >
      Abre tu cuenta gratis de Mercado Pago
      <ArrowRightIcon className="size-4" aria-hidden="true" />
    </button>
  )
}

/** El acceso al enlace de referido dentro de la respuesta del FAQ. */
function ReferralInlineText({ children }: { children: ReactNode }) {
  const className = "font-semibold text-[#1872cc] underline underline-offset-2"
  return MP_REFERRAL_URL ? (
    <a
      href={MP_REFERRAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  ) : (
    <span className={cn(className, "cursor-not-allowed opacity-70")}>
      {children}
    </span>
  )
}

/** Burbuja del chat: lado, tono y cola según remitente. */
function ChatBubble({
  side,
  variant = "client",
  time,
  children,
}: {
  side: "left" | "right"
  variant?: "client" | "assistant" | "verified"
  time: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex w-full",
        side === "right" ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed text-[#111b21] shadow-sm",
          side === "right" ? "rounded-br-md" : "rounded-bl-md",
          variant === "client" && "bg-[#dcf8c6]",
          variant === "assistant" && "bg-white",
          variant === "verified" &&
            "border border-emerald-500 bg-white"
        )}
      >
        {children}
        <span className="mt-0.5 block text-right text-[10px] leading-none text-black/45">
          {time} ✓✓
        </span>
      </div>
    </div>
  )
}

export default function ShortLandingPage() {
  return (
    <div className="min-h-svh bg-[#f8fafc] font-sans text-[#0f172a]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[480px] items-center justify-between px-4">
          <Link
            href="/"
            className="flex items-center gap-2"
            aria-label="SPEILink, inicio"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spei-link-logo.svg"
              alt=""
              aria-hidden="true"
              className="h-8 w-auto"
            />
            <Wordmark className="text-base" />
          </Link>
          <button
            type="button"
            disabled
            className="inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-[#003366] px-4 text-sm font-semibold text-[#003366] opacity-60 focus-visible:outline-none"
          >
            Iniciar sesión
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[480px] px-4">
        <div className="flex flex-col gap-10 py-8">
          {/* Hero: primera pantalla completa sin scroll en un celular. */}
          <section className="flex flex-col items-center gap-4 pt-4 text-center">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#d1fae5] px-3 text-xs font-semibold text-[#065f46]">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              0% de comisión al cobrar con WhatsApp
            </span>
            <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance text-[#003366]">
              Empieza a cobrar hoy y quédate con el 100% de tus ventas.
            </h1>
            <p className="text-pretty text-base text-slate-600">
              Links de pago por WhatsApp con depósito directo a tu cuenta. Sin
              intermediarios y con verificación bancaria automática.
            </p>
            <GradientCta />
            <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
              <LockIcon className="size-3.5" aria-hidden="true" />
              Sin intermediarios
              <span
                aria-hidden="true"
                className="size-1 shrink-0 rounded-full bg-slate-400"
              />
              <BrandInline /> nunca retiene tu dinero
            </p>
          </section>

          {/* Fórmula visual: la ecuación del producto en una tarjeta. */}
          <section aria-label="Cómo funciona el cobro">
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#1872cc]/30 bg-white p-6 text-center shadow-sm">
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="rounded-xl bg-[#e8f1fb] px-4 py-2 text-lg font-extrabold text-[#003366]">
                  CLABE
                </span>
                <span className="text-2xl font-extrabold text-[#1872cc]">
                  +
                </span>
                <span className="rounded-xl bg-[#e8f1fb] px-4 py-2 text-lg font-extrabold text-[#003366]">
                  WhatsApp
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                <strong className="font-semibold text-[#003366]">
                  CLABE + WhatsApp:
                </strong>{" "}
                recibe transferencias SPEI verificadas al instante y quédate
                con el 100% de tus ventas.
              </p>
            </div>
          </section>

          {/* Demostración: la experiencia real del comprador, burbuja a burbuja. */}
          <section aria-label="Ejemplo de una venta por WhatsApp">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
              <div className="flex items-center gap-3 bg-[#003366] px-4 py-3 text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/spei-link-logo.svg"
                  alt=""
                  aria-hidden="true"
                  className="h-9 w-9 rounded-full bg-white p-1"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">
                    <BrandInline /> Asistente
                  </span>
                  <span className="text-xs text-white/70">
                    Validación en tiempo real
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 bg-[#e5ddd5] p-3">
                <ChatBubble side="right" time="10:30">
                  Solicito un link de pago por{" "}
                  <span className="font-semibold tabular-nums">$500.00 MXN</span>
                </ChatBubble>
                <ChatBubble side="left" variant="assistant" time="10:30">
                  <p className="mb-1.5">Transfiere{" "}
                    <span className="font-semibold tabular-nums">$500.00 MXN</span>{" "}
                    directo a:
                  </p>
                  <p className="mb-1 flex items-center gap-1.5">
                    CLABE:
                    <span className="rounded border border-dashed border-[#1872cc] bg-[#f0f7ff] px-1.5 font-mono text-xs font-semibold text-[#003366]">
                      646180…
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    Concepto:
                    <span className="rounded border border-dashed border-[#1872cc] bg-[#f0f7ff] px-1.5 font-mono text-xs font-semibold text-[#003366]">
                      XQK9
                    </span>
                  </p>
                </ChatBubble>
                <ChatBubble side="right" time="10:34">
                  Listo, ya hice la transferencia
                </ChatBubble>
                <ChatBubble side="left" variant="assistant" time="10:34">
                  Envíame la foto del comprobante de tu transferencia para
                  confirmar el pago.
                </ChatBubble>
                <ChatBubble side="right" time="10:35">
                  Va, ya la envié 📎
                </ChatBubble>
                <ChatBubble side="left" variant="verified" time="10:36">
                  ✅{" "}
                  <span className="font-semibold">
                    ¡Pago verificado en cuenta!
                  </span>{" "}
                  Depósito de{" "}
                  <span className="font-semibold tabular-nums">$500.00 MXN</span>{" "}
                  confirmado con folio{" "}
                  <span className="font-mono font-semibold">XQK9</span>.
                </ChatBubble>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle>Cobra en 3 pasos simples</SectionTitle>
            <div className="flex flex-col gap-3">
              {STEPS.map((step) => (
                <div
                  key={step.step}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#e8f1fb] text-lg font-extrabold text-[#003366]"
                  >
                    {step.step}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-semibold text-[#0f172a]">
                      {step.title}
                    </p>
                    <p className="text-sm text-slate-600">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Carrusel: descanso visual con casos de uso reales (WebP 600px,
              lazy y snap horizontal — 1 tarjeta visible + borde de la siguiente). */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Pensado para negocios como el tuyo</SectionTitle>
            <div
              tabIndex={0}
              aria-label="Fotos de negocios que cobran con SPEILink"
              className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 focus-visible:outline-2 focus-visible:outline-[#1872cc] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {CAROUSEL_SLIDES.map((slide) => (
                <figure
                  key={slide.src}
                  className="w-[82%] shrink-0 snap-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    width={600}
                    height={600}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover"
                  />
                  <figcaption className="border-t border-slate-100 px-3 py-2.5">
                    <p className="text-sm font-semibold text-[#0f172a]">
                      {slide.title}
                    </p>
                    <p className="text-sm text-slate-600">{slide.benefit}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle>Seguridad bancaria, control total</SectionTitle>
            <div className="flex flex-col gap-3">
              {TRUST_POINTS.map((point) => (
                <div
                  key={point.title}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#1872cc]"
                  >
                    <point.icon className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="font-semibold text-[#0f172a]">
                      {point.title}
                    </p>
                    <p className="text-sm text-slate-600">
                      {point.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Puente: el dinero ya cae en Mercado Pago; aquí ves qué ganas al
              tenerlo ahí. Va justo antes del FAQ, sin CTA de alta general. */}
          <section className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-[#ecfdf5] p-5 shadow-sm">
            <h2 className="text-lg font-extrabold leading-snug tracking-tight text-balance text-[#003366]">
              ¿Aún no tienes cuenta de Mercado Pago? Abrirla tiene grandes
              ventajas para tu negocio
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Para que <BrandInline /> valide tus ventas al instante con 0% de
              comisión, solo necesitas conectar una cuenta gratuita de Mercado
              Pago. Además de ahorrarte las comisiones de las terminales
              tradicionales, tu negocio obtiene beneficios financieros
              inmediatos:
            </p>
            <ul className="flex flex-col gap-3">
              {MP_BENEFITS.map((benefit) => (
                <li key={benefit.title} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#d1fae5] text-[#065f46]"
                  >
                    <CheckIcon className="size-3.5" />
                  </span>
                  <p className="text-sm leading-relaxed text-slate-600">
                    <strong className="font-semibold text-[#0f172a]">
                      {benefit.title}:
                    </strong>{" "}
                    {benefit.description}
                  </p>
                </li>
              ))}
            </ul>
            <MercadoPagoReferralCta />
            <p className="text-center text-xs leading-relaxed text-slate-500">
              Al registrarte desde este enlace, activas tu cuenta lista para
              conectarse con <BrandInline />.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>Preguntas frecuentes</SectionTitle>
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
              {FAQ_ITEMS.map((item) => (
                <details key={item.id} className="group px-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3.5 text-sm font-semibold text-[#0f172a] transition-colors hover:text-[#003366] focus-visible:ring-2 focus-visible:ring-[#1872cc] focus-visible:ring-offset-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                    {/* Un solo ítem flex: sin el envoltorio, el `gap-2` parte
                        la pregunta en segmentos con espacios de más. */}
                    <span>{item.question}</span>
                    <ChevronDownIcon
                      className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="pb-3.5 text-sm leading-relaxed text-slate-600">
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </section>

          {/* Cierre: tarjeta de alto contraste con el golpe final. */}
          <section className="flex flex-col items-center gap-4 rounded-2xl bg-[#003366] p-6 text-center text-white shadow-xl shadow-[#003366]/30">
            <h2 className="text-xl font-extrabold tracking-tight text-balance">
              Deja de regalar el 4% en cada venta.
            </h2>
            <p className="text-sm leading-relaxed text-white/80">
              Empieza a cobrar hoy y quédate con el 100% de tus ventas con 0%
              de comisión al cobrar con WhatsApp.
            </p>
            <button
              type="button"
              disabled
              className="inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-white text-base font-bold text-[#003366] opacity-60 shadow-lg focus-visible:outline-none"
            >
              Crear mi cuenta gratis
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </button>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-3 px-4 py-8">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spei-link-logo.svg"
              alt=""
              aria-hidden="true"
              className="h-6 w-auto"
            />
            <Wordmark className="text-sm" />
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
            <button
              type="button"
              disabled
              className="cursor-not-allowed underline underline-offset-3 opacity-60 focus-visible:outline-none"
            >
              Soporte por WhatsApp
            </button>
            <span
              aria-hidden="true"
              className="size-1 shrink-0 rounded-full bg-slate-400"
            />
            <span>Aviso de Privacidad</span>
            <span
              aria-hidden="true"
              className="size-1 shrink-0 rounded-full bg-slate-400"
            />
            <span>Términos de Uso</span>
          </p>
          <p className="text-xs leading-relaxed text-slate-500">
            <BrandInline /> es una plataforma tecnológica de gestión y
            conciliación de cobros. No es una institución financiera ni capta
            recursos del público. SPEI® es una marca registrada del Banco de
            México. <BrandInline /> es un servicio independiente y no está
            afiliado ni patrocinado por Banxico ni por Mercado Pago.
          </p>
        </div>
      </footer>
    </div>
  )
}
