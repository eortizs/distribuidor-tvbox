"use client"

import * as React from "react"

/** Tiempo que hay que mantener presionado para que el gesto cuente. */
const LONG_PRESS_DELAY_MS = 500

/**
 * Desplazamiento máximo (en px) que cancela el gesto: más allá de esto el
 * usuario está desplazando la página o arrastrando, no presionando.
 */
const MOVE_TOLERANCE_PX = 10

export interface UseLongPressOptions {
  /**
   * Se dispara una sola vez por gesto, cuando el dedo (o el botón del ratón)
   * ya llevaba `delay` ms presionado sobre el elemento.
   */
  onLongPress: () => void
  /** Milisegundos que hay que mantener presionado. */
  delay?: number
  /** Permite apagar el gesto (p. ej. si el elemento ya no admite pulsación). */
  enabled?: boolean
}

export interface UseLongPressHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void
  /**
   * Cierra el gesto. Devuelve `true` si el clic venía de una pulsación
   * larga: en ese caso el clic ya fue descartado y el elemento no debe
   * abrir nada.
   */
  onClick: (event: React.MouseEvent<HTMLElement>) => boolean
}

/**
 * Pulsación larga (tap sostenido en móvil, clic sostenido en escritorio).
 *
 * El gesto se apoya en eventos de puntero, así que un solo código sirve para
 * dedo, ratón y lápiz. La velocidad de la respuesta depende del dispositivo:
 * en el táctil hay que aguantar medio segundo antes de que el sistema
 * entienda que no es un scroll, y ese mismo margen evita que un clic
 * normal se convierta por error en una selección.
 *
 * Tres detalles que hacen que el gesto no choque con el navegador:
 *
 * - El clic que sigue a la pulsación larga se descarta (si no, el elemento
 *   abriría lo que tiene abierto justo después de seleccionar).
 * - El menú nativo (guardar imagen, copiar) se cancela mientras el gesto está
 *   en curso: en escritorio aparece solo al mantener pulsado el botón.
 * - Si el puntero se mueve más de unos pocos píxeles, el gesto se cancela:
 *   el usuario está desplazando la galería, no seleccionando.
 */
export function useLongPress({
  onLongPress,
  delay = LONG_PRESS_DELAY_MS,
  enabled = true,
}: UseLongPressOptions): UseLongPressHandlers {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Estado del gesto en curso: `active` dice si el dedo sigue presionado y
  // `fired` si la pulsación larga ya se disparó (el clic que viene después
  // tiene que descartarse).
  const gestureRef = React.useRef({
    active: false,
    fired: false,
    pointerType: "",
    startX: 0,
    startY: 0,
  })
  const stopTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // El callback va directo en las dependencias: el temporizador se crea al
  // empezar el gesto, así que siempre llama a la versión más reciente.
  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // El tipo de puntero se anota siempre (también en el clic derecho):
      // el menú nativo se cancela según el dispositivo que lo pidió.
      gestureRef.current.pointerType = event.pointerType
      if (!enabled) return
      // Solo el botón principal: el clic derecho abre su propio menú.
      if (!event.isPrimary || event.button !== 0) return
      const gesture = gestureRef.current
      gesture.active = true
      gesture.fired = false
      gesture.startX = event.clientX
      gesture.startY = event.clientY
      stopTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (!gestureRef.current.active) return
        gestureRef.current.fired = true
        onLongPress()
      }, delay)
    },
    [delay, enabled, onLongPress, stopTimer]
  )

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const gesture = gestureRef.current
      if (!gesture.active || gesture.fired) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (Math.hypot(dx, dy) <= MOVE_TOLERANCE_PX) return
      // El puntero se movió: el usuario está desplazando la galería, no
      // presionando una imagen.
      gesture.active = false
      stopTimer()
    },
    [stopTimer]
  )

  const endGesture = React.useCallback(() => {
    gestureRef.current.active = false
    stopTimer()
  }, [stopTimer])

  const onContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const gesture = gestureRef.current
      // El menú nativo compite con el gesto. En el táctil siempre (el
      // callout de iOS aparece a los ~500 ms) y en escritorio solo mientras
      // el botón sigue presionado (es cuando el navegador lo abre).
      if (gesture.pointerType !== "touch" && !gesture.active && !gesture.fired) {
        return
      }
      event.preventDefault()
    },
    []
  )

  const onClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!gestureRef.current.fired) return false
    // El clic cierra una pulsación larga: el elemento ya reaccionó al gesto
    // y no debe abrir lo que tiene abierto.
    gestureRef.current.fired = false
    event.preventDefault()
    event.stopPropagation()
    return true
  }, [])

  React.useEffect(() => stopTimer, [stopTimer])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endGesture,
    onPointerLeave: endGesture,
    onPointerCancel: endGesture,
    onContextMenu,
    onClick,
  }
}
