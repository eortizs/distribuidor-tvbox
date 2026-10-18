import { mkdir, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { pool } from "@/server/db"
import { AppError } from "@/server/umejson/types"

export const FILE_KINDS = ["attachment", "generated"] as const
export type FileKind = (typeof FILE_KINDS)[number]

export interface UserFile {
  id: string
  userId: string
  kind: FileKind
  fileName: string
  storedName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/
const MAX_FILE_NAME_LENGTH = 150
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function storageRoot(): string {
  return (
    process.env.USER_FILES_DIR ??
    path.join(process.cwd(), "storage", "users")
  )
}

export function maxUploadBytes(): number {
  const parsed = Number(process.env.USER_FILES_MAX_BYTES)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_UPLOAD_BYTES
}

export function isFileKind(value: unknown): value is FileKind {
  return (
    typeof value === "string" &&
    (FILE_KINDS as readonly string[]).includes(value)
  )
}

function requireValidUserId(userId: string): string {
  if (!UUID_RE.test(userId)) {
    throw new AppError(500, "invalid_user_id", "Invalid user id for storage")
  }
  return userId
}

function kindDirName(kind: FileKind): string {
  return kind === "attachment" ? "attachments" : "generated"
}

export function userStorageDir(userId: string, kind?: FileKind): string {
  requireValidUserId(userId)
  const userDir = path.join(/* turbopackIgnore: true */ storageRoot(), userId)
  return kind
    ? path.join(/* turbopackIgnore: true */ userDir, kindDirName(kind))
    : userDir
}

/** Creates the user's storage folders (idempotent). */
export async function ensureUserStorage(userId: string): Promise<string> {
  requireValidUserId(userId)
  const userDir = userStorageDir(userId)
  await mkdir(userStorageDir(userId, "attachment"), { recursive: true })
  await mkdir(userStorageDir(userId, "generated"), { recursive: true })
  return userDir
}

/** Removes the user's whole storage folder (used when an account is deleted). */
export async function removeUserStorage(userId: string): Promise<void> {
  requireValidUserId(userId)
  await rm(userStorageDir(userId), { recursive: true, force: true })
}

export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "file"
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
  if (!cleaned || cleaned === "." || cleaned === "..") return "file"
  return cleaned.length > MAX_FILE_NAME_LENGTH
    ? cleaned.slice(-MAX_FILE_NAME_LENGTH)
    : cleaned
}

function sanitizeMimeType(raw: string): string {
  return MIME_RE.test(raw) ? raw : "application/octet-stream"
}

function mapFileRow(row: Record<string, unknown>): UserFile {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: row.kind as FileKind,
    fileName: row.file_name as string,
    storedName: row.stored_name as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

export interface SaveUserFileInput {
  userId: string
  kind: FileKind
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export async function saveUserFile(
  input: SaveUserFileInput
): Promise<UserFile> {
  const userId = requireValidUserId(input.userId)
  if (input.bytes.byteLength === 0) {
    throw new AppError(422, "empty_file", "The file is empty")
  }
  if (input.bytes.byteLength > maxUploadBytes()) {
    throw new AppError(
      413,
      "file_too_large",
      `The file exceeds the ${maxUploadBytes()} byte limit`
    )
  }

  await ensureUserStorage(userId)
  const dir = userStorageDir(userId, input.kind)
  const fileName = sanitizeFileName(input.fileName)
  const storedName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fileName}`
  const target = path.join(dir, storedName)

  await writeFile(target, input.bytes)
  try {
    const result = await pool.query(
      `INSERT INTO user_files (id, user_id, kind, file_name, stored_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, kind, file_name, stored_name, mime_type, size_bytes, created_at`,
      [
        crypto.randomUUID(),
        userId,
        input.kind,
        fileName,
        storedName,
        sanitizeMimeType(input.mimeType),
        input.bytes.byteLength,
      ]
    )
    return mapFileRow(result.rows[0])
  } catch (error) {
    await unlink(target).catch(() => {})
    throw error
  }
}

export async function listUserFiles(
  userId: string,
  options: { kind?: FileKind; limit?: number; offset?: number } = {}
): Promise<{ files: UserFile[]; total: number }> {
  const values: unknown[] = [requireValidUserId(userId)]
  let where = "user_id = $1"
  if (options.kind) {
    values.push(options.kind)
    where += ` AND kind = $${values.length}`
  }
  const totalResult = await pool.query(
    `SELECT count(*)::int AS count FROM user_files WHERE ${where}`,
    values
  )
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const offset = Math.max(options.offset ?? 0, 0)
  const result = await pool.query(
    `SELECT id, user_id, kind, file_name, stored_name, mime_type, size_bytes, created_at
       FROM user_files
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  )
  return {
    files: result.rows.map(mapFileRow),
    total: Number(totalResult.rows[0].count),
  }
}

export async function getUserFile(
  userId: string,
  fileId: string
): Promise<UserFile | null> {
  if (!UUID_RE.test(fileId)) return null
  const result = await pool.query(
    `SELECT id, user_id, kind, file_name, stored_name, mime_type, size_bytes, created_at
       FROM user_files
      WHERE id = $1 AND user_id = $2`,
    [fileId, requireValidUserId(userId)]
  )
  return result.rowCount ? mapFileRow(result.rows[0]) : null
}

export function userFilePath(file: UserFile): string {
  return path.join(userStorageDir(file.userId, file.kind), file.storedName)
}

export async function deleteUserFile(
  userId: string,
  fileId: string
): Promise<boolean> {
  const file = await getUserFile(userId, fileId)
  if (!file) return false
  await pool.query("DELETE FROM user_files WHERE id = $1 AND user_id = $2", [
    fileId,
    requireValidUserId(userId),
  ])
  await unlink(userFilePath(file)).catch(() => {})
  return true
}
