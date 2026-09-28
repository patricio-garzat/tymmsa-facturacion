// Capa de obtención de datos (tipo de cambio).
// Responsabilidad única: traer del API de Banco de México (SIE) el tipo de
// cambio FIX real por fecha — el mismo valor que publica el DOF — para que
// el procesamiento pueda convertir cada factura en USD con el tipo de
// cambio del día en que se facturó, en vez de un tipo de cambio fijo único.
//
// Llamada directa desde el navegador: el API de Banxico responde con
// encabezados CORS habilitados, así que no hace falta pasar por el backend.

import { CONFIG } from "./config.js";

const EMPTY_RESULT = { enabled: false, rates: {}, serieTitulo: null, error: null };

function banxicoDateToIso(fecha) {
  const [d, m, y] = String(fecha).split("/");
  if (!d || !m || !y) return fecha;
  return `${y}-${m}-${d}`;
}

function shiftIsoDate(isoDateStr, days) {
  const [y, m, d] = isoDateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * @param {string} startDateIso "YYYY-MM-DD"
 * @param {string} endDateIso "YYYY-MM-DD"
 */
export async function fetchFixRates(startDateIso, endDateIso) {
  if (!CONFIG.BANXICO_TOKEN) return EMPTY_RESULT;

  const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${CONFIG.BANXICO_SERIE_FIX}/datos/${startDateIso}/${endDateIso}?token=${encodeURIComponent(CONFIG.BANXICO_TOKEN)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      return { enabled: true, rates: {}, serieTitulo: null, error: `Banxico HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = await res.json();
    const serie = json.bmx && json.bmx.series && json.bmx.series[0];
    if (!serie) {
      return { enabled: true, rates: {}, serieTitulo: null, error: "Respuesta de Banxico sin datos de serie" };
    }

    const rates = {};
    (serie.datos || []).forEach((d) => {
      const valor = parseFloat(d.dato);
      if (isNaN(valor)) return; // "N/E" en fines de semana/feriados
      rates[banxicoDateToIso(d.fecha)] = valor;
    });

    return { enabled: true, rates, serieTitulo: serie.titulo || null, error: null };
  } catch (err) {
    return { enabled: true, rates: {}, serieTitulo: null, error: err.message || String(err) };
  }
}

/**
 * Determina el rango de fechas a pedirle a Banxico a partir de las facturas
 * en USD del JSON crudo del Sheet (antes de procesar), y trae los datos.
 */
export async function fetchFixRatesForInvoices(rawInvoices) {
  if (!CONFIG.BANXICO_TOKEN) return EMPTY_RESULT;

  const usdDates = (rawInvoices || [])
    .filter((inv) => inv.moneda === "USD" && inv.fecha)
    .map((inv) => inv.fecha);

  if (!usdDates.length) return { ...EMPTY_RESULT, enabled: true };

  const earliest = usdDates.reduce((min, d) => (d < min ? d : min), usdDates[0]);
  // El tipo de cambio de una factura se busca un día hábil antes de su
  // fecha (así lo publica el DOF), así que pedimos unos días extra de
  // colchón antes de la factura más antigua para no quedarnos cortos.
  const startDate = shiftIsoDate(earliest, -8);
  const endDate = new Date().toISOString().slice(0, 10);

  return fetchFixRates(startDate, endDate);
}
