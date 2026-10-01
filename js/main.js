// Punto de entrada. Orquesta: obtención -> procesamiento -> estado de
// filtros -> cálculos -> visualización. No contiene reglas de negocio ni
// manipulación de DOM directa (eso vive en calculations.js y ui.js).

import { CONFIG } from "./config.js?v=20261001g";
import { loadInvoiceData, getCachedRaw, setCachedRaw, DATA_SOURCE } from "./dataService.js?v=20261001g";
import { fetchFixRatesForInvoices, getCachedFx } from "./fxService.js?v=20261001g";
import { processRawData, monthShortName, monthLongName } from "./processing.js?v=20261001g";
import { ALL, createFilterState, applyFilters } from "./filters.js?v=20261001g";
import {
  computeHeadlineKpis,
  computeMonthlySeries,
  computeClientRanking,
  computeClientActivity,
  computeCurrencyMix,
  computeConcentration,
  computeAging,
  computeProjection,
  computeFacturacionSummary,
} from "./calculations.js?v=20261001g";
import { generateInsights } from "./insights.js?v=20261001g";
import { formatMoney, formatMoneyCompact, formatDate } from "./format.js?v=20261001g";
import { renderMonthlyChart } from "./charts.js?v=20261001g";
import { exportInvoicesToExcel } from "./exportExcel.js?v=20261001g";
import { isUnlocked, tryUnlock, lock } from "./auth.js?v=20261001g";
import * as ui from "./ui.js?v=20261001g";

const state = {
  dataset: null,
  filters: createFilterState(),
  compareYear: null,
  selectedClient: null,
  facturacion: { search: "", sortKey: "factura", sortDir: "asc", expandedId: null, page: 1 },
};

// Última tabla renderizada en Facturación, para que exportar/imprimir usen
// exactamente lo que el usuario está viendo (mismos filtros, búsqueda y orden).
let lastFacturacionView = { invoices: [], summary: null, filterLabel: "" };

function describeFilters(filters, search) {
  const parts = [];
  parts.push(`Año: ${filters.anio === ALL ? "Todos" : filters.anio}`);
  parts.push(`Mes: ${filters.mes === ALL ? "Todos" : monthLongName(filters.mes)}`);
  parts.push(`Cliente: ${filters.cliente === ALL ? "Todos" : filters.cliente}`);
  parts.push(`Moneda: ${filters.moneda === ALL ? "Todas" : filters.moneda}`);
  if (search && search.trim()) parts.push(`Búsqueda: "${search.trim()}"`);
  return parts.join(" · ");
}

async function boot() {
  ui.wireNav(() => {});
  ui.wireThemeToggle();
  ui.wireFilters(onFiltersChange);
  ui.wireCompareYear(onCompareYearChange);
  ui.wireFacturacionControls(onFacturacionSearch, onFacturacionSort);
  ui.wireFacturacionActions(onFacturacionExport, onFacturacionPrint);
  ui.wireFacturacionPagination(onFacturacionPrevPage, onFacturacionNextPage);
  ui.wireClientDetailClose(() => {
    state.selectedClient = null;
    renderClientesTab();
  });
  ui.wireClientActivitySettings(() => renderClientesTab());

  // Apps Script puede tardar varios segundos "en frío". Si ya tenemos algo
  // guardado de una visita anterior, lo pintamos de inmediato (sin esperar
  // la red) y actualizamos en segundo plano — así no se ve una pantalla de
  // carga larga cada vez que alguien abre el portal.
  const cached = getCachedRaw();
  if (cached) {
    await applyRawData(cached.raw, { source: DATA_SOURCE.CACHE, error: null }, true, { preferCachedFx: true });
    ui.showApp();
    loadAndRender(false);
  } else {
    await loadAndRender(true);
  }

  if (CONFIG.APPS_SCRIPT_URL) {
    setInterval(() => loadAndRender(false), CONFIG.REFRESH_INTERVAL_MS);
  }
}

async function loadAndRender(isInitial) {
  try {
    if (isInitial) ui.setLoadingText("Cargando facturación desde Google Sheets…");
    const { raw, source, error } = await loadInvoiceData();
    if (source === DATA_SOURCE.LIVE) setCachedRaw(raw);
    await applyRawData(raw, { source, error }, isInitial);
  } catch (err) {
    if (isInitial) {
      ui.setLoadingText(`Error cargando datos: ${err.message || err}`);
      ui.setSyncStatus("error", "Error de carga");
    }
    return;
  } finally {
    if (isInitial) ui.showApp();
  }
}

/**
 * Procesa un JSON crudo ya obtenido (en vivo, de caché, o de respaldo) y
 * lo refleja en la interfaz. Separado de loadAndRender para poder pintar
 * con datos de caché sin tener que esperar ninguna llamada de red primero.
 */
async function applyRawData(raw, { source, error }, isInitial, { preferCachedFx = false } = {}) {
  // En la pintura instantánea desde caché no queremos esperar ninguna
  // llamada de red — ni siquiera a Banxico. Si ya hay un tipo de cambio
  // guardado de una visita anterior, se usa tal cual (se actualiza solo,
  // porque el refresco en segundo plano sí trae uno fresco después).
  const cachedFx = preferCachedFx ? getCachedFx() : null;
  raw.fx = cachedFx || (await fetchFixRatesForInvoices(raw.invoices));
  state.dataset = processRawData(raw);

  if (isInitial) {
    const years = state.dataset.years;
    state.filters.anio = years.length ? years[0] : ALL;
    ui.populateFilterOptions(state.dataset);
    ui.syncFilterInputs(state.filters);
  }

  const banners = [];
  if (source === DATA_SOURCE.LIVE) {
    ui.setSyncStatus("live", "Conectado a Google Sheets");
  } else if (source === DATA_SOURCE.CACHE) {
    ui.setSyncStatus("offline", "Datos guardados — actualizando…");
  } else if (!CONFIG.APPS_SCRIPT_URL) {
    ui.setSyncStatus("offline", "Datos de ejemplo (sin conexión configurada)");
    banners.push(
      "El portal aún no está conectado en vivo a Google Sheets. Está mostrando el último snapshot exportado. Sigue las instrucciones en <code>apps-script/Code.gs</code> para conectar en vivo."
    );
  } else {
    ui.setSyncStatus("error", "Sin conexión — mostrando datos de respaldo");
    banners.push(`No se pudo conectar con Google Sheets (${error || "error desconocido"}). Mostrando el último snapshot disponible.`);
  }

  if (state.dataset.fx.enabled && state.dataset.fx.error) {
    banners.push(
      `No se pudo obtener el tipo de cambio histórico de Banxico (${state.dataset.fx.error}). Las facturas en USD usan el tipo de cambio fijo de CATALOGOS mientras tanto.`
    );
  }
  ui.renderDashboardBanner(banners);

  ui.renderGeneratedAt(state.dataset.generatedAt);
  renderAll();
}

function getContextYear() {
  if (state.filters.anio !== ALL) return state.filters.anio;
  return state.dataset.years.length ? state.dataset.years[0] : new Date().getFullYear();
}

function renderAll() {
  renderDashboardTab();
  renderFacturacionTab();
  renderClientesTab();
  renderAnalisisTab();
}

/* ---------------- Dashboard ---------------- */

function renderDashboardTab() {
  const { dataset, filters } = state;
  const contextYear = getContextYear();

  const kpis = computeHeadlineKpis(dataset, filters);
  ui.renderKpis(kpis, filters, contextYear);

  const periodInvoices = applyFilters(dataset.invoices, filters);
  const topClients = computeClientRanking(periodInvoices);
  ui.renderTopClientsTable(topClients);

  ui.populateCompareYearOptions(dataset.years, contextYear, state.compareYear);
  renderMonthlyChartFor(contextYear);

  const insights = generateInsights(dataset, filters);
  ui.renderInsights(insights);
}

function renderMonthlyChartFor(contextYear) {
  const { dataset, filters, compareYear } = state;
  const labels = Array.from({ length: 12 }, (_, i) => monthShortName(i + 1));
  const seriesA = computeMonthlySeries(dataset, contextYear, filters).totals;
  const seriesB = compareYear ? computeMonthlySeries(dataset, compareYear, filters).totals : null;

  renderMonthlyChart("chart-monthly", {
    labels,
    seriesA,
    labelA: String(contextYear),
    seriesB,
    labelB: compareYear ? String(compareYear) : null,
    moneyFormatter: (v, compact) => (compact ? formatMoneyCompact(v) : formatMoney(v)),
  });
}

function onCompareYearChange(year) {
  state.compareYear = year;
  renderMonthlyChartFor(getContextYear());
}

/* ---------------- Facturación ---------------- */

function renderFacturacionTab() {
  const { dataset, filters, facturacion } = state;
  let invoices = applyFilters(dataset.invoices, filters, { includeCancelled: true });

  if (facturacion.search.trim()) {
    const q = facturacion.search.trim().toLowerCase();
    invoices = invoices.filter(
      (inv) =>
        inv.factura.toLowerCase().includes(q) ||
        inv.cliente.toLowerCase().includes(q) ||
        formatDate(inv.fecha).toLowerCase().includes(q) ||
        formatDate(inv.vencimiento).toLowerCase().includes(q)
    );
  }

  const summary = computeFacturacionSummary(invoices);
  ui.renderFacturacionSummary(summary);

  invoices = sortInvoices(invoices, facturacion.sortKey, facturacion.sortDir);

  const filterLabel = describeFilters(filters, facturacion.search);
  ui.renderPrintHeader(filterLabel, invoices.length);
  lastFacturacionView = { invoices, summary, filterLabel };

  const totalPages = Math.max(1, Math.ceil(invoices.length / ui.FACTURACION_PAGE_SIZE));
  if (facturacion.page > totalPages) facturacion.page = totalPages;
  if (facturacion.page < 1) facturacion.page = 1;

  ui.renderFacturacionTable(invoices, facturacion, (id) => {
    facturacion.expandedId = facturacion.expandedId === id ? null : id;
    renderFacturacionTab();
  });
  ui.applyFacturacionPage(facturacion.page);
  ui.renderFacturacionPagination(facturacion.page, totalPages);
}

function onFacturacionPrevPage() {
  if (state.facturacion.page > 1) {
    state.facturacion.page -= 1;
    renderFacturacionTab();
  }
}

function onFacturacionNextPage() {
  state.facturacion.page += 1;
  renderFacturacionTab();
}

async function onFacturacionExport() {
  const { invoices, summary, filterLabel } = lastFacturacionView;
  const datePart = new Date().toISOString().slice(0, 10);
  ui.setExportButtonState(true, "Generando…");
  const ok = await exportInvoicesToExcel({
    invoices,
    summary,
    filterLabel,
    fileName: `tymmsa-facturacion-${datePart}.xlsx`,
  });
  ui.setExportButtonState(false);
  if (!ok) {
    alert("No se pudo generar el Excel: no cargó el módulo de exportación (revisa tu conexión a internet e intenta de nuevo).");
  }
}

function onFacturacionPrint() {
  window.print();
}

function sortInvoices(invoices, key, dir) {
  const mult = dir === "asc" ? 1 : -1;
  return [...invoices].sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (va instanceof Date) va = va.getTime();
    if (vb instanceof Date) vb = vb.getTime();
    if (key === "factura") {
      const na = parseInt(String(va).replace(/\D/g, ""), 10);
      const nb = parseInt(String(vb).replace(/\D/g, ""), 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return (na - nb) * mult;
    }
    if (typeof va === "string") return va.localeCompare(vb, "es") * mult;
    return ((va ?? 0) - (vb ?? 0)) * mult;
  });
}

function onFacturacionSearch(value) {
  state.facturacion.search = value;
  state.facturacion.page = 1;
  renderFacturacionTab();
}

function onFacturacionSort(key) {
  const f = state.facturacion;
  if (f.sortKey === key) {
    f.sortDir = f.sortDir === "asc" ? "desc" : "asc";
  } else {
    f.sortKey = key;
    f.sortDir = key === "fecha" || key === "vencimiento" || key === "mxnEquivalente" ? "desc" : "asc";
  }
  f.page = 1;
  renderFacturacionTab();
}

/* ---------------- Clientes ---------------- */

function renderClientesTab() {
  const { dataset, filters, selectedClient } = state;
  const periodInvoices = applyFilters(dataset.invoices, filters);
  const ranking = computeClientRanking(periodInvoices);

  // La actividad (última factura) se calcula sobre TODO el historial, no
  // sólo el período filtrado: la pregunta "¿sigue activo?" no depende de
  // qué Año/Mes esté viendo el usuario en este momento. Los umbrales en
  // meses los define el usuario (controles arriba de la tabla).
  const activity = computeClientActivity(dataset.invoices, ui.getClientActivityThresholds());
  const rankingWithActivity = ranking.map((c) => ({ ...c, activity: activity.get(c.cliente) || null }));

  ui.renderClientesTable(rankingWithActivity, selectedClient, (cliente) => {
    state.selectedClient = state.selectedClient === cliente ? null : cliente;
    renderClientesTab();
  });

  if (state.selectedClient) {
    const contextYear = getContextYear();
    const clientFilters = { ...filters, cliente: state.selectedClient, mes: ALL, anio: contextYear };
    const clientYearInvoices = applyFilters(dataset.invoices, clientFilters);
    const total = clientYearInvoices.reduce((acc, i) => acc + i.mxnEquivalente, 0);

    ui.renderClientDetailHeader(state.selectedClient, total);

    const labels = Array.from({ length: 12 }, (_, i) => monthShortName(i + 1));
    const seriesA = computeMonthlySeries(dataset, contextYear, { ...filters, cliente: state.selectedClient }).totals;
    renderMonthlyChart("chart-client-detail", {
      labels,
      seriesA,
      labelA: String(contextYear),
      seriesB: null,
      labelB: null,
      moneyFormatter: (v, compact) => (compact ? formatMoneyCompact(v) : formatMoney(v)),
    });
  } else {
    ui.renderClientDetailHeader(null, 0);
  }
}

/* ---------------- Análisis ---------------- */

function renderAnalisisTab() {
  const { dataset, filters } = state;
  const periodInvoices = applyFilters(dataset.invoices, filters);

  const mix = computeCurrencyMix(periodInvoices);
  const ranking = computeClientRanking(periodInvoices);
  const concentration = computeConcentration(ranking);
  const aging = computeAging(periodInvoices);

  ui.renderAnalisisGrid({ mix, concentration, aging, fx: dataset.fx });

  const contextYear = getContextYear();
  const isAnnualScope = filters.mes === ALL && filters.cliente === ALL && filters.moneda === ALL;
  const projection = isAnnualScope ? computeProjection(dataset, contextYear, filters) : null;
  ui.renderProjection(projection, contextYear);
}

/* ---------------- Filters wiring ---------------- */

function onFiltersChange(newFilters) {
  state.filters = newFilters;
  state.selectedClient = null;
  state.facturacion.page = 1;
  ui.syncFilterInputs(state.filters);
  renderAll();
}

/* ---------------- Acceso (contraseña) ---------------- */

function startApp() {
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("loading-screen").classList.remove("hidden");
  document.getElementById("auth-logout").addEventListener("click", () => {
    lock();
    window.location.reload();
  });
  boot();
}

function showAuthGate() {
  const gate = document.getElementById("auth-gate");
  const loadingScreen = document.getElementById("loading-screen");
  const form = document.getElementById("auth-form");
  const input = document.getElementById("auth-password");
  const error = document.getElementById("auth-error");

  loadingScreen.classList.add("hidden");
  gate.style.display = "flex";
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = await tryUnlock(input.value);
    if (ok) {
      startApp();
    } else {
      error.style.display = "block";
      input.value = "";
      input.focus();
    }
  });
}

if (isUnlocked()) {
  startApp();
} else {
  showAuthGate();
}
