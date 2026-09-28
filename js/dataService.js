// Capa de obtención de datos.
// Responsabilidad única: conseguir el JSON crudo {generatedAt, params, invoices}
// desde el Apps Script Web App, o desde el snapshot local si no hay conexión
// configurada o falla la red. No procesa ni calcula nada aquí.

import { CONFIG } from "./config.js?v=20260928c";

export const DATA_SOURCE = {
  LIVE: "live",
  FALLBACK: "fallback",
  CACHE: "cache",
};

const CACHE_KEY = "tymmsa_data_cache_v1";

/**
 * Último JSON en vivo que sí llegó a cargar, guardado en este navegador.
 * Sirve para pintar la pantalla al instante en la siguiente visita,
 * mientras Apps Script responde en segundo plano (puede tardar varios
 * segundos "en frío"). No sustituye al dato en vivo, sólo evita la
 * espera en pantalla.
 */
export function getCachedRaw() {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && parsed.raw ? parsed : null;
  } catch {
    return null;
  }
}

export function setCachedRaw(raw) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ raw, cachedAt: new Date().toISOString() }));
  } catch {
    // localStorage lleno o bloqueado: no es crítico, simplemente no cachea.
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLiveOnce() {
  const url = `${CONFIG.APPS_SCRIPT_URL}?token=${encodeURIComponent(CONFIG.ACCESS_TOKEN)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Apps Script respondió ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error(json.error);
  return json;
}

// Apps Script es lento y a veces falla de forma pasajera (sobre todo
// "en frío", tras un rato sin uso). Antes de rendirnos y mostrar el
// snapshot de respaldo, reintentamos un par de veces.
async function fetchLive() {
  if (!CONFIG.APPS_SCRIPT_URL) return null;
  const delaysMs = [800, 2000];
  let lastError = null;

  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fetchLiveOnce();
    } catch (err) {
      lastError = err;
      if (attempt < delaysMs.length) await wait(delaysMs[attempt]);
    }
  }
  throw lastError;
}

async function fetchFallback() {
  const res = await fetch(CONFIG.FALLBACK_DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo leer ${CONFIG.FALLBACK_DATA_URL}`);
  return res.json();
}

/**
 * Devuelve { raw, source, error } donde:
 * - raw: { generatedAt, params, invoices } o null si todo falló
 * - source: DATA_SOURCE.LIVE | DATA_SOURCE.FALLBACK
 * - error: mensaje si la conexión en vivo fue intentada y falló (aunque
 *   haya datos de respaldo disponibles, para poder avisar en la UI)
 */
export async function loadInvoiceData() {
  let liveError = null;

  if (CONFIG.APPS_SCRIPT_URL) {
    try {
      const raw = await fetchLive();
      if (raw) return { raw, source: DATA_SOURCE.LIVE, error: null };
    } catch (err) {
      liveError = err.message || String(err);
    }
  }

  const raw = await fetchFallback();
  return { raw, source: DATA_SOURCE.FALLBACK, error: liveError };
}
