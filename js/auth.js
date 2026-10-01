// Capa de acceso al portal.
// Responsabilidad única: pedir una contraseña antes de mostrar cualquier
// dato, y recordar el acceso en este navegador. No es un sistema de
// cuentas de usuario ni cifra los datos en tránsito — es una barrera
// simple para que no cualquiera que encuentre el link entre a ver
// facturación real. Alguien con conocimientos técnicos podría revisar el
// código del navegador y saltársela; para eso está pensado un nivel más
// fuerte (login real vía el hosting) si algún día se necesita.

import { CONFIG } from "./config.js?v=20261001g";

const STORAGE_KEY = "tymmsa_portal_unlocked_v1";

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isUnlocked() {
  return localStorage.getItem(STORAGE_KEY) === CONFIG.AUTH_PASSWORD_HASH;
}

export async function tryUnlock(password) {
  const hash = await sha256Hex(password || "");
  if (hash === CONFIG.AUTH_PASSWORD_HASH) {
    localStorage.setItem(STORAGE_KEY, hash);
    return true;
  }
  return false;
}

export function lock() {
  localStorage.removeItem(STORAGE_KEY);
}
