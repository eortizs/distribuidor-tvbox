"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeftIcon, FlaskConicalIcon, KeyRoundIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { FlujoStatus } from "@/lib/flujotv"

import { ClientesPanel } from "./clientes-panel"
import { ConsolaPanel } from "./consola-panel"
import { fetchFlujoStatus } from "./flujo-api"
import { FlujoStatusCard } from "./flujo-status-card"
import { LicenciasPanel } from "./licencias-panel"
import { RenovacionPanel } from "./renovacion-panel"

type LabTab = "clientes" | "licencias" | "renovacion" | "consola"

interface FlujoLabProps {
  /** Estado resuelto en el servidor: la primera pintura ya es real. */
  initialStatus: FlujoStatus | null
}

export function FlujoLab({ initialStatus }: FlujoLabProps) {
  const [tab, setTab] = useState<LabTab>("clientes")
  const [status, setStatus] = useState<FlujoStatus | null>(initialStatus)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [renewalTarget, setRenewalTarget] = useState("")
  const [reloadToken, setReloadToken] = useState(0)

  const loadStatus = useCallback(() => {
    fetchFlujoStatus()
      .then((next) => {
        setStatus(next)
        setStatusError(null)
      })
      .catch((error: unknown) => {
        setStatusError(
          error instanceof Error
            ? error.message
            : "No se pudo consultar el estado de la API."
        )
      })
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const goToRenewal = useCallback((userName: string) => {
    setRenewalTarget(userName)
    setTab("renovacion")
  }, [])

  const reloadTables = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const loading = status === null && statusError === null
  const configured = status?.configured === true

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/lab"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs transition-colors"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Laboratorio
        </Link>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold tracking-tight">API FlujoTV</h1>
          <p className="text-muted-foreground text-sm">
            Consulta las licencias de los clientes del panel, revisa su vigencia y
            ejecuta renovaciones sin salir del tablero.
          </p>
        </div>
      </div>

      <FlujoStatusCard
        status={status}
        error={statusError}
        onRefresh={loadStatus}
        onRefreshed={reloadTables}
      />

      {loading ? (
        <Card className="w-full">
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      ) : !configured ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>La API de FlujoTV no está configurada</EmptyTitle>
            <EmptyDescription>
              Define <span className="font-mono">FLUJO_API_KEY</span> (o{" "}
              <span className="font-mono">FLUJO_API_KEY_FILE</span> con la ruta
              a un fichero 0600) en el servidor y vuelve a cargar el estado.
              La clave se envía únicamente en el header{" "}
              <span className="font-mono">X-API-Key</span>.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={loadStatus}>
              Volver a comprobar
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab((value as LabTab) ?? "clientes")}
        >
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
            <TabsTrigger value="licencias">Historial</TabsTrigger>
            <TabsTrigger value="renovacion">Renovación</TabsTrigger>
            <TabsTrigger value="consola">Consola</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes" className="mt-4">
            <ClientesPanel
              reloadToken={reloadToken}
              onRenew={goToRenewal}
            />
          </TabsContent>

          <TabsContent value="licencias" className="mt-4">
            <LicenciasPanel reloadToken={reloadToken} />
          </TabsContent>

          <TabsContent value="renovacion" className="mt-4">
            <RenovacionPanel
              key={renewalTarget}
              target={renewalTarget}
              onRenewed={reloadTables}
            />
          </TabsContent>

          <TabsContent value="consola" className="mt-4">
            <ConsolaPanel baseUrl={status?.baseUrl ?? ""} />
          </TabsContent>
        </Tabs>
      )}

      {!loading && configured ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <FlaskConicalIcon aria-hidden="true" />
          Módulo de laboratorio: las llamadas se registran en el servidor con
          el usuario que las ejecuta.
        </p>
      ) : null}
    </div>
  )
}
