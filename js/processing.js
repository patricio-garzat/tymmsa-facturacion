// Capa de procesamiento.
// Responsabilidad única: tomar el JSON crudo del Sheet y convertirlo en
// un modelo normalizado y tipado que el resto de la app pueda consumir
// sin volver a pensar en el formato original de la hoja.

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];
const MESES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function monthShortName(m) {
  return MESES[m - 1] || "";
}
export function monthLongName(m) {
  return MESES_LARGO[m - 1] || "";
}

function parseIsoDateLocal(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function normalizeStatus(estatus) {
  const s = (estatus || "").trim().toLowerCase();
  if (s === "cobrada") return "Cobrada";
  if (s === "cancelada") return "Cancelada";
  return "Facturada";
}

function normalizeSemaforo(semaforo) {
  const s = (semaforo || "").trim().toLowerCase();
  if (s === "cobrada") return "Cobrada";
  if (s === "vencida") return "Vencida";
  if (s === "por vencer") return "Por vencer";
  return "Vigente";
}

function toIsoString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Busca el tipo de cambio FIX (Banxico) que le corresponde a una fecha de
 * factura, replicando el criterio del DOF: Banxico "determina" el FIX un
 * día, pero el DOF lo publica y lo hace válido hasta el siguiente día
 * hábil. Por eso el tipo de cambio que el DOF muestra "para el día D" es
 * en realidad el que Banxico determinó el día hábil anterior — se busca
 * empezando un día antes de la factura, y se retrocede más si ese día
 * tampoco tiene publicación (fines de semana/feriados).
 */
function findFxRate(fxRates, isoDateStr, maxLookbackDays = 8) {
  if (!fxRates) return null;
  const cursor = parseIsoDateLocal(isoDateStr);
  if (!cursor) return null;
  cursor.setDate(cursor.getDate() - 1); // día hábil anterior, como el DOF
  for (let i = 0; i <= maxLookbackDays; i++) {
    const rate = fxRates[toIsoString(cursor)];
    if (rate != null) return rate;
    cursor.setDate(cursor.getDate() - 1);
  }
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} raw { generatedAt, params, invoices, fx }
 * @returns {{ generatedAt: string, params: object, invoices: Array, years: number[], clients: string[], fx: object }}
 */
export function processRawData(raw) {
  const params = raw.params || {};
  const fx = raw.fx || { enabled: false, rates: {}, serieTitulo: null, error: null };

  let fxHistoricalCount = 0;
  let fxFallbackCount = 0;

  const invoices = (raw.invoices || [])
    .map((inv) => {
      const fecha = parseIsoDateLocal(inv.fecha);
      const vencimiento = parseIsoDateLocal(inv.vencimiento);
      const estatus = normalizeStatus(inv.estatus);
      const moneda = inv.moneda === "USD" ? "USD" : "MXN";
      const montoSinIva = Number(inv.montoSinIva) || 0;

      let mxnEquivalente = Number(inv.mxnEquivalente) || 0;
      let fxSource = "catalogos";
      let fxRate = null;

      if (moneda === "USD" && fx.enabled) {
        const rate = findFxRate(fx.rates, inv.fecha);
        if (rate != null) {
          mxnEquivalente = round2(montoSinIva * rate);
          fxSource = "banxico";
          fxRate = rate;
          fxHistoricalCount++;
        } else {
          fxFallbackCount++;
        }
      }

      return {
        factura: inv.factura,
        cliente: (inv.cliente || "Sin cliente").trim(),
        fecha,
        anio: fecha ? fecha.getFullYear() : null,
        mes: Number(inv.mes) || (fecha ? fecha.getMonth() + 1 : null),
        moneda,
        monto: Number(inv.monto) || 0,
        montoSinIva,
        mxnEquivalente,
        fxSource,
        fxRate,
        estatus,
        isCancelled: estatus === "Cancelada",
        isPaid: estatus === "Cobrada",
        condicion: inv.condicion || "",
        diasCredito: inv.diasCredito == null ? null : Number(inv.diasCredito),
        vencimiento,
        diasAtraso: inv.diasAtraso == null || inv.diasAtraso === "" ? null : Number(inv.diasAtraso),
        semaforo: normalizeSemaforo(inv.semaforo),
      };
    })
    .filter((inv) => inv.fecha instanceof Date && !isNaN(inv.fecha));

  const years = Array.from(new Set(invoices.map((i) => i.anio))).sort((a, b) => b - a);
  const clients = Array.from(new Set(invoices.map((i) => i.cliente))).sort((a, b) => a.localeCompare(b, "es"));

  return {
    generatedAt: raw.generatedAt || null,
    params: {
      iva: Number(params.iva) || 0,
      tipoCambio: Number(params.tipoCambio) || 0,
      metaAnual: Number(params.metaAnual) || 0,
      mesesCerrados: Number(params.mesesCerrados) || 0,
      ajusteConservador: Number(params.ajusteConservador) || 0,
      ajusteOptimista: Number(params.ajusteOptimista) || 0,
      diasAlertaPorVencer: Number(params.diasAlertaPorVencer) || 0,
    },
    invoices,
    years,
    clients,
    fx: {
      enabled: !!fx.enabled,
      serieTitulo: fx.serieTitulo || null,
      error: fx.error || null,
      historicalCount: fxHistoricalCount,
      fallbackCount: fxFallbackCount,
    },
  };
}
