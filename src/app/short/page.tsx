import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowLeftRightIcon,
  CheckIcon,
  CircleCheckIcon,
  HeadphonesIcon,
  LandmarkIcon,
  LockIcon,
  MessageCircleIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react"

import { BrandInline, Wordmark } from "@/components/short/brand"
import { CustomerDataValue } from "@/components/short/CustomerDataValue"
import { DirectTransferFlow } from "@/components/short/DirectTransferFlow"
import { FloatingCommissionBadge } from "@/components/short/FloatingCommissionBadge"
import { FaqAccordion, type FaqAccordionItem } from "@/components/short/faq-accordion"
import {
  FooterSupportButton,
  NavbarLoginButton,
  PrimarySignupCta,
} from "@/components/short/landing-cta"
import { WhatsAppPhoneDemo } from "@/components/short/whatsapp-phone-demo"
import { shortLinkBaseUrl } from "@/server/site-url"

const TITLE = "SPEILink — Links de pago por WhatsApp con confirmación automática"
const DESCRIPTION =
  "Crea links de pago para WhatsApp y recibe el 100% de tu dinero directo en tu cuenta. Cada pago se valida con su concepto de pago y depósito bancario."

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

const COMPATIBLE_BANKS = ["BBVA", "Banorte", "Santander", "Nu", "Citibanamex"] as const

const STEPS = [
  {
    step: "01",
    icon: QrCodeIcon,
    title: "Crea tu link",
    description:
      "Escribe el monto y el concepto de pago, genera tu link o QR desde la app y compártelo por WhatsApp o muéstralo en tu mostrador.",
  },
  {
    step: "02",
    icon: ArrowLeftRightIcon,
    title: "Tu cliente transfiere",
    description:
      "El cliente paga por transferencia directo a tu cuenta desde cualquier banco en México, sin descargar apps.",
  },
  {
    step: "03",
    icon: CircleCheckIcon,
    title: "Confirmación automática sin mover un dedo",
    description:
      "En cuanto el dinero entra a tu cuenta, nuestro sistema detecta el depósito solo y envía el recibo confirmado por WhatsApp, sin que tengas que revisar tu banco ni validar capturas de pantalla.",
  },
]

const CAROUSEL_SLIDES = [
  {
    src: "/carrusel/abarrotes.webp",
    alt: "Cajera cobrando en una tienda de abarrotes con un cartel que dice «Se aceptan transferencias con WhatsApp, usamos SPEILink»",
    badge: "Abarrotes y tienditas",
    title: "Cobra directo en tu mostrador",
    benefit:
      "Tus clientes transfieren desde su celular y el pago se confirma al instante, sin terminal.",
  },
  {
    src: "/carrusel/taller.webp",
    alt: "Mecánico sonriente mostrando en su celular un link de pago SPEILink con código QR por $2,300.00 MXN dentro de su taller",
    badge: "Talleres y servicios",
    title: "Link con QR listo para compartir",
    benefit:
      "Envía el cobro por WhatsApp o muestra el QR al entregar el trabajo y recibe el 100% en tu cuenta.",
  },
  {
    src: "/carrusel/artesanias.webp",
    alt: "Artesana sonriente en su tienda de artesanías mexicanas con un cartel que dice «Se aceptan transferencias con WhatsApp»",
    badge: "Artesanías y más",
    title: "Acepta transferencias sin complicaciones",
    benefit:
      "Vende en ferias, locales o por mensaje conservando íntegro el margen de cada pieza.",
  },
]

const TRUST_POINTS = [
  {
    icon: LandmarkIcon,
    title: "Tu dinero, directo a tu cuenta",
    description: (
      <>
        Conectas tu cuenta de Mercado Pago con un clic —la única cuenta digital en
        México capaz de notificar y monitorear movimientos de transferencia en tiempo
        real y sin costo de consulta—. <BrandInline /> solo lee la confirmación del
        depósito; tu dinero nunca pasa por intermediarios.
      </>
    ),
    showBanks: false,
  },
  {
    icon: ShieldCheckIcon,
    title: "Validación real del saldo y concepto",
    description: (
      <>
        Una venta solo se confirma cuando el pago incluye el concepto de pago y el
        depósito está realmente en tu cuenta. Si el dinero no cayó, no se confirma.
      </>
    ),
    showBanks: false,
  },
  {
    icon: WalletIcon,
    title: "Compatible con toda la banca mexicana",
    description:
      "Tus clientes pagan desde BBVA, Banorte, Santander, Nu, Citibanamex o cualquier banco en México por transferencia.",
    showBanks: true,
  },
  {
    icon: HeadphonesIcon,
    title: "Soporte y control 24/7",
    description: (
      <>
        Cada venta confirmada y cada depósito quedan registrados en tu panel, disponibles
        a cualquier hora. Y si necesitas ayuda, nuestro soporte responde por WhatsApp
        todos los días.
      </>
    ),
    showBanks: false,
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
      "Recibe pagos desde cualquier banco de México por transferencia y administra tus ingresos desde una sola app.",
  },
]

const FAQ_ITEMS: FaqAccordionItem[] = [
  {
    id: "que-necesito",
    question: "¿Qué necesito para empezar?",
    answer: (
      <>
        Solo registrarte gratis en <BrandInline /> y conectar tu cuenta de Mercado
        Pago (persona física o empresa). Si todavía no tienes una, te guiamos paso
        a paso dentro de la app para abrirla gratis en 3 minutos y empezar a recibir
        rendimientos diarios por el dinero de tus ventas.
      </>
    ),
  },
  {
    id: "porque-mercado-pago",
    question:
      "¿Por qué necesito usar una cuenta de Mercado Pago para recibir los pagos?",
    answer:
      "Porque actualmente es la única plataforma financiera en México que permite conectar y validar transferencias entrantes en tiempo real y sin costo por consulta. Gracias a esto, tus clientes pueden pagarte desde cualquier banco (BBVA, Banorte, Nu, etc.) y tú recibes la confirmación al instante.",
  },
  {
    id: "modelo-negocio",
    question: <>¿Cómo gana dinero <BrandInline />?</>,
    answer:
      "Ofrecemos un plan gratuito para empezar y planes mensuales fijos para negocios con alto volumen.",
  },
  {
    id: "mercado-pago-cliente",
    question: "¿Mis clientes necesitan tener Mercado Pago?",
    answer:
      "No. Pueden transferirte desde BBVA, Banorte, Santander, Nu, Citibanamex o cualquier banco en México por transferencia.",
  },
]

export default function ShortLandingPage() {
  return (
    <div className="min-h-svh bg-white text-[#0F172A]">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669]"
            aria-label="SPEILink, inicio"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spei-link-logo.svg"
              alt=""
              aria-hidden="true"
              className="h-7 w-auto sm:h-8"
            />
            <Wordmark className="text-base text-[#0F172A] sm:text-lg" />
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <NavbarLoginButton />
            <PrimarySignupCta variant="navbar" />
          </div>
        </div>
      </header>

      <main className="overflow-x-clip">
        <section className="relative bg-white py-10 sm:py-14 lg:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,_rgba(5,150,105,0.08),_transparent_65%)]"
          />
          <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8">
            <div className="flex flex-col items-center text-center lg:col-span-7 lg:items-start lg:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-[#065F46] sm:text-sm">
                <CheckIcon className="size-4 text-[#059669]" aria-hidden="true" />
                100% automatizado.
              </span>
              <h1 className="mt-5 text-3xl leading-[1.1] font-extrabold tracking-[-0.02em] text-balance text-[#0F172A] sm:text-4xl lg:text-5xl">
                Acepta pagos por WhatsApp y confirma la transferencia{" "}
                <span className="text-[#059669]">al instante.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-pretty text-slate-600 sm:text-lg">
                Todo ocurre en automático, sin que tengas que dictar tu CLABE,
                contestar chats ni abrir tu app del banco. Tu cliente escanea o
                abre tu link, transfiere y <BrandInline /> valida el depósito y
                confirma por ti.
              </p>
              <div className="mt-7 w-full sm:w-auto">
                <PrimarySignupCta variant="hero" />
              </div>
              <div className="mt-3.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 lg:justify-start">
                <span>Sin tarjetas</span>
                <span aria-hidden="true" className="size-1 rounded-full bg-slate-300" />
                <span>Actívalo en 3 minutos</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-slate-500 lg:justify-start">
                <LockIcon className="size-3.5 text-[#059669]" aria-hidden="true" />
                <span>Sin intermediarios</span>
                <span aria-hidden="true" className="size-1 rounded-full bg-slate-300" />
                <span>
                  <BrandInline /> nunca retiene tu dinero
                </span>
              </div>
              <div className="mt-6 w-full border-t border-slate-200/80 pt-5">
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Tus clientes pagan por transferencia desde cualquier banco
                </p>
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                  {COMPATIBLE_BANKS.map((bank) => (
                    <span
                      key={bank}
                      className="rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 py-1 text-xs font-semibold text-[#1E293B]"
                    >
                      {bank}
                    </span>
                  ))}
                  <span className="rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 py-1 text-xs font-semibold text-[#1E293B]">
                    y más bancos
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5">
              <WhatsAppPhoneDemo />
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200/80 bg-[#F8FAFC] py-8 sm:py-10">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-6 text-center shadow-sm sm:flex-row sm:justify-between sm:px-8 sm:text-left">
              <div className="flex shrink-0 items-center gap-2.5" aria-hidden="true">
                <span className="rounded-xl border border-slate-200 bg-[#F8FAFC] px-4 py-2 text-base font-extrabold tracking-tight text-[#0F172A] sm:text-lg">
                  CLABE
                </span>
                <span className="text-xl font-extrabold text-[#059669]">+</span>
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-base font-extrabold tracking-tight text-[#065F46] sm:text-lg">
                  <MessageCircleIcon className="size-4 text-[#059669]" />
                  WhatsApp
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                <strong className="font-semibold text-[#0F172A]">CLABE + WhatsApp:</strong>{" "}
                recibe transferencias verificadas al instante y quédate con el{" "}
                <span className="font-semibold text-[#059669] tabular-nums">100%</span>{" "}
                de tus ventas.
              </p>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200/80 bg-[#F8FAFC] py-14 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 flex flex-col items-center gap-2 text-center">
              <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-[#0F172A] sm:text-3xl">
                Cobra en tres simples pasos.
              </h2>
              <p className="max-w-xl text-sm text-slate-600 sm:text-base">
                Link → Transferencia → Validación
              </p>
            </div>
            <div className="relative grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
              <div
                aria-hidden="true"
                className="pointer-events-none hidden lg:block absolute top-11 left-[16.67%] right-[16.67%] border-t-2 border-dashed border-emerald-200"
              />
              {STEPS.map((step) => (
                <div
                  key={step.step}
                  className="relative z-10 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-slate-300 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl bg-emerald-50 px-3 text-sm font-extrabold text-[#059669] tabular-nums">
                      {step.step}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-[#F8FAFC] text-[#1E293B]"
                    >
                      <step.icon className="size-5" />
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-lg font-bold tracking-[-0.01em] text-[#0F172A]">
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-14 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex flex-col items-center gap-2 text-center">
              <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-[#0F172A] sm:text-3xl">
                Pensado para negocios como el tuyo
              </h2>
              <p className="max-w-xl text-sm text-slate-600 sm:text-base">
                Negocios en todo México que ya cobran transferencias sin perder margen.
              </p>
            </div>
            <div
              tabIndex={0}
              aria-label="Fotos de negocios que cobran con SPEILink"
              className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 no-scrollbar focus-visible:outline-2 focus-visible:outline-[#059669] lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0"
            >
              {CAROUSEL_SLIDES.map((slide) => (
                <figure
                  key={slide.src}
                  className="w-[82%] shrink-0 snap-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-slate-300 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:w-auto"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={slide.src}
                      alt={slide.alt}
                      width={600}
                      height={600}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute top-3 left-3 inline-flex items-center rounded-full border border-slate-200/80 bg-white/95 px-3 py-1 text-xs font-semibold text-[#0F172A] shadow-sm backdrop-blur-sm">
                      {slide.badge}
                    </span>
                  </div>
                  <figcaption className="flex flex-col gap-1 border-t border-slate-100 p-4 sm:p-5">
                    <p className="text-base font-bold text-[#0F172A]">{slide.title}</p>
                    <p className="text-sm leading-relaxed text-slate-600">{slide.benefit}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <CustomerDataValue />

        <section className="bg-[#0F172A] py-16 text-white sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 flex flex-col items-center gap-2.5 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
                Respaldo y control directo
              </span>
              <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-white sm:text-3xl">
                Seguridad bancaria, control total
              </h2>
              <p className="max-w-xl text-sm text-slate-300 sm:text-base">
                Tu dinero entra directo a tu cuenta y cada cobro se respalda con
                verificación real.
              </p>
            </div>
            <DirectTransferFlow />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {TRUST_POINTS.map((point) => (
                <div
                  key={point.title}
                  className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-[transform,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-emerald-400/30 hover:bg-white/[0.06] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/15 text-emerald-400"
                  >
                    <point.icon className="size-5" />
                  </span>
                  <h3 className="text-lg font-bold tracking-[-0.01em] text-white">
                    {point.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-300 sm:text-base">
                    {point.description}
                  </p>
                  {point.showBanks && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {COMPATIBLE_BANKS.map((bank) => (
                        <span
                          key={bank}
                          className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-slate-200"
                        >
                          {bank}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200/80 bg-[#F8FAFC] py-14 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/80 via-white to-slate-50 p-6 shadow-sm sm:p-8 lg:p-10">
              <div className="flex max-w-3xl flex-col gap-3">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-[#065F46]">
                  <TrendingUpIcon className="size-3.5 text-[#059669]" aria-hidden="true" />
                  Ventaja financiera incluida
                </span>
                <h2 className="text-xl font-extrabold leading-snug tracking-[-0.02em] text-balance text-[#0F172A] sm:text-2xl lg:text-3xl">
                  ¿Aún no tienes cuenta de Mercado Pago? Abrirla tiene grandes ventajas
                  para tu negocio
                </h2>
                <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                  Para que <BrandInline /> valide tus ventas al instante, solo necesitas
                  conectar una cuenta gratuita de Mercado Pago. Además, tu negocio
                  obtiene beneficios financieros inmediatos:
                </p>
              </div>
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
                {MP_BENEFITS.map((benefit) => (
                  <li
                    key={benefit.title}
                    className="flex items-start gap-3 rounded-xl border border-emerald-200/70 bg-white/90 p-4 shadow-xs"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#059669]"
                    >
                      <CheckIcon className="size-3.5" />
                    </span>
                    <p className="text-sm leading-relaxed text-slate-600">
                      <strong className="mb-1 block font-semibold text-[#0F172A]">
                        {benefit.title}:{" "}
                      </strong>
                      {benefit.description}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col items-start gap-2 pt-2 sm:flex-row sm:items-center sm:gap-4">
                <PrimarySignupCta variant="section" />
                <p className="text-xs text-slate-500">
                  Crea primero tu cuenta en <BrandInline /> y te guiamos para conectar
                  Mercado Pago.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-14 sm:py-20">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex flex-col items-center gap-2 text-center">
              <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-[#0F172A] sm:text-3xl">
                Preguntas frecuentes
              </h2>
              <p className="text-sm text-slate-600 sm:text-base">
                Todo lo que necesitas saber antes de recibir tu primer pago.
              </p>
            </div>
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
        </section>

        <section className="bg-[#F8FAFC] py-14 sm:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl bg-[#0F172A] px-6 py-10 text-center text-white shadow-2xl shadow-slate-900/20 sm:px-10 sm:py-14">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-[#059669]/25 blur-3xl"
              />
              <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center gap-4">
                <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-balance sm:text-4xl">
                  Deja de revisar tu banco en cada transferencia.
                </h2>
                <p className="text-sm leading-relaxed text-slate-300 sm:text-base">
                  Empieza a cobrar hoy por WhatsApp con confirmación automática al
                  instante.
                </p>
                <div className="mt-2 w-full sm:w-auto">
                  <PrimarySignupCta variant="banner" />
                </div>
                <p className="text-xs text-slate-400">
                  Sin tarjetas • Depósito directo a tu cuenta
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer id="landing-footer" className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/spei-link-logo.svg"
                alt=""
                aria-hidden="true"
                className="h-6 w-auto"
              />
              <Wordmark className="text-base text-[#0F172A]" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <FooterSupportButton />
              <span aria-hidden="true" className="size-1 rounded-full bg-slate-300" />
              <span>Aviso de Privacidad</span>
              <span aria-hidden="true" className="size-1 rounded-full bg-slate-300" />
              <span>Términos de Uso</span>
            </div>
          </div>
          <p className="border-t border-slate-100 pt-5 text-xs leading-relaxed text-slate-500">
            <BrandInline /> es una plataforma tecnológica de gestión y conciliación de
            cobros. No es una institución financiera ni capta recursos del público.{" "}
            <BrandInline /> es un servicio independiente y no está afiliado ni
            patrocinado por Banxico ni por Mercado Pago.
          </p>
        </div>
      </footer>

      <FloatingCommissionBadge />
    </div>
  )
}
