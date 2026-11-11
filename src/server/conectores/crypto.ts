import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

import { AppError } from "@/server/umejson/types"

/**
 * Cifrado en reposo de los tokens OAuth de los conectores. La clave se
 * deriva del secret de la app (que ya vive en el entorno) con scrypt y una
 * sal fija por versión del formato; los tokens nunca viajan al cliente ni
 * se registran en logs.
 *
 * Sin secret configurado el módulo falla cerrado: no se guardan tokens en
 * claro bajo ninguna circunstancia.
 */

const FORMATO = "v1"
const SCRYPT_SALT = "conectores-token-v1"

/**
 * Clave de cifrado derivada una sola vez por proceso: scryptSync es
 * costoso y la secret es constante mientras el servidor vive. `undefined`
 * = aún no derivada; `null` = no hay secret configurado (fallar cerrado).
 */
let claveCache: Buffer | null | undefined

function claveTokens(): Buffer | null {
  if (claveCache !== undefined) return claveCache
  const secret =
    process.env.CONECTORES_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  claveCache = secret ? scryptSync(secret, SCRYPT_SALT, 32) : null
  return claveCache
}

export function isTokensCryptoReady(): boolean {
  return claveTokens() !== null
}

/** Cifra un token: `v1.<iv>.<tag>.<ciphertext>` en base64url. */
export function cifrarToken(token: string): string {
  const key = claveTokens()
  if (!key) {
    throw new AppError(
      500,
      "conectores_crypto_missing",
      "No hay secret configurado para cifrar tokens de conectores"
    )
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    FORMATO,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

/** Descifra un token del formato propio; null si el secreto cambió o el dato no es válido. */
export function descifrarToken(almacenado: string | null): string | null {
  if (!almacenado) return null
  const parts = almacenado.split(".")
  if (parts.length !== 4 || parts[0] !== FORMATO) return null
  const key = claveTokens()
  if (!key) return null
  try {
    const iv = Buffer.from(parts[1], "base64url")
    const tag = Buffer.from(parts[2], "base64url")
    const ciphertext = Buffer.from(parts[3], "base64url")
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return null
  }
}

/** Comparación en tiempo constante para el estado anti-CSRF. */
export function compareConstante(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function crearEstadoAleatorio(): string {
  return randomBytes(32).toString("base64url")
}
