• Composición: SPEILinkPipelineVideo
• Resolución: 1080 x 1920 (9:16 Reels / TikTok / WhatsApp Status)
• FPS: 30 (Duración total: 960 frames = 32.0s)
• Paleta de diseño (Consistente con SPEILink):
	• Fondo base: #0F172A (Slate 950 profundo) con retícula técnica sutil (#1E293B).
	• Acento primario / Éxito: #10B981 (Emerald 500) y #059669.
	• Nodos de WhatsApp: #25D366 / burbuja #DCF8C6.
	• Tipografía: Plus Jakarta Sans / Inter (tabular-nums en montos).

Línea de Tiempo por <Sequence> (Frame a Frame)


<Sequence from={0} durationInFrames={150}> — Escena 1: El Cuello de Botella (0:00 – 0:05)

• Objetivo: Visualizar la fricción del cobro por transferencia tradicional.
• Animación (UI / Motion):
	• Frames 0–30: Aparecen dos nodos separados con spring(): Cliente (izquierda) y Tu Negocio (derecha).
	• Frames 30–90: Se proyecta una cadena larga de 18 dígitos (CLABE: 012180001234567890) que vibra ligeramente en rojo/ámbar (#F59E0B), seguida de un ícono de reloj y una captura de pantalla borrosa con signo de interrogación (¿Ya cayó?).
	• Frames 90–150: Todo el nodo de fricción se comprime y desaparece con interpolate() de opacidad (1 -> 0).
• Super Texto (Kinetic Typography):
	• Frames 10–140: "¿Sigues dictando tu CLABE y revisando tu banco?"
• Voz en Off (TTS / Locución): "¿Sigues dictando tu CLABE número por número y abriendo tu banco para ver si ya te pagaron?"

<Sequence from={150} durationInFrames={150}> — Escena 2: El Link / QR Disparador (0:05 – 0:10)

• Objetivo: Mostrar el inicio del pipeline con un link o QR.
• Animación (UI / Motion):
	• Frames 150–190: Entra al centro superior una tarjeta limpia tipo dashboard SPEILink (bg-white rounded-3xl shadow-2xl) mostrando los inputs auto-completándose: Monto: $500.00 MXN | Concepto: COMPRA500.
	• Frames 190–240: La tarjeta emite un Código QR y un enlace corto (SPEILink/p/xqk9).
	• Frames 240–300: El QR se desplaza hacia la esquina superior izquierda como nodo disparador (Trigger) del pipeline.
• Super Texto:
	• "1. Generas tu link o muestras tu QR"
• Voz en Off: "Con SPEILink, generas un link con el monto exacto o muestras tu QR en el mostrador."

<Sequence from={300} durationInFrames={180}> — Escena 3: El Cliente Inicia el Chat (0:10 – 0:16)

• Objetivo: Explicar que el comprador abre WhatsApp y transfiere directo.
• Animación (UI / Motion):
	• Frames 300–350: Una línea de pulso animada (strokeDashoffset) conecta el QR con un Mockup de WhatsApp en el centro.
	• Frames 350–410: Aparece el mensaje entrante del cliente ("Solicito link por $500.00 MXN") y, 0.5 segundos después (frame 375), el Bot Automático responde solo con la CLABE y el concepto COMPRA500 (con badge brillante: ⚡ Respuesta automática).
	• Frames 410–480: Debajo del teléfono aparece el nodo Banco del Cliente (BBVA / Nu / Banorte) disparando una partícula verde brillante ($500.00 MXN) directamente hacia el nodo Tu Cuenta Mercado Pago.
• Super Texto:
	• "2. Tu cliente abre el chat y transfiere directo a tu cuenta"
• Voz en Off: "Tu cliente inicia el chat por WhatsApp y transfiere desde cualquier banco directo a tu cuenta de Mercado Pago."

<Sequence from={480} durationInFrames={210}> — Escena 4: El Pipeline de Validación (0:16 – 0:23)

• Objetivo: Dejar 100% claro que SPEILink no toca el dinero, pero sí automatiza la confirmación.
• Animación (UI / Motion):
	• Frames 480–540: Vista esquemática de 2 carriles paralelos (el corazón del pipeline):
		• Carril Superior (Verde sólido): Banco Cliente ➔ Tu Cuenta Mercado Pago con etiqueta: 100% directo • Sin intermediarios.
		• Carril Inferior (Línea punteada de solo lectura): Notificación SPEI ➔ Motor SPEILink ➔ WhatsApp.
	• Frames 540–630: Al llegar el depósito al nodo de Mercado Pago, un pulso viaja por el carril inferior hacia el chat de WhatsApp y dispara la burbuja verde: ✅ ¡Pago verificado en cuenta! +$500.00 MXN.1
	• Frames 630–690: Aparece el sello flotante: ⚡ Piloto automático: tú no respondes nada.
• Super Texto:
	• "3. Validación bancaria y recibo en automático"
• Voz en Off: "SPEILink nunca toca tu dinero: solo detecta el depósito al instante y envía el recibo confirmado en el chat por ti."

<Sequence from={690} durationInFrames={150}> — Escena 5: Captura de Lead Consensuado (0:23 – 0:28)

• Objetivo: Mostrar el activo comercial oculto (el contacto del cliente).
• Animación (UI / Motion):
	• Frames 690–740: Del chat de WhatsApp se desprende una tarjeta de contacto (+52 55 •••• ••89 | Compra: $500 MXN | Estado: Verificado) que entra a una lista titulada Tu Base de Clientes.
	• Frames 740–840: Se apilan 3 contactos más rápidamente con efecto cascada (stagger) y aparecen etiquetas de acción: Enviar garantía, Avisar promociones.
• Super Texto:
	• "+ Te quedas con el WhatsApp de cada cliente"
• Voz en Off: "Y lo mejor: como tu cliente inició la conversación, te quedas con su WhatsApp real para darle seguimiento y hacer que vuelva a comprarte."

<Sequence from={840} durationInFrames={120}> — Escena 6: Cierre y CTA (0:28 – 0:32)

• Objetivo: Conversión directa a registro gratuito.
• Animación (UI / Motion):
	• Frames 840–880: Limpieza de canvas con transición suave. Entra el isotipo y logotipo SPEILink en el centro.
	• Frames 880–960: Aparecen 3 píldoras alineadas (0% comisión • Sin tarjetas • Actívalo en 3 min) y un botón pulsante esmeralda con la URL SPEILink.
• Super Texto:
	• "Automatiza tus cobros por transferencia hoy"
	• SPEILink
• Voz en Off: "Empieza gratis hoy en SPEILink y quédate con el cien por ciento de tus ventas."



