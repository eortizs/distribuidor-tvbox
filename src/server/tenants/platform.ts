import { randomBytes } from "node:crypto"

import { withTransaction } from "@/server/db"
import {
  findTenantBySlug,
  findTenantById,
  invalidateTenantCache,
  runAsPlatform,
  runWithPlatformTenant,
} from "@/server/tenant/context"
import { isValidTenantSlug } from "@/server/tenant/hosts"
import { createAccount } from "@/server/auth/accounts"
import { ensureUserStorage } from "@/server/storage/user-files"
import { hashPassword } from "@/server/auth/password"
import { AppError } from "@/server/umejson/types"

/**
 * Repositorio de la CONSOLA DE PLATAFORMA (Fase 2, §2.4 del plan): altas y
 * ajustes de tenants corren bajo contexto de plataforma (los singletons
 * `tenants` solo se escriben con app.platform=on; `runWithPlatformTenant`
 * añade el GUC de tenant para las filas nuevas del tenant creado).
 */

export interface PlatformTenantRow {
  id: string
  slug: string
  name: string
  kind: "legacy" | "business"
  status: "active" | "suspended"
  modules: string[]
  whatsappNumber: string | null
  ownerEmail: string | null
  userCount: number
  /** Código del afiliado que trajo el negocio; null si llegó sin enlace. */
  affiliateCode: string | null
  createdAt: Date
}

/**
 * Lista de tenants con su propietario y conteo de cuentas (contexto
 * plataforma: ve todos los tenants y todos los usuarios).
 */
export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  // Lista cross-tenant: contexto de plataforma, sin tenant (§4.2).
  return runAsPlatform(async () =>
    withTransaction(async (tx) => {
      const result = await tx.query(
        `SELECT t.id, t.slug, t.name, t.kind, t.status, t.modules,
                t.whatsapp_number, t.created_at,
                owner.username AS owner_email,
                ref.code AS affiliate_code,
                (SELECT count(*)::int FROM users u2 WHERE u2.tenant_id = t.id) AS user_count
           FROM tenants t
           LEFT JOIN users owner
             ON owner.tenant_id = t.id AND owner.role = 'propietario'
           LEFT JOIN affiliates ref
             ON ref.id = t.referred_by_affiliate_id
          ORDER BY t.created_at`
      )
      return result.rows.map((row) => ({
        id: row.id as string,
        slug: row.slug as string,
        name: row.name as string,
        kind: row.kind as PlatformTenantRow["kind"],
        status: row.status as PlatformTenantRow["status"],
        modules: (row.modules as string[] | null) ?? [],
        whatsappNumber: (row.whatsapp_number as string | null) ?? null,
        ownerEmail: (row.owner_email as string | null) ?? null,
        userCount: Number(row.user_count ?? 0),
        affiliateCode: (row.affiliate_code as string | null) ?? null,
        createdAt: row.created_at as Date,
      }))
    })
  )
}

export interface CreateTenantInput {
  name: string
  slug: string
  ownerEmail: string
  /** Contraseña temporal del propietario; si falta se genera. */
  ownerPassword?: string
  /** Nombre completo del propietario (entidad Cuenta); opcional. */
  ownerFullName?: string
  /**
   * `sub` de Google verificado (alta pública del apex): cuenta SOLO-Google
   * (sin contraseña local) que entra por «Continuar con Google».
   */
  ownerGoogleSub?: string | null
  /**
   * Afiliado que trajo el negocio (plan speilink-afiliados §6.6): la
   * atribución se escribe en la MISMA transacción que el alta y es única y
   * para siempre. null/omitido = alta sin afiliado.
   */
  referredByAffiliateId?: string | null
}

export interface CreatedTenant {
  tenantId: string
  slug: string
  ownerEmail: string
  /** Id del propietario (ticket de entrega del registro, §4.2). */
  ownerId: string
  /** Contraseña temporal en claro: la consola la muestra UNA vez. */
  temporaryPassword: string
}

/**
 * Alta de tenant de negocio: catálogo + propietario, ATÓMICOS en una sola
 * transacción (el alta a medias dejaba un tenant sin dueño). El propietario
 * inicia sesión en su subdominio con la contraseña temporal.
 */
export async function createTenant(
  input: CreateTenantInput
): Promise<CreatedTenant> {
  const name = input.name.trim()
  const slug = input.slug.trim().toLowerCase()
  const email = input.ownerEmail.trim().toLowerCase()
  if (name.length < 1 || name.length > 80) {
    throw new AppError(422, "nombre_invalido", "El nombre debe tener entre 1 y 80 caracteres.")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(422, "correo_invalido", "El correo del propietario no es válido.")
  }
  if (!isValidTenantSlug(slug)) {
    throw new AppError(
      422,
      "slug_invalido",
      "El slug debe tener 3-30 caracteres (letras, dígitos y guiones), sin reservados."
    )
  }
  if (await findTenantBySlug(slug)) {
    throw new AppError(409, "slug_tomado", `El slug '${slug}' ya existe.`)
  }
  const googleOnly = Boolean(input.ownerGoogleSub)
  const temporaryPassword =
    input.ownerPassword ?? (googleOnly ? "" : randomBytes(9).toString("base64url"))
  const tenantId = crypto.randomUUID()

  const owner = await runWithPlatformTenant(tenantId, () =>
    withTransaction(async (tx) => {
      try {
        await tx.query(
          `INSERT INTO tenants (id, slug, name, kind, status, modules, use_platform_mp_account, referred_by_affiliate_id)
           VALUES ($1, $2, $3, 'business', 'active', ARRAY['core']::text[], false, $4)`,
          [
            tenantId,
            slug,
            name,
            input.referredByAffiliateId ?? null,
          ]
        )
        // El propietario y su entidad Cuenta viven en la MISMA transacción
        // (dual GUC): valida el documento umeJSON y crea el usuario con rol
        // propietario del tenant nuevo. Google-only: sin contraseña local
        // (entra por «Continuar con Google»), igual que el legado.
        return await createAccount(
          {
            email,
            password: googleOnly ? undefined : temporaryPassword,
            role: "propietario",
            tenantId,
            fullName: input.ownerFullName,
            googleSub: input.ownerGoogleSub ?? undefined,
            actor: "platform",
            source: "platform",
          },
          tx
        )
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          const constraint = String(
            (error as { constraint?: string }).constraint ?? ""
          )
          if (constraint.includes("tenants")) {
            throw new AppError(409, "slug_tomado", `El slug '${slug}' ya existe.`)
          }
          throw new AppError(
            409,
            "email_taken",
            `An account with email '${email}' already exists`
          )
        }
        throw error
      }
    })
  )

  // Tras el COMMIT (el almacenamiento no puede quedar dentro de la tx).
  await ensureUserStorage(owner.id).catch((error) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: `storage: ensure folder for ${owner.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    )
  })
  // El alta debe verse AL INSTANTE (canje del ticket y primer login del
  // dueño): sin invalidar, la cache de 30 s sirvió el «no existe» previo.
  invalidateTenantCache({ slug, id: tenantId })

  return {
    tenantId,
    slug,
    ownerEmail: email,
    ownerId: owner.id,
    temporaryPassword,
  }
}

/**
 * Suspende o reactiva un tenant. Suspendido ⇒ sus sesiones quedan rechazadas
 * al instante Y su socket WhatsApp se cierra (sin borrar su carpeta); al
 * reactivar vuelve a arrancar si hay número declarado.
 */
export async function setTenantStatus(
  tenantId: string,
  status: "active" | "suspended"
): Promise<void> {
  await withTransaction(async (tx) => {
    const result = await tx.query(
      `UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1 AND kind = 'business'`,
      [tenantId, status]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError(404, "tenant_no_encontrado", "El tenant no existe o no es de negocio.")
    }
  })
  invalidateTenantCache({ id: tenantId })
  try {
    const gateway = await import("@/server/whatsapp/gateway")
    if (status === "suspended") {
      await gateway.stopTenantSession(tenantId)
    } else {
      void gateway.startTenantSession(tenantId).catch(() => undefined)
    }
  } catch {
    // El gateway es best-effort: el cambio de estado ya quedó en BD.
  }
}

/** Restablece la contraseña del propietario de un tenant (temporal, una vez). */
export async function resetTenantOwnerPassword(
  tenantId: string
): Promise<string> {
  const tenant = await findTenantById(tenantId)
  if (!tenant) {
    throw new AppError(404, "tenant_no_encontrado", "El tenant no existe.")
  }
  const temporaryPassword = randomBytes(9).toString("base64url")
  const passwordHash = await hashPassword(temporaryPassword)
  await runWithPlatformTenant(tenantId, () =>
    withTransaction(async (tx) => {
      const owner = await tx.query(
        `SELECT id FROM users WHERE tenant_id = $1 AND role = 'propietario' LIMIT 1`,
        [tenantId]
      )
      if (!owner.rowCount) {
        throw new AppError(404, "owner_no_encontrado", "El tenant no tiene propietario.")
      }
      await tx.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
        owner.rows[0].id,
        passwordHash,
      ])
    })
  )
  return temporaryPassword
}
