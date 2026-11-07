"use server"

import { revalidatePath } from "next/cache"

import { getSessionUser } from "@/server/auth/session"
import { isSectionKey, setSectionPermissions } from "@/server/auth/permissions"
import { findUserById } from "@/server/auth/users"

export interface UpdatePermissionsState {
  error: string | null
  success: string | null
}

export async function updateUserPermissionsAction(
  _prev: UpdatePermissionsState,
  formData: FormData
): Promise<UpdatePermissionsState> {
  const session = await getSessionUser()
  if (!session || session.role !== "admin") {
    return { error: "Forbidden", success: null }
  }

  const userId = String(formData.get("userId") ?? "")
  const target = await findUserById(userId)
  if (!target) {
    return { error: "User not found", success: null }
  }

  const sections = formData
    .getAll("sections")
    .map((value) => String(value))
    .filter(isSectionKey)
  if (sections.length === 0) {
    return { error: "Deja al menos una sección visible", success: null }
  }

  await setSectionPermissions(userId, sections)

  revalidatePath("/users")
  return {
    error: null,
    success: `Permisos de '${target.username}' actualizados`,
  }
}
