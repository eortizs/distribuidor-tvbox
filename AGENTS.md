<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Despliegue (obligatorio)

Este proyecto **siempre se publica en el subdominio**: https://distribuidor-tvbox.people-ia.com/

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
