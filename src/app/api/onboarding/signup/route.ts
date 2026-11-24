import { NextResponse, connection, type NextRequest } from "next/server"

import { performBusinessSignup } from "@/server/onboarding/signup"

/**
 * Fallback del registro público (§4.1): la acción de servidor no llega si la
 * reescritura del apex falla; esta ruta POST es directa (el matcher del proxy
 * excluye /api). MISMO núcleo (performBusinessSignup): interruptor, topes,
 * honeypot, validación, alta atómica y ticket de entrega.
 */
export async function POST(request: NextRequest) {
  await connection()
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 })
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"

  const result = await performBusinessSignup(
    {
      businessName: String(body.businessName ?? ""),
      slug: String(body.slug ?? ""),
      fullName: String(body.fullName ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      legal: body.legal === true,
      website: String(body.website ?? ""),
    },
    ip
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }
  return NextResponse.json(
    { redirectUrl: result.redirectUrl },
    { headers: { "cache-control": "no-store" } }
  )
}
