"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createSession, destroySession } from "@/server/auth/session"
import { findUserByUsername, updateUser } from "@/server/auth/users"
import { createAccount } from "@/server/auth/accounts"
import { populateFullNameFromGoogle } from "@/server/auth/profile"
import {
  GOOGLE_LINK_COOKIE,
  googleLinkCookieOptions,
  verifyGoogleLinkToken,
} from "@/server/auth/google"
import {
  isValidEmail,
  normalizeEmail,
  type AuthUser,
} from "@/server/auth/types"
import { verifyPassword } from "@/server/auth/password"
import { AppError } from "@/server/umejson/types"
import {
  hostTenantIdForRequest,
  validateSessionHost,
} from "@/server/tenant/identity"
import { findTenantBySlug, setRequestContext } from "@/server/tenant/context"
import { resolveTenantHost } from "@/server/tenant/hosts"
import { requestHost } from "@/server/tenant/request-host"
import { systemPool } from "@/server/db"

export interface LoginState {
  error: string | null
}

export interface RegisterState {
  error: string | null
}

/**
 * Contexto de entrada para login/registro (§4.2, caso anónimo): el tenant
 * del HOST acota la búsqueda por correo. En el host de plataforma corre como
 * plataforma (ve todas las cuentas; solo las sin tenant pueden entrar).
 * Devuelve el host resuelto para los mensajes de error.
 */
async function establishEntryContext(): Promise<{
  hostKind: ReturnType<typeof resolveTenantHost>["kind"]
  tenantId: string | null
  suspended: boolean
}> {
  const host = await requestHost()
  const resolved = resolveTenantHost(host)

  if (resolved.kind === "platform") {
    setRequestContext({ tenantId: null, platform: true, source: "host" })
    return { hostKind: "platform", tenantId: null, suspended: false }
  }

  if (resolved.kind === "tenant") {
    const tenant = await findTenantBySlug(resolved.slug)
    if (!tenant) {
      // Slug inexistente: contexto imposible (todo falla cerrado).
      return { hostKind: "unknown", tenantId: null, suspended: false }
    }
    if (tenant.status !== "active") {
      return { hostKind: "tenant", tenantId: null, suspended: true }
    }
    setRequestContext({ tenantId: tenant.id, platform: false, source: "host" })
    return { hostKind: "tenant", tenantId: tenant.id, suspended: false }
  }

  if (resolved.kind === "legacy") {
    const tenantId = await hostTenantIdForRequest(host)
    if (tenantId) {
      setRequestContext({ tenantId, platform: false, source: "host" })
    }
    return { hostKind: "legacy", tenantId, suspended: false }
  }

  return { hostKind: resolved.kind, tenantId: null, suspended: false }
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = normalizeEmail(String(formData.get("username") ?? ""))
  const password = String(formData.get("password") ?? "")

  if (!email || !password) {
    return { error: "El correo y la contraseña son obligatorios" }
  }
  if (!isValidEmail(email)) {
    return { error: "Ingresa un correo electrónico válido" }
  }

  const entry = await establishEntryContext()
  if (entry.hostKind === "unknown") {
    return { error: "Este dominio no corresponde a ningún panel." }
  }
  if (entry.suspended) {
    return { error: "Esta cuenta de negocio está suspendida. Contacta a soporte." }
  }

  const user = await findUserByUsername(email)
  if (
    !user ||
    !user.passwordHash ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    return { error: "Credenciales incorrectas" }
  }

  // Host ↔ cuenta: en el host de plataforma solo entran cuentas de
  // plataforma; en un host de tenant, solo cuentas de ese tenant (la
  // búsqueda ya llegó filtrada por RLS; esto cubre el host de plataforma).
  const tenantIdOfUser = await resolveUserTenantId(user.id)
  if (!validateSessionHost(tenantIdOfUser, await requestHost())) {
    return { error: "Esta cuenta pertenece a otro panel." }
  }

  // Vínculo pendiente de Google: la contraseña acaba de probar que el que
  // inicia sesión es el dueño de la cuenta, así que el sub (con su foto y
  // nombre) puede enlazarse.
  const cookieStore = await cookies()
  const linkToken = verifyGoogleLinkToken(
    cookieStore.get(GOOGLE_LINK_COOKIE)?.value,
    user.username
  )
  if (linkToken && !user.googleSub) {
    await updateUser(user.id, {
      googleSub: linkToken.sub,
      // undefined = sin cambio: la foto solo se escribe si el token la trae.
      googlePicture: linkToken.picture ?? undefined,
    })
    if (linkToken.name) {
      // Solo rellena fullName si está vacío; nunca pisa ediciones manuales.
      await populateFullNameFromGoogle(user.id, linkToken.name, user.username)
    }
  }
  if (cookieStore.get(GOOGLE_LINK_COOKIE)) {
    cookieStore.set(GOOGLE_LINK_COOKIE, "", {
      ...googleLinkCookieOptions(),
      maxAge: 0,
    })
  }

  await createSession({
    id: user.id,
    username: user.username,
    role: user.role,
    tenantId: tenantIdOfUser,
  })

  redirect("/clientes")
}

/** Tenant del usuario por id (systemPool: no depende del contexto actual). */
async function resolveUserTenantId(userId: string): Promise<string | null> {
  const result = await systemPool.query(
    "SELECT tenant_id FROM users WHERE id = $1",
    [userId]
  )
  return (result.rows[0]?.tenant_id as string | null) ?? null
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""))
  const password = String(formData.get("password") ?? "")
  const confirmPassword = String(formData.get("confirmPassword") ?? "")

  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address" }
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  // El registro local SOLO existe en el host legado (§4.5): en hosts de
  // tenant/plataforma la página ya está bloqueada; la acción se defiende.
  const entry = await establishEntryContext()
  if (entry.hostKind !== "legacy") {
    return { error: "El registro no está disponible en este dominio." }
  }
  if (!entry.tenantId) {
    return { error: "No fue posible resolver el dominio de registro." }
  }

  let user: AuthUser
  let userTenantId: string | null = null
  try {
    user = await createAccount({
      email,
      password,
      tenantId: entry.tenantId,
    })
    userTenantId = entry.tenantId
  } catch (error) {
    if (error instanceof AppError && error.code === "email_taken") {
      return { error: "An account with this email already exists" }
    }
    throw error
  }

  await createSession({
    id: user.id,
    username: user.username,
    role: user.role,
    tenantId: userTenantId,
  })

  redirect("/clientes")
}

export async function logoutAction(): Promise<void> {
  await destroySession()
  redirect("/login")
}
