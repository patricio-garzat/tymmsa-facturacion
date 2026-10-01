// Capa de cálculos.
// Responsabilidad única: dado un conjunto de facturas (ya procesadas y
// filtradas), producir los números que la UI necesita. Funciones puras,
// sin acceso a DOM ni a red.

import { ALL, applyFilters, applyFiltersIgnoringMonth } from "./filters.js?v=20261001f";

export function sumBy(invoices, field) {
  return invoices.reduce((acc, inv) => acc + (Number(inv[field]) || 0), 0);
}

export function countInvoices(invoices) {
  return invoices.length;
}

export function uniqueClients(invoices) {
  return new Set(invoices.map((i) => i.cliente)).size;
}

/**
 * Resumen de totales para la tabla de Facturación: desglosa por moneda
 * (sin IVA / con IVA para MXN, original y convertido para USD) y da el
 * total en MXN equivalente combinando ambas monedas. Las facturas
 * canceladas no cuentan, igual que en el resto del portal.
 */
export function computeFacturacionSummary(invoices) {
  const active = invoices.filter((inv) => !inv.isCancelled);
  const mxn = active.filter((inv) => inv.moneda === "MXN");
  const usd = active.filter((inv) => inv.moneda === "USD");

  const mxnSinIva = sumBy(mxn, "montoSinIva");
  const mxnConIva = sumBy(mxn, "monto");
  const usdOriginal = sumBy(usd, "monto");
  const usdEnMxn = sumBy(usd, "mxnEquivalente");

  return {
    mxnSinIva,
    mxnConIva,
    usdOriginal,
    usdEnMxn,
    totalMxn: mxnSinIva + usdEnMxn,
  };
}

/**
 * Determina el período de comparación "anterior" equivalente al período
 * definido por los filtros actuales, manteniendo cliente/moneda fijos.
 * Devuelve null si no hay una comparación razonable (p. ej. año = Todos).
 */
export function getComparisonFilters(filters) {
  if (filters.anio === ALL) return null;

  if (filters.mes !== ALL) {
    // Mes anterior (puede cruzar a diciembre del año previo)
    if (filters.mes === 1) {
      return { ...filters, anio: filters.anio - 1, mes: 12 };
    }
    return { ...filters, mes: filters.mes - 1 };
  }

  // Año completo -> año anterior
  return { ...filters, anio: filters.anio - 1 };
}

/**
 * Para comparar año vs año de forma justa, recorta el año anterior a los
 * mismos meses que tienen datos en el año actual (comparación "a la fecha").
 */
export function getYtdAlignedComparisonInvoices(allInvoices, filters, currentPeriodInvoices) {
  const compFilters = getComparisonFilters(filters);
  if (!compFilters) return { filters: null, invoices: [] };

  if (filters.mes !== ALL) {
    return { filters: compFilters, invoices: applyFilters(allInvoices, compFilters) };
  }

  const monthsWithData = new Set(currentPeriodInvoices.map((i) => i.mes));
  const maxMonth = monthsWithData.size ? Math.max(...monthsWithData) : 12;

  const candidateInvoices = applyFilters(allInvoices, compFilters).filter((i) => i.mes <= maxMonth);
  return { filters: compFilters, invoices: candidateInvoices, maxMonth };
}

export function computeDelta(current, previous) {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * KPIs principales del dashboard, ya resueltos contra los filtros activos.
 */
export function computeHeadlineKpis(dataset, filters) {
  const { invoices } = dataset;

  const periodInvoices = applyFilters(invoices, filters);
  const yearInvoices = applyFiltersIgnoringMonth(invoices, filters);

  const periodTotal = sumBy(periodInvoices, "mxnEquivalente");
  const yearTotal = sumBy(yearInvoices, "mxnEquivalente");
  const periodCount = countInvoices(periodInvoices);
  const ticketPromedio = periodCount ? periodTotal / periodCount : 0;

  const { invoices: comparisonInvoices, filters: comparisonFilters } = getYtdAlignedComparisonInvoices(
    invoices,
    filters,
    periodInvoices
  );
  const comparisonTotal = comparisonFilters ? sumBy(comparisonInvoices, "mxnEquivalente") : null;
  const delta = comparisonFilters ? computeDelta(periodTotal, comparisonTotal) : null;

  return {
    periodTotal,
    yearTotal,
    periodCount,
    ticketPromedio,
    delta,
    hasComparison: comparisonFilters !== null && countInvoices(comparisonInvoices) > 0,
    comparisonFilters,
  };
}

/**
 * Serie mensual (Ene-Dic) de facturación para un año dado, respetando
 * cliente/moneda de los filtros pero ignorando año/mes.
 */
export function computeMonthlySeries(dataset, year, filters) {
  const scoped = applyFilters(dataset.invoices, { ...filters, anio: year, mes: ALL });
  const totals = Array(12).fill(0);
  const counts = Array(12).fill(0);
  scoped.forEach((inv) => {
    const idx = inv.mes - 1;
    if (idx >= 0 && idx < 12) {
      totals[idx] += inv.mxnEquivalente;
      counts[idx] += 1;
    }
  });
  return { totals, counts };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const DEFAULT_ACTIVITY_THRESHOLDS = { seguimientoMonths: 2, inactivoMonths: 4 };

/**
 * Actividad por cliente: cuándo fue su última factura y, según los
 * umbrales en meses que el usuario defina, si eso cuenta como Activo,
 * Seguimiento o Inactivo. Los umbrales son iguales para todos los
 * clientes (no se ajustan por el ritmo propio de cada uno) — el usuario
 * decide directamente a partir de cuántos meses quiere ver cada estado.
 *
 * Siempre se calcula sobre el historial COMPLETO (todas las facturas que
 * existan, sin importar los filtros de Año/Mes/Moneda activos en el
 * portal), porque la pregunta que responde — "¿sigue activo este
 * cliente?" — no depende de qué período esté viendo el usuario ahora.
 */
export function computeClientActivity(invoices, thresholds = DEFAULT_ACTIVITY_THRESHOLDS, today = new Date()) {
  const seguimientoDays = (thresholds.seguimientoMonths ?? DEFAULT_ACTIVITY_THRESHOLDS.seguimientoMonths) * 30;
  const inactivoDays = (thresholds.inactivoMonths ?? DEFAULT_ACTIVITY_THRESHOLDS.inactivoMonths) * 30;

  const byClient = new Map();

  invoices.forEach((inv) => {
    if (!(inv.fecha instanceof Date) || isNaN(inv.fecha)) return;
    if (!byClient.has(inv.cliente)) byClient.set(inv.cliente, []);
    byClient.get(inv.cliente).push(inv.fecha);
  });

  const activity = new Map();

  byClient.forEach((dates, cliente) => {
    const sorted = [...dates].sort((a, b) => a - b);
    const ultimaFactura = sorted[sorted.length - 1];
    const diasSinFacturar = Math.floor((today - ultimaFactura) / MS_PER_DAY);

    let status = "activo";
    if (diasSinFacturar >= inactivoDays) status = "critico";
    else if (diasSinFacturar >= seguimientoDays) status = "atencion";

    activity.set(cliente, { ultimaFactura, diasSinFacturar, status });
  });

  return activity;
}

export function computeClientRanking(invoices) {
  const total = sumBy(invoices, "mxnEquivalente");
  const byClient = new Map();

  invoices.forEach((inv) => {
    if (!byClient.has(inv.cliente)) {
      byClient.set(inv.cliente, {
        cliente: inv.cliente,
        facturas: 0,
        mxnEquivalente: 0,
        montoMxnConIva: 0,
        montoUsd: 0,
      });
    }
    const c = byClient.get(inv.cliente);
    c.facturas += 1;
    c.mxnEquivalente += inv.mxnEquivalente;
    if (inv.moneda === "MXN") c.montoMxnConIva += inv.monto;
    if (inv.moneda === "USD") c.montoUsd += inv.monto;
  });

  return Array.from(byClient.values())
    .map((c) => ({
      ...c,
      pctDelTotal: total ? c.mxnEquivalente / total : 0,
      ticketPromedio: c.facturas ? c.mxnEquivalente / c.facturas : 0,
    }))
    .sort((a, b) => b.mxnEquivalente - a.mxnEquivalente);
}

export function computeCurrencyMix(invoices) {
  const total = sumBy(invoices, "mxnEquivalente");
  const mxn = invoices.filter((i) => i.moneda === "MXN");
  const usd = invoices.filter((i) => i.moneda === "USD");
  const mxnTotal = sumBy(mxn, "mxnEquivalente");
  const usdTotalMxnEquiv = sumBy(usd, "mxnEquivalente");
  return {
    mxnTotalConIva: sumBy(mxn, "monto"),
    mxnTotalEquiv: mxnTotal,
    usdTotalOriginal: sumBy(usd, "monto"),
    usdTotalMxnEquiv,
    mxnPct: total ? mxnTotal / total : 0,
    usdPct: total ? usdTotalMxnEquiv / total : 0,
    total,
  };
}

export function computeConcentration(clientRanking) {
  const top1 = clientRanking[0];
  const top3Sum = clientRanking.slice(0, 3).reduce((acc, c) => acc + c.mxnEquivalente, 0);
  const total = clientRanking.reduce((acc, c) => acc + c.mxnEquivalente, 0);
  const top1Pct = top1 ? top1.pctDelTotal : 0;
  const top3Pct = total ? top3Sum / total : 0;

  let riesgo = "BAJO";
  if (top1Pct >= 0.5) riesgo = "ALTO";
  else if (top1Pct >= 0.3) riesgo = "MEDIO";

  return { top1, top1Pct, top3Pct, riesgo };
}

/**
 * Cartera: agrupa facturas no pagadas y no canceladas por semáforo de cobranza.
 */
export function computeAging(invoices) {
  const pending = invoices.filter((i) => !i.isPaid && !i.isCancelled);
  const buckets = { Vigente: [], "Por vencer": [], Vencida: [] };
  pending.forEach((inv) => {
    const key = buckets[inv.semaforo] ? inv.semaforo : "Vigente";
    buckets[key].push(inv);
  });

  const total = sumBy(pending, "mxnEquivalente");
  const summarize = (arr) => ({
    facturas: arr.length,
    monto: sumBy(arr, "mxnEquivalente"),
    pct: total ? sumBy(arr, "mxnEquivalente") / total : 0,
  });

  return {
    total,
    totalFacturas: pending.length,
    vigente: summarize(buckets.Vigente),
    porVencer: summarize(buckets["Por vencer"]),
    vencida: summarize(buckets.Vencida),
  };
}

/**
 * Proyección de cierre de año, replicando la metodología del propio
 * Google Sheet (CATALOGOS): promedio de meses cerrados extrapolado a los
 * meses restantes, con escenarios conservador / base / optimista.
 */
export function computeProjection(dataset, year, filters) {
  const { params } = dataset;
  const mesesCerrados = Math.max(0, Math.min(12, Math.round(params.mesesCerrados)));
  if (mesesCerrados <= 0) return null;

  const { totals } = computeMonthlySeries(dataset, year, filters);
  const closedTotals = totals.slice(0, mesesCerrados);
  const acumulado = closedTotals.reduce((a, b) => a + b, 0);
  const promedioBase = acumulado / mesesCerrados;
  const mesesFaltantes = 12 - mesesCerrados;

  // Total realmente facturado a la fecha (todos los meses con datos, incluyendo
  // meses aún no marcados como "cerrados" en CATALOGOS). Distinto de `acumulado`,
  // que sólo usa los meses cerrados como base del promedio/proyección.
  const totalActual = totals.reduce((a, b) => a + b, 0);

  const scenario = (ajuste) => {
    const promedio = promedioBase * (1 + ajuste);
    const proyeccion = acumulado + promedio * mesesFaltantes;
    return { promedio, proyeccion };
  };

  const conservador = scenario(params.ajusteConservador);
  const base = scenario(0);
  const optimista = scenario(params.ajusteOptimista);

  return {
    mesesCerrados,
    mesesFaltantes,
    acumulado,
    promedioBase,
    totalActual,
    metaAnual: params.metaAnual,
    conservador,
    base,
    optimista,
    avanceMeta: params.metaAnual ? totalActual / params.metaAnual : null,
    faltaParaMeta: params.metaAnual ? params.metaAnual - totalActual : null,
  };
}
