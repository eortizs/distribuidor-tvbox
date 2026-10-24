"use client"

import { useState } from "react"
import {
  CircleCheckIcon,
  CircleXIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

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
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { FlujoStatus } from "@/lib/flujotv"

import { refreshFlujo } from "./flujo-api"

interface FlujoStatusCardProps {
  status: FlujoStatus | null
  error: string | null
  onRefresh: () => void
  /** Avisa al padre para que recargue las tablas. */
  onRefreshed: () => void
}

export function FlujoStatusCard({
  status,
  error,
  onRefresh,
  onRefreshed,
}: FlujoStatusCardProps) {
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function runRefresh() {
    setRefreshing(true)
    try {
      const result = await refreshFlujo("list_clients")
      toast.success("Panel de FlujoTV refrescado", {
        description: `HTTP ${result.status} en ${(result.durationMs / 1000).toFixed(1)} s.`,
      })
      onRefreshed()
    } catch (refreshError) {
      toast.error(
        refreshError instanceof Error
          ? refreshError.message
          : "No se pudo refrescar el panel."
      )
    } finally {
      setRefreshing(false)
      setRefreshOpen(false)
    }
  }

  const loading = status === null && error === null

  return (
    <Card className="w-full">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold tracking-tight">
              Estado de la conexión
            </h2>
            <p className="text-muted-foreground text-sm">
              La clave se resuelve en el servidor: nunca viaja al navegador.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCwIcon aria-hidden="true" />
              Actualizar estado
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!status?.configured}
              onClick={() => setRefreshOpen(true)}
            >
              <TriangleAlertIcon aria-hidden="true" />
              Refrescar panel
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Fact
              label="Servicio"
              badge={
                status?.configured ? (
                  <Badge variant="success-light" size="sm">
                    <CircleCheckIcon aria-hidden="true" />
                    Configurado
                  </Badge>
                ) : (
                  <Badge variant="warning-light" size="sm">
                    <TriangleAlertIcon aria-hidden="true" />
                    Sin clave
                  </Badge>
                )
              }
              value={status?.baseUrl ?? "—"}
              mono
            />
            <Fact
              label="Clave de API"
              badge={
                status?.keySource ? (
                  <Badge variant="info-light" size="sm">
                    {status.keySource === "ajustes"
                      ? "Ajustes del panel"
                      : status.keySource === "env"
                        ? "FLUJO_API_KEY"
                        : "FLUJO_API_KEY_FILE"}
                  </Badge>
                ) : (
                  <Badge variant="destructive-light" size="sm">
                    <CircleXIcon aria-hidden="true" />
                    Ausente
                  </Badge>
                )
              }
              value={
                status?.maskedKey ??
                "Actívala en Configuración → API de licencias"
              }
              mono
            />
            <Fact
              label="Salud del servicio"
              badge={
                status?.health.reachable ? (
                  <Badge variant="success-light" size="sm">
                    <CircleCheckIcon aria-hidden="true" />
                    {status.health.status ?? "ok"}
                  </Badge>
                ) : (
                  <Badge variant="destructive-light" size="sm">
                    <CircleXIcon aria-hidden="true" />
                    Sin respuesta
                  </Badge>
                )
              }
              value={
                status?.health.version
                  ? `Versión ${status.health.version}`
                  : (status?.health.error ?? "—")
              }
            />
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <CircleXIcon aria-hidden="true" />
            <AlertTitle>No se pudo consultar el estado</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Refrescar los clientes del panel?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta llamada dispara una sincronización real contra el panel de
              FlujoTV y tarda alrededor de 90 segundos. Se usa solo cuando los
              datos del panel están desactualizados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={refreshing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void runRefresh()
              }}
              disabled={refreshing}
            >
              {refreshing ? "Refrescando…" : "Refrescar ahora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function Fact({
  label,
  value,
  badge,
  mono = false,
}: {
  label: string
  value: string
  badge?: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        {badge}
      </div>
      <span
        className={`text-foreground truncate text-sm ${
          mono ? "font-mono text-xs" : ""
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
