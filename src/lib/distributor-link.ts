/**
 * Valor del item "sin distribuidor" del select del formulario de edición de
 * usuarios (Base UI Select no admite value ""). Lo comparten el formulario
 * (users-list.tsx) y el server action (actions/users.ts) para que el
 * sentinel no pueda divergir entre cliente y servidor: si divergiera,
 * "Not linked" guardaría el literal como nombre de distribuidor en vez de
 * desligar.
 */
export const DISTRIBUTOR_LINK_NONE = "__none__"
