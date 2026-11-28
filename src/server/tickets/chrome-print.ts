import { existsSync, readdirSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"

/*
 * Captura HTML→PNG con el Chrome headless del VPS vía protocolo DevTools
 * (CDP). Para WhatsApp conviene IMAGEN (el chat muestra el ticket con su
 * branding de inmediato; un PDF solo muestra un icono), así que la pieza
 * usa `Page.captureScreenshot` con clip del tamaño EXACTO de la tarjeta y
 * escala 2x (840×2160) para que el texto quede nítido en el teléfono.
 *
 * Sin dependencias nuevas: el cliente CDP vive sobre el WebSocket nativo de
 * Node. El binario se resuelve del caché de navegadores de Playwright que ya
 * existe en la máquina (chrome-headless-shell es el flavor pensado para
 * capturar/imprimir) o de `TICKET_CHROME_BIN`.
 */

export interface ChromeCapturaOpciones {
  bin: string
  htmlPath: string
  /** Tamaño de la captura en px CSS (96 dpi). */
  anchoPx: number
  altoPx: number
  /** Escala de nitidez (2 = 2x por lado por defecto). */
  escala?: number
  timeoutMs?: number
}

const CDP_TIMEOUT_MS = 45_000
const DEVTOOLS_WAIT_MS = 15_000

export function esHeadlessShell(bin: string): boolean {
  return /headless[-_]shell/i.test(bin)
}

/** Localiza el binario Chrome headless disponible en esta máquina. */
export function resolverChromeBin(): string | null {
  const candidatos: string[] = []
  if (process.env.TICKET_CHROME_BIN) candidatos.push(process.env.TICKET_CHROME_BIN)
  // Caché de navegadores de Playwright: chrome-headless-shell (el flavor de
  // captura/impresión) primero, chromium completo después; versión más nueva
  // antes.
  const cacheDirs = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(homedir(), ".cache", "ms-playwright"),
    "/root/.cache/ms-playwright",
  ]
  for (const cacheDir of cacheDirs) {
    if (!cacheDir) continue
    try {
      const entradas = readdirSync(cacheDir)
        .filter((nombre) => /^(chromium|chromium_headless_shell)-\d+$/.test(nombre))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      for (const entrada of entradas) {
        if (entrada.startsWith("chromium_headless_shell")) {
          candidatos.push(path.join(cacheDir, entrada, "chrome-headless-shell-linux64", "chrome-headless-shell"))
          candidatos.push(path.join(cacheDir, entrada, "chrome-linux", "headless_shell"))
        } else {
          candidatos.push(path.join(cacheDir, entrada, "chrome-linux64", "chrome"))
          candidatos.push(path.join(cacheDir, entrada, "chrome-linux", "chrome"))
        }
      }
    } catch {
      // Cache inexistente: se intenta la siguiente.
    }
  }
  return candidatos.find((candidato) => candidato.length > 0 && existsSync(candidato)) ?? null
}

/** Un paso CDP con timeout propio. */
function conTimeout<T>(promesa: Promise<T>, ms: number, motivo: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(motivo)), ms)
    promesa.then(
      (valor) => { clearTimeout(timer); resolve(valor) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

/** Impresiones/capturas Chrome simultáneas permitidas en el proceso. Cada
 * shell pesa ~150-300 MB y todos los disparadores son detached (chequeo
 * inmediato, verificador, barrido, webhook, aprobaciones manuales): sin
 * tope, un burst de confirmaciones lanza N Chromes a la vez en el mismo
 * VPS. La entrega es background y el orden entre tickets no importa — cola
 * FIFO de espera. */
const CAPTURAS_SIMULTANEAS = 2
let capturasEnVuelo = 0
const capturasEsperando: Array<() => void> = []

async function conRanuraDeCaptura<T>(job: () => Promise<T>): Promise<T> {
  if (capturasEnVuelo >= CAPTURAS_SIMULTANEAS) {
    await new Promise<void>((res) => capturasEsperando.push(res))
  }
  capturasEnVuelo += 1
  try {
    return await job()
  } finally {
    capturasEnVuelo -= 1
    capturasEsperando.shift()?.()
  }
}

/**
 * Captura `htmlPath` como PNG con el binario dado: marco de tamaño EXACTO
 * (anchoPx×altoPx a 96 dpi) a la escala de nitidez dada, con fondos y
 * fuentes cargadas. Devuelve el buffer PNG. Lanza con motivo legible si el
 * binario, DevTools o la captura fallan. Acotado por el semáforo de
 * capturas simultáneas del módulo.
 */
export function capturarImagenConChrome(opciones: ChromeCapturaOpciones): Promise<Buffer> {
  return conRanuraDeCaptura(() => capturarImagenSinRanura(opciones))
}

async function capturarImagenSinRanura(opciones: ChromeCapturaOpciones): Promise<Buffer> {
  const timeoutTotal = opciones.timeoutMs ?? CDP_TIMEOUT_MS
  const args = [
    "--remote-debugging-port=0",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    ...(esHeadlessShell(opciones.bin) ? [] : ["--headless"]),
    "about:blank",
  ]
  const child = spawn(opciones.bin, args, { stdio: ["ignore", "ignore", "pipe"] })
  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-8000)
  })

  try {
    // 1. Espera la URL de DevTools que el binario imprime en stderr.
    const wsUrl = await conTimeout(
      new Promise<string>((resolve, reject) => {
        const revisar = () => {
          const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
          if (match) resolve(match[1])
        }
        revisar()
        child.stderr?.on("data", revisar)
        child.on("exit", (code) => reject(new Error(`ticket_chrome_salio:${code ?? "?"}`)))
      }),
      DEVTOOLS_WAIT_MS,
      "ticket_cdp_sin_devtools"
    )

    // 2. Sesión CDP aplanada sobre el WebSocket nativo de Node.
    const pngBase64 = await conTimeout(
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        let msgId = 0
        const pendientes = new Map<number, { res: (v: Record<string, unknown>) => void; rej: (e: Error) => void }>()
        let sessionId: string | null = null
        let alCargar: (() => void) | null = null

        const fallo = (error: Error) => {
          try { ws.close() } catch { /* ya cerrado */ }
          reject(error)
        }

        const enviar = (
          method: string,
          params: Record<string, unknown> = {},
          conSesion = true
        ): Promise<Record<string, unknown>> =>
          new Promise((res, rej) => {
            const id = ++msgId
            pendientes.set(id, { res, rej })
            ws.send(
              JSON.stringify({
                id,
                method,
                params,
                ...(conSesion && sessionId ? { sessionId } : {}),
              })
            )
          })

        ws.onerror = () => fallo(new Error("ticket_cdp_ws_error"))
        ws.onclose = () => fallo(new Error("ticket_cdp_ws_cerrado"))
        ws.onmessage = (evento) => {
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(String(evento.data))
          } catch {
            return
          }
          if (typeof msg.id === "number" && pendientes.has(msg.id)) {
            const pendiente = pendientes.get(msg.id)!
            pendientes.delete(msg.id)
            if (msg.error) pendiente.rej(new Error(`ticket_cdp_${String((msg.error as Record<string, unknown>).code ?? "error")}:${JSON.stringify(msg.error).slice(0, 200)}`))
            else pendiente.res((msg.result ?? {}) as Record<string, unknown>)
            return
          }
          if (msg.method === "Page.loadEventFired" && alCargar) alCargar()
        }

        ws.onopen = () => {
          void (async () => {
            try {
              const creado = await enviar("Target.createTarget", { url: "about:blank" }, false)
              const adjunto = await enviar("Target.attachToTarget", {
                targetId: creado.targetId,
                flatten: true,
              }, false)
              sessionId = String(adjunto.sessionId)
              await enviar("Page.enable")
              await enviar("Page.navigate", { url: `file://${opciones.htmlPath}` })
              await new Promise<void>((res) => { alCargar = res })
              // Fuentes web (Google Fonts): espera a que terminen de cargar
              // para que la captura salga con la tipografía del diseño.
              await new Promise((res) => setTimeout(res, 300))
              await enviar("Runtime.evaluate", {
                expression: "document.fonts.ready.then(() => document.fonts.status)",
                awaitPromise: true,
                returnByValue: true,
              }).catch(() => null)
              const captura = await enviar("Page.captureScreenshot", {
                format: "png",
                captureBeyondViewport: true,
                clip: {
                  x: 0,
                  y: 0,
                  width: opciones.anchoPx,
                  height: opciones.altoPx,
                  scale: opciones.escala ?? 2,
                },
              })
              const data = captura.data
              if (typeof data !== "string" || data.length < 100) {
                fallo(new Error("ticket_cdp_captura_vacia"))
                return
              }
              try { ws.close() } catch { /* ya cerrado */ }
              resolve(data)
            } catch (error) {
              fallo(error instanceof Error ? error : new Error(String(error)))
            }
          })()
        }
      }),
      timeoutTotal,
      "ticket_cdp_timeout"
    )

    return Buffer.from(pngBase64, "base64")
  } finally {
    child.kill("SIGKILL")
  }
}
