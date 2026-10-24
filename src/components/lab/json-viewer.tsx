"use client"

import { useMemo } from "react"

interface JsonViewerProps {
  value: unknown
  className?: string
}

/**
 * Volcado JSON legible. Es una zona de lectura, no un panel: sin radio ni
 * sombra, solo el borde del contenedor que lo envuelve.
 */
export function JsonViewer({ value, className }: JsonViewerProps) {
  const text = useMemo(() => {
    if (value === undefined) return ""
    try {
      return JSON.stringify(value, null, 2) ?? String(value)
    } catch {
      return String(value)
    }
  }, [value])

  if (text.length === 0) {
    return (
      <p className={className ?? "text-muted-foreground text-xs"}>
        La respuesta no tiene cuerpo.
      </p>
    )
  }

  return (
    <pre
      className={`bg-muted/40 overflow-auto p-3 font-mono text-xs leading-relaxed ${
        className ?? ""
      }`}
    >
      {text}
    </pre>
  )
}
