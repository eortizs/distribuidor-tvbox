// Verificación post-despliegue del shortener spei.link + rename Links de pago.
// Uso: node scripts/verify-links-pago.mjs <CODIGO_ACTIVO_OPCIONAL>
const BASE = "https://spei.link"
const PANEL = "https://distribuidor-tvbox.people-ia.com"

async function head(label, url, init) {
  const res = await fetch(url, { redirect: "manual", ...init })
  const interesting = [
    "location",
    "cache-control",
    "x-robots-tag",
    "content-type",
  ]
  const headers = {}
  for (const key of interesting) {
    if (res.headers.has(key)) headers[key] = res.headers.get(key)
  }
  console.log(
    `${label}: ${res.status}${headers.location ? ` → ${headers.location}` : ""} ${JSON.stringify(headers)}`
  )
  return res
}

async function main() {
  const activeCode = process.argv[2]

  await head("raíz       ", `${BASE}/`)
  await head("desconocido", `${BASE}/ZZZZ`)
  await head("forma inválida", `${BASE}/UGP0`)
  await head("url vieja módulo", `${PANEL}/modulos/orden-de-pago`)
  await head("url anterior  ", `${PANEL}/modulos/ligas-de-pago`)
  await head("url nueva módulo", `${PANEL}/modulos/links-de-pago`)
  await head("login panel", `${PANEL}/login`)

  if (activeCode) {
    const res = await head("código activo", `${BASE}/${activeCode}`)
    const target = res.headers.get("location") ?? ""
    if (res.status === 302 && target) {
      const decoded = decodeURIComponent(target)
      const code = activeCode.trim().toUpperCase()
      console.log(
        `texto prellenado OK: ${decoded.includes("Solicito un link de pago por")}`
      )
      // El mensaje lleva el CÓDIGO del link: es lo que identifica la orden
      // cuando hay varias pendientes del mismo importe.
      console.log(`código del link en el texto OK: ${decoded.includes(`(código ${code})`)}`)
    }
  }

  // Chunks estáticos del login (verificación estándar de hidratación).
  const login = await fetch(`${PANEL}/login`)
  const html = await login.text()
  const chunks = [
    ...new Set(html.match(/\/_next\/static\/chunks\/[^"]+\.(?:js|css)/g) ?? []),
  ]
  let bad = 0
  for (const chunk of chunks) {
    const res = await fetch(`${PANEL}${chunk}`, { method: "HEAD" })
    if (res.status !== 200) {
      bad += 1
      console.log(`CHUNK ${res.status}: ${chunk}`)
    }
  }
  console.log(`chunks: ${chunks.length - bad}/${chunks.length} OK`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
