export function coerceValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "") return ""
  if (trimmed === "null") return null
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return raw
}
