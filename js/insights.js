// Capa de insights.
// Responsabilidad única: convertir números ya calculados en frases en
// español. No calcula nada nuevo, no accede a datos crudos. Cada insight
// sólo se agrega si el dato que lo sustenta existe (nada se inventa).

import { ALL, applyFilters, applyFiltersIgnoringMonth } from "./filters.js?v=20261001a";
import {
  computeMonthlySeries,
  computeClientRanking,
  computeConcentration,
  computeCurrencyMix,
  computeAging,
  computeHeadlineKpis,
  sumBy,
} from "./calculations.js?v=20261001a";
import { monthLongName, monthShortName } from "./processing.js?v=20261001a";
import { formatMoney, formatPct } from "./format.js?v=20261001a";

export function generateInsights(dataset, filters) {
  const insights = [];
  const year = filters.anio === ALL ? Math.max(...dataset.years) : filters.anio;
  if (!year) return insights;

  const yearInvoices = applyFiltersIgnoringMonth(dataset.invoices, { ...filters, anio: year });
  if (!yearInvoices.length) return insights;

  // Mejor mes del año
  const { totals } = computeMonthlySeries(dataset, year, filters);
  const monthsWithData = totals
    .map((total, idx) => ({ mes: idx + 1, total }))
    .filter((m) => m.total > 0);

  if (monthsWithData.length >= 2) {
    const sorted = [...monthsWithData].sort((a, b) => b.total - a.total);
    const best = sorted[0];
    const second = sorted[1];
    insights.push(
      `${monthLongName(best.mes)} es el mes con mayor facturación de ${year}, con ${formatMoney(best.total)}.`
    );
    if (second) {
      insights.push(
        `${monthLongName(second.mes)} es actualmente el segundo mes con mayor facturación del año (${formatMoney(second.total)}).`
      );
    }
  }

  // Concentración de clientes
  const clientRanking = computeClientRanking(yearInvoices);
  if (clientRanking.length) {
    const { top1, top1Pct, top3Pct, riesgo } = computeConcentration(clientRanking);
    if (top1) {
      insights.push(
        `${top1.cliente} representa el ${formatPct(top1Pct)} de la facturación de ${year}${clientRanking.length > 1 ? ` (los 3 clientes principales suman ${formatPct(top3Pct)})` : ""}.`
      );
    }
    if (clientRanking.length >= 3 && riesgo !== "BAJO") {
      insights.push(
        `La concentración de clientes es ${riesgo === "ALTO" ? "alta" : "media"}: conviene diversificar la cartera de clientes.`
      );
    }
  }

  // Comparación de período (usa el mismo cálculo que el KPI principal)
  const kpis = computeHeadlineKpis(dataset, filters);
  if (kpis.hasComparison && kpis.delta !== null) {
    const periodLabel = filters.mes !== ALL ? monthLongName(filters.mes) : `el año ${year}`;
    const direction = kpis.delta >= 0 ? "aumentó" : "disminuyó";
    insights.push(
      `La facturación de ${periodLabel} ${direction} ${formatPct(Math.abs(kpis.delta))} respecto al período anterior comparable.`
    );
  }

  // Mezcla de moneda
  const mix = computeCurrencyMix(yearInvoices);
  if (mix.total > 0 && mix.usdTotalOriginal > 0 && mix.mxnTotalConIva > 0) {
    insights.push(
      `${formatPct(mix.mxnPct)} de la facturación de ${year} es en MXN y ${formatPct(mix.usdPct)} en USD (equivalente).`
    );
  }

  // Cartera vencida
  const aging = computeAging(yearInvoices);
  if (aging.vencida.facturas > 0) {
    insights.push(
      `Hay ${formatMoney(aging.vencida.monto)} en cartera vencida (${aging.vencida.facturas} factura${aging.vencida.facturas === 1 ? "" : "s"}, ${formatPct(aging.vencida.pct)} de la cartera por cobrar).`
    );
  }

  return insights;
}
