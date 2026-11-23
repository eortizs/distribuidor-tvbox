import { isOwnerRole } from "@/server/auth/types"
import type { AuthUser } from "@/server/auth/types"
import { getProfile } from "@/server/auth/profile"
import { transferBankDataOrNull } from "@/server/mercadopago/config"

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
  if (isOwnerRole(user.role)) {
    return transferBankDataOrNull()
  }
  return null
}
