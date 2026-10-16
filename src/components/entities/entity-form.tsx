"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/reui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { coerceValue } from "@/lib/coerce-value"
import { ENTITY_STATES, SENTINEL } from "@/server/umejson/types"

interface PropertyRow {
  key: string
  value: string
}

const initialStateOptions = [...ENTITY_STATES]

export function EntityForm() {
  const router = useRouter()
  const [entityName, setEntityName] = useState("")
  const [state, setState] = useState<string>("active")
  const [rows, setRows] = useState<PropertyRow[]>([{ key: "", value: "" }])
  const [documentation, setDocumentation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setRow = (index: number, patch: Partial<PropertyRow>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const trimmedName = entityName.trim()
    if (!trimmedName) {
      setError("entityName is required")
      return
    }

    const dynamicProperties: Record<string, unknown> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      if (key in dynamicProperties) {
        setError(`Duplicate property key: ${key}`)
        return
      }
      dynamicProperties[key] = coerceValue(row.value)
    }

    setSubmitting(true)
    try {
      const response = await fetch("/api/v1/ume-json/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: SENTINEL,
          entityName: trimmedName,
          dynamicProperties,
          lifecycle: {
            createdAt: SENTINEL,
            updatedAt: SENTINEL,
            version: 1,
          },
          state: {
            current: state,
            statusLog: [
              {
                status: state,
                timestamp: SENTINEL,
                reason: "Created from UI",
              },
            ],
          },
          markdownDocumentation:
            documentation.trim() ||
            `### ${trimmedName}\nCreated from the admin UI.`,
        }),
      })
      const json = (await response.json()) as {
        ok: boolean
        data?: { id: string }
        error?: { code: string; message: string }
      }
      if (!response.ok || !json.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${response.status})`)
        return
      }
      toast.success("Entity created")
      router.push(`/entities/${json.data.id}`)
    } catch {
      setError("Network error while creating the entity")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="entityName"
          className="text-sm font-medium"
        >
          entityName
        </label>
        <Input
          id="entityName"
          value={entityName}
          onChange={(event) => setEntityName(event.target.value)}
          placeholder="Cliente"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="state" className="text-sm font-medium">
          Initial state
        </label>
        <Select
          value={state}
          onValueChange={(value) => setState(value ?? "active")}
        >
          <SelectTrigger id="state" size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {initialStateOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">dynamicProperties</span>
          <Badge variant="outline" size="sm">
            id, lifecycle and timestamps are injected by the server
          </Badge>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(event) =>
                  setRow(index, { key: event.target.value })
                }
                placeholder="key"
                className="max-w-44"
                aria-label="Property key"
              />
              <Input
                value={row.value}
                onChange={(event) =>
                  setRow(index, { value: event.target.value })
                }
                placeholder="value (string, number, true/false, null)"
                aria-label="Property value"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setRows((prev) =>
                    prev.length > 1
                      ? prev.filter((_, i) => i !== index)
                      : prev
                  )
                }
                aria-label="Remove property"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setRows((prev) => [...prev, { key: "", value: "" }])}
        >
          <PlusIcon aria-hidden="true" />
          Add property
        </Button>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <label htmlFor="documentation" className="text-sm font-medium">
          markdownDocumentation
        </label>
        <Textarea
          id="documentation"
          value={documentation}
          onChange={(event) => setDocumentation(event.target.value)}
          placeholder="### Cliente - Ana"
          className="min-h-24"
        />
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Creating…" : "Create entity"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
