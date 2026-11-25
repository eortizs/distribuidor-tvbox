import { randomBytes, randomInt } from "node:crypto"

import {
  isAffiliateCode,
  isBannedAffiliateCode,
} from "@/lib/afiliados"
import { pool, withTransaction } from "@/server/db"
import { hashPassword } from "@/server/auth/password"
import { AppError } from "@/server/umejson/types"
import { runAsAffiliate, runAsPlatform } from "@/server/tenant/context"

/**
 * Repositorio del sistema de afiliados (plan speilink-afiliados §6.2).
 *
 * Contextos: las escrituras y las lecturas públicas (enlace del proxy,
 * puerta del registro) corren con `runAsPlatform` + `pool`; el PORTAL corre
 * con `runAsAffiliate` — su GUC propio y RLS: solo ve su fila y sus negocios
 * referidos. `systemPool` NO se toca. Sin caché: suspender surte efecto en
 * la siguiente petición (los enlaces impresos no mueren, pero se apagan al
 * instante).
 *
 * El código es inmutable y jamás se reutiliza (UNIQUE global, no solo entre
 * activos): los enlaces impresos no pueden cambiar de dueño.
 */

export interface AffiliateRow {
  id: string
  userId: string
  code: string
  status: "active" | "suspended"
  fullName: string
  clickCount: number
  suspendedAt: Date | null
  createdAt: Date
}

export interface AffiliateListItem extends AffiliateRow {
  email: string
  signupCount: number
}

export interface ReferredTenantRow {
  id: string
  slug: string
  name: string
  status: "active" | "suspended"
  createdAt: Date
}

export interface AffiliatePortalData {
  affiliate: AffiliateRow
  email: string
  referredTenants: ReferredTenantRow[]
}

/** 32 símbolos sin ambigüedad (el mismo alfabeto de los links de pago). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 4
/** Reintentos ante palabra vetada o colisión UNIQUE (probabilidad ínfima). */
const MAX_CODE_ATTEMPTS = 8

function generateAffiliateCode(): string {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    let code = ""
    for (let index = 0; index < CODE_LENGTH; index += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    }
    if (!isBannedAffiliateCode(code)) return code
  }
  // Improbable agotar los reintentos con una lista corta de vetadas; el
  // caller valida forma y UNIQUE de todos modos.
  return "9Z9Z"
}

function mapAffiliateRow(row: Record<string, unknown>): AffiliateRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    code: row.code as string,
    status: (row.status as AffiliateRow["status"]) ?? "active",
    fullName: row.full_name as string,
    clickCount: Number(row.click_count ?? 0),
    suspendedAt: (row.suspended_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === "23505"
}

// ---------------------------------------------------------------------------
// Lecturas públicas (proxy del enlace, puerta del registro): contexto
// plataforma sobre el pool de la app — los códigos son inmutables y la
// suspensión debe verse al instante, así que sin caché.
// ---------------------------------------------------------------------------

/** El afiliado ACTIVO por código; null si no existe o está suspendido. */
export async function findActiveAffiliateByCode(
  code: string
): Promise<AffiliateRow | null> {
  return runAsPlatform(async () => {
    const result = await pool.query(
      `SELECT id, user_id, code, status, full_name, click_count,
              suspended_at, created_at
         FROM affiliates
        WHERE code = $1 AND status = 'active'`,
      [code]
    )
    return result.rowCount ? mapAffiliateRow(result.rows[0]) : null
  })
}

/** Cualquier afiliado por código (colisión de códigos en el alta). */
export async function findAffiliateByCodeAnyStatus(
  code: string
): Promise<AffiliateRow | null> {
  return runAsPlatform(async () => {
    const result = await pool.query(
      `SELECT id, user_id, code, status, full_name, click_count,
              suspended_at, created_at
         FROM affiliates
        WHERE code = $1`,
      [code]
    )
    return result.rowCount ? mapAffiliateRow(result.rows[0]) : null
  })
}

/**
 * Fila del afiliado de UN usuario (bootstrap del portal: el guard ya validó
 * el rol `afiliado` de la sesión; la búsqueda va por SU user_id).
 */
export async function findAffiliateByUserId(
  userId: string
): Promise<AffiliateRow | null> {
  return runAsPlatform(async () => {
    const result = await pool.query(
      `SELECT id, user_id, code, status, full_name, click_count,
              suspended_at, created_at
         FROM affiliates
        WHERE user_id = $1`,
      [userId]
    )
    return result.rowCount ? mapAffiliateRow(result.rows[0]) : null
  })
}

/** Cuenta UN clic del enlace (primera apertura del navegador en la ventana). */
export async function incrementAffiliateClick(code: string): Promise<void> {
  await runAsPlatform(async () => {
    const result = await pool.query(
      `UPDATE affiliates
          SET click_count = click_count + 1
        WHERE code = $1 AND status = 'active'`,
      [code]
    )
    // Evidencia de escritura (el caller falla abierto; sin esta línea un
    // fallo silencioso dejaría el embudo en cero para siempre).
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "affiliate.click_counted",
        code,
        rowCount: result.rowCount,
      })
    )
  })
}

// ---------------------------------------------------------------------------
// Portal del afiliado: SU fila + sus negocios referidos bajo runAsAffiliate
// (RLS: no ve filas ajenas ni negocios de otros).
// ---------------------------------------------------------------------------

export async function getAffiliatePortalData(
  affiliateId: string
): Promise<AffiliatePortalData | null> {
  return runAsAffiliate(affiliateId, async () => {
    const affiliate = await pool.query(
      `SELECT id, user_id, code, status, full_name, click_count,
              suspended_at, created_at
         FROM affiliates
        WHERE id = $1`,
      [affiliateId]
    )
    if (!affiliate.rowCount) return null
    const email = await pool.query(
      "SELECT username FROM users WHERE id = $1",
      [affiliate.rows[0].user_id]
    )
    // RLS (tenants_affiliate_read): solo los referidos a ESTE afiliado.
    const tenants = await pool.query(
      `SELECT id, slug, name, status, created_at
         FROM tenants
        WHERE referred_by_affiliate_id = $1
        ORDER BY created_at DESC`,
      [affiliateId]
    )
    return {
      affiliate: mapAffiliateRow(affiliate.rows[0]),
      email: (email.rows[0]?.username as string | null) ?? "",
      referredTenants: tenants.rows.map((row) => ({
        id: row.id as string,
        slug: row.slug as string,
        name: row.name as string,
        status: (row.status as ReferredTenantRow["status"]) ?? "active",
        createdAt: row.created_at as Date,
      })),
    }
  })
}

export interface ReferredTenantWithOwner {
  id: string
  slug: string
  name: string
  status: "active" | "suspended"
  /** Correo del propietario del negocio; null si el alta quedó a medias. */
  ownerEmail: string | null
  createdAt: Date
}

/**
 * Negocios referidos del afiliado CON su propietario (§«Clientes» del host
 * de plataforma: los clientes del afiliado son los propietarios de los
 * negocios que llegaron con su enlace). Bajo runAsAffiliate: RLS acota la
 * lista a SU atribución.
 */
export async function listReferredTenantsWithOwner(
  affiliateId: string
): Promise<ReferredTenantWithOwner[]> {
  return runAsAffiliate(affiliateId, async () => {
    const result = await pool.query(
      `SELECT t.id, t.slug, t.name, t.status, t.created_at,
              owner.username AS owner_email
         FROM tenants t
         LEFT JOIN users owner
           ON owner.tenant_id = t.id AND owner.role = 'propietario'
        WHERE t.referred_by_affiliate_id = $1
        ORDER BY t.created_at DESC`,
      [affiliateId]
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      status: (row.status as ReferredTenantWithOwner["status"]) ?? "active",
      ownerEmail: (row.owner_email as string | null) ?? null,
      createdAt: row.created_at as Date,
    }))
  })
}

export interface ReferredTenantForPlatform {
  id: string
  slug: string
  name: string
  status: "active" | "suspended"
  affiliateCode: string
  affiliateName: string
  createdAt: Date
}

/**
 * Negocios REFERIDOS para «Clientes» de la cuenta PLATAFORMA (2026-11-24):
 * los clientes del admin son los clientes de los afiliados — los negocios
 * que llegaron con un enlace; el admin NO tiene clientes propios (los altos
 * directos sin afiliado viven solo en el módulo Tenants). Contexto
 * plataforma: ve todas las atribuciones.
 */
export async function listReferredTenantsForPlatform(): Promise<
  ReferredTenantForPlatform[]
> {
  return runAsPlatform(async () => {
    const result = await pool.query(
      `SELECT t.id, t.slug, t.name, t.status, t.created_at,
              a.code AS affiliate_code, a.full_name AS affiliate_name
         FROM tenants t
         JOIN affiliates a ON a.id = t.referred_by_affiliate_id
        ORDER BY t.created_at DESC`
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      status: (row.status as ReferredTenantForPlatform["status"]) ?? "active",
      affiliateCode: (row.affiliate_code as string) ?? "",
      affiliateName: (row.affiliate_name as string) ?? "",
      createdAt: row.created_at as Date,
    }))
  })
}

// ---------------------------------------------------------------------------
// Consola de plataforma: alta, estado, restablecer contraseña, listado.
// ---------------------------------------------------------------------------

export interface AffiliateConsoleListRow extends AffiliateListItem {
  configuredCount: number
}

/** Listado para la consola (contexto plataforma; la consola no usa RLS de afiliado). */
export async function listAffiliates(): Promise<AffiliateListItem[]> {
  return runAsPlatform(async () => {
    const result = await pool.query(
      `SELECT a.id, a.user_id, a.code, a.status, a.full_name, a.click_count,
              a.suspended_at, a.created_at,
              u.username AS email,
              (SELECT count(*)::int FROM tenants t
                WHERE t.referred_by_affiliate_id = a.id) AS signup_count
         FROM affiliates a
         JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC`
    )
    return result.rows.map((row) => ({
      ...mapAffiliateRow(row),
      email: (row.email as string | null) ?? "",
      signupCount: Number(row.signup_count ?? 0),
    }))
  })
}

export interface CreateAffiliateInput {
  fullName: string
  email: string
  /** Código personalizado opcional (el Admin lo escribe); forma + no vetado. */
  code?: string | null
  /** Quien lo da de alta (cuenta de plataforma de la consola). */
  createdBy?: string | null
}

export interface CreatedAffiliate {
  id: string
  userId: string
  code: string
  email: string
  /** Contraseña temporal en claro: la consola la muestra UNA vez. */
  temporaryPassword: string
}

/**
 * Alta de afiliado (solo Admin, §3 del plan): cuenta SIN tenant (rol
 * `afiliado`, sin entidad Cuenta) + fila del catálogo, ATÓMICOS. La
 * contraseña temporal se muestra una sola vez en la consola.
 */
export async function createAffiliate(
  input: CreateAffiliateInput
): Promise<CreatedAffiliate> {
  const fullName = input.fullName.trim().replace(/\s+/g, " ")
  const email = input.email.trim().toLowerCase()
  const requestedCode = input.code?.trim().toUpperCase() ?? ""

  if (fullName.length < 1 || fullName.length > 100) {
    throw new AppError(422, "nombre_invalido", "El nombre debe tener entre 1 y 100 caracteres.")
  }
  if (!EMAIL_RE.test(email)) {
    throw new AppError(422, "correo_invalido", "El correo del afiliado no es válido.")
  }
  if (requestedCode.length > 0) {
    if (!isAffiliateCode(requestedCode)) {
      throw new AppError(
        422,
        "codigo_invalido",
        "El código debe tener 4 caracteres (sin 0, 1, I ni O)."
      )
    }
    if (isBannedAffiliateCode(requestedCode)) {
      throw new AppError(422, "codigo_vetado", "Ese código no está disponible. Elige otro.")
    }
  }

  const temporaryPassword = randomBytes(9).toString("base64url")
  const passwordHash = await hashPassword(temporaryPassword)

  return runAsPlatform(async () => {
    // El código se acuña ANTES de la transacción (el generador reintenta por
    // vetadas; la colisión UNIQUE la resuelve el catch de la tx).
    let code = requestedCode
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      if (!code) code = generateAffiliateCode()
      if (!(await findAffiliateByCodeAnyStatus(code))) break
      if (requestedCode) {
        throw new AppError(409, "codigo_tomado", "Ese código ya está en uso. Elige otro.")
      }
      code = ""
    }
    const finalCode = code
    if (!isAffiliateCode(finalCode)) {
      throw new AppError(500, "codigo_agotado", "No se pudo generar un código libre.")
    }

    const affiliateId = crypto.randomUUID()
    const userId = crypto.randomUUID()

    try {
      await withTransaction(async (tx) => {
        // Cuenta sin tenant (tenant_id NULL explícito: el trigger no tiene
        // de dónde tomarlo bajo contexto de plataforma) y SIN entidad Cuenta.
        await tx.query(
          `INSERT INTO users (id, username, password_hash, role, tenant_id)
           VALUES ($1, $2, $3, 'afiliado', NULL)`,
          [userId, email, passwordHash]
        )
        await tx.query(
          `INSERT INTO affiliates (id, user_id, code, status, full_name, created_by)
           VALUES ($1, $2, $3, 'active', $4, $5)`,
          [affiliateId, userId, finalCode, fullName, input.createdBy ?? null]
        )
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = String((error as { constraint?: string }).constraint ?? "")
        if (constraint.includes("code")) {
          throw new AppError(409, "codigo_tomado", "Ese código ya está en uso. Elige otro.")
        }
        throw new AppError(
          409,
          "email_taken",
          `Ese correo ya está registrado en el panel (users.username es único global).`
        )
      }
      throw error
    }

    return {
      id: affiliateId,
      userId,
      code: finalCode,
      email,
      temporaryPassword,
    }
  })
}

/** Suspende o reactiva el enlace del afiliado (la atribución se conserva). */
export async function setAffiliateStatus(
  affiliateId: string,
  status: "active" | "suspended"
): Promise<void> {
  await runAsPlatform(async () => {
    const result = await pool.query(
      `UPDATE affiliates
          SET status = $2,
              suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [affiliateId, status]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError(404, "afiliado_no_encontrado", "El afiliado no existe.")
    }
  })
}

/** Restablece la contraseña del afiliado (temporal, una vez). */
export async function resetAffiliatePassword(affiliateId: string): Promise<string> {
  const temporaryPassword = randomBytes(9).toString("base64url")
  const passwordHash = await hashPassword(temporaryPassword)
  await runAsPlatform(async () => {
    const result = await pool.query(
      `UPDATE users
          SET password_hash = $2
        WHERE id = (SELECT user_id FROM affiliates WHERE id = $1)`,
      [affiliateId, passwordHash]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError(404, "afiliado_no_encontrado", "El afiliado no existe.")
    }
  })
  return temporaryPassword
}
