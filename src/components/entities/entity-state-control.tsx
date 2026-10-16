"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const stateOptions = ["active", "draft", "validation_required"] as const

export function EntityStateControl({
  entityId,
  version,
  currentState,
}: {
  entityId: string
  version: number
  currentState: string
}) {
  const router = useRouter()
  const [target, setTarget] = useState<string>("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApply = async () => {
    if (!target) return
    setError(null)
    setConflict(false)
    setSaving(true)
    try {
      const response = await fetch(`/api/entities/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          state: target,
          reason: reason.trim() || undefined,
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
      toast.success(`State changed to ${target}`)
      setTarget("")
      setReason("")
      router.refresh()
    } catch {
      setError("Network error while changing state")
    } finally {
      setSaving(false)
    }
  }

  const available = stateOptions.filter((state) => state !== currentState)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={target} onValueChange={(value) => setTarget(value ?? "")}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue placeholder="New state" />
          </SelectTrigger>
          <SelectContent>
            {available.map((state) => (
              <SelectItem key={state} value={state}>
                {state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason"
          className="max-w-56"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleApply}
          disabled={saving || !target}
        >
          {saving ? "Applying…" : "Apply"}
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
