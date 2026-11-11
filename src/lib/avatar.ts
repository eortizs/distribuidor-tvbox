import type { CSSProperties } from "react"

/**
 * Helpers compartidos de avatar con iniciales: los usan las filas de
 * `/clientes`, `/modulos/paquetes-flujotv` y `/modulos/distribuidores`.
 */

/** Iniciales del avatar a partir del nombre de usuario. */
export function initials(userName: string): string {
  const parts = userName.trim().split(/[\s._-]+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? ""
  const second = parts[1]?.charAt(0) ?? parts[0]?.charAt(1) ?? ""
  return (first + second).toUpperCase()
}

/**
 * Paleta pastel para avatares de clientes, tomada de las paletas de
 * CreativeBooster (https://creativebooster.net/blogs/colors/pastel-color-palettes):
 * fondo pastel + tinta oscura del mismo tono para legibilidad de las iniciales.
 */
const PASTEL_AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: "#FFADAD", fg: "#7F2D2D" },
  { bg: "#FFD6A5", fg: "#7A4310" },
  { bg: "#FDFFB6", fg: "#66600F" },
  { bg: "#CAFFBF", fg: "#2C6B31" },
  { bg: "#9BF6FF", fg: "#0D5A66" },
  { bg: "#72DDF7", fg: "#0A4A66" },
  { bg: "#9FAFFF", fg: "#2B3A8C" },
  { bg: "#8093F1", fg: "#1F2A66" },
  { bg: "#D8BBFF", fg: "#5A3799" },
  { bg: "#FECCFF", fg: "#8A3B8A" },
  { bg: "#F7ADC3", fg: "#8C3358" },
  { bg: "#FFB8D9", fg: "#93346B" },
  { bg: "#FFCB97", fg: "#7F4A19" },
  { bg: "#8AF0BF", fg: "#14624A" },
  { bg: "#75DAD7", fg: "#0E5F5C" },
  { bg: "#B3E1F8", fg: "#1B5478" },
  { bg: "#E6CBF7", fg: "#66449E" },
  { bg: "#C2A9EF", fg: "#46338C" },
  { bg: "#EEC7AC", fg: "#6E4A2B" },
  { bg: "#B8C19C", fg: "#47522C" },
  { bg: "#BE9A98", fg: "#573B38" },
  { bg: "#ACF2C9", fg: "#17603F" },
  { bg: "#A1ECFF", fg: "#0E5666" },
  { bg: "#F09191", fg: "#6E2C2C" },
]

function hashPastelSeed(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** Estilo del avatar: par pastel estable para la semilla (id o nombre). */
export function pastelAvatarStyle(seed: string): CSSProperties {
  const { bg, fg } =
    PASTEL_AVATAR_PALETTE[hashPastelSeed(seed) % PASTEL_AVATAR_PALETTE.length]
  return { backgroundColor: bg, color: fg }
}
