# Distribuidor TVBox — Admin Dashboard

Dashboard de administración para distribuidores TVBox construido con Next.js 16 (App Router, `cacheComponents`), React 19 y Tailwind 4. Las entidades de negocio se modelan con el formato **umeJSON** y se persisten en **PostgreSQL (JSONB)** siguiendo el diseño normativo de [`eortizs/ume-json-v1`](https://github.com/eortizs/ume-json-v1) (`docs/PERSISTENCE.md`).

## Características

- **Entidades umeJSON genéricas**: cualquier `entityName` con `dynamicProperties`, creado a través de un flujo *finalize* donde el servidor inyecta `id` (UUID v7), `lifecycle.createdAt/updatedAt` y valida los sentinels `RESERVED_FOR_SYSTEM`.
- **Persistencia head + journal**: tabla `entities` (documento JSONB vigente + columnas espejo) y `entity_events` (bitácora append-only con `seq` monotónico, bitemporalidad `occurred_at`/`recorded_at`), con bloqueo optimista por `version` en cada mutación.
- **Autenticación con perfiles**: `admin` (acceso total + gestión de usuarios) y `distribuidor` (solo sus propias entidades). El login siempre es una cuenta de correo. Autorregistro en `/register`: toda cuenta nueva se crea con perfil `distribuidor` y genera su propia entidad umeJSON (`entityName: "Cuenta"`, ligada vía `dynamicProperties.userId` / `distribuidorId`). Usuario y password se insertan junto a su entidad `Cuenta` en una sola transacción. Sesiones en base de datos con cookie httpOnly, contraseñas con scrypt asíncrono, gate a nivel proxy con validación de sesión contra la DB y rate limit de 10 POST/min por IP en `/login` y `/register` (en memoria, por proceso).
- **UI admin**: lista de entidades con data-grid ReUI (búsqueda, filtro, paginación en servidor), formulario dinámico de creación, detalle con editor de propiedades, cambio de estado y timeline de eventos. El footer del sidebar muestra el usuario con un menú desplegable (Perfil, Billing, Notifications, Log out); el panel móvil del sidebar se cierra automáticamente al navegar a cualquier opción.
- **Modo oscuro global**: tema claro/oscuro/sistema en toda la app, incluidos los módulos futuros (ver [Tema y marca](#tema-y-marca)).
- **Perfil de usuario** (`/profile`): pestañas *Detalles*, *Información* y *Seguridad* (variante `line` de ReUI). Ver [Perfil de usuario](#perfil-de-usuario).
- **Asistente LLM** (`/asistente`): chat estilo ChatGPT en la sección *Support* del sidebar. Streaming token a token vía OpenRouter (`ASISTENTE_MODEL`, `OPENROUTER_API_KEY` en `.env`), respuestas en Markdown (renderizadas al terminar cada respuesta; texto plano durante el streaming), historial efímero y rate limit de 20 mensajes/min por usuario con timeout de inactividad de 30 s hacia el proveedor. El panel tiene altura fija (`100svh` menos el header): el transcript hace scroll por dentro, con auto-scroll al borde durante la respuesta y botón para volver al final; funciona igual en desktop y móvil (la página nunca crece más allá del viewport). En esta versión el modelo **no** accede a la base de datos; el acceso futuro a datos irá siempre acotado al usuario de la sesión (un `distribuidor` solo podrá consultar sus propias entidades).

## Requisitos

- Node.js 20+
- PostgreSQL 16

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno (.env)
DATABASE_URL=postgresql://<usuario>:<password>@localhost:5432/reseller
OPENROUTER_API_KEY=<clave de OpenRouter>   # Asistente (/asistente)
ASISTENTE_MODEL=meta/muse-spark-1.3-contributor

# 3. Aplicar el esquema (idempotente en DB vacía)
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/auth-schema.sql

# 4. Crear el usuario administrador (el login siempre es un correo)
node db/create-user.mjs admin@tvbox.network <password> admin

# 5. Desarrollo o producción
npm run dev            # http://localhost:3000
npm run build && npm run start   # respeta PORT (default 3000)
```

El login vive en `/login` y siempre es una cuenta de correo; desde ahí se enlaza a `/register` para crear cuenta. Toda cuenta nueva nace con perfil `distribuidor` y su entidad umeJSON `Cuenta`; el resto de rutas redirigen a `/login` si no hay sesión.

## Roles

| Rol | Alcance |
|---|---|
| `admin` | Ve y edita todas las entidades; crea usuarios en `/users` |
| `distribuidor` | Solo ve y edita las entidades que él crea (el servidor estampa `dynamicProperties.distribuidorId` al crear y filtra con el índice GIN). El scoping se aplica tanto en la API como en la página SSR de detalle y su timeline de eventos |

El autorregistro (`/register`) crea cuentas únicamente como `distribuidor`; solo un `admin` puede elevar el perfil después.

## Perfil de usuario

Página `/profile` (enlace **Perfil** en el menú del footer del sidebar), organizada en tres pestañas (patrón ReUI `c-tabs-2`, variante `line`):

| Pestaña | Contenido |
|---|---|
| **Detalles** (por defecto) | Lectura sola: email, rol (badge), fecha de alta y última actualización de la entidad Cuenta |
| **Información** | Email (solo lectura: es el identificador de login), nombre completo y teléfono, editables |
| **Seguridad** | Cambio de contraseña: actual + nueva (mín. 8, distinta de la actual) + confirmación |

Persistencia y reglas:

- Los datos de perfil (`fullName`, `phone`) viven en `dynamicProperties` de la entidad umeJSON `Cuenta` del usuario (localizada por `dynamicProperties.userId`); no requieren migración de esquema.
- Cada guardado pasa por `updateProperties` del repositorio: bloqueo optimista por `version` (conflicto → error al usuario) y evento `property.updated` con diff `from`/`to` en `entity_events`, con `actor` = email de la sesión y `reason: "Profile updated"`. Si la entidad Cuenta no existe, se crea con el mismo draft que el registro.
- La contraseña se cambia solo tras verificar la actual contra el hash scrypt; el nuevo hash se escribe con `updatePassword` (`src/server/auth/users.ts`). Las sesiones activas no se invalidan.
- Validación en el server action (`src/app/actions/profile.ts`): nombre ≤ 100 caracteres, teléfono opcional con formato flexible (`+`, dígitos, espacios, paréntesis, guiones; 7–20), y ninguna mutación sin sesión (`requireUser`).
- Formularios cliente con `useActionState`, estado pendiente, error inline (`role="alert"`) y toast de éxito con `router.refresh()` para recargar los datos; los paneles usan `keepMounted` para no perder lo tecleado al cambiar de pestaña.

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

Toda mutación es una transacción atómica: `UPDATE entities ... WHERE id = $1 AND version = $esperada` (0 filas → conflicto 409) + `INSERT` en `entity_events` con `seq = max(seq)+1`. Los tipos de evento son cerrados: `created`, `property.updated` (con diff `from`/`to`), `state.changed`, `relation.added`, `annotation.added`, `imported.from`, `correction`. `state.statusLog` es una proyección de la bitácora (se recalcula en la misma transacción). `db/create-user.mjs` respeta el mismo protocolo: al cambiar el rol de una cuenta existente aplica lock optimista y journala un `property.updated` con el diff.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/ume-json/finalize` | Valida schema + sentinels, inyecta id/lifecycle y persiste. `__diagnostic` / `schema_violation` / `sentinel_violation` → 422 |
| `GET` | `/api/entities?entityName=&q=&limit=&offset=` | Lista paginada (distribuidor: solo las suyas) |
| `GET` | `/api/entities/[id]` | Detalle de la entidad |
| `PATCH` | `/api/entities/[id]` | `{version, dynamicProperties \| state, reason?}` — 409 en conflicto de versión |
| `GET` | `/api/entities/[id]/events` | Bitácora de eventos |
| `GET/POST` | `/api/users`* | Gestión de usuarios (solo admin, vía server actions) |
| `POST` | `/api/asistente/chat` | Chat con el LLM en streaming (`{ messages: [{ role, content }] }` → texto plano en chunks). Sesión requerida; 20 req/min por usuario |

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
  (dashboard)/           # UI protegida: dashboard, entities, users, profile
  api/                   # Route handlers
  actions/               # Server actions (login, registro, logout, perfil, crear usuario)
  login/                 # Login (card ReUI)
  register/              # Autorregistro (crea user distribuidor + entidad Cuenta)
  proxy.ts (en src/)     # Gate de sesión/rol antes de renderizar
```

## Tema y marca

- **Tema claro/oscuro**: `ThemeProvider` (next-themes, atributo `class`) montado en el layout raíz (`src/app/layout.tsx`) con `suppressHydrationWarning`; tema por defecto **dark**, con opción Sistema. El selector Claro / Oscuro / Sistema vive en el header del dashboard (`src/components/theme-toggle.tsx`). Cualquier módulo presente o futuro hereda el tema automáticamente: los tokens de ambos modos ya están definidos en `globals.css` (`:root` y `.dark`) y los componentes shadcn/ReUI reaccionan solos; el Toaster (sonner) sigue el tema vía `useTheme`. Para respetar el tema, el código nuevo usa tokens semánticos (`bg-card`, `text-muted-foreground`, …) y no colores crudos; un color crudo lleva siempre su par `dark:`.
- **Marca Togu**: el logo (monograma "T") es un SVG con tokens semánticos (`src/components/togu-logo.tsx`, `fill-primary`/`fill-primary-foreground`), por lo que se invierte solo al cambiar de tema; se usa en el sidebar, en login/register (`auth-shell.tsx`) y en los metadatos. Los assets estáticos viven en `public/togu-icon-light.svg` y `public/togu-icon-dark.svg` (colores explícitos `#171717`/`#fafafa`), y el favicon es `src/app/icon.svg`, que alterna claro/oscuro según el `prefers-color-scheme` del navegador (sustituye al antiguo `favicon.ico`).

## Convenciones de UI

- La interfaz usa componentes **shadcn/ui** y **ReUI** (ver `src/components/ui` y `src/components/reui`) con iconos de `lucide-react`. Los componentes instalados se usan tal como están: no se reestilizan ni se retemporizan; el theming va por tokens semánticos (`bg-primary`, `text-muted-foreground`, etc.).
- El toggle del sidebar (`SidebarTrigger` en `src/components/ui/sidebar.tsx`) usa el icono de hamburguesa (`MenuIcon`) en lugar del `PanelLeftIcon` por defecto de shadcn.

## Documentación del formato

- Especificación umeJSON y pipeline de ingestión: [`eortizs/ume-json-v1`](https://github.com/eortizs/ume-json-v1)
- Diseño de persistencia normativo: [`docs/PERSISTENCE.md` (upstream)](https://github.com/eortizs/ume-json-v1/blob/main/docs/PERSISTENCE.md)

## Deployment

Servidor Node con build de producción, gestionado por **PM2**:

```bash
npm run build
pm2 restart distribuidor-tvbox   # o pm2 start npm --name distribuidor-tvbox -- start
```

- La app corre como `next start` (servicio PM2 `distribuidor-tvbox`) en el **puerto 3010**; PM2 reinicia el proceso automáticamente si muere. Tras cualquier cambio de código hay que ejecutar `npm run build` y luego `pm2 restart distribuidor-tvbox` (`next start` sirve el build de `.next`, no el código fuente).
- Requiere `DATABASE_URL` en el entorno (`.env`) y las migraciones aplicadas (paso 3).
