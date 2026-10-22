import { mkdir, readFile, stat, writeFile } from "node:fs/promises"

import sharp from "sharp"

import { pool } from "@/server/db"
import {
  FILE_VARIANTS,
  userFilePath,
  userFileVariantPath,
  userVariantStorageDir,
  type FileVariant,
  type UserFile,
} from "@/server/storage/user-files"

/**
 * Especificación de cada variante derivada: lado mayor (en píxeles) y calidad
 * de la codificación WebP.
 *
 * Los tamaños están pensados para el celular, que es donde se ven estas
 * imágenes: `thumb` es la miniatura de la galería (algo más grande que el
 * tile para que se vea nítida con DPR 2-3) y `low` es la imagen que se abre
 * al tocar el tile, que entra completa en la pantalla a máxima densidad del
 * dispositivo. El original se conserva intacto para la descarga.
 */
export const VARIANT_SPECS: Record<
  FileVariant,
  { maxDimension: number; quality: number }
> = {
  low: { maxDimension: 1280, quality: 78 },
  thumb: { maxDimension: 400, quality: 72 },
}

/** Las variantes se codifican siempre en WebP: pesa menos y decodifica rápido. */
export const VARIANT_MIME_TYPE = "image/webp"

const VARIANT_SUFFIX: Record<FileVariant, string> = {
  low: "baja",
  thumb: "miniatura",
}

export interface FileVariantRecord {
  fileId: string
  variant: FileVariant
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
}

/** Nombre con el que se descarga la variante (el original conserva el suyo). */
export function variantFileName(fileName: string, variant: FileVariant): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "imagen"
  return `${base}-${VARIANT_SUFFIX[variant]}.webp`
}

function mapVariantRow(row: Record<string, unknown>): FileVariantRecord {
  return {
    fileId: row.file_id as string,
    variant: row.variant as FileVariant,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Deriva una variante con sharp: corrige la orientación EXIF, reduce el lado
 * mayor al tope de la variante (sin ampliar) y codifica en WebP.
 */
async function deriveVariant(
  bytes: Uint8Array,
  variant: FileVariant
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const spec = VARIANT_SPECS[variant]
  const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
    .rotate()
    .resize({
      width: spec.maxDimension,
      height: spec.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: spec.quality, effort: 4 })
    .toBuffer({ resolveWithObject: true })
  return { bytes: data, width: info.width, height: info.height }
}

async function upsertVariantRow(
  fileId: string,
  variant: FileVariant,
  meta: { sizeBytes: number; width: number; height: number }
): Promise<FileVariantRecord> {
  const result = await pool.query(
    `INSERT INTO user_file_variants (file_id, variant, mime_type, size_bytes, width, height)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (file_id, variant) DO UPDATE
        SET mime_type = EXCLUDED.mime_type,
            size_bytes = EXCLUDED.size_bytes,
            width = EXCLUDED.width,
            height = EXCLUDED.height
     RETURNING file_id, variant, mime_type, size_bytes, width, height, created_at`,
    [
      fileId,
      variant,
      VARIANT_MIME_TYPE,
      meta.sizeBytes,
      meta.width,
      meta.height,
    ]
  )
  return mapVariantRow(result.rows[0])
}

/**
 * Deriva y guarda todas las variantes del archivo. Es best effort: si una
 * variante falla (formato no soportado, disco lleno) el original queda
 * intacto y la generación no se pierde.
 */
export async function saveImageVariants(
  file: UserFile,
  bytes: Uint8Array
): Promise<FileVariantRecord[]> {
  const saved: FileVariantRecord[] = []
  for (const variant of FILE_VARIANTS) {
    try {
      const derived = await deriveVariant(bytes, variant)
      await mkdir(userVariantStorageDir(file.userId, file.kind), {
        recursive: true,
      })
      await writeFile(userFileVariantPath(file, variant), derived.bytes)
      saved.push(
        await upsertVariantRow(file.id, variant, {
          sizeBytes: derived.bytes.byteLength,
          width: derived.width,
          height: derived.height,
        })
      )
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: variant ${variant} failed for file ${file.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
    }
  }
  return saved
}

export async function getFileVariant(
  fileId: string,
  variant: FileVariant
): Promise<FileVariantRecord | null> {
  const result = await pool.query(
    `SELECT file_id, variant, mime_type, size_bytes, width, height, created_at
       FROM user_file_variants
      WHERE file_id = $1 AND variant = $2`,
    [fileId, variant]
  )
  return result.rowCount ? mapVariantRow(result.rows[0]) : null
}

/**
 * Variantes ya derivadas de varios archivos, indexadas por id de archivo.
 * Si la tabla aún no existe (esquema sin aplicar) devuelve el mapa vacío:
 * la galería sigue funcionando con el original y las variantes se derivan
 * bajo demanda.
 */
export async function listFileVariants(
  fileIds: readonly string[]
): Promise<Map<string, Partial<Record<FileVariant, FileVariantRecord>>>> {
  const byFile = new Map<string, Partial<Record<FileVariant, FileVariantRecord>>>()
  if (fileIds.length === 0) return byFile
  try {
    const result = await pool.query(
      `SELECT file_id, variant, mime_type, size_bytes, width, height, created_at
         FROM user_file_variants
        WHERE file_id = ANY($1::uuid[])`,
      [[...fileIds]]
    )
    for (const row of result.rows as Record<string, unknown>[]) {
      const record = mapVariantRow(row)
      const current = byFile.get(record.fileId) ?? {}
      current[record.variant] = record
      byFile.set(record.fileId, current)
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `images: variant index unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    )
  }
  return byFile
}

/* Derivaciones en vuelo: la galería pide muchas variantes a la vez y la
 * misma variante no debe derivarse dos veces a la vez. */
const inFlight = new Map<string, Promise<FileVariantRecord | null>>()

function deriveOnce(
  key: string,
  run: () => Promise<FileVariantRecord | null>
): Promise<FileVariantRecord | null> {
  const pending = inFlight.get(key)
  if (pending) return pending
  const promise = run().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/**
 * Devuelve la variante del archivo, derivándola del original si todavía no
 * existe (o si su fichero se perdió). Es la ruta que usa el servidor cuando
 * alguien pide una imagen que todavía no tiene variantes.
 */
export async function ensureFileVariant(
  file: UserFile,
  variant: FileVariant
): Promise<FileVariantRecord | null> {
  const existing = await getFileVariant(file.id, variant).catch(() => null)
  if (existing && (await fileExists(userFileVariantPath(file, variant)))) {
    return existing
  }

  return deriveOnce(`${file.id}:${variant}`, async () => {
    let original: Buffer
    try {
      original = await readFile(userFilePath(file))
    } catch {
      return null
    }
    try {
      const derived = await deriveVariant(original, variant)
      await mkdir(userVariantStorageDir(file.userId, file.kind), {
        recursive: true,
      })
      await writeFile(userFileVariantPath(file, variant), derived.bytes)
      return await upsertVariantRow(file.id, variant, {
        sizeBytes: derived.bytes.byteLength,
        width: derived.width,
        height: derived.height,
      })
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          error: `images: variant ${variant} could not be derived for file ${file.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      )
      return null
    }
  })
}
