/*
 * Tema deportivo para «Insertar detalles».
 *
 * Los datos deportivos (ganadores, campeones, resultados, marcadores,
 * clasificaciones, sedes, récords) son el caso donde el conocimiento propio
 * del modelo falla con más claridad: la memoria de un LLM mezcla temporadas,
 * guarda resultados de años viejos y los presenta con seguridad. Por eso la
 * herramienta trata cualquier petición deportiva como una petición de datos
 * que hay que verificar en la web, nunca como una petición de redacción.
 *
 * La detección es determinista (no depende del modelo) para que la ruta de
 * búsqueda forzada se active siempre que el tema sea deportivo, se escriba
 * como se escriba.
 */

/** Disciplinas deportivas (es-MX y en). */
const SPORT_TERMS: readonly RegExp[] = [
  /\bf[uú]tbol\b/i,
  /\bsoccer\b/i,
  /\bfootball\b/i,
  /\bbalonpi[eé]\b/i,
  /\bf[uú]tbol\s*americano\b/i,
  /\bbeisbol\b/i,
  /\bb[eé]isbol\b/i,
  /\bbaseball\b/i,
  /\bbasquetbol\b/i,
  /\bbasquetbol\b/i,
  /\bbasketball\b/i,
  /\btenis\b/i,
  /\btennis\b/i,
  /\bgolf\b/i,
  /\bboxeo\b/i,
  /\bboxing\b/i,
  /\bciclismo\b/i,
  /\bciclocross\b/i,
  /\bskate\w*/i,
  /\bsnowboard\w*/i,
  /\bsurf\w*/i,
  /\bski\w*/i,
  /\besqu[ií]\b/i,
  /\bpatinaje\b/i,
  /\bhockey\b/i,
  /\brugby\b/i,
  /\bvoleibol\b/i,
  /\bbalonmano\b/i,
  /\bnataci[oó]n\b/i,
  /\batletismo\b/i,
  /\btriatl\w*/i,
  /\bdecatl\w*/i,
  /\bmarat[oó]n\b/i,
  /\bmarathon\b/i,
  /\bironman\b/i,
  /\bcricket\b/i,
  /\bcurling\b/i,
  /\bwater\s*polo\b/i,
  /\bvela\b/i,
  /\bclavadas\b/i,
  /\besgrima\b/i,
  /\bjudo\b/i,
  /\bkarate\b/i,
  /\btaekwondo\b/i,
  /\bjiu[- ]jitsu\b/i,
  /\bmma\b/i,
  /\bufc\b/i,
  /\bdardos\b/i,
  /\bbillar\b/i,
  /\bpadel\b/i,
  /\bajedrez\b/i,
  /\bregata\b/i,
  /\bcanotaje\b/i,
  /\bdescenso\b/i,
  /\bmotocross\b/i,
  /\bautomovilismo\b/i,
  /\bwrestling\b/i,
  /\bbowling\b/i,
  /\be-?sports?\b/i,
  /\bcampe[oó]n(es|es)?\b/i,
  /\bplay-?offs?\b/i,
]

/** Competiciones, series y atrocities con nombre propio. */
const COMPETITION_TERMS: readonly RegExp[] = [
  /\bf1\b/i,
  /\bformula\s*(1|one|2|two|3|three|4|four|e)\b/i,
  /\bgran\s*premio\b/i,
  /\bgrand\s*prix\b/i,
  /\bgp\s+(de|del|de\s+)\w+/i,
  /\bmotogp\b/i,
  /\bmoto\s*gp\b/i,
  /\bnascar\b/i,
  /\bindycar\b/i,
  /\bwrc\b/i,
  /\bmundial\s+de\s+automovilismo\b/i,
  /\bnba\b/i,
  /\bnfl\b/i,
  /\bmlb\b/i,
  /\bnhl\b/i,
  /\bmls\b/i,
  /\bwnba\b/i,
  /\bliga\s*mx\b/i,
  /\bliga\s*de\s*expansi[oó]n\b/i,
  /\bpremier\s*league\b/i,
  /\blaliga\b/i,
  /\bla\s*liga\b/i,
  /\bbundesliga\b/i,
  /\bserie\s*a\b/i,
  /\bligue\s*1\b/i,
  /\bchampions\s*league\b/i,
  /\bliga\s*de\s*campeones\b/i,
  /\beuropa\s*league\b/i,
  /\bconference\s*league\b/i,
  /\bconferencia\s+de\s+campeones\b/i,
  /\bcopa\s*libertadores\b/i,
  /\bcopa\s*sudamericana\b/i,
  /\bcopa\s*am[eé]rica\b/i,
  /\bcopa\s*del\s*rey\b/i,
  /\bcopa\s*del\s*mundo\b/i,
  /\bcopa\s*mundial\b/i,
  /\bmundial\s+de\b/i,
  /\bworld\s*cup\b/i,
  /\beliminatorias?\b/i,
  /\bjuegos\s*ol[ií]mpicos\b/i,
  /\bol[ií]mpic[oa]s?\b/i,
  /\bparal[ií]mpicos\b/i,
  /\batp\b/i,
  /\bwta\b/i,
  /\bgrand\s*slam\b/i,
  /\broland\s*garros\b/i,
  /\bwimbledon\b/i,
  /\bindian\s*wells\b/i,
  /\bmiami\s*open\b/i,
  /\btour\s*de\s*france\b/i,
  /\bcircuito\s+de\s+imola\b/i,
  /\bsuper\s*bowl\b/i,
  /\bbal[oó]n\s+de\s+oro\b/i,
  /\bballon\s+d'or\b/i,
  /\buefa\b/i,
  /\bchampions\b/i,
  /\bliga\s+de\s+(f[uú]tbol|balonpi[eé])\b/i,
  /\bliga\s+espa[ñn]ola\b/i,
  /\bmonza\b/i,
  /\bselekci[oó]n\s+mexicana\b/i,
  /\bel\s+tri\b/i,
  /\bcheco\s+p[eé]rez\b/i,
  /\bsergio\s+p[eé]rez\b/i,
  /\bnico\s+p[eé]rez\b/i,
]

/**
 * true cuando la petición es de temática deportiva. Determina que la ruta de
 * «Insertar detalles» fuerce la búsqueda web: el modelo nunca responde con
 * datos deportivos de su memoria.
 */
export function isSportsTopic(text: string): boolean {
  if (!text || text.trim().length === 0) return false
  return (
    SPORT_TERMS.some((term) => term.test(text)) ||
    COMPETITION_TERMS.some((term) => term.test(text))
  )
}

/**
 * Reglas de investigación del tema deportivo para la fase de búsqueda: la
 * búsqueda es obligatoria, la memoria no cuenta como fuente y las consultas
 * se anclan al año de la fecha de referencia (la memoria del modelo sugiere
 * temporadas viejas).
 */
export function sportsResearchRules(moment: { iso: string; long: string }): string {
  const year = moment.iso.slice(0, 4)
  return [
    "TEMA DEPORTIVO: los datos deportivos (ganadores, campeones, resultados, marcadores, clasificaciones, posiciones, sedes, récords y fechas) NUNCA salen de tu memoria: lo que recuerdas es de temporadas viejas y se ve igual que lo verificado, así que no cuenta como fuente.",
    "Es OBLIGATORIO usar la herramienta google_search antes de responder (una o más veces, con consultas concretas sobre la competencia, el evento y la fecha de referencia). Una respuesta sin búsqueda se considera inválida y se descarta.",
    `Usa la temporada o el año de la fecha de referencia (${year}) en cada consulta y nunca un año anterior, aunque tu memoria te sugiera otro: "ganadores últimos cinco Grandes Premios de Fórmula 1 ${year}", "resultados ${moment.long} ${year}".`,
    "Confirma cada dato con 2 o 3 páginas de medios distintos (dos páginas del mismo medio no valen) y cita las URLs exactas de esas páginas.",
    "Si la búsqueda no confirma un dato, no lo incluyas y repórtalo como AVISO: es preferible dejar el dato fuera antes que completarlo de memoria.",
  ].join(" ")
}
