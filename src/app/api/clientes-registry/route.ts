import { forbiddenResponse, requireApiUser } from "@/server/auth/api"
import { isBranchRole } from "@/server/auth/types"
import { createClient, listClients, type ClientScope } from "@/server/clientes/registry"

export const instant = false

/**
 * Registro local de clientes (Fase 3): CORE — solo tenants de negocio lo
 * usan (el legado gestiona clientes FlujoTV en /clientes). El listado es del
 * tenant (RLS) SEGMENTADO por perfil (fase 2, 2026-11-24): la sucursal solo
 * ve SUS clientes (dueño = quien lo crea); el propietario, todos. La alta
 * exige sesión.
 */
function scopeOf(userId: string, role: string): ClientScope {
  return { userId, branchScoped: isBranchRole(role) }
}

export async function GET(request: Request) {
  const user = await requireApiUser("core")
  if (!user) return forbiddenResponse()

  const params = new URL(request.url).searchParams
  const q = params.get("q")?.trim() || undefined
  const clients = await listClients(q, false, scopeOf(user.id, user.role))
  return Response.json({
    ok: true,
    data: clients.map((client) => ({
      id: client.id,
      name: client.name,
      whatsappPhone: client.whatsappPhone,
      notes: client.notes,
      status: client.status,
      ownerEmail: client.ownerEmail,
      linkCount: client.linkCount,
      createdAt: client.createdAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
    })),
  })
}

export async function POST(request: Request) {
  const user = await requireApiUser("core")
  if (!user) return forbiddenResponse()

  let body: { name?: unknown; whatsappPhone?: unknown; notes?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json(
      { ok: false, error: { code: "cuerpo_invalido", message: "JSON inválido" } },
      { status: 400 }
    )
  }

  try {
    const client = await createClient({
      name: String(body.name ?? ""),
      whatsappPhone: body.whatsappPhone == null ? null : String(body.whatsappPhone),
      notes: body.notes == null ? null : String(body.notes),
      createdBy: user.id,
    })
    return Response.json(
      {
        ok: true,
        data: {
          id: client.id,
          name: client.name,
          whatsappPhone: client.whatsappPhone,
          notes: client.notes,
          status: client.status,
          linkCount: client.linkCount,
          createdAt: client.createdAt.toISOString(),
          updatedAt: client.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    const code = (error as { code?: string }).code
    if (
      code === "nombre_invalido" ||
      code === "whatsapp_invalido" ||
      code === "notas_invalidas"
    ) {
      return Response.json(
        {
          ok: false,
          error: {
            code,
            message: error instanceof Error ? error.message : "Datos inválidos",
          },
        },
        { status: 422 }
      )
    }
    throw error
  }
}
