# Distribuidor TVBox — Admin Dashboard

Dashboard de administración para distribuidores TVBox construido con Next.js 16 (App Router, `cacheComponents`), React 19 y Tailwind 4. Las entidades de negocio se modelan con el formato **umeJSON** y se persisten en **PostgreSQL (JSONB)** siguiendo el diseño normativo de [`eortizs/ume-json-v1`](https://github.com/eortizs/ume-json-v1) (`docs/PERSISTENCE.md`).

## Características

- **Entidades umeJSON genéricas**: cualquier `entityName` con `dynamicProperties`, creado a través de un flujo *finalize* donde el servidor inyecta `id` (UUID v7), `lifecycle.createdAt/updatedAt` y valida los sentinels `RESERVED_FOR_SYSTEM`.
- **Persistencia head + journal**: tabla `entities` (documento JSONB vigente + columnas espejo) y `entity_events` (bitácora append-only con `seq` monotónico, bitemporalidad `occurred_at`/`recorded_at`), con bloqueo optimista por `version` en cada mutación.
- **Autenticación con perfiles**: `admin` (acceso total + gestión de usuarios) y `distribuidor` (solo sus propias entidades). Sesiones en base de datos con cookie httpOnly, contraseñas con scrypt, gate a nivel proxy con validación de sesión contra la DB.
- **UI admin**: lista de entidades con data-grid ReUI (búsqueda, filtro, paginación en servidor), formulario dinámico de creación, detalle con editor de propiedades, cambio de estado y timeline de eventos.

## Requisitos

- Node.js 20+
- PostgreSQL 16

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno (.env)
DATABASE_URL=postgresql://<usuario>:<password>@localhost:5432/reseller

# 3. Aplicar el esquema (idempotente en DB vacía)
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/auth-schema.sql

# 4. Crear el usuario administrador
node db/create-user.mjs <usuario> <password> admin

# 5. Desarrollo o producción
npm run dev            # http://localhost:3000
npm run build && npm run start   # respeta PORT (default 3000)
```

El login vive en `/login`; el resto de rutas redirigen allí si no hay sesión.

## Roles

| Rol | Alcance |
|---|---|
| `admin` | Ve y edita todas las entidades; crea usuarios en `/users` |
| `distribuidor` | Solo ve y edita las entidades que él crea (el servidor estampa `dynamicProperties.distribuidorId` al crear y filtra con el índice GIN) |

## Modelo de datos

Cada entidad es un documento umeJSON (`doc` JSONB) con espejos relacionales para indexado y concurrencia:

```json
{
  "id": "uuid-v7 (servidor)",
  "entityName": "Venta",
  "dynamicProperties": { "monto": 500 },
  "lifecycle": { "createdAt": "...", "updatedAt": "...", "version": 1 },
  "state": { "current": "active", "statusLog": [ ... máx. 20 ... ] },
  "markdownDocumentation": "### Venta ..."
}
```

Toda mutación es una transacción atómica: `UPDATE entities ... WHERE id = $1 AND version = $esperada` (0 filas → conflicto 409) + `INSERT` en `entity_events` con `seq = max(seq)+1`. Los tipos de evento son cerrados: `created`, `property.updated` (con diff `from`/`to`), `state.changed`, `relation.added`, `annotation.added`, `imported.from`, `correction`. `state.statusLog` es una proyección de la bitácora (se recalcula en la misma transacción).

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/ume-json/finalize` | Valida schema + sentinels, inyecta id/lifecycle y persiste. `__diagnostic` / `schema_violation` / `sentinel_violation` → 422 |
| `GET` | `/api/entities?entityName=&q=&limit=&offset=` | Lista paginada (distribuidor: solo las suyas) |
| `GET` | `/api/entities/[id]` | Detalle de la entidad |
| `PATCH` | `/api/entities/[id]` | `{version, dynamicProperties \| state, reason?}` — 409 en conflicto de versión |
| `GET` | `/api/entities/[id]/events` | Bitácora de eventos |
| `GET/POST` | `/api/users`* | Gestión de usuarios (solo admin, vía server actions) |

Todas las rutas requieren sesión; el `actor` de la bitácora se deriva de la sesión (`user:<username>`), nunca del cliente.

## Estructura

```
db/                      # DDL normativo (schema.sql, auth-schema.sql) + create-user.mjs
src/server/
  db.ts                  # Pool pg singleton
  http.ts                # Errores API + límite de body 100 KB
  auth/                  # password (scrypt), session, users, guards
  umejson/               # schema (Ajv + sentinels), finalize, repository (protocolo head+journal)
src/app/
  (dashboard)/           # UI protegida: dashboard, entities, users
  api/                   # Route handlers
  actions/               # Server actions (login, logout, crear usuario)
  login/                 # Login (card ReUI)
  proxy.ts (en src/)     # Gate de sesión/rol antes de renderizar
```

## Documentación del formato

- Especificación umeJSON y pipeline de ingestión: [`eortizs/ume-json-v1`](https://github.com/eortizs/ume-json-v1)
- Diseño de persistencia normativo: [`docs/PERSISTENCE.md` (upstream)](https://github.com/eortizs/ume-json-v1/blob/main/docs/PERSISTENCE.md)

## Deployment

Servidor Node con build de producción (`npm run build && npm run start`), inverse-proxied por Caddy. Requiere `DATABASE_URL` en el entorno y las migraciones aplicadas (paso 3).
