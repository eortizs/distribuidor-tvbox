"use client"

/**
 * Sondeo compartido de la renovación DESACOPLADA de un canje de cupón
 * (individuales en /clientes y paquetes en /modulos/paquetes-flujotv): la
 * orden parte `paid` (el cupón ya quedó registrado y el saldo debitado) y el
 * servidor aplica la renovación con reintentos automáticos. La máquina de
 * sondeo vive aquí para que las dos vistas no deriven — mensajes y ventana
 * incluidos; solo la etiqueta del éxito es propia de cada vista.
 */

import { useEffect, useRef } from "react"

import {
  fetchPaymentOrder,
  type PaymentOrder,
} from "@/components/entities/pago-api"

/**
 * Ventana del sondeo: cubre el reintento automático de 60 s del scheduler
 * más la ejecución del intento; al agotarse el mensaje invita a re-pulsar
 * «Aplicar cupón», que consulta la misma orden sin crear otra.
 */
export const COUPON_POLL_ATTEMPTS = 60
export const COUPON_POLL_INTERVAL_MS = 2000

/** Mensaje al agotar la ventana de sondeo sin estado final (idéntico en ambas vistas). */
export const COUPON_POLL_EXHAUSTED_MESSAGE =
  "El cupón quedó registrado y la renovación sigue aplicándose en el panel de licencias. Espera un momento y vuelve a pulsar «Aplicar cupón»: se consulta la misma orden sin canjar ni sumar meses extra."

/** Objetivo del sondeo: la orden y la transacción entregadas por el canje. */
export interface CouponPollTarget {
  orderId: string
  /**
   * Id de la transacción de renovación (`txn-…`) que devuelve el canje;
   * null en reintentos del admin (la respuesta del reintento no lo trae).
   * Viaja en el mensaje de fallo como «ID de seguimiento» para la bitácora.
   */
  transactionId: string | null
}

/**
 * Mensaje del fallo CONFIRMADO de renovación (`renewal_failed`, presupuesto
 * de reintentos agotado o fallo permanente). Único en ambas vistas: el «ID
 * de seguimiento» va incluido cuando hay transacción, para que el admin
 * pueda seguir el caso en `mp_order_events`.
 */
export function couponRenewalFailureMessage(
  orderId: string,
  transactionId: string | null,
  error: string | null
): string {
  return `El cupón se aceptó y quedó registrado (orden ${orderId.slice(0, 8)}…), pero la renovación no se confirmó en el panel de licencias.${error ? ` ${error}` : ""} Pulsa «Reintentar renovación»: no se vuelve a canjar ni suma meses extra.${transactionId ? ` ID de seguimiento: ${transactionId}.` : ""}`
}

export interface CouponRenewalPollParams {
  /** Orden a sondear; null = inactivo. */
  target: CouponPollTarget | null
  /** Renovación confirmada: cerrar con éxito y refrescar la fila. */
  onRenewed: (order: PaymentOrder) => void
  /** Fallo confirmado: activar el reintento seguro (sin nuevo canje). */
  onFailed: (order: PaymentOrder, target: CouponPollTarget) => void
  /** Ventana agotada sin estado final: informar y permitir el re-clic. */
  onExhausted: () => void
}

/**
 * Máquina de sondeo: consulta la orden cada `COUPON_POLL_INTERVAL_MS` hasta
 * verla terminal (`renewed` / `renewal_failed`) o agotar la ventana. Los
 * callbacks viajan en refs para que el ciclo no se reinicie cuando la vista
 * re-renderiza (un efecto dependiente de callbacks inestables resetearía el
 * contador de intentos y el sondeo nunca acabaría).
 */
export function useCouponRenewalPoll(params: CouponRenewalPollParams): void {
  const { target } = params
  const callbacksRef = useRef(params)
  // Los callbacks se sincronizan en efecto (no durante el render, que el
  // linter de react-hooks prohíbe): al declararse antes que el efecto de
  // sondeo, el ref ya está fresco cuando el tick lo lee.
  useEffect(() => {
    callbacksRef.current = params
  })

  useEffect(() => {
    if (!target) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const tick = async () => {
      attempts += 1
      let order: PaymentOrder | null = null
      try {
        order = await fetchPaymentOrder(target.orderId)
      } catch {
        // Error puntual de red: el siguiente tick reintenta.
        order = null
      }
      if (cancelled) return

      if (order) {
        if (order.status === "renewed") {
          callbacksRef.current.onRenewed(order)
          return
        }
        if (order.status === "renewal_failed") {
          callbacksRef.current.onFailed(order, target)
          return
        }
      }

      if (attempts >= COUPON_POLL_ATTEMPTS) {
        callbacksRef.current.onExhausted()
        return
      }
      timer = setTimeout(() => {
        void tick()
      }, COUPON_POLL_INTERVAL_MS)
    }

    timer = setTimeout(() => {
      void tick()
    }, COUPON_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [target])
}
