import {
  CheckCircle2Icon,
  CheckIcon,
  MessageCircleCheckIcon,
  ReceiptTextIcon,
  RepeatIcon,
} from "lucide-react"

import { BrandInline } from "@/components/short/brand"

const VALUE_POINTS = [
  {
    icon: MessageCircleCheckIcon,
    title: "El cliente inicia la conversación",
    description:
      "Al escanear tu QR o abrir tu link de pago, es tu comprador quien abre el chat en WhatsApp. Obtienes su número real y activo de manera orgánica y consensuada.",
  },
  {
    icon: ReceiptTextIcon,
    title: "Seguimiento postventa sin fricción",
    description:
      "Envía su comprobante digital, confirma entregas, comparte garantías o resuelve dudas directamente en el mismo hilo donde te pagó.",
  },
  {
    icon: RepeatIcon,
    title: "Haz que vuelvan a comprarte",
    description:
      "Deja de depender de que pasen frente a tu local o de pagar anuncios para recuperarlos: avísales cuando lleguen productos nuevos o envíales promociones exclusivas.",
  },
]

export function CustomerDataValue() {
  return (
    <section className="border-y border-slate-200/60 bg-slate-50/70 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col items-center gap-2.5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-[#065F46]">
            <CheckIcon className="size-3.5 text-[#059669]" aria-hidden="true" />
            Tu mayor activo comercial
          </span>
          <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-balance text-[#0F172A] sm:text-3xl">
            Quédate con el contacto de cada cliente
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Cuando te pagan con efectivo o transferencia bancaria, tu cliente
            se va y pierdes todo rastro de él. Con <BrandInline />, cada
            transferencia construye tu propia base de datos de clientes reales
            en WhatsApp, de forma natural y sin pedir formularios incómodos.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {VALUE_POINTS.map((point) => (
            <div
              key={point.title}
              className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:border-slate-300 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-[#F8FAFC] text-[#1E293B]"
              >
                <point.icon className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-bold tracking-[-0.01em] text-[#0F172A]">
                  {point.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
                  {point.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 items-center gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-7">
            <span className="inline-flex w-fit items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Control de pedidos + Nota Digital
            </span>
            <h3 className="text-lg font-bold tracking-[-0.01em] text-[#0F172A] sm:text-xl">
              Controla tus pedidos y entrega su Nota Digital en automático
            </h3>
            <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
              Ideal para cafeterías, misceláneas y negocios de mostrador: arma
              el pedido desde la app, liga el cobro al número de orden como
              concepto SPEI y lleva el control exacto de qué está pagado. Al
              acreditarse la transferencia, tu cliente recibe automáticamente
              su nota desglosada directo en su WhatsApp.
            </p>
            <ul className="flex flex-col gap-2">
              <li className="flex items-start gap-2 text-sm text-[#1E293B]">
                <CheckCircle2Icon
                  className="mt-0.5 size-4 shrink-0 text-[#059669]"
                  aria-hidden="true"
                />
                Conciliación exacta por número de orden sin confusiones entre
                cuentas.
              </li>
              <li className="flex items-start gap-2 text-sm text-[#1E293B]">
                <CheckCircle2Icon
                  className="mt-0.5 size-4 shrink-0 text-[#059669]"
                  aria-hidden="true"
                />
                Comprobante digital desglosado que eleva la confianza de tu
                comprador.
              </li>
            </ul>
          </div>
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-emerald-200/80 bg-[#DCF8C6] p-4 text-sm text-slate-800 shadow-sm">
              <p className="font-bold">✅ ¡Pago verificado! · Orden ORD104</p>
              <ul className="mt-3 flex flex-col gap-2">
                <li className="flex justify-between gap-3 border-b border-dashed border-emerald-300/70 pb-2">
                  <span>2x Capuchino grande</span>
                  <span className="tabular-nums">$110.00</span>
                </li>
                <li className="flex justify-between gap-3 border-b border-dashed border-emerald-300/70 pb-2">
                  <span>1x Rol de canela</span>
                  <span className="tabular-nums">$35.00</span>
                </li>
              </ul>
              <p className="mt-2 flex justify-between border-t border-emerald-300/60 pt-2 font-bold tabular-nums">
                <span>Total pagado</span>
                <span>$145.00 MXN</span>
              </p>
              <p className="mt-1 text-right text-xs text-slate-500">
                Nota digital enviada automáticamente · 10:36 ✓✓
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="rounded-xl border-2 border-[#059669]/40 bg-emerald-50/70 p-5">
            <p className="text-sm font-bold text-[#065F46]">
              <BrandInline /> por WhatsApp
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[#1E293B]">
              Cobras al instante y ganas un canal directo para venderle una y
              otra vez.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
