"use client"

/**
 * Pantalla Conectores (`/modulos/conectores`): catálogo de integraciones
 * por proveedor y conexiones del usuario. Cada conector del catálogo
 * (`src/lib/conectores.ts`) se pinta como una fila-card (`ConectorCard`):
 * cabecera con tile, título, proveedor y la acción arriba a la derecha, y
 * debajo las líneas de contexto a lo ancho. Estados:
 *
 * - Disponible y sin conexión: acción primaria «Conectar», que inicia el
 *   flujo OAuth del proveedor (redirección completa al consentimiento).
 * - Conectado: badge de estado, cuenta del proveedor y fecha de conexión;
 *   «Desconectar» (ghost destructivo) con confirmación en AlertDialog y
 *   DELETE a `/api/conectores/[connectorId]`.
 * - En error (el proveedor revocó o caducó el acceso): badge de error y
 *   acción primaria «Reconectar», que repite el flujo OAuth.
 * - Próximamente: fila informativa sin acción.
 *
 * El resultado del flujo OAuth llega por query (`conectado` o `error`) y
 * se muestra como Alert superior descartable; los tokens jamás llegan al
 * cliente.
 */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleXIcon,
  ExternalLinkIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  CONECTORES,
  findConector,
  type Conector,
  type ConexionPublica,
} from "@/lib/conectores"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { cn } from "cn"

export interface ConectorFlash {
  tipo: "conectado" | "error"
  conectorId?: string
  codigo?: string
}

interface ConectoresViewProps {
  /** Conexiones del usuario en forma pública; null si falló la lectura. */
  conexiones: ConexionPublica[] | null
  cargaFallida: boolean
  /** Resultado del flujo OAuth llegada por query. */
  flash: ConectorFlash | null
  /** OAuth de Google operativo en el servidor (credenciales y cifrado). */
  googleListo: boolean
}

const FLASH_ERRORES: Record<
  string,
  { title: string; description: string; variant: "info" | "warning" | "destructive" }
> = {
  google_cancelado: {
    title: "Conexión cancelada",
    description: "No se autorizó el acceso a la cuenta. Puedes intentarlo de nuevo.",
    variant: "info",
  },
  estado_invalido: {
    title: "El enlace de autorización expiró",
    description:
      "Es de un solo uso: vuelve a pulsar Conectar para iniciar el flujo otra vez.",
    variant: "warning",
  },
  conector_invalido: {
    title: "Conector no disponible",
    description: "Este conector no está activo en el catálogo.",
    variant: "destructive",
  },
  proveedor_no_configurado: {
    title: "El proveedor no está configurado",
    description:
      "El servidor no tiene las credenciales OAuth de este proveedor.",
    variant: "destructive",
  },
  sesion_requerida: {
    title: "Inicia sesión para conectar",
    description: "Tu sesión expiró durante el flujo de autorización.",
    variant: "warning",
  },
  google_fallo: {
    title: "No se pudo completar la conexión",
    description: "Google rechazó la autorización. Inténtalo de nuevo en unos segundos.",
    variant: "destructive",
  },
}

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(
    new Date(iso)
  )
}

/** Punto separador de segmentos en una línea de contexto. */
function Punto() {
  return (
    <span
      aria-hidden="true"
      className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
    />
  )
}

/**
 * Fila-card de conector, compartida por las tres variantes (conectado,
 * disponible y próximamente): cabecera con tile + título + proveedor y la
 * acción en la esquina superior derecha (`CardAction`); debajo, las líneas
 * de contexto a lo ancho de la tarjeta. Así el botón nunca compite por el
 * renglón con el correo ni la fecha, que en móvil son largos.
 */
function ConectorCard({
  conector,
  tenue = false,
  badge,
  accion,
  children,
}: {
  conector: Conector
  /** Conector no disponible todavía: tile atenuado. */
  tenue?: boolean
  badge?: React.ReactNode
  accion?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted [&_svg:not([class*='size-'])]:size-6",
              tenue ? "text-muted-foreground" : "text-foreground"
            )}
          >
            <conector.icon />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold tracking-tight">
                {conector.title}
              </span>
              {badge}
            </div>
            <span className="text-muted-foreground text-xs">
              {conector.proveedor}
            </span>
          </div>
        </div>
        {accion ? <CardAction>{accion}</CardAction> : null}
      </CardHeader>
      {children ? (
        <CardContent className="flex flex-col gap-1">{children}</CardContent>
      ) : null}
    </Card>
  )
}

export function ConectoresView({
  conexiones,
  cargaFallida,
  flash,
  googleListo,
}: ConectoresViewProps) {
  const router = useRouter()
  const [desconectando, setDesconectando] = useState<string | null>(null)
  const [confirmarDesconexion, setConfirmarDesconexion] = useState<
    string | null
  >(null)

  const porId = new Map(
    (conexiones ?? []).map((conexion) => [conexion.connectorId, conexion])
  )
  const conectados = CONECTORES.filter((conector) => porId.has(conector.id))
  const disponibles = CONECTORES.filter(
    (conector) => conector.estado === "disponible" && !porId.has(conector.id)
  )
  const proximamente = CONECTORES.filter(
    (conector) => conector.estado === "proximamente"
  )

  async function desconectar(connectorId: string) {
    const conector = findConector(connectorId)
    setDesconectando(connectorId)
    try {
      const response = await fetch(`/api/conectores/${connectorId}`, {
        method: "DELETE",
      })
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean }
        | null
      if (!response.ok || !json?.ok) {
        throw new Error(`disconnect_failed_${response.status}`)
      }
      toast.success(`${conector?.title ?? "El conector"} desconectado`)
      setConfirmarDesconexion(null)
      router.refresh()
    } catch {
      toast.error("No se pudo desconectar. Inténtalo de nuevo.")
    } finally {
      setDesconectando(null)
    }
  }

  const flashError = flash?.tipo === "error" ? FLASH_ERRORES[flash.codigo ?? ""] : null
  const flashConector = flash?.conectorId ? findConector(flash.conectorId) : null

  return (
    <div className="flex flex-1 flex-col gap-6">
      {flash && !cargaFallida ? (
        flash.tipo === "conectado" ? (
          <Alert variant="success">
            <CheckCircle2Icon aria-hidden="true" />
            <AlertTitle>
              {flashConector?.title ?? "Conector"} conectado
            </AlertTitle>
            <AlertDescription>
              <p>El acceso quedó guardado y listo para usarse.</p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant={flashError?.variant ?? "destructive"}>
            {flashError?.variant === "info" ? (
              <InfoIcon aria-hidden="true" />
            ) : flashError?.variant === "warning" ? (
              <TriangleAlertIcon aria-hidden="true" />
            ) : (
              <CircleXIcon aria-hidden="true" />
            )}
            <AlertTitle>{flashError?.title ?? "No se pudo conectar"}</AlertTitle>
            <AlertDescription>
              <p>{flashError?.description ?? "Inténtalo de nuevo más tarde."}</p>
            </AlertDescription>
          </Alert>
        )
      ) : null}

      {cargaFallida ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>No se pudieron cargar tus conexiones</AlertTitle>
          <AlertDescription>
            <p>Revisa tu conexión y vuelve a intentarlo.</p>
            <Button
              render={<Link href="/modulos/conectores" />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="self-start"
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {!googleListo && disponibles.length > 0 ? (
            <Alert variant="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Conexión con Google sin configurar</AlertTitle>
              <AlertDescription>
                <p>
                  El servidor no tiene credenciales OAuth de Google; pide a un
                  administrador que las active.
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          {conectados.length > 0 ? (
            <section aria-labelledby="conectores-tus" className="flex flex-col gap-3">
              <h2
                id="conectores-tus"
                className="text-sm font-semibold tracking-tight"
              >
                Tus conexiones
              </h2>
              <div className="flex flex-col gap-3">
                {conectados.map((conector) => {
                  const conexion = porId.get(conector.id)
                  if (!conexion) return null
                  const enError = conexion.status === "error"
                  return (
                    <ConectorCard
                      key={conector.id}
                      conector={conector}
                      badge={
                        enError ? (
                          <Badge variant="destructive-light">Error</Badge>
                        ) : (
                          <Badge variant="success-light">Conectado</Badge>
                        )
                      }
                      accion={
                        enError ? (
                          <Button
                            // Ancla plana, no <Link>: el inicio del flujo
                            // OAuth debe navegar como documento completo;
                            // el fetch RSC de Link sigue el 307 hacia
                            // Google y el navegador lo bloquea por CORS.
                            render={
                              <a href={`/api/conectores/conectar/${conector.id}`} />
                            }
                            nativeButton={false}
                            size="sm"
                          >
                            Reconectar
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setConfirmarDesconexion(conector.id)}
                            disabled={desconectando === conector.id}
                          >
                            {desconectando === conector.id
                              ? "Desconectando…"
                              : "Desconectar"}
                          </Button>
                        )
                      }
                    >
                      {enError ? (
                        <p className="text-muted-foreground text-xs">
                          El acceso caducó; reconecta para renovarlo.
                        </p>
                      ) : (
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="break-all">
                            {conexion.accountEmail ?? "Cuenta conectada"}
                          </span>
                          <Punto />
                          <span className="shrink-0 whitespace-nowrap">
                            desde {fechaCorta(conexion.connectedAt)}
                          </span>
                        </div>
                      )}
                      <p className="text-muted-foreground line-clamp-2 text-xs">
                        {conector.description}
                      </p>
                    </ConectorCard>
                  )
                })}
              </div>
            </section>
          ) : null}

          {disponibles.length > 0 ? (
            <section aria-labelledby="conectores-disponibles" className="flex flex-col gap-3">
              <h2
                id="conectores-disponibles"
                className="text-sm font-semibold tracking-tight"
              >
                Disponibles
              </h2>
              <div className="flex flex-col gap-3">
                {disponibles.map((conector) => (
                  <ConectorCard
                    key={conector.id}
                    conector={conector}
                    accion={
                      <Button
                        // Ancla plana, no <Link>: ver nota en Reconectar.
                        render={
                          <a href={`/api/conectores/conectar/${conector.id}`} />
                        }
                        nativeButton={false}
                        size="sm"
                        disabled={!googleListo}
                      >
                        <ExternalLinkIcon aria-hidden="true" />
                        Conectar
                      </Button>
                    }
                  >
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {conector.description}
                    </p>
                  </ConectorCard>
                ))}
              </div>
            </section>
          ) : null}

          {proximamente.length > 0 ? (
            <section aria-labelledby="conectores-proximamente" className="flex flex-col gap-3">
              <h2
                id="conectores-proximamente"
                className="text-sm font-semibold tracking-tight"
              >
                Próximamente
              </h2>
              <div className="flex flex-col gap-3">
                {proximamente.map((conector) => (
                  <ConectorCard
                    key={conector.id}
                    conector={conector}
                    tenue
                    badge={<Badge variant="outline">Próximamente</Badge>}
                  >
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {conector.description}
                    </p>
                  </ConectorCard>
                ))}
              </div>
            </section>
          ) : null}

          <p className="text-muted-foreground text-xs">
            Las conexiones son por usuario: los tokens se guardan cifrados y
            solo tu cuenta puede usarlos.
          </p>
        </>
      )}

      <AlertDialog
        open={confirmarDesconexion !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmarDesconexion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`¿Desconectar ${
                findConector(confirmarDesconexion ?? "")?.title ?? "el conector"
              }?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se revoca el acceso en el proveedor y se borra la conexión
              guardada. Los módulos que la usen dejarán de funcionar hasta
              que vuelvas a conectar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desconectando !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault()
                if (confirmarDesconexion) void desconectar(confirmarDesconexion)
              }}
              disabled={desconectando !== null}
            >
              {desconectando !== null ? "Desconectando…" : "Desconectar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
