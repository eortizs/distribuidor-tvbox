"use client"

/**
 * Herramienta Cronómetro (`/modulos/cronometro`): una sola Card con dos
 * pestañas — cronómetro de vueltas y temporizador de cuenta regresiva.
 *
 * - Cronómetro: pantalla grande con centésimas, Iniciar/Pausar/Continuar
 *   (primaria), Reiniciar (outline) y Vuelta (secundaria, solo en marcha).
 *   Las vueltas se listan de la más reciente arriba, con la duración de la
 *   vuelta y el total acumulado; la más rápida y la más lenta quedan marcadas
 *   con un Badge. El tiempo se calcula con marcas de reloj (`Date.now`),
 *   nunca incrementando: volver de una pestaña en segundo plano repinta el
 *   valor correcto sin deriva.
 * - Temporizador: campos de horas/minutos/segundos (bloqueados en marcha) y
 *   presets de minutos al toque; barra de progreso del tiempo restante y
 *   aviso de fin con Badge, pitido (WebAudio) y vibración. Al terminar la
 *   acción primaria pasa a «Repetir» para relanzar la misma duración.
 *
 * Ambas herramientas conservan su estado entre pestañas: el cronómetro sigue
 * midiendo mientras se usa el temporizador y viceversa. Los cambios de estado
 * se anuncian por región `aria-live` y hay atajos de teclado acotados al
 * módulo (Espacio = iniciar/pausar, V = vuelta, R = reiniciar).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  FlagIcon,
  HourglassIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RotateCcwIcon,
  TimerIcon,
} from "lucide-react"

import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  TIMER_MAX_MS,
  TIMER_PRESET_MINUTES,
  coerceTimerField,
  formatStopwatchMs,
  formatTimerLabel,
  formatTimerMs,
  lapMarkers,
  type Lap,
  type RunStatus,
} from "@/lib/cronometro"

type Tab = "cronometro" | "temporizador"

/** Latido del cronómetro en marcha (~30 fps para las centésimas). */
const STOPWATCH_TICK_MS = 33

/** Latido del temporizador: la pantalla es de segundos; sobra con 200 ms. */
const TIMER_TICK_MS = 200

/** Texto de la leyenda según el estado de marcha. */
const STATUS_CAPTION: Record<RunStatus, string> = {
  idle: "Listo",
  running: "En marcha",
  paused: "En pausa",
}

/** Pitido triple de WebAudio al cumplir el tiempo; mejor esfuerzo. */
function playFinishChime() {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioCtor) return
    const ctx = new AudioCtor()
    const beepAt = (start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.3)
    }
    const base = ctx.currentTime + 0.05
    beepAt(base)
    beepAt(base + 0.35)
    beepAt(base + 0.7)
    window.setTimeout(() => {
      void ctx.close()
    }, 1400)
  } catch {
    // Sin audio disponible: quedan el aviso visual y la vibración.
  }
}

/** Pantalla grande de tiempo con leyenda de estado (y Badge al cumplir). */
function TimeDisplay({
  label,
  caption,
  finished = false,
  children,
}: {
  label: string
  caption: string
  finished?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      role="region"
      aria-label={label}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-muted/50 px-4 py-4"
    >
      {finished ? (
        <Badge variant="success-light" size="lg">
          ¡Tiempo cumplido!
        </Badge>
      ) : null}
      <div
        aria-hidden="true"
        className="min-w-0 font-medium leading-none tracking-tight tabular-nums text-5xl sm:text-6xl"
      >
        {children}
      </div>
      <p aria-hidden="true" className="text-muted-foreground text-sm">
        {caption}
      </p>
    </div>
  )
}

/**
 * Estado del cronómetro: marca de reloj al iniciar y acumulado al pausar.
 * El latido solo repinta; el tiempo real siempre sale de las marcas.
 */
function useStopwatch() {
  const [status, setStatus] = useState<RunStatus>("idle")
  const [accumulatedMs, setAccumulatedMs] = useState(0)
  const [laps, setLaps] = useState<Lap[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [startedAtMs, setStartedAtMs] = useState(0)
  const [announcement, setAnnouncement] = useState("")
  const accumulatedRef = useRef(0)
  const nextLapIdRef = useRef(1)

  useEffect(() => {
    if (status !== "running") return
    const timer = window.setInterval(
      () => setNowMs(Date.now()),
      STOPWATCH_TICK_MS
    )
    return () => window.clearInterval(timer)
  }, [status])

  /** Fija el acumulado en el instante actual (pausa, vuelta, reinicio). */
  const settle = useCallback(() => {
    const total =
      accumulatedRef.current + Math.max(0, Date.now() - startedAtMs)
    accumulatedRef.current = total
    setAccumulatedMs(total)
    return total
  }, [startedAtMs])

  const start = useCallback(() => {
    const now = Date.now()
    setStartedAtMs(now)
    setNowMs(now)
    setStatus("running")
    setAnnouncement("Cronómetro en marcha")
  }, [])

  const pause = useCallback(() => {
    settle()
    setStatus("paused")
    setAnnouncement("Cronómetro en pausa")
  }, [settle])

  const reset = useCallback(() => {
    accumulatedRef.current = 0
    setAccumulatedMs(0)
    setLaps([])
    setStatus("idle")
    setAnnouncement("Cronómetro reiniciado")
  }, [])

  const lap = useCallback(() => {
    const total = settle()
    const id = nextLapIdRef.current
    nextLapIdRef.current += 1
    setLaps((prev) => [
      { id, lapMs: total - (prev[0]?.totalMs ?? 0), totalMs: total },
      ...prev,
    ])
    navigator.vibrate?.(20)
    setAnnouncement("Vuelta registrada")
  }, [settle])

  const elapsedMs =
    accumulatedMs +
    (status === "running" ? Math.max(0, nowMs - startedAtMs) : 0)

  return {
    status,
    elapsedMs,
    laps,
    markers: lapMarkers(laps),
    canReset: status !== "idle" || accumulatedMs > 0 || laps.length > 0,
    start,
    pause,
    reset,
    lap,
    announcement,
  }
}

type StopwatchController = ReturnType<typeof useStopwatch>

type TimerField = "hours" | "minutes" | "seconds"

const TIMER_FIELD_MAX: Record<TimerField, number> = {
  hours: 23,
  minutes: 59,
  seconds: 59,
}

/**
 * Estado del temporizador: cuenta por hora objetivo (`endAt`) y avance por
 * marcas de reloj; editar la duración (fuera de marcha) reinicia la cuenta.
 */
function useTimer() {
  const [fields, setFields] = useState({
    hours: "0",
    minutes: "5",
    seconds: "0",
  })
  const [status, setStatus] = useState<RunStatus>("idle")
  const [finished, setFinished] = useState(false)
  const [totalMs, setTotalMs] = useState(5 * 60 * 1000)
  const [remainingMs, setRemainingMs] = useState(5 * 60 * 1000)
  const [announcement, setAnnouncement] = useState("")
  const endAtRef = useRef(0)
  const lastDurationRef = useRef(5 * 60 * 1000)

  const durationMs =
    coerceTimerField(fields.hours, TIMER_FIELD_MAX.hours) * 3_600_000 +
    coerceTimerField(fields.minutes, TIMER_FIELD_MAX.minutes) * 60_000 +
    coerceTimerField(fields.seconds, TIMER_FIELD_MAX.seconds) * 1000

  // Nueva duración mientras no corre: reinicia la cuenta y limpia el fin.
  // En marcha los campos están bloqueados, así que no puede cambiar.
  useEffect(() => {
    if (durationMs === lastDurationRef.current) return
    lastDurationRef.current = durationMs
    setTotalMs(durationMs)
    setRemainingMs(durationMs)
    setFinished(false)
  }, [durationMs])

  const setField = useCallback((field: TimerField, value: string) => {
    setFields((prev) => ({ ...prev, [field]: value }))
  }, [])

  const commitField = useCallback((field: TimerField, value: string) => {
    setFields((prev) => ({
      ...prev,
      [field]: String(coerceTimerField(value, TIMER_FIELD_MAX[field])),
    }))
  }, [])

  const applyDuration = useCallback((ms: number) => {
    const safe = Math.min(Math.max(0, ms), TIMER_MAX_MS)
    setFields({
      hours: String(Math.floor(safe / 3_600_000)),
      minutes: String(Math.floor((safe % 3_600_000) / 60_000)),
      seconds: String(Math.floor((safe % 60_000) / 1000)),
    })
  }, [])

  const start = useCallback(() => {
    endAtRef.current = Date.now() + remainingMs
    setStatus("running")
    setFinished(false)
    setAnnouncement(`Temporizador en marcha: ${formatTimerLabel(remainingMs)}`)
  }, [remainingMs])

  const pause = useCallback(() => {
    setRemainingMs(Math.max(0, endAtRef.current - Date.now()))
    setStatus("paused")
    setAnnouncement("Temporizador en pausa")
  }, [])

  const reset = useCallback(() => {
    setRemainingMs(lastDurationRef.current)
    setStatus("idle")
    setFinished(false)
    setAnnouncement("Temporizador reiniciado")
  }, [])

  const repeat = useCallback(() => {
    endAtRef.current = Date.now() + totalMs
    setRemainingMs(totalMs)
    setStatus("running")
    setFinished(false)
    setAnnouncement(`Temporizador repetido: ${formatTimerLabel(totalMs)}`)
  }, [totalMs])

  // Cuenta regresiva por marcas de tiempo; el fin dispara aviso y pitido.
  useEffect(() => {
    if (status !== "running") return
    const tick = () => {
      const remaining = endAtRef.current - Date.now()
      if (remaining <= 0) {
        setRemainingMs(0)
        setStatus("idle")
        setFinished(true)
        navigator.vibrate?.([150, 100, 150, 100, 300])
        playFinishChime()
        return
      }
      setRemainingMs(remaining)
    }
    tick()
    const timer = window.setInterval(tick, TIMER_TICK_MS)
    return () => window.clearInterval(timer)
  }, [status])

  const canStart = remainingMs > 0 && !finished
  const canReset = status !== "idle" || finished || remainingMs !== totalMs
  const progressValue =
    totalMs > 0 ? Math.min(100, Math.max(0, (remainingMs / totalMs) * 100)) : 0

  return {
    status,
    finished,
    fields,
    totalMs,
    remainingMs,
    canStart,
    canReset,
    progressValue,
    setField,
    commitField,
    applyDuration,
    start,
    pause,
    reset,
    repeat,
    announcement,
  }
}

type TimerController = ReturnType<typeof useTimer>

function CronometroToolView({ stopwatch }: { stopwatch: StopwatchController }) {
  const { status, elapsedMs, laps, markers, canReset } = stopwatch
  return (
    <>
      <TimeDisplay
        label="Tiempo del cronómetro"
        caption={STATUS_CAPTION[status]}
      >
        {formatStopwatchMs(elapsedMs)}
      </TimeDisplay>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={stopwatch.reset}
          disabled={!canReset}
        >
          <RotateCcwIcon aria-hidden="true" />
          Reiniciar
        </Button>
        {status === "running" ? (
          <Button type="button" variant="secondary" size="lg" onClick={stopwatch.lap}>
            <FlagIcon aria-hidden="true" />
            Vuelta
          </Button>
        ) : null}
        <Button
          type="button"
          size="lg"
          className="ml-auto"
          onClick={status === "running" ? stopwatch.pause : stopwatch.start}
        >
          {status === "running" ? (
            <PauseIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
          {status === "running"
            ? "Pausar"
            : status === "paused"
              ? "Continuar"
              : "Iniciar"}
        </Button>
      </div>
      {laps.length > 0 ? (
        <div className="flex min-h-0 flex-col gap-1" aria-label="Vueltas registradas">
          <p className="text-muted-foreground text-xs font-medium">
            Vueltas ({laps.length})
          </p>
          <ul className="max-h-44 min-h-0 list-none overflow-y-auto [scrollbar-width:thin]">
            {laps.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  Vuelta {entry.id}
                  {entry.id === markers.fastestId ? (
                    <Badge variant="success-light" size="xs" radius="full">
                      Rápida
                    </Badge>
                  ) : entry.id === markers.slowestId ? (
                    <Badge variant="destructive-light" size="xs" radius="full">
                      Lenta
                    </Badge>
                  ) : null}
                </span>
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {formatStopwatchMs(entry.lapMs)}
                </span>
                <span className="text-muted-foreground w-24 text-right text-xs tabular-nums">
                  total {formatStopwatchMs(entry.totalMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p aria-live="polite" role="status" className="sr-only">
        {stopwatch.announcement}
      </p>
    </>
  )
}

function TemporizadorToolView({ timer }: { timer: TimerController }) {
  const { status, finished, fields, totalMs, remainingMs, canStart, canReset } =
    timer
  return (
    <>
      <TimeDisplay
        label="Tiempo restante del temporizador"
        caption={finished ? "Tiempo cumplido" : STATUS_CAPTION[status]}
        finished={finished}
      >
        {formatTimerMs(remainingMs)}
      </TimeDisplay>
      <Progress value={timer.progressValue} className="w-full" aria-label="Progreso del temporizador" />
      <div
        role="group"
        aria-label="Duración del temporizador"
        className="grid grid-cols-3 gap-2"
      >
        {(
          [
            { field: "hours" as TimerField, label: "Horas", inputId: "timer-horas" },
            { field: "minutes" as TimerField, label: "Minutos", inputId: "timer-minutos" },
            { field: "seconds" as TimerField, label: "Segundos", inputId: "timer-segundos" },
          ]
        ).map(({ field, label, inputId }) => (
          <div key={field} className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor={inputId}
              className="text-muted-foreground text-xs font-medium"
            >
              {label}
            </label>
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={0}
              max={TIMER_FIELD_MAX[field]}
              value={fields[field]}
              onChange={(event) => timer.setField(field, event.target.value)}
              onBlur={(event) => timer.commitField(field, event.target.value)}
              disabled={status === "running"}
              className="h-12 text-base"
            />
          </div>
        ))}
      </div>
      <div
        role="group"
        aria-label="Duraciones rápidas"
        className="flex flex-wrap items-center justify-center gap-2"
      >
        {TIMER_PRESET_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            type="button"
            variant="outline"
            size="lg"
            className="rounded-full"
            disabled={status === "running"}
            onClick={() => timer.applyDuration(minutes * 60_000)}
          >
            {minutes} min
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={timer.reset}
          disabled={!canReset}
        >
          <RotateCcwIcon aria-hidden="true" />
          Reiniciar
        </Button>
        <Button
          type="button"
          size="lg"
          className="ml-auto"
          disabled={!finished && status !== "running" && !canStart}
          onClick={
            finished
              ? timer.repeat
              : status === "running"
                ? timer.pause
                : timer.start
          }
        >
          {finished ? (
            <RepeatIcon aria-hidden="true" />
          ) : status === "running" ? (
            <PauseIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
          {finished
            ? "Repetir"
            : status === "running"
              ? "Pausar"
              : status === "paused"
                ? "Continuar"
                : "Iniciar"}
        </Button>
      </div>
      {totalMs === 0 ? (
        <p className="text-muted-foreground text-center text-xs" role="status">
          Elige una duración mayor a cero para iniciar.
        </p>
      ) : null}
      <p aria-live="polite" role="status" className="sr-only">
        {timer.announcement}
      </p>
      <p aria-live="assertive" role="alert" className="sr-only">
        {finished ? "¡Tiempo cumplido!" : ""}
      </p>
    </>
  )
}

const HELP_ID = "cronometro-ayuda"

/**
 * Herramienta Cronómetro: Card única con pestañas; cada herramienta conserva
 * su estado y los atajos de teclado quedan acotados al módulo.
 */
export function Cronometro() {
  const [tab, setTab] = useState<Tab>("cronometro")
  const stopwatch = useStopwatch()
  const timer = useTimer()

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target
    if (target instanceof Element && target.closest("input")) return
    // Con un botón enfocado, Espacio/Enter ya activan el botón.
    if (
      target instanceof Element &&
      target.closest("button") &&
      (event.key === " " || event.key === "Enter")
    ) {
      return
    }
    const key = event.key.toLowerCase()
    if (event.key === " ") {
      event.preventDefault()
      if (tab === "cronometro") {
        if (stopwatch.status === "running") {
          stopwatch.pause()
        } else {
          stopwatch.start()
        }
      } else if (timer.finished) {
        timer.repeat()
      } else if (timer.status === "running") {
        timer.pause()
      } else if (timer.canStart) {
        timer.start()
      }
      return
    }
    if (key === "v" && tab === "cronometro" && stopwatch.status === "running") {
      event.preventDefault()
      stopwatch.lap()
      return
    }
    if (key === "r") {
      const active = tab === "cronometro" ? stopwatch : timer
      if (active.canReset) {
        event.preventDefault()
        active.reset()
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full" onKeyDown={handleKeyDown}>
      <Card
        className="min-h-0 min-w-0 flex-1 ring-0"
        aria-describedby={HELP_ID}
      >
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab((value as Tab) ?? "cronometro")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="w-full" aria-label="Modo del cronómetro">
              <TabsTrigger value="cronometro">
                <TimerIcon aria-hidden="true" />
                Cronómetro
              </TabsTrigger>
              <TabsTrigger value="temporizador">
                <HourglassIcon aria-hidden="true" />
                Temporizador
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="cronometro"
              keepMounted
              className="flex min-h-0 flex-1 flex-col gap-3"
            >
              <CronometroToolView stopwatch={stopwatch} />
            </TabsContent>
            <TabsContent
              value="temporizador"
              keepMounted
              className="flex min-h-0 flex-1 flex-col gap-3"
            >
              <TemporizadorToolView timer={timer} />
            </TabsContent>
          </Tabs>
          <span id={HELP_ID} className="sr-only">
            Con el foco en el módulo también funcionan las teclas: Espacio
            inicia o pausa, V registra una vuelta y R reinicia la herramienta
            visible.
          </span>
        </CardContent>
      </Card>
    </div>
  )
}
