// Capa de obtención de datos.
// Responsabilidad única: conseguir el JSON crudo {generatedAt, params, invoices}
// desde el Apps Script Web App, o desde el snapshot local si no hay conexión
// configurada o falla la red. No procesa ni calcula nada aquí.

import { CONFIG } from "./config.js";

export const DATA_SOURCE = {
  LIVE: "live",
  FALLBACK: "fallback",
};

async function fetchLive() {
  if (!CONFIG.APPS_SCRIPT_URL) return null;
  const url = `${CONFIG.APPS_SCRIPT_URL}?token=${encodeURIComponent(CONFIG.ACCESS_TOKEN)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Apps Script respondió ${res.status}`);
  const json = await res.json();
  if (json && json.error) throw new Error(json.error);
  return json;
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
