"use client"

import * as React from "react"

/**
 * Dictado por voz con la Web Speech API del navegador.
 *
 * Solo Chromium y Safari exponen el reconocedor; Firefox no. Por eso la
 * detección va primero: cuando el navegador no puede dictar, el botón queda
 * inactivo y se explica por qué, en lugar de fallar al pulsarlo.
 *
 * El reconocedor entrega palabras en dos tiempos: las provisionales (lo que
 * se está oyendo) y las confirmadas. Aquí se acumulan las dos en un solo
 * texto, y al terminar la sesión se entrega completo para que el área de
 * texto lo pueda guardar tal cual.
 *
 * La acumulación es por índice, no por evento: varios navegadores móviles
 * reenvían en cada evento la lista completa de resultados (con `resultIndex`
 * siempre en 0), así que sumar evento por evento repetía las frases ya
 * confirmadas. Guardar cada resultado en su lugar y rehacer el texto deja
 * una sola copia, sin importar cuántas veces llegue la lista.
 *
 * Además, los reconocedores móviles devuelven la misma frase varias veces
 * como resultados consecutivos (Chrome de Android lo documenta) o la
 * retranscriben tras la pausa (iOS 18). Al juntar el texto, las copias
 * consecutivas de lo mismo se colapsan: queda una sola.
 */

type SpeechRecognitionAlternativeLike = { transcript: string }

type SpeechRecognitionResultLike = {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>
}

/** Un resultado de la lista: su texto y si el motor ya lo confirmó. */
type SpeechRecognitionEntry = {
  text: string
  final: boolean
}

type SpeechRecognitionErrorEventLike = { error: string }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionFactory = new () => SpeechRecognitionLike

/** Cada error del reconocedor con su mensaje para el usuario. */
const ERROR_MESSAGES: Record<string, string> = {
  "no-speech": "No se detectó voz. Intenta de nuevo.",
  "audio-capture": "No se encontró un micrófono conectado.",
  "not-allowed": "No diste permiso para usar el micrófono.",
  "service-not-allowed": "El navegador bloqueó el dictado por voz.",
  network: "El dictado por voz necesita conexión a internet.",
  "language-not-supported": "El navegador no reconoce el español de México.",
}

/** El mensaje para los errores que no traen uno propio. */
const DEFAULT_ERROR_MESSAGE = "No se pudo dictar la descripción."

/** ¿El navegador tiene reconocedor de voz? */
function getSpeechRecognitionFactory(): SpeechRecognitionFactory | null {
  if (typeof window === "undefined") return null
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionFactory
    webkitSpeechRecognition?: SpeechRecognitionFactory
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/** La capacidad del navegador no cambia: no hay nada que suscribir. */
function subscribeNothing() {
  return () => {}
}

/** En el servidor no hay navegador: el dictado no está disponible. */
function getServerSupport() {
  return false
}

/** En el cliente depende del navegador y de que la página sea segura. */
function getClientSupport() {
  if (typeof window === "undefined") return false
  // El reconocedor solo funciona en un contexto seguro (https o localhost).
  if (!window.isSecureContext) return false
  return getSpeechRecognitionFactory() !== null
}

/** Agrega un fragmento al texto ya escrito, sin dejar espacios de más. */
function appendTranscript(base: string, addition: string): string {
  const clean = addition.trim()
  if (!clean) return base
  return base ? `${base} ${clean}` : clean
}

/**
 * Texto comparable: sin puntuación, sin mayúsculas, sin espacios de más.
 *
 * El duplicado que devuelve el navegador no siempre es idéntico: puede traer
 * un punto al final o una mayúscula. La comparación se hace sobre el texto
 * normalizado.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[¡!¿?.,;:«»"'"'()\-—–…]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** ¿Los dos textos dicen lo mismo (solo cambian puntuación o mayúsculas)? */
function sameText(a: string, b: string): boolean {
  const na = normalizeText(a)
  return na.length > 0 && na === normalizeText(b)
}

/** ¿`prefix` es el comienzo de `full`? */
function startsWithText(prefix: string, full: string): boolean {
  const np = normalizeText(prefix)
  return np.length > 0 && normalizeText(full).startsWith(np)
}

/**
 * Junta los resultados de la lista en un solo texto, colapsando lo que el
 * navegador duplica.
 *
 * Chrome de Android devuelve la misma frase varias veces seguidas (a veces
 * tres) como resultados consecutivos; el reconocedor de iOS vuelve a
 * transcribir la frase tras la pausa. Por eso cada texto se compara con lo
 * ya guardado:
 *
 * - Igual a todo lo guardado: el navegador reenvió lo acumulado; queda la
 *   copia que ya estaba.
 * - Contiene a todo lo guardado como comienzo: el motor reenvió la frase
 *   acumulada en una sola entrada (o el usuario se corrigió repitiendo y
 *   ampliando): se queda la versión larga.
 * - Igual al resultado anterior o lo contiene como comienzo: confirmación o
 *   duplicado del último: una sola copia.
 * - Todo lo demás se agrega.
 *
 * El costo aceptado: repetir una frase exactamente igual, una tras otra, no
 * queda por duplicado. Contra el duplicado sistemático de los móviles es el
 * mal menor.
 */
function entriesToText(entries: SpeechRecognitionEntry[]): string {
  const kept: string[] = []
  let keptNormalized = ""
  for (const entry of entries) {
    const text = entry.text.trim()
    if (!text) continue
    const fresh = normalizeText(text)
    if (!fresh) continue
    if (kept.length === 0) {
      kept.push(text)
      keptNormalized = fresh
      continue
    }
    if (keptNormalized === fresh) {
      // El navegador reenvió todo lo acumulado: ya está.
      continue
    }
    if (fresh.startsWith(keptNormalized)) {
      // El navegador reenvió lo acumulado y le añadió: una sola entrada.
      kept.length = 0
      kept.push(text)
      keptNormalized = fresh
      continue
    }
    const last = kept[kept.length - 1]
    const same = sameText(text, last)
    const grows = !same && startsWithText(last, text)
    if (same || grows) {
      kept[kept.length - 1] = text
    } else {
      kept.push(text)
    }
    keptNormalized = normalizeText(kept.join(" "))
  }
  return kept.join(" ")
}

/**
 * Une el texto ya cerrado con el de la lista nueva sin repetir lo que el
 * navegador reenvía al reiniciar la lista (iOS vuelve a transcribir la misma
 * frase tras la pausa).
 */
function joinClosedText(closed: string, joined: string): string {
  if (!joined.trim()) return closed
  if (!closed.trim()) return joined
  const base = normalizeText(closed)
  const fresh = normalizeText(joined)
  if (base === fresh || base.endsWith(` ${fresh}`)) return closed
  if (fresh.startsWith(base)) return joined
  return appendTranscript(closed, joined)
}

/** Estado de la transcripción: la lista abierta y lo ya cerrado. */
export type RecognitionTextState = {
  /** Resultados de la lista actual, uno por índice. */
  entries: SpeechRecognitionEntry[]
  /** Texto de las listas anteriores, cuando el navegador reinicia la lista. */
  closed: string
}

/**
 * Aplica la lista de resultados que entrega el navegador sobre los
 * resultados que ya se tenían.
 *
 * Cada resultado se guarda en su índice, así que el texto se rehace desde la
 * lista completa en vez de sumarse evento por evento: una frase que el
 * navegador ya confirmó y vuelve a enviar se escribe en su lugar, y las
 * copias consecutivas que devuelve el móvil se colapsan al juntar.
 *
 * Cuando el navegador reinicia la lista al cambiar de utterance, lo que
 * había quedado en la lista anterior se aparta como texto cerrado para no
 * perderlo.
 */
export function mergeRecognitionResults(
  state: RecognitionTextState,
  list: ArrayLike<SpeechRecognitionResultLike>
): RecognitionTextState & { text: string } {
  const { entries, closed } = state

  // ¿El navegador empezó una lista nueva? Dos señales independientes:
  //
  // - La lista se encogió: el motor descartó entradas. Lo que había se
  //   cierra entero (las reglas de contención colapsan el caso en que la
  //   lista nueva ya contiene lo anterior), para no perder ninguna entrada.
  // - La primera entrada confirmada fue sustituida por un texto distinto:
  //   hay una utterance nueva. Salvo que la nueva EMPIECE CON el texto de la
  //   que había: entonces no es una lista nueva, es el motor retranscribiendo
  //   de forma acumulada (lo hacen varios móviles), y tratarla como
  //   reinicio duplicaba lo ya dictado.
  const encojeLista = entries.length > 0 && list.length < entries.length

  const primeraSustituida =
    entries.length > 0 &&
    list.length > 0 &&
    entries[0].final &&
    !sameText(list[0][0].transcript, entries[0].text) &&
    !startsWithText(entries[0].text, list[0][0].transcript)

  const listaReinicia = encojeLista || primeraSustituida

  // Lo que había en la lista anterior se cierra con las mismas reglas de
  // contención, para no acarrear copias al texto cerrado.
  const closed2 = listaReinicia
    ? joinClosedText(closed, entriesToText(entries))
    : closed

  const entries2 = listaReinicia ? [] : entries.slice()
  for (let index = 0; index < list.length; index += 1) {
    const result = list[index]
    entries2[index] = { text: result[0].transcript, final: result.isFinal }
  }

  const joined = entriesToText(entries2)
  return {
    entries: entries2,
    closed: closed2,
    text: joinClosedText(closed2, joined),
  }
}

export type SpeechRecognitionOptions = {
  /** Idioma del dictado (BCP-47). */
  lang?: string
  /** Texto de la sesión en curso: lo confirmado más lo provisional. */
  onTranscript?: (text: string) => void
  /** La sesión terminó (a mano, por error o por silencio). */
  onEnd?: (text: string) => void
}

export type SpeechRecognitionState = {
  /** El navegador sabe dictar. */
  isSupported: boolean
  /** Hay una sesión de dictado en curso. */
  isListening: boolean
  /** Último error del reconocedor, ya en español. */
  error: string | null
}

export type SpeechRecognitionActions = {
  /** Empieza a dictar: hay que llamarlo desde un clic del usuario. */
  start: () => void
  /** Termina la sesión; el texto dictado llega a `onEnd`. */
  stop: () => void
}

export function useSpeechRecognition({
  lang = "es-MX",
  onTranscript,
  onEnd,
}: SpeechRecognitionOptions = {}): SpeechRecognitionState &
  SpeechRecognitionActions {
  const [isListening, setIsListening] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // La capacidad del navegador se lee como un dato externo: en el servidor
  // vale `false` y el botón se habilita al hidratar.
  const isSupported = React.useSyncExternalStore(
    subscribeNothing,
    getClientSupport,
    getServerSupport
  )

  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null)
  // Resultados de la lista actual, uno por índice.
  const entriesRef = React.useRef<SpeechRecognitionEntry[]>([])
  // Texto ya cerrado: lo que quedó de listas anteriores, cuando el navegador
  // reinicia la lista de resultados al cambiar de utterance.
  const closedRef = React.useRef("")
  // Texto completo de la sesión en curso.
  const transcriptRef = React.useRef("")
  // Número de sesión: los eventos de una sesión vieja (la que se aborta al
  // empezar otra) se ignoran, para no mezclar dos transcripciones.
  const sessionRef = React.useRef(0)
  const onTranscriptRef = React.useRef(onTranscript)
  const onEndRef = React.useRef(onEnd)

  React.useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  React.useEffect(() => {
    onEndRef.current = onEnd
  }, [onEnd])

  // Al salir de la pantalla el reconocedor se apaga: el micrófono no se
  // queda abierto sin que nadie lo esté mirando.
  React.useEffect(() => {
    return () => {
      sessionRef.current += 1
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = React.useCallback(() => {
    const Factory = getSpeechRecognitionFactory()
    if (!Factory) {
      setError("Tu navegador no admite dictado por voz.")
      return
    }

    // Se cierra cualquier sesión anterior antes de abrir la nueva.
    recognitionRef.current?.abort()

    const session = sessionRef.current + 1
    sessionRef.current = session

    setError(null)
    entriesRef.current = []
    closedRef.current = ""
    transcriptRef.current = ""

    const recognition = new Factory()
    recognition.lang = lang
    // Continuo para que una pausa no corte el dictado; con resultados
    // provisionales las palabras aparecen mientras se hablan.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // `closed` evita que un evento que llega después del cierre (el
    // reconocedor puede soltar un último resultado) vuelva a escribir.
    let closed = false

    recognition.onresult = (event) => {
      if (closed || session !== sessionRef.current) return
      const merged = mergeRecognitionResults(
        { entries: entriesRef.current, closed: closedRef.current },
        event.results
      )
      entriesRef.current = merged.entries
      closedRef.current = merged.closed
      transcriptRef.current = merged.text
      onTranscriptRef.current?.(merged.text)
    }

    recognition.onerror = (event) => {
      if (closed || session !== sessionRef.current) return
      // "aborted" es el cierre normal de una sesión y lo cuenta `onend`.
      if (event.error === "aborted") return
      setError(ERROR_MESSAGES[event.error] ?? DEFAULT_ERROR_MESSAGE)
    }

    recognition.onend = () => {
      if (closed || session !== sessionRef.current) return
      closed = true
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
      }
      setIsListening(false)
      onEndRef.current?.(transcriptRef.current)
    }

    recognitionRef.current = recognition
    setIsListening(true)
    try {
      recognition.start()
    } catch {
      setError(DEFAULT_ERROR_MESSAGE)
      setIsListening(false)
    }
  }, [lang])

  return {
    isSupported,
    isListening,
    error,
    start,
    stop,
  }
}
