import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto"

const SCRYPT_N = 16384
const SCRYPT_r = 8
const SCRYPT_p = 1
const KEY_LENGTH = 64

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) =>
      error ? reject(error) : resolve(derivedKey)
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  })
  return `scrypt:${SCRYPT_N}:${SCRYPT_r}:${SCRYPT_p}:${salt.toString("base64")}:${hash.toString("base64")}`
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split(":")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [, n, r, p, saltB64, hashB64] = parts
  const salt = Buffer.from(saltB64, "base64")
  const expected = Buffer.from(hashB64, "base64")
  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return timingSafeEqual(actual, expected)
}
