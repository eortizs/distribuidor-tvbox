import { randomBytes } from "node:crypto"

import { withTransaction } from "@/server/db"
import { publishRealtime } from "@/server/realtime/bus"
import {
  findTenantBySlug,
  findTenantById,
  runAsPlatform,
  runWithPlatformTenant,
} from "@/server/tenant/context"
import { isValidTenantSlug } from "@/server/tenant/hosts"
import { insertUser } from "@/server/auth/users"
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
                (SELECT count(*)::int FROM users u2 WHERE u2.tenant_id = t.id) AS user_count
           FROM tenants t
           LEFT JOIN users owner
             ON owner.tenant_id = t.id AND owner.role = 'propietario'
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
}

export interface CreatedTenant {
  tenantId: string
  slug: string
  ownerEmail: string
  /** Contraseña temporal en claro: la consola la muestra UNA vez. */
  temporaryPassword: string
}

/**
 * Alta de tenant de negocio: catálogo + propietario, atómicos. El propietario
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
  const temporaryPassword = input.ownerPassword ?? randomBytes(9).toString("base64url")
  const passwordHash = await hashPassword(temporaryPassword)
  const tenantId = crypto.randomUUID()

  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, slug, name, kind, status, modules, use_platform_mp_account)
       VALUES ($1, $2, $3, 'business', 'active', ARRAY['core']::text[], false)`,
      [tenantId, slug, name]
    )
  })

  // El propietario y su entidad Cuenta viven en el tenant nuevo (dual GUC).
  await runWithPlatformTenant(tenantId, () =>
    withTransaction(async (tx) => {
      const user = await insertUser(
        {
          username: email,
          passwordHash,
          role: "propietario",
          tenantId,
        },
        tx
      )
      const doc = {
        id: user.id,
        entityName: "Cuenta",
        dynamicProperties: {
          email,
          userId: user.id,
          role: "propietario",
          distribuidorId: user.id,
          ...(input.ownerEmail ? {} : {}),
        },
        lifecycle: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        state: {
          current: "active",
          statusLog: [
            {
              status: "active",
              timestamp: new Date().toISOString(),
              reason: "Tenant owner created",
            },
          ],
        },
        markdownDocumentation: `### Cuenta — ${email}\nCuenta con perfil 'propietario'.`,
      }
      await tx.query(
        `INSERT INTO entities (id, entity_name, doc, version)
         VALUES ($1, 'Cuenta', $2::jsonb, 1)`,
        [crypto.randomUUID(), JSON.stringify(doc)]
      )
      await publishRealtime(tx, { kind: "users", entityId: user.id })
    })
  )

  return { tenantId, slug, ownerEmail: email, temporaryPassword }
}

/** Suspende o reactiva un tenant. Suspendido ⇒ sus sesiones quedan rechazadas. */
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
