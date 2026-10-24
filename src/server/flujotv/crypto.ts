import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto"

/**
 * Cifrado de la clave de la API de licencias.
 *
 * La clave se guarda en la base de datos del panel, así que viaja cifrada
 * (AES-256-GCM) y el material de cifrado sale del servidor: la variable
 * `FLUJO_ENCRYPTION_SECRET` si está definida, y si no la propia cadena de
 * conexión de la base de datos (que ya es un secreto del servidor y está en el
 * mismo dominio de confianza). Rotar ese secreto invalida las claves
 * guardadas: hay que volver a introducir la clave de la API.
 */

const ALGORITHM = "aes-256-gcm"
const SALT = "flujotv-api-key-v1"

let derivedKey: Buffer | null = null

function secretMaterial(): string {
  return (
    process.env.FLUJO_ENCRYPTION_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    ""
  )
}

/** Si hay con qué cifrar. Sin secreto no se puede guardar la clave. */
export function isEncryptionAvailable(): boolean {
  return secretMaterial().length > 0
}

function key(): Buffer {
  if (!derivedKey) {
    derivedKey = scryptSync(secretMaterial(), SALT, 32)
  }
  return derivedKey
}

/** Cifra un secreto y lo devuelve como `iv.tag.datos` en base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const data = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".")
}

/** Descifra un secreto; `null` si el payload no es válido o el secreto rotó. */
export function decryptSecret(payload: string): string | null {
  const parts = payload.split(".")
  if (parts.length !== 3) return null
  const [iv, tag, data] = parts
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key(),
      Buffer.from(iv, "base64")
    )
    decipher.setAuthTag(Buffer.from(tag, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return null
  }
}
