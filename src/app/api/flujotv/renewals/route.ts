import { requireApiUser, unauthorizedResponse } from "@/server/auth/api"
import { flujoErrorResponse } from "@/server/flujotv/http"
import { getFlujoClient, renewFlujoLicense } from "@/server/flujotv/service"
import {
  isFlujoClientInScope,
  resolveClientScope,
} from "@/server/flujotv/scope"
import { readJsonBody } from "@/server/http"
import { isRenewalMonths } from "@/lib/flujotv"

/** 1 a 200 caracteres imprimibles (ASCII imprimible). */
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{1,200}$/

interface RenewalBody {
  user_name?: unknown
  months?: unknown
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser()
    if (!user) return unauthorizedResponse()

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? ""
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message:
              "Falta el header Idempotency-Key o no es válido (1 a 200 caracteres imprimibles).",
          },
        },
        { status: 422 }
      )
    }

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    const body = parsed.body as RenewalBody
    const userName =
      typeof body.user_name === "string" ? body.user_name.trim() : ""
    if (userName.length === 0) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Falta el nombre de usuario de la licencia.",
          },
        },
        { status: 422 }
      )
    }

    if (!isRenewalMonths(body.months)) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "validation_error",
            message: "Los meses deben ser 1, 3, 6 o 12.",
          },
        },
        { status: 422 }
      )
    }

    // El perfil distribuidor solo puede renovar clientes de su reseller
    // ligado: un cliente fuera de alcance (o sin atribución posible) se
    // rechaza antes de tocar la API de licencias.
    const scope = await resolveClientScope(user)
    if (scope.kind === "none") {
      return Response.json(
        {
          ok: false,
          error: {
            code: "forbidden",
            message:
              "Tu cuenta no tiene un distribuidor ligado: no puedes renovar licencias.",
          },
        },
        { status: 403 }
      )
    }
    if (scope.kind === "distributor") {
      const target = await getFlujoClient(userName)
      const allowed = target
        ? await isFlujoClientInScope(target, scope)
        : false
      if (!allowed) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "forbidden",
              message: `El cliente '${userName}' no pertenece a tu distribuidor.`,
            },
          },
          { status: 403 }
        )
      }
    }

    const result = await renewFlujoLicense({
      userName,
      months: body.months,
      idempotencyKey,
    })

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "flujotv.renewal",
        actor: `user:${user.username}`,
        user_name: userName,
        months: body.months,
        status: result.status,
      })
    )

    return Response.json({ ok: true, data: result })
  } catch (error) {
    return flujoErrorResponse(error)
  }
}
