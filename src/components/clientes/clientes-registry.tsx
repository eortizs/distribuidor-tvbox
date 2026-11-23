"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Frame, FrameDescription, FrameHeader, FrameTitle } from "@/components/reui/frame"
import { useRealtimeEvent } from "@/hooks/use-realtime"
import { SearchIcon, Trash2Icon } from "lucide-react"

/**
 * Registro local de clientes de un tenant de negocio (Fase 3 §3.5): nombre,
 * WhatsApp y notas; sin vencimientos. Patrón de Notas (src/components/
 * herramientas/notas/notas.tsx): buscador con debounce y guardia de
 * secuencia, alta/edición en Sheet, archivado con confirmación y refresco
 * en vivo por el evento `clients` del bus.
 */

interface RegistryClient {
  id: string
  name: string
  whatsappPhone: string | null
  notes: string | null
  status: "active" | "archived"
  linkCount: number
  createdAt: string
}

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_MIN_CHARS = 2

const dateFormat = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "2-digit",
  month: "short",
  year: "numeric",
})

function waHref(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  return digits.length >= 8 ? `https://wa.me/${digits}` : null
}

export function ClientesRegistry() {
  const [clients, setClients] = useState<RegistryClient[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const loadSeqRef = useRef(0)

  const load = useCallback(async (query: string) => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      const response = await fetch(
        `/api/clientes-registry${query.length >= SEARCH_MIN_CHARS ? `?q=${encodeURIComponent(query)}` : ""}`
      )
      const payload = (await response.json()) as {
        ok: boolean
        data?: RegistryClient[]
      }
      if (!payload.ok || seq !== loadSeqRef.current) return
      setClients(payload.data ?? [])
    } catch {
      if (seq === loadSeqRef.current) {
        toast.error("No fue posible cargar los clientes")
      }
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  // Carga inicial + búsqueda con debounce (el timer mantiene el setState
  // fuera del cuerpo sincrónico del efecto: regla react-hooks/
  // set-state-in-effect).
  useEffect(() => {
    const trimmed = search.trim()
    const timer = setTimeout(() => void load(trimmed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, load])

  // Tiempo real: alta/edición/archivado desde otro dispositivo refresca.
  useRealtimeEvent(["clients"], () => {
    void load(search.trim())
  })

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<RegistryClient | null>(null)
  const [name, setName] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<RegistryClient | null>(null)

  const openCreate = () => {
    setEditing(null)
    setName("")
    setWhatsapp("")
    setNotes("")
    setEditorOpen(true)
  }

  const openEdit = (client: RegistryClient) => {
    setEditing(client)
    setName(client.name)
    setWhatsapp(client.whatsappPhone ?? "")
    setNotes(client.notes ?? "")
    setEditorOpen(true)
  }

  const handleSave = async () => {
    if (name.trim().length === 0) {
      toast.error("El nombre es obligatorio")
      return
    }
    setSaving(true)
    try {
      const body = JSON.stringify({
        name: name.trim(),
        whatsappPhone: whatsapp.trim().length > 0 ? whatsapp.trim() : null,
        notes: notes.length > 0 ? notes : null,
      })
      const response = editing
        ? await fetch(`/api/clientes-registry/${editing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body,
          })
        : await fetch("/api/clientes-registry", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
      const payload = (await response.json()) as { ok: boolean; error?: { message?: string } }
      if (!payload.ok) {
        toast.error(payload.error?.message ?? "No fue posible guardar")
        return
      }
      toast.success(editing ? "Cliente actualizado" : "Cliente creado")
      setEditorOpen(false)
      void load(search.trim())
    } catch {
      toast.error("No fue posible guardar el cliente")
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (client: RegistryClient) => {
    try {
      const response = await fetch(`/api/clientes-registry/${client.id}`, {
        method: "DELETE",
      })
      const payload = (await response.json()) as { ok: boolean }
      if (!payload.ok) {
        toast.error("No fue posible archivar")
        return
      }
      toast.success("Cliente archivado")
      setArchiveTarget(null)
      void load(search.trim())
    } catch {
      toast.error("No fue posible archivar el cliente")
    }
  }

  return (
    <Frame className="flex flex-1 flex-col gap-4">
      <FrameHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <FrameTitle>Clientes</FrameTitle>
          <FrameDescription>
            Tu registro de clientes: nombre, WhatsApp y notas. Asócialos a tus
            links de pago para llevar el control de cada cobro.
          </FrameDescription>
        </div>
        <Button type="button" onClick={openCreate}>
          Nuevo cliente
        </Button>
      </FrameHeader>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Búsqueda</CardTitle>
          <CardDescription className="text-sm">
            Por nombre o WhatsApp ({SEARCH_MIN_CHARS}+ caracteres).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InputGroup>
            <SearchIcon className="text-muted-foreground" />
            <InputGroupInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar clientes…"
              aria-label="Buscar clientes"
            />
          </InputGroup>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {loading && clients.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              Cargando…
            </CardContent>
          </Card>
        ) : clients.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center text-sm">
              {search.trim().length >= SEARCH_MIN_CHARS
                ? "Sin resultados para la búsqueda."
                : "Aún no tienes clientes. Crea el primero con «Nuevo cliente»."}
            </CardContent>
          </Card>
        ) : (
          clients.map((client) => {
            const href = waHref(client.whatsappPhone)
            return (
              <Card key={client.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{client.name}</span>
                      {client.linkCount > 0 ? (
                        <Badge variant="secondary" size="sm">
                          {client.linkCount} {client.linkCount === 1 ? "link" : "links"}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {client.whatsappPhone ?? "Sin WhatsApp"}
                    </div>
                    {client.notes ? (
                      <p className="text-muted-foreground line-clamp-2 text-xs">
                        {client.notes}
                      </p>
                    ) : null}
                    <div className="text-muted-foreground text-xs">
                      {dateFormat.format(new Date(client.createdAt))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {href ? (
                      <Button variant="outline" size="sm" render={<a href={href} target="_blank" rel="noopener noreferrer" />}>
                        WhatsApp
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => openEdit(client)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      aria-label={`Archivar ${client.name}`}
                      onClick={() => setArchiveTarget(client)}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Alta / edición */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
            <DialogDescription>
              El WhatsApp permite contactarlo directo desde la lista.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="client-name">Nombre</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="Doña Lupe"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="client-whatsapp">WhatsApp (opcional)</Label>
              <Input
                id="client-whatsapp"
                value={whatsapp}
                onChange={(event) => setWhatsapp(event.target.value)}
                inputMode="tel"
                maxLength={16}
                placeholder="52 55 1234 5678"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="client-notes">Notas (opcional)</Label>
              <Textarea
                id="client-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Qué compra, referencias, acuerdos…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de archivado */}
      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Archivar {archiveTarget?.name}?</DialogTitle>
            <DialogDescription>
              Deja de aparecer en la lista. Los links ya creados conservan el
              histórico. Puedes crear otro cliente con el mismo nombre.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (archiveTarget) void handleArchive(archiveTarget)
              }}
            >
              Archivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Frame>
  )
}
