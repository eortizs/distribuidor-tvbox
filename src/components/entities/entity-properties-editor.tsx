"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { coerceValue } from "@/lib/coerce-value"

interface PropertyRow {
  key: string
  value: string
}

function toEditableString(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

export function EntityPropertiesEditor({
  entityId,
  version,
  dynamicProperties,
}: {
  entityId: string
  version: number
  dynamicProperties: Record<string, unknown>
}) {
  const router = useRouter()
  const [rows, setRows] = useState<PropertyRow[]>(() =>
    Object.entries(dynamicProperties).map(([key, value]) => ({
      key,
      value: toEditableString(value),
    }))
  )
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRow = (index: number, patch: Partial<PropertyRow>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }

  const buildProperties = (): Record<string, unknown> | null => {
    const properties: Record<string, unknown> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      if (key in properties) {
        setError(`Duplicate property key: ${key}`)
        return null
      }
      properties[key] = coerceValue(row.value)
    }
    return properties
  }

  const handleSave = async () => {
    setError(null)
    setConflict(false)
    const properties = buildProperties()
    if (!properties) return

    setSaving(true)
    try {
      const response = await fetch(`/api/entities/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          dynamicProperties: properties,
          reason: "Edited from entity detail",
        }),
      })
      const json = (await response.json()) as {
        ok: boolean
        error?: { code: string; message: string }
      }
      if (response.status === 409) {
        setConflict(true)
        return
      }
      if (!response.ok || !json.ok) {
        setError(json.error?.message ?? `Request failed (${response.status})`)
        return
      }
      toast.success("Properties updated")
      router.refresh()
    } catch {
      setError("Network error while saving")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={row.key}
              onChange={(event) => setRow(index, { key: event.target.value })}
              placeholder="key"
              className="max-w-44"
              aria-label="Property key"
            />
            <Input
              value={row.value}
              onChange={(event) => setRow(index, { value: event.target.value })}
              placeholder="value"
              aria-label="Property value"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setRows((prev) =>
                  prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
                )
              }
              aria-label="Remove property"
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((prev) => [...prev, { key: "", value: "" }])}
        >
          <PlusIcon aria-hidden="true" />
          Add property
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {conflict ? (
        <Alert>
          <AlertTitle>Version conflict</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>
              The entity was modified elsewhere. Reload to get the latest
              version.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.refresh()}
            >
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
