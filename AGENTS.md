<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Despliegue (obligatorio)

Este proyecto **siempre se publica en el subdominio**: https://distribuidor-tvbox.people-ia.com/

### Arquitectura de publicación

- El sitio **se sirve desde esta misma máquina**: pm2 ejecuta la app `distribuidor-tvbox` (`npm start` → `next start`) sobre este directorio, escuchando en el puerto **3010**.
- Caddy (contenedor `agente-caddy-1`, config en `/root/agente/Caddyfile`) resuelve el subdominio con `reverse_proxy 172.18.0.1:3010`; Cloudflare va por delante.
- **Hacer push a GitHub NO despliega nada.** El remoto (`github.com/eortizs/distribuidor-tvbox`) es solo respaldo del código.

### Procedimiento de despliegue (obligatorio tras cada cambio)

```bash
node db/apply-mp-orders-cupon.mjs && node db/apply-mp-orders-transfer.mjs && node db/apply-mp-orders-renewal-verify.mjs && node db/apply-mp-refunds.mjs && node db/apply-shopping-list.mjs && node db/apply-coupon-limit.mjs && node db/apply-coupon-monthly-limit.mjs && node db/apply-tickets.mjs && node db/apply-paquetes.mjs && node db/apply-transfer-receipt-scan.mjs && node db/apply-transfer-concept.mjs && node db/apply-notifications.mjs && node db/apply-saldo.mjs && node db/apply-saldo-tipos.mjs && node db/apply-auth-google.mjs && node db/apply-renewal-attempts.mjs && node db/apply-conectores.mjs && node db/apply-client-filters.mjs
npm run build && pm2 reload distribuidor-tvbox
```

1. **Migraciones de `db/` primero**: los scripts `apply-*.mjs` aplican su SQL de forma idempotente (`IF NOT EXISTS`) y son seguros de re-ejecutar. El código nuevo puede consultar columnas que solo existen tras correrlos; si se despliega sin migrar, las rutas de compra responden 500 (`SQL 42703`). Ante un cambio de esquema nuevo, crear su par `db/<tema>-schema.sql` + `db/apply-<tema>.mjs` y añadirlo aquí.
2. `npm run build` (equivale a `eve build && next build`): genera el build en `.next`/`.output`.
3. `pm2 reload distribuidor-tvbox`: reinicia el servidor para que cargue el manifiesto del build nuevo.

### Variables de entorno relevantes (`.env`)

- `MERCADOPAGO_ACCESS_TOKEN`, `LICENSE_PRICE_MXN`, `SITE_URL`: motor de pagos (sin ellas no hay checkout ni precio).
- `TRANSFER_BANK_NAME`, `TRANSFER_ACCOUNT`, `TRANSFER_HOLDER`: datos bancarios de la transferencia; sin las tres, el método se oculta.
- `RECEIPT_SCAN_MODEL` (con `AI_GATEWAY_API_KEY`): modelo de visión que revisa los comprobantes de transferencia del carrito de renovación (`POST /api/transferencias/orders`, módulo `src/server/transferencias/scan.ts`). Extrae fecha/hora, concepto, importe y beneficiario del ticket y verifica contra la orden. **Estrictos solo tres puntos**: fecha dentro del mes actual, concepto con el **código de pago de 4 caracteres** entregado al comprador en el paso 1 (el comprador escribe SOLO el código como concepto; la orden ya lo liga internamente al usuario renovado; flujo de dos pasos: primero el concepto vía `POST /api/transferencias/concepto`, después el comprobante; migración `db/apply-transfer-concept.mjs`, tablas `transfer_concepts` + columnas `mp_orders.concept_id/concept_code`) e importe ≥ orden. El beneficiario es tolerante: acepta iniciales («E. Ortiz», «Enrique O»), origen/destino implícito sin la palabra «beneficiario» y nombres con palabras extra; un nombre ajeno completo sí rechaza; sin beneficiario legible no bloquea. Todo pasa → orden `paid` y renovación automática; algo falla → orden `pending` para revisión manual y aviso al comprador de contactar al admin; sin modelo configurado o con el escaneo caído → revisión manual como siempre. La UI bloquea la app por etapas (validación → renovación → resultado) hasta el 100%: el overlay sondea `GET /api/mercadopago/orders/{id}` cada 3 s (la lectura concilia órdenes varadas), se restaura desde localStorage si el comprador recarga, y solo el panel final libera. Dedup por sha256 (`mp_orders.ticket_sha256`): el mismo comprobante re-subido por el mismo comprador nunca auto-aprueba otra orden (va a revisión manual). Escaneos con tope de 3/min por comprador (bucket en memoria) y timeout de 25 s para caber en el presupuesto de Cloudflare. El resultado queda en `mp_orders.scan_status/scan_result/scan_model/scan_at` (migración `db/apply-transfer-receipt-scan.mjs`) y lo ve el admin en «Transferencias por revisar». El concepto de pago es idempotente por comprador + usuario + mes (cancelar y volver entrega el mismo código) y se anula (`status='consumed'`) cuando la orden se aprueba o rechaza; al vencer el mes vence el código.
- `COUPON_QA_ENABLED=1`: activa el cupón de QA `0000` (pago con cupón). **Desactivado por defecto**: un cupón siempre activo permitiría renovaciones gratis sin límite. Con `COUPON_QA_DAILY_LIMIT` (default 3) se topea los canjes por comprador en 24 h y con `COUPON_QA_MONTHLY_LIMIT` (default 10) el acumulado en 30 días; ambos con override por usuario desde `/users` (icono de permisos → `users.coupon_daily_limit` / `users.coupon_monthly_limit`). El canje es idempotente por `request_id` (`mp_orders.coupon_request_id`, índice único parcial).
- `FLUJO_API_KEY` (o la clave guardada en Configuración → API de licencias): clave del panel FlujoTV.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: credenciales OAuth 2.0 de Google (Google Cloud Console → Credenciales → ID de cliente OAuth, tipo «Aplicación web»). Sin las dos, el botón «Continuar con Google» de `/login` y `/register` se oculta y `/api/auth/google/start` redirige a `/login?error=google_disabled`. La URI de redirección autorizada en Google debe ser `SITE_URL + /api/auth/google/callback` (usa `SITE_URL`; sin ella deduce el origen de la petición). El callback canjea el código, valida los claims del `id_token` (iss/aud/exp y correo verificado), liga la cuenta por `users.google_sub` (migración `db/apply-auth-google.mjs`, columnas `google_sub`/`google_picture` + `password_hash` nullable), o crea la cuenta como distribuidor sin contraseña local. El vínculo con una cuenta local existente **exige prueba de propiedad**: el callback deja la identidad pendiente firmada en cookie (HMAC con `GOOGLE_CLIENT_SECRET`, 10 min) y redirige a `/login?error=google_link_required`; al iniciar sesión con la contraseña correcta, `loginAction` canjea el cookie y enlaza `google_sub`. No hay vínculo automático por correo sin verificar (evita que una cuenta local autoregistrada anticipe el Google de su dueño). Las cuentas solo-Google no pueden iniciar sesión con contraseña. El nombre completo y la foto de Google (`name`/`picture` del `id_token`, con respaldo en el endpoint userinfo) llenan `fullName` de la entidad Cuenta (solo si está vacío; nunca pisa ediciones manuales) y `users.google_picture` (avatar del menú; se refresca en cada inicio). **Ojo**: con `cacheComponents` activo, `/api/auth/google/start` y `/callback` deben llamar `await connection()` — sin API de request-time se prerenderizan en el build y sirven congelada la respuesta (p. ej. `google_disabled` si las credenciales no existían al compilar); `export const dynamic` no compila en este proyecto. Origen público compartido: `publicSiteUrl()` en `src/server/site-url.ts` (lo usan OAuth y Mercado Pago; no leer `SITE_URL` crudo).
- `LISTA_COMPRAS_MODEL`: opcional; modelo del intérprete de Lista de compras (`/api/lista-compras/interpretar`). Sin ella usa `ASISTENTE_MODEL` con la misma `OPENROUTER_API_KEY`.
- `CONECTORES_SECRET`: opcional; clave del cifrado AES-256-GCM de los tokens OAuth guardados por el módulo Conectores (`/modulos/conectores`, tabla `connector_connections`, migración `db/apply-conectores.mjs`). Si falta, se deriva de `GOOGLE_CLIENT_SECRET` — pero **rotar ese secret ladrilla en silencio todas las conexiones guardadas** (el descifrado GCM falla sin ruido y las conexiones pasan a `error`), así que conviene fijarla dedicada antes de la primera conexión. El flujo OAuth del conector es distinto al del login: URI de redirección autorizada `SITE_URL + /api/conectores/google/callback` (hay que darla de alta en Google Cloud Console). El scope pedido vive en el catálogo `src/lib/conectores.ts` (hoy `https://www.googleapis.com/auth/calendar.events`). Los consumidores de los tokens usan `accesoValido()` en `src/server/conectores/repository.ts` (renueva en frío; solo `google_grant_invalid` marca la conexión en error).
- `TICKET_SCAN_MODEL` (con `AI_GATEWAY_API_KEY`): modelo de visión del análisis de Alta de tickets (`/api/tickets/[id]/extraer`). Sin ninguna de las dos el endpoint responde 500 (`tickets_llm_not_configured`); el módulo se despliega, pero el análisis queda bloqueado hasta configurarlas.

### Advertencia crítica

**Nunca dejar el build sin reiniciar pm2.** Si se ejecuta `npm run build` sin `pm2 reload distribuidor-tvbox`, el servidor sigue con el manifiesto del build antiguo en memoria: sirve el HTML nuevo del disco pero responde **404** a los chunks estáticos nuevos (los nombres de archivo cambian en cada build). Eso rompe la hidratación (`ChunkLoadError`), congela el splash en "Cargando…" y deja la app sin interactividad en producción.

### Verificación post-despliegue

```bash
curl -s https://distribuidor-tvbox.people-ia.com/login \
  | grep -o '/_next/static/chunks/[^"]*\.\(js\|css\)' | sort -u | while read -r p; do
    printf "%s " "$(curl -s -o /dev/null -w '%{http_code}' "https://distribuidor-tvbox.people-ia.com$p")"; echo "$p"
  done
```

Todos los recursos listados deben devolver `200`. Con el servidor parado o recién reiniciado puede tardar unos segundos en responder.

## Reglas de UI: servidor MCP de ReUI (obligatorio)

Cualquier elemento o componente de la GUI debe crearse usando el servidor MCP de **ReUI**. Está prohibido escribir componentes de UI a mano cuando ReUI provee uno equivalente.

Flujo obligatorio para cualquier trabajo de UI:

1. Buscar el componente/bloque/ejemplo adecuado con `reui_search` (y `reui_search_icons` para iconos).
2. Leer la API real del componente con `reui_get_component` antes de escribir props o JSX; copiar composiciones exactas de `reui_get_examples`.
3. Instalar con `reui_get_install_command` + CLI de shadcn.
4. Adaptar por reúso: conectar datos reales y tema con tokens semánticos; nunca reestilizar ni retemporizar los componentes instalados.
5. Validar antes de cerrar con `reui_validate_usage` y `reui_get_audit_checklist`.

Los componentes ya presentes en `src/components/ui` y `src/components/reui` se usan tal como están. Antes de estilizar UI, leer el skill con `reui_get_agent_skill`.

## Mejores prácticas de UX (obligatorio)

Al crear o modificar cualquier componente, se debe buscar ofrecer la **mejor UX posible** aplicando las mejores prácticas de diseño de interfaces:

- **Jerarquía y orden de componentes**: organizar los elementos según su importancia (título → descripción → contenido → acciones). Lo más importante primero y visualmente dominante; agrupar controles relacionados; mantener una sola acción principal por vista.
- **Organización de botones**: la acción primaria a la derecha (o al final del flujo), secundarias a la izquierda, destructivas separadas y con confirmación. Nunca más de una acción primaria visible por vista; usar variantes correctas (primary/secondary/outline/ghost/destructive).
- **Tamaño y escala tipográfica**: usar la escala del sistema de diseño (nothing below `text-xs`); títulos con jerarquía clara, cuerpo legible, etiquetas cortas. No usar tamaños arbitrarios.
- **Espaciado y alineación**: ritmo visual consistente con `gap-*`/márgenes del sistema; alinear a una retícula; densidad adecuada al contexto (tablas densas, formularios aireados).
- **Estados y feedback**: todo elemento interactivo debe tener estados hover/focus/active/disabled; feedback inmediato para acciones del usuario (loading, toasts, mensajes de error cerca del campo).
- **Accesibilidad**: contraste suficiente, área táctil mínima, foco visible, labels asociados a inputs, navegación por teclado.
- **Carga cognitiva**: formularios cortos, opciones limitadas, texto de ayuda solo donde haga falta, iconos con etiqueta de texto cuando el significado no es universal.

Antes de entregar UI, verificar que el resultado cumple estas prácticas (usar `reui_get_audit_checklist` y el skill de ReUI como referencia de calidad).
