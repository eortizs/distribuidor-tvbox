"use client"

import { useCallback, useMemo, useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  HashIcon,
  MonitorDownIcon,
  SmartphoneIcon,
  SlidersHorizontalIcon,
  TagIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { guardarFlujoAppCampoAction } from "@/app/actions/flujotv-app"
import { type FlujoAppCampo, type FlujoAppInfo } from "@/lib/flujotv-app"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"

interface FilaFlujoTv {
  id: string
  label: string
  value: string
  icon: LucideIcon
  campo: FlujoAppCampo
  /** Cuando existe, el valor se muestra además como enlace externo. */
  href?: string
}

type Borradores = Record<FlujoAppCampo, string>

const BORRADORES_VACIOS: Borradores = {
  version: "",
  downloaderCode: "",
  urlTv: "",
  urlCelular: "",
}

export function ActualizacionFlujoTv({
  inicial,
  puedeEditar,
  editarInicial = false,
}: {
  inicial: FlujoAppInfo
  puedeEditar: boolean
  editarInicial?: boolean
}) {
  const [datos, setDatos] = useState<FlujoAppInfo>(inicial)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  /** Edición global: al activarla, todos los campos pasan a editor a la vez. */
  const [editando, setEditando] = useState(editarInicial)
  const [borradores, setBorradores] = useState<Borradores>(() =>
    editarInicial
      ? {
          version: inicial.version,
          downloaderCode: inicial.downloaderCode,
          urlTv: inicial.urlTv,
          urlCelular: inicial.urlCelular,
        }
      : BORRADORES_VACIOS
  )
  const [guardandoCampo, setGuardandoCampo] = useState<FlujoAppCampo | null>(
    null
  )

  const info: FilaFlujoTv[] = useMemo(
    () => [
      {
        id: "version",
        label: "Versión",
        value: datos.version,
        icon: TagIcon,
        campo: "version",
      },
      {
        id: "codigo",
        label: "Código Downloader",
        value: datos.downloaderCode,
        icon: HashIcon,
        campo: "downloaderCode",
      },
    ],
    [datos]
  )

  const descargas: FilaFlujoTv[] = useMemo(
    () => [
      {
        id: "descarga-tv",
        label: "Descarga TV / Tablet / PC",
        value: datos.urlTv,
        href: datos.urlTv,
        icon: MonitorDownIcon,
        campo: "urlTv",
      },
      {
        id: "descarga-celular",
        label: "Descarga Celular",
        value: datos.urlCelular,
        href: datos.urlCelular,
        icon: SmartphoneIcon,
        campo: "urlCelular",
      },
    ],
    [datos]
  )

  /** Bloque completo tal como llega al portapapeles con «Copiar todo». */
  const textoCompleto = useMemo(
    () => [
      "FlujoTV",
      ...info.map((fila) => `${fila.label}: ${fila.value}`),
      ...descargas.map((fila) => `${fila.label}: ${fila.value}`),
    ].join("\n"),
    [info, descargas]
  )

  /**
   * Copia texto al portapapeles con feedback breve de CheckIcon: cada fila
   * manda su renglón completo (etiqueta incluida) y «Copiar todo» manda el
   * bloque entero, título incluido.
   */
  const copiar = useCallback((id: string, texto: string) => {
    navigator.clipboard
      .writeText(texto)
      .then(() => {
        setCopiedId(id)
        window.setTimeout(
          () => setCopiedId((actual) => (actual === id ? null : actual)),
          2000
        )
      })
      .catch(() => {
        toast.error("No se pudo copiar.")
      })
  }, [])

  const entrarEdicion = useCallback(() => {
    setBorradores({
      version: datos.version,
      downloaderCode: datos.downloaderCode,
      urlTv: datos.urlTv,
      urlCelular: datos.urlCelular,
    })
    setEditando(true)
  }, [datos])

  const terminarEdicion = useCallback(() => {
    setEditando(false)
    setBorradores(BORRADORES_VACIOS)
  }, [])

  /** Guarda un campo y repinta la tarjeta con el estado devuelto. */
  const guardarCampo = useCallback(
    async (campo: FlujoAppCampo) => {
      if (guardandoCampo) return
      setGuardandoCampo(campo)
      try {
        const nuevo = await guardarFlujoAppCampoAction(
          campo,
          borradores[campo]
        )
        setDatos(nuevo)
        setBorradores((actuales) => ({ ...actuales, [campo]: nuevo[campo] }))
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo guardar el cambio."
        )
      } finally {
        setGuardandoCampo(null)
      }
    },
    [borradores, guardandoCampo]
  )

  /** Descarta el borrador de un campo: vuelve al valor vigente. */
  const cancelarCampo = useCallback(
    (campo: FlujoAppCampo) => {
      setBorradores((actuales) => ({ ...actuales, [campo]: datos[campo] }))
    },
    [datos]
  )

  // El pseudo-elemento extiende el área táctil a 44 px (28 px + 8 px por lado) sin cambiar el tamaño visual.
  const botonCopiar = (fila: FilaFlujoTv) => {
    const copiado = copiedId === fila.id
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="relative shrink-0 after:content-[''] after:absolute after:-inset-2"
        onClick={() => copiar(fila.id, `${fila.label}: ${fila.value}`)}
        aria-label={`Copiar: ${fila.label}`}
      >
        {copiado ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
    )
  }

  /** Editor de un campo dentro del modo edición global. */
  const editorFila = (fila: FilaFlujoTv) => {
    const Icono = fila.icon
    const guardando = guardandoCampo === fila.campo
    return (
      <form
        key={fila.id}
        className="flex min-w-0 flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          void guardarCampo(fila.campo)
        }}
      >
        <span className="flex items-center gap-2.5">
          <Icono aria-hidden="true" className="size-5 shrink-0 opacity-60" />
          <span className="truncate text-muted-foreground">{fila.label}</span>
        </span>
        <span className="flex items-center gap-2">
          <Input
            value={borradores[fila.campo]}
            onChange={(event) =>
              setBorradores((actuales) => ({
                ...actuales,
                [fila.campo]: event.target.value,
              }))
            }
            disabled={guardando}
            aria-label={`Nuevo valor para ${fila.label}`}
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={guardando}
            aria-label={`Guardar ${fila.label}`}
          >
            {guardando ? (
              <Spinner className="size-4" />
            ) : (
              <CheckIcon aria-hidden="true" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={guardando}
            className="relative after:content-[''] after:absolute after:-inset-2"
            onClick={() => cancelarCampo(fila.campo)}
            aria-label={`Cancelar ${fila.label}`}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </span>
      </form>
    )
  }

  const renderFila = (fila: FilaFlujoTv) => {
    if (editando) return editorFila(fila)
    const Icono = fila.icon
    if (fila.href) {
      // Renglón de descarga: etiqueta en un solo renglón arriba y el enlace debajo.
      return (
        <div
          key={fila.id}
          className="flex items-center justify-between gap-2"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Icono aria-hidden="true" className="size-5 shrink-0 opacity-60" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-muted-foreground">
                {fila.label}
              </span>
              <a
                href={fila.href}
                target="_blank"
                rel="noreferrer"
                className="truncate text-base underline-offset-4 hover:underline"
              >
                Enlace directo
              </a>
            </span>
          </span>
          {botonCopiar(fila)}
        </div>
      )
    }
    return (
      <div key={fila.id} className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <Icono aria-hidden="true" className="size-5 shrink-0 opacity-60" />
          <span className="truncate text-muted-foreground">{fila.label}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-medium tabular-nums">
            {fila.value}
          </span>
          {botonCopiar(fila)}
        </span>
      </div>
    )
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">FlujoTV</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="px-4"
            onClick={() => copiar("todo", textoCompleto)}
            aria-label="Copiar toda la información de FlujoTV"
          >
            {copiedId === "todo" ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
            Copiar todo
          </Button>
          {puedeEditar ? (
            editando ? (
              <Button
                type="button"
                size="lg"
                className="px-4"
                onClick={terminarEdicion}
                aria-label="Terminar la edición de la información"
              >
                <CheckIcon aria-hidden="true" />
                Terminar
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="px-4"
                onClick={entrarEdicion}
                aria-label="Configurar la información de FlujoTV"
              >
                <SlidersHorizontalIcon aria-hidden="true" />
                Configurar
              </Button>
            )
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">{info.map(renderFila)}</div>
        <Separator />
        <div className="flex flex-col gap-2">{descargas.map(renderFila)}</div>
      </CardContent>
    </Card>
  )
}
