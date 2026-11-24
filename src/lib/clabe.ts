/** CLABE de 18 dígitos agrupada en bloques de 3 mientras se escribe. */
export function formatClabe(value: string): string {
  return value
    .replace(/\D/g, "")
    .slice(0, 18)
    .replace(/(\d{3})(?=\d)/g, "$1 ")
    .trim()
}

/** La CLABE se guarda SIN espacios: solo dígitos. */
export function clabeDigits(value: string): string {
  return value.replace(/\D/g, "")
}
