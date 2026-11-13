/*
 * Service worker del panel: solo Web Push del módulo Alertas. No cachea
 * nada: el serve del shell ya lo maneja Next, y un cache propio aquí podría
 * servir chunks viejos tras un deploy (el 404 de chunks rompe la hidratación).
 *
 * Registro: desde la card «Avisos en este dispositivo» de /modulos/alertas
 * cuando el usuario activa los avisos del dispositivo.
 */

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Payload no JSON: se muestra el aviso genérico de abajo.
  }
  const title = (data && data.title) || "Alerta"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: (data && data.body) || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: (data && data.tag) || undefined,
      data: { url: (data && data.url) || "/modulos/alertas" },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      // Si el panel ya está abierto se lleva al módulo; si no, se abre.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus()
          if ("navigate" in client) {
            try {
              await client.navigate(target)
            } catch {
              // Navegación cross-origin rechazada: el foco basta.
            }
          }
          return
        }
      }
      return self.clients.openWindow(target)
    })()
  )
})
