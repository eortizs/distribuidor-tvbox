import { isOwnerRole } from "@/server/auth/types"
import type { AuthUser } from "@/server/auth/types"
import { getProfile } from "@/server/auth/profile"
import { transferBankDataOrNull } from "@/server/mercadopago/config"
import { pool } from "@/server/db"
import { getTenantBanking } from "@/server/tenants/business"

/*
 * Resolución de la cuenta receptora de una orden de pago: el dinero del
 * pagador va a la cuenta del CREADOR (es su cobro uno a uno), así que los
 * datos bancarios son los del perfil (Perfil → Datos bancarios:
 * `bankName`/`bankHolder`/`bankClabe` en la entidad Cuenta). El admin puede
 * caer al env `TRANSFER_*` (su propia cuenta de vendedor) si no llenó el
 * perfil; un distribuidor SIN datos completos no puede crear órdenes: caer
 * al env le enviaría SUS cobros a la cuenta del admin.
 */

export interface PaymentOrderBank {
  bank: string
  account: string
  holder: string
}

/**
 * Datos bancarios del creador para cobrar. Null = imposibilitado para
 * crear (el llamador responde el 422 con la indicación de completar el
 * Perfil o de configurar el env).
 */
export async function resolveCreatorBankData(
  user: AuthUser
): Promise<PaymentOrderBank | null> {
  const profile = await getProfile(user.id).catch(() => null)
  const bankName = profile?.account?.bankName?.trim() ?? ""
  const bankHolder = profile?.account?.bankHolder?.trim() ?? ""
  const bankClabe = profile?.account?.bankClabe?.trim() ?? ""
  if (bankName.length > 0 && bankHolder.length > 0 && bankClabe.length > 0) {
    return { bank: bankName, account: bankClabe, holder: bankHolder }
  }
  // Nivel negocio (Fase 3): los datos bancarios del tenant del creador.
  const tenantId = user.tenantId ?? (await tenantIdOf(user.id))
  if (tenantId) {
    const business = await getTenantBanking(tenantId)
    if (
      business &&
      (business.bankName ?? "").trim().length > 0 &&
      (business.bankHolder ?? "").trim().length > 0 &&
      (business.bankClabe ?? "").trim().length > 0
    ) {
      return {
        bank: (business.bankName ?? "").trim(),
        account: (business.bankClabe ?? "").trim(),
        holder: (business.bankHolder ?? "").trim(),
      }
    }
    // Nivel plataforma: SOLO si el negocio comparte la cuenta del `.env`
    // (use_platform_mp_account; el legado la tiene) y quien cobra es
    // propietario — la regla histórica del admin.
    const shares = await pool.query<{ shares: boolean }>(
      `SELECT use_platform_mp_account AS shares FROM tenants WHERE id = $1::uuid`,
      [tenantId]
    )
    if (shares.rows[0]?.shares === true && isOwnerRole(user.role)) {
      return transferBankDataOrNull()
    }
    return null
  }
  // Sin tenant resuelto (operación bajo contexto de plataforma/jobs): la
  // regla histórica del legado.
  if (isOwnerRole(user.role)) {
    return transferBankDataOrNull()
  }
  return null
}

/** Tenant de un usuario por id (contexto puede no estar resuelto aún). */
async function tenantIdOf(userId: string): Promise<string | null> {
  const result = await pool.query<{ tenant_id: string | null }>(
    `SELECT tenant_id FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId]
  )
  return result.rows[0]?.tenant_id ?? null
}
