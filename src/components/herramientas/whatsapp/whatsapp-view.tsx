"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  QrCodeIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useTable, type ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { Badge } from "@/components/reui/badge"
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  WhatsAppLogRow,
  WhatsAppOutboxRow,
} from "@/server/whatsapp/service"
import type { WhatsAppStatusInfo } from "@/server/whatsapp/socket"

/*
 * Módulo admin del canal WhatsApp: estado del gateway, vinculación del
 * número del agente (QR o código de 8 dígitos), números registrados, cola
 * de salida con reintentos y bitácora de mensajes. Los datos iniciales
 * llegan servidos por la RSC; después se refrescan por sondeo ligero
 * (el bus SSE no tiene kind propio para WhatsApp: el volumen no lo amerita).
 */

interface RegisteredNumber {
  id: string
  username: string
  role: "admin" | "distribuidor"
  phone: string
}

const TZ = "America/Mexico_City"

const fechaHoraFmt = new Intl.DateTimeFormat("es-MX", {
  timeZone: TZ,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

function fmt(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : fechaHoraFmt.format(date)
}

const STATUS_META: Record<
  WhatsAppStatusInfo["status"],
  { label: string; variant: "success-light" | "info-light" | "warning-light" | "destructive-light" | "secondary" }
> = {
  open: { label: "Conectado", variant: "success-light" },
  connecting: { label: "Conectando…", variant: "info-light" },
  close: { label: "Desconectado", variant: "warning-light" },
  revoked: { label: "Sesión revocada", variant: "destructive-light" },
  disabled: { label: "Deshabilitado", variant: "secondary" },
}

const OUTBOX_STATUS_META: Record<
  WhatsAppOutboxRow["status"],
  { label: string; variant: "info-light" | "warning-light" | "success-light" | "destructive-light" }
> = {
  pending: { label: "Pendiente", variant: "info-light" },
  sending: { label: "Enviando", variant: "warning-light" },
  sent: { label: "Enviado", variant: "success-light" },
  failed: { label: "Fallido", variant: "destructive-light" },
}

export function WhatsAppView({
  initialStatus,
  agentNumber,
  llmConfigured,
  initialOutbox,
  initialLog,
  registered,
}: {
  initialStatus: WhatsAppStatusInfo
  /** Número completo del agente (solo admin); null si el módulo está sin config. */
  agentNumber: string | null
  llmConfigured: boolean
  initialOutbox: WhatsAppOutboxRow[]
  initialLog: WhatsAppLogRow[]
  registered: RegisteredNumber[]
}) {
  const [status, setStatus] = useState(initialStatus)
  const [outbox, setOutbox] = useState(initialOutbox)
  const [log, setLog] = useState(initialLog)
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [pairingBusy, setPairingBusy] = useState<"qr" | "code" | null>(null)
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /** Último estado conocido para anunciar la conexión solo al cambiar. */
  const statusRef = useRef<WhatsAppStatusInfo["status"]>(initialStatus.status)

  const fetchData = useCallback(async () => {
    setRefreshing(true)
    try {
      const [statusRes, outboxRes, logRes] = await Promise.all([
        fetch("/api/whatsapp/status", { cache: "no-store" }),
        fetch("/api/whatsapp/outbox", { cache: "no-store" }),
        fetch("/api/whatsapp/log?limit=50", { cache: "no-store" }),
      ])
      if (statusRes.ok) {
        const payload = (await statusRes.json()) as { data?: WhatsAppStatusInfo }
        if (payload.data) {
          if (payload.data.status === "open" && statusRef.current !== "open") {
            toast.success("WhatsApp conectado")
            setQr(null)
            setPairingCode(null)
          }
          statusRef.current = payload.data.status
          setStatus(payload.data)
        }
      }
      if (outboxRes.ok) {
        const payload = (await outboxRes.json()) as { data?: { items?: WhatsAppOutboxRow[] } }
        if (payload.data?.items) setOutbox(payload.data.items)
      }
      if (logRes.ok) {
        const payload = (await logRes.json()) as { data?: { items?: WhatsAppLogRow[] } }
        if (payload.data?.items) setLog(payload.data.items)
      }
    } catch {
      // Sondeo mejor esfuerzo: la vista reintenta en el siguiente ciclo.
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Sondeo ligero mientras la pestaña está visible; se pausa en segundo plano.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchData()
    }, 15_000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Durante vinculación, sondeo más rápido: estado, cola y el propio QR
  // (Baileys rota el string cada ~20 s; sin refresco, la imagen caduca).
  useEffect(() => {
    if (status.status !== "connecting" || !qr) return
    const interval = setInterval(async () => {
      try {
        const response = await fetch("/api/whatsapp/qr", { cache: "no-store" })
        const payload = (await response.json()) as {
          data?: { dataUrl?: string }
        }
        if (response.ok && payload.data?.dataUrl) setQr(payload.data.dataUrl)
      } catch {
        // El siguiente ciclo reintenta; el QR vigente sigue en el servidor.
      }
    }, 5_000)
    return () => clearInterval(interval)
  }, [status.status, qr])

  const showQr = async () => {
    setPairingBusy("qr")
    try {
      const response = await fetch("/api/whatsapp/qr", { cache: "no-store" })
      const payload = (await response.json()) as {
        ok?: boolean
        data?: { dataUrl?: string }
        error?: { message?: string }
      }
      if (response.ok && payload.data?.dataUrl) {
        setQr(payload.data.dataUrl)
      } else {
        toast.error(payload.error?.message ?? "No hay QR disponible.")
      }
    } catch {
      toast.error("No se pudo pedir el QR.")
    } finally {
      setPairingBusy(null)
    }
  }

  const requestCode = async () => {
    setPairingBusy("code")
    try {
      const response = await fetch("/api/whatsapp/pairing", { method: "POST" })
      const payload = (await response.json()) as {
        ok?: boolean
        data?: { code?: string }
        error?: { message?: string }
      }
      if (response.ok && payload.data?.code) {
        setPairingCode(payload.data.code)
        setQr(null)
      } else {
        toast.error(payload.error?.message ?? "No se pudo generar el código.")
      }
    } catch {
      toast.error("No se pudo generar el código.")
    } finally {
      setPairingBusy(null)
    }
  }

  const resetSession = async () => {
    setPairingBusy("qr")
    try {
      const response = await fetch("/api/whatsapp/reset", { method: "POST" })
      const payload = (await response.json()) as { error?: { message?: string } }
      if (response.ok) {
        toast.success("Sesión eliminada; genera un QR para vincular de nuevo.")
        await fetchData()
      } else {
        toast.error(payload.error?.message ?? "No se pudo reestablecer la sesión.")
      }
    } catch {
      toast.error("No se pudo reestablecer la sesión.")
    } finally {
      setPairingBusy(null)
    }
  }

  const retryItem = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/whatsapp/outbox/${id}/retry`, {
          method: "POST",
        })
        const payload = (await response.json()) as { error?: { message?: string } }
        if (response.ok) {
          toast.success("Envío reencolado.")
          await fetchData()
        } else {
          toast.error(payload.error?.message ?? "No se pudo reencolar.")
        }
      } catch {
        toast.error("No se pudo reencolar el envío.")
      }
    },
    [fetchData]
  )

  const copyCode = async () => {
    if (!pairingCode) return
    try {
      await navigator.clipboard.writeText(pairingCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("No se pudo copiar el código.")
    }
  }

  const outboxColumns = useMemo<
    ColumnDef<DataGridFeatures, WhatsAppOutboxRow>[]
  >(
    () => [
      {
        accessorKey: "createdAt",
        id: "createdAt",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Creado" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {fmt(row.original.createdAt)}
          </span>
        ),
        size: 120,
      },
      {
        accessorKey: "username",
        id: "username",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Usuario" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground text-xs font-medium">
            {row.original.username ?? "—"}
          </span>
        ),
        size: 200,
      },
      {
        accessorKey: "phone",
        id: "phone",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="WhatsApp" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {row.original.phone}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: "title",
        id: "title",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Mensaje" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-1 max-w-[220px] text-xs">
            {row.original.title}
          </span>
        ),
        size: 220,
      },
      {
        accessorKey: "status",
        id: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => {
          const meta = OUTBOX_STATUS_META[row.original.status]
          return (
            <Badge variant={meta.variant} size="sm">
              {meta.label}
            </Badge>
          )
        },
        size: 110,
      },
      {
        accessorKey: "attempts",
        id: "attempts",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Intentos" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {row.original.attempts}
          </span>
        ),
        size: 80,
      },
      {
        accessorKey: "lastError",
        id: "lastError",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Error" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-1 max-w-[180px] text-xs">
            {row.original.lastError ?? "—"}
          </span>
        ),
        size: 180,
      },
      {
        id: "actions",
        header: () => null,
        cell: ({ row }) =>
          row.original.status === "failed" || row.original.status === "sending" ? (
            <Button
              variant="ghost"
              size="sm"
              className="relative after:content-[''] after:absolute after:-inset-2"
              onClick={() => void retryItem(row.original.id)}
              aria-label="Reintentar envío"
            >
              <RotateCcwIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : null,
        size: 60,
      },
    ],
    [retryItem]
  )

  const logColumns = useMemo<
    ColumnDef<DataGridFeatures, WhatsAppLogRow>[]
  >(
    () => [
      {
        accessorKey: "createdAt",
        id: "createdAt",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Hora" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">
            {fmt(row.original.createdAt)}
          </span>
        ),
        size: 120,
      },
      {
        accessorKey: "direction",
        id: "direction",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Vía" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={row.original.direction === "in" ? "info-light" : "secondary"}
            size="sm"
          >
            {row.original.direction === "in" ? "Entrante" : "Saliente"}
          </Badge>
        ),
        size: 100,
      },
      {
        accessorKey: "username",
        id: "username",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Usuario" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground text-xs font-medium">
            {row.original.username ?? "—"}
          </span>
        ),
        size: 180,
      },
      {
        accessorKey: "text",
        id: "text",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title="Mensaje" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-2 max-w-[420px] whitespace-pre-wrap text-xs">
            {row.original.text}
          </span>
        ),
        size: 420,
      },
    ],
    []
  )

  const statusMeta = STATUS_META[status.status]
  const canPair = status.configured && status.status !== "open"

  const outboxTable = useTable({
    features: dataGridFeatures,
    columns: outboxColumns,
    data: outbox,
    getRowId: (row: WhatsAppOutboxRow) => row.id,
  })

  const logTable = useTable({
    features: dataGridFeatures,
    columns: logColumns,
    data: log,
    getRowId: (row: WhatsAppLogRow) => String(row.id),
  })

  return (
    <Frame spacing="default" className="w-full">
      <FrameHeader>
        <FrameTitle className="text-xl font-semibold">WhatsApp</FrameTitle>
        <FrameDescription>
          Espejo de las notificaciones del panel y agente de consultas por el
          número {agentNumber ? `+${agentNumber.replace(/^(\d{2})(\d+)$/, "+$1 $2")}` : "del agente IA"}.
        </FrameDescription>
      </FrameHeader>

      <FramePanel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
            {!status.configured ? (
              <Badge variant="secondary">Sin WHATSAPP_AGENT_NUMBER</Badge>
            ) : null}
            {!llmConfigured ? (
              <Badge variant="warning-light">Agente sin modelo</Badge>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchData()}
            disabled={refreshing}
          >
            <RefreshCwIcon
              className={refreshing ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            Actualizar
          </Button>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Agente</span>
            <span className="font-medium tabular-nums">
              {agentNumber ?? "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Sesión vinculada</span>
            <span className="font-medium">{fmt(status.pairedAt)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Último corte</span>
            <span className="font-medium">
              {fmt(status.lastDisconnectAt)}
              {status.lastDisconnectCode !== null
                ? ` (código ${status.lastDisconnectCode})`
                : ""}
            </span>
          </div>
        </div>
        {status.status === "revoked" ? (
          <Alert variant="destructive">
            <AlertTitle>Sesión revocada</AlertTitle>
            <AlertDescription>
              El dispositivo fue desvinculado desde el teléfono del agente.
              Reestablece la sesión y vincula de nuevo con QR o código.
            </AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void resetSession()}
              disabled={pairingBusy !== null}
            >
              Reestablecer sesión
            </Button>
          </Alert>
        ) : null}
      </FramePanel>

      <FramePanel>
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Vinculación</h2>
            <p className="text-muted-foreground text-sm">
              Vincula el número del agente como dispositivo enlazado. Solo se
              hace una vez: la sesión queda guardada y reconecta sola tras cada
              deploy.
            </p>
          </div>
          {status.status === "open" ? (
            <p className="text-muted-foreground text-sm">
              El número ya está vinculado y conectado. Para cambiarlo,
              desvincula el dispositivo desde el teléfono y espera el estado
              «Sesión revocada».
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <Button
                onClick={() => void showQr()}
                disabled={!canPair || pairingBusy !== null}
              >
                <QrCodeIcon className="size-4" aria-hidden="true" />
                {pairingBusy === "qr" ? "Cargando QR…" : "Mostrar QR"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void requestCode()}
                disabled={!canPair || pairingBusy !== null}
              >
                {pairingBusy === "code" ? "Generando…" : "Generar código de emparejamiento"}
              </Button>
            </div>
          )}
          {qr ? (
            <div className="flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt="Código QR de vinculación de WhatsApp"
                className="size-64 rounded-lg border"
              />
              <p className="text-muted-foreground text-sm">
                WhatsApp del número del agente → Ajustes → Dispositivos
                vinculados → Vincular un dispositivo. El QR se renueva solo;
                esta ventana se conecta al detectar el enlace.
              </p>
            </div>
          ) : null}
          {pairingCode ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  readOnly
                  value={pairingCode}
                  className="max-w-[180px] text-center font-mono text-base tracking-[0.3em]"
                  aria-label="Código de emparejamiento"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyCode()}
                  className="relative after:content-[''] after:absolute after:-inset-2"
                >
                  {copied ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <CopyIcon className="size-4" aria-hidden="true" />
                  )}
                  {copied ? "Copiado" : "Copiar"}
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">
                En el teléfono del agente: WhatsApp → Ajustes → Dispositivos
                vinculados → Vincular un dispositivo → «Vincular con número de
                teléfono», y teclea este código.
              </p>
            </div>
          ) : null}
        </div>
      </FramePanel>

      <FramePanel>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Números registrados</h2>
            <span className="text-muted-foreground text-sm">
              {registered.length} cuenta{registered.length === 1 ? "" : "s"} con WhatsApp
            </span>
          </div>
          {registered.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Ninguna cuenta tiene WhatsApp registrado todavía. Se captura en
              Usuarios (editar) o cada usuario desde su Perfil.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {registered.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 py-1"
                >
                  <span className="text-foreground text-sm font-medium">
                    {item.username}
                  </span>
                  <Badge
                    variant={item.role === "admin" ? "primary-light" : "info-light"}
                    size="xs"
                  >
                    {item.role}
                  </Badge>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {item.phone}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FramePanel>

      <FramePanel className="p-0">
        <div className="flex flex-col gap-1 px-(--frame-panel-px) pt-(--frame-panel-py)">
          <h2 className="text-lg font-semibold">Cola de salida</h2>
          <p className="text-muted-foreground text-sm pb-3">
            Envíos pendientes o fallidos del espejo de notificaciones. Se
            reintentan solos con backoff; un fallo queda aquí para reencolarlo.
          </p>
        </div>
        <DataGrid
          table={outboxTable}
          recordCount={outbox.length}
          tableLayout={{ dense: true }}
          emptyMessage="Sin envíos pendientes: todo salió."
        >
          <DataGridContainer>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
        </DataGrid>
      </FramePanel>

      <FramePanel className="p-0">
        <div className="flex flex-col gap-1 px-(--frame-panel-px) pt-(--frame-panel-py)">
          <h2 className="text-lg font-semibold">Bitácora</h2>
          <p className="text-muted-foreground text-sm pb-3">
            Últimos mensajes entrantes y salientes del canal (retención 90
            días).
          </p>
        </div>
        <DataGrid
          table={logTable}
          recordCount={log.length}
          tableLayout={{ dense: true }}
          emptyMessage="Sin mensajes todavía."
        >
          <DataGridContainer>
            <DataGridScrollArea>
              <DataGridTable />
            </DataGridScrollArea>
          </DataGridContainer>
        </DataGrid>
      </FramePanel>
    </Frame>
  )
}
