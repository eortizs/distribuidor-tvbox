# Distribuidor TVBox — Admin Dashboard

Dashboard de administración para distribuidores TVBox construido con Next.js 16 (App Router, `cacheComponents`), React 19 y Tailwind 4. Las entidades de negocio se modelan con el formato **umeJSON** y se persisten en **PostgreSQL (JSONB)** siguiendo el diseño normativo de [`eortizs/ume-json-v1`](https://github.com/eortizs/ume-json-v1) (`docs/PERSISTENCE.md`).

## Características

- **Entidades umeJSON genéricas**: cualquier `entityName` con `dynamicProperties`, creado a través de un flujo *finalize* donde el servidor inyecta `id` (UUID v7), `lifecycle.createdAt/updatedAt` y valida los sentinels `RESERVED_FOR_SYSTEM`.
- **Persistencia head + journal**: tabla `entities` (documento JSONB vigente + columnas espejo) y `entity_events` (bitácora append-only con `seq` monotónico, bitemporalidad `occurred_at`/`recorded_at`), con bloqueo optimista por `version` en cada mutación.
- **Autenticación con perfiles**: `admin` (acceso total + gestión de usuarios) y `distribuidor` (solo sus propias entidades). El login siempre es una cuenta de correo. Autorregistro en `/register`: toda cuenta nueva se crea con perfil `distribuidor` y genera su propia entidad umeJSON (`entityName: "Cuenta"`, ligada vía `dynamicProperties.userId` / `distribuidorId`). Usuario y password se insertan junto a su entidad `Cuenta` en una sola transacción. Sesiones en base de datos con cookie httpOnly, contraseñas con scrypt asíncrono, gate a nivel proxy con validación de sesión contra la DB y rate limit de 10 POST/min por IP en `/login` y `/register` (en memoria, por proceso).
- **UI admin**: lista de entidades con data-grid ReUI (búsqueda, filtro, paginación en servidor), formulario dinámico de creación, detalle con editor de propiedades, cambio de estado y timeline de eventos. El footer del sidebar muestra el usuario con un menú desplegable (Perfil, Billing, Notifications, Log out); el panel móvil del sidebar se cierra automáticamente al navegar a cualquier opción.
- **Modo oscuro global**: tema claro/oscuro/sistema en toda la app, incluidos los módulos futuros (ver [Tema y marca](#tema-y-marca)).
- **Perfil de usuario** (`/profile`): pestañas *Detalles*, *Información* y *Seguridad* (variante `line` de ReUI). Ver [Perfil de usuario](#perfil-de-usuario).
- **Asistente LLM** (`/asistente`): chat estilo ChatGPT en la sección *Support* del sidebar. Streaming token a token vía OpenRouter (`ASISTENTE_MODEL`, `OPENROUTER_API_KEY` en `.env`), respuestas en Markdown (renderizadas al terminar cada respuesta; texto plano durante el streaming), historial efímero y rate limit de 20 mensajes/min por usuario con timeout de inactividad de 30 s hacia el proveedor. El modelo se cambia solo editando `ASISTENTE_MODEL` en `.env` y reiniciando (`pm2 restart distribuidor-tvbox`); con modelos de razonamiento (p. ej. `meta/muse-spark-1.3-contributor`) la respuesta visible llega tras la fase interna de *thinking*, que el servidor mantiene viva. El panel tiene altura fija (`100svh` menos el header): el transcript hace scroll por dentro, con auto-scroll al borde durante la respuesta y botón para volver al final; funciona igual en desktop y móvil (la página nunca crece más allá del viewport). En esta versión el modelo **no** accede a la base de datos; el acceso futuro a datos irá siempre acotado al usuario de la sesión (un `distribuidor` solo podrá consultar sus propias entidades).
- **Gestión de usuarios** (`/users`, solo admin): listado en data-grid ReUI con búsqueda por email y filtro por rol; alta en dialog, edición (email, rol, contraseña) y baja con confirmación en `AlertDialog`. Protecciones en servidor: no se puede borrar la propia cuenta ni degradar/eliminar al último `admin`; el email debe ser único. Al editar una cuenta se actualiza en la misma transacción el usuario de autenticación y su entidad umeJSON `Cuenta` (espejo de `email`/`role` con evento `property.updated`); al eliminarla se archivan (soft-delete) todas sus entidades —incluida su `Cuenta`— con evento `entity.deleted`, y solo después se borra el usuario.
- **Almacenamiento de archivos por usuario**: cada cuenta tiene su propio folder en el servidor (`storage/users/<userId>/`, raíz configurable con `USER_FILES_DIR`) con subcarpetas `attachments/` (adjuntos subidos) y `generated/` (imágenes y archivos generados por IA). El folder se crea al registrar la cuenta, al ejecutar `node db/ensure-user-storage.mjs` (cartera de cuentas existentes) y de forma perezosa en el primer guardado; se elimina junto con la cuenta. Los archivos se indexan en la tabla `user_files` (`db/storage-schema.sql`) y se sirven solo al usuario de la sesión vía `/api/files`. Ver [Almacenamiento por usuario](#almacenamiento-por-usuario).
- **Imágenes con IA** (`/herramientas/imagenes`, sección *Herramientas* del sidebar): generador de imágenes vía OpenRouter Image API (`IMAGE_MODEL`, `OPENROUTER_API_KEY` en `.env`) con prompt, relación de aspecto y calidad. Cada imagen se guarda en `storage/users/<userId>/generated/` vía `saveUserFile` (kind `generated`) y se sirve por `/api/files`; la galería es automática por usuario (tabla `image_generations`, `db/images-schema.sql`). Tarificador: cada generación registra el costo real que reporta el proveedor (`usage.cost` en USD); la UI muestra el costo por imagen y el costo acumulado del usuario. Borrar una imagen es un soft-delete: sale de la galería y libera su archivo, pero el costo permanece en el acumulado; si el binario no pudiera guardarse, el costo igualmente queda registrado (fila sin `file_id`, excluida de la galería). Rate limit de 6 imágenes/min por usuario. Ver [Imágenes con IA](#imágenes-con-ia).

## Requisitos

- Node.js 20+
- PostgreSQL 16

## Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno (.env)
DATABASE_URL=postgresql://<usuario>:<password>@localhost:5432/reseller
OPENROUTER_API_KEY=<clave de OpenRouter>   # Asistente (/asistente) e Imágenes (/herramientas/imagenes)
ASISTENTE_MODEL=meta/muse-spark-1.3-contributor
IMAGE_MODEL=openai/gpt-image-2.5-sunburst   # Generador de imágenes (obligatorio para /herramientas/imagenes)

# 3. Aplicar el esquema (idempotente en DB vacía; respetar este orden:
#    auth → storage → images por las foreign keys)
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/auth-schema.sql
psql "$DATABASE_URL" -f db/storage-schema.sql
psql "$DATABASE_URL" -f db/images-schema.sql

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
| `admin` | Ve y edita todas las entidades; gestiona usuarios en `/users` (crear, editar y eliminar) |
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

## Almacenamiento por usuario

Cada cuenta dispone de un folder propio en el servidor para sus archivos: adjuntos subidos e imágenes/archivos generados por IA.

```
storage/users/<userId>/
  attachments/   # adjuntos subidos vía POST /api/files
  generated/     # imágenes y archivos generados por IA (p. ej. el asistente)
```

- **Raíz configurable**: `USER_FILES_DIR` (por defecto `<proyecto>/storage/users`); `USER_FILES_MAX_BYTES` fija el tamaño máximo por archivo (10 MB por defecto). El folder está en `.gitignore` y no forma parte del build.
- **Ciclo de vida**: `createAccount` crea el folder al registrar una cuenta (con reintentos perezosos en el primer guardado si fallara); `node db/ensure-user-storage.mjs` lo aprovisiona para cuentas existentes; al eliminar una cuenta se elimina su folder completo.
- **Índice**: cada archivo se registra en la tabla `user_files` (`db/storage-schema.sql`): nombre original saneado, nombre en disco (`<ts>-<rand>-<nombre>`), MIME, tamaño y fecha. Borrar un archivo elimina la fila y el fichero.
- **Aislamiento**: las rutas `/api/files*` operan siempre sobre el `userId` de la sesión (nunca sobre un id del cliente); la descarga hace streaming con `Content-Disposition` y `X-Content-Type-Options: nosniff`.
- **Uso futuro**: el asistente (o cualquier módulo) guarda lo que genere con `saveUserFile({ userId, kind: "generated", ... })` de `src/server/storage/user-files.ts`, de modo que todo queda dentro del folder del usuario.

## Imágenes con IA

Generador en `/herramientas/imagenes` (sección *Herramientas* del sidebar); backend en `src/server/images/service.ts` y rutas `/api/images*`.

- **Proveedor**: OpenRouter Image API (`POST https://openrouter.ai/api/v1/images`) con el modelo `IMAGE_MODEL` (`.env`); parámetros soportados: prompt (1–2000 caracteres), relación de aspecto (`auto`, `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`) y calidad (`auto`, `low`, `medium`, `high`); `n = 1`. Timeout de 180 s hacia el proveedor y rate limit de 6 imágenes/min por usuario (en memoria, por proceso).
- **Persistencia**: la imagen se decodifica (`b64_json` → binario) y se guarda con `saveUserFile` (kind `generated`), por lo que vive en `storage/users/<userId>/generated/` y se sirve vía `/api/files/<fileId>`; cada generación se registra en `image_generations` (`db/images-schema.sql`) con prompt, modelo, parámetros y costo.
- **Mejora de instrucciones**: el botón *Mejorar instrucciones* (junto a *Generar*) envía el prompt, el aspecto y la calidad seleccionados al LLM de texto (`ASISTENTE_MODEL`) y devuelve el prompt reescrito —más concreto y visual, en español, sin contradecir lo pedido— junto con el aspecto sugerido cuando el texto es ambiguo (p. ej. "banner" → 16:9, "retrato" → 9:16) y la calidad solo si el usuario la pide explícitamente. El resultado reemplaza el contenido del formulario para que el usuario lo revise antes de generar.
- **Tarificador**: el costo es el que reporta el proveedor (`usage.cost`, USD, `numeric(12,6)`; `NULL` si no viene dato). El **costo acumulado** suma *todas* las generaciones del usuario: borrar una imagen (soft-delete, `deleted_at`) la saca de la galería y borra su binario, pero el costo permanece en el total para que refleje el gasto real facturado. Si el archivo no pudiera persistirse tras una generación exitosa, el costo igualmente queda registrado en una fila sin `file_id` (excluida de la galería, incluida en el total).
- **Galería**: `GET /api/images` devuelve las generaciones vivas (con `file_id`) más el total y el costo acumulado; `DELETE /api/images/[id]` hace el soft-delete y libera el archivo. La UI (`src/components/herramientas/imagenes/image-studio.tsx`) muestra el costo por imagen en cada tile y el acumulado en el encabezado.

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
| `GET/POST` | `/api/users`* | Gestión de cuentas (solo admin, vía server actions: alta, edición y baja) |
| `POST` | `/api/asistente/chat` | Chat con el LLM en streaming (`{ messages: [{ role, content }] }` → texto plano en chunks). Sesión requerida; 20 req/min por usuario |
| `GET` | `/api/images` | Galería del usuario de la sesión (`?limit=`, `?offset=`) con total y costo acumulado del tarificador |
| `POST` | `/api/images` | Genera una imagen (`{ prompt, aspectRatio?, quality? }`) y la registra con su costo. Sesión requerida; 6 req/min por usuario |
| `POST` | `/api/images/enhance` | Mejora de instrucciones con el LLM (`{ prompt, aspectRatio?, quality? }` → `{ prompt, aspectRatio, quality }` reescritos; ajusta el aspecto si el texto es ambiguo). Sesión requerida; 10 req/min por usuario |
| `DELETE` | `/api/images/[id]` | Soft-delete de una generación propia: sale de la galería, libera el archivo y conserva el costo en el acumulado |
| `GET` | `/api/files` | Lista los archivos del usuario de la sesión (`?kind=attachment\|generated`, `?limit=`, `?offset=`) |
| `POST` | `/api/files` | Sube un archivo (`multipart/form-data`: `file`, `kind=attachment\|generated`) al folder del usuario |
| `GET` | `/api/files/[id]` | Descarga/sirve un archivo propio (`?download=1` fuerza la descarga) |
| `DELETE` | `/api/files/[id]` | Elimina un archivo propio (del índice y del disco) |

Todas las rutas requieren sesión; el `actor` de la bitácora se deriva de la sesión (`user:<username>`), nunca del cliente.

## Estructura

```
db/                      # DDL normativo (schema.sql, auth-schema.sql, storage-schema.sql, images-schema.sql) + create-user.mjs, ensure-user-storage.mjs
src/server/
  db.ts                  # Pool pg singleton
  http.ts                # Errores API + límite de body 100 KB
  asistente/             # LLM del asistente (streaming OpenRouter)
  auth/                  # password (scrypt), session, users, guards
  images/                # Generador de imágenes (OpenRouter Image API + tarificador)
  storage/               # user-files (folders por usuario + índice user_files)
  umejson/               # schema (Ajv + sentinels), finalize, repository (protocolo head+journal)
src/app/
  (dashboard)/           # UI protegida: dashboard, entities, users, profile, herramientas/imagenes
  api/                   # Route handlers
  actions/               # Server actions (login, registro, logout, perfil, crear usuario)
  login/                 # Login (card ReUI)
  register/              # Autorregistro (crea user distribuidor + entidad Cuenta)
  proxy.ts (en src/)     # Gate de sesión/rol antes de renderizar
```

## Tema y marca

- **Tema claro/oscuro**: `ThemeProvider` (next-themes, atributo `class`) montado en el layout raíz (`src/app/layout.tsx`) con `suppressHydrationWarning`; tema por defecto **Sistema**, con opción Claro / Oscuro. El selector Claro / Oscuro / Sistema vive en el header del dashboard (`src/components/theme-toggle.tsx`). Cualquier módulo presente o futuro hereda el tema automáticamente: los tokens de ambos modos ya están definidos en `globals.css` (`:root` y `.dark`) y los componentes shadcn/ReUI reaccionan solos; el Toaster (sonner) sigue el tema vía `useTheme`. Para respetar el tema, el código nuevo usa tokens semánticos (`bg-card`, `text-muted-foreground`, …) y no colores crudos; un color crudo lleva siempre su par `dark:`.
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
