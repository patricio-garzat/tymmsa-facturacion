// Capa de visualización (UI/DOM).
// Responsabilidad única: tomar datos ya calculados y pintarlos. No decide
// reglas de negocio ni hace fetch; sólo lee lo que le pasan y escucha
// interacción del usuario (delegando la lógica hacia afuera vía callbacks).

import { ALL } from "./filters.js";
import { monthShortName, monthLongName } from "./processing.js";
import { formatMoney, formatMoneyCompact, formatUsd, formatPct, formatDate, formatNumber, formatRate } from "./format.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- Shell / nav ---------------- */

export function showApp() {
  $("#loading-screen").classList.add("hidden");
  $("#app").style.display = "";
}

export function setLoadingText(text) {
  const el = $("#loading-text");
  if (el) el.textContent = text;
}

export function wireNav(onNavigate) {
  // Hay dos juegos de botones con la misma clase: el nav horizontal de
  // escritorio y la barra inferior de móvil. Cualquiera de los dos que se
  // use, se sincronizan entre sí por data-view.
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
      $$(".view").forEach((v) => v.classList.remove("active"));
      $(`#view-${view}`).classList.add("active");
      onNavigate(view);
    });
  });
}

export function setSyncStatus(status, label) {
  const dot = $("#sync-dot");
  const text = $("#sync-label");
  dot.classList.remove("offline", "error");
  if (status === "offline") dot.classList.add("offline");
  if (status === "error") dot.classList.add("error");
  text.textContent = label;
}

export function renderGeneratedAt(generatedAt) {
  if (!generatedAt) return;
  const d = new Date(generatedAt);
  const label = isNaN(d) ? "" : d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  $("#as-of").textContent = label ? `Actualizado ${label}` : "";
  $("#footer-generated").textContent = label ? `última actualización ${label}` : "";
}

export function renderDashboardBanner(messages) {
  const el = $("#dashboard-banner");
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = list.map((m) => `<div class="banner warning">${m}</div>`).join("");
}

/* ---------------- Filters ---------------- */

export function populateFilterOptions(dataset) {
  const anioSel = $("#f-anio");
  anioSel.innerHTML = [`<option value="${ALL}">Todos</option>`]
    .concat(dataset.years.map((y) => `<option value="${y}">${y}</option>`))
    .join("");

  const mesSel = $("#f-mes");
  mesSel.innerHTML = [`<option value="${ALL}">Todos</option>`]
    .concat(Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${monthLongName(i + 1)}</option>`))
    .join("");

  const clienteSel = $("#f-cliente");
  clienteSel.innerHTML = [`<option value="${ALL}">Todos</option>`]
    .concat(dataset.clients.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`))
    .join("");

  const monedaSel = $("#f-moneda");
  monedaSel.innerHTML = [ALL, "MXN", "USD"].map((m) => `<option value="${m}">${m}</option>`).join("");
}

export function syncFilterInputs(filters) {
  $("#f-anio").value = String(filters.anio);
  $("#f-mes").value = String(filters.mes);
  $("#f-cliente").value = filters.cliente;
  $("#f-moneda").value = filters.moneda;
}

export function wireFilters(onChange) {
  ["f-anio", "f-mes", "f-cliente", "f-moneda"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => {
      onChange(readFiltersFromInputs());
    });
  });
  $("#f-reset").addEventListener("click", () => {
    onChange({ anio: ALL, mes: ALL, cliente: ALL, moneda: ALL }, true);
  });
}

function readFiltersFromInputs() {
  const anioRaw = $("#f-anio").value;
  const mesRaw = $("#f-mes").value;
  return {
    anio: anioRaw === ALL ? ALL : Number(anioRaw),
    mes: mesRaw === ALL ? ALL : Number(mesRaw),
    cliente: $("#f-cliente").value,
    moneda: $("#f-moneda").value,
  };
}

/* ---------------- Dashboard KPIs ---------------- */

export function renderKpis(kpis, filters, contextYear) {
  const periodLabel = filters.mes !== ALL
    ? `${monthLongName(filters.mes)} ${filters.anio !== ALL ? filters.anio : contextYear}`
    : filters.anio !== ALL
      ? `Año ${filters.anio}`
      : "Todo el histórico";

  const deltaHtml = kpis.hasComparison && kpis.delta !== null
    ? deltaBadge(kpis.delta)
    : `<span class="kpi-sub">Sin período comparable</span>`;

  const grid = $("#kpi-grid");
  grid.innerHTML = `
    <div class="kpi-card primary">
      <div class="kpi-label">Facturación · ${escapeHtml(periodLabel)}</div>
      <div class="kpi-value">${formatMoney(kpis.periodTotal)}</div>
      ${deltaHtml}
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Facturación acumulada del año</div>
      <div class="kpi-value">${formatMoney(kpis.yearTotal)}</div>
      <div class="kpi-sub">MXN equivalente, sin IVA</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Facturas</div>
      <div class="kpi-value">${formatNumber(kpis.periodCount)}</div>
      <div class="kpi-sub">${escapeHtml(periodLabel)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ticket promedio</div>
      <div class="kpi-value">${formatMoney(kpis.ticketPromedio)}</div>
      <div class="kpi-sub">${escapeHtml(periodLabel)}</div>
    </div>
  `;
}

function deltaBadge(delta) {
  const cls = delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat";
  const arrow = cls === "up" ? "↑" : cls === "down" ? "↓" : "→";
  return `<span class="kpi-delta ${cls}">${arrow} ${formatPct(Math.abs(delta))} vs. período anterior</span>`;
}

/* ---------------- Chart controls ---------------- */

export function populateCompareYearOptions(years, currentYear, selectedCompare) {
  const sel = $("#chart-compare-year");
  const options = ["Ninguno"].concat(years.filter((y) => y !== currentYear).map(String));
  sel.innerHTML = options.map((y) => `<option value="${y}">${y === "Ninguno" ? "Ninguno" : y}</option>`).join("");
  sel.value = selectedCompare ? String(selectedCompare) : "Ninguno";
}

export function wireCompareYear(onChange) {
  $("#chart-compare-year").addEventListener("change", (e) => {
    const v = e.target.value;
    onChange(v === "Ninguno" ? null : Number(v));
  });
}

/* ---------------- Top clients mini table ---------------- */

export function renderTopClientsTable(ranking) {
  const tbody = $("#table-top-clients tbody");
  const top = ranking.slice(0, 5);
  if (!top.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Sin datos para este período.</td></tr>`;
    return;
  }
  tbody.innerHTML = top
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.cliente)}</td>
        <td class="num mono" data-label="Facturación">${formatMoney(c.mxnEquivalente)}</td>
        <td class="num mono" data-label="% del total">${formatPct(c.pctDelTotal)}</td>
      </tr>`
    )
    .join("");
}

/* ---------------- Insights ---------------- */

export function renderInsights(insights) {
  const el = $("#insights-list");
  if (!insights.length) {
    el.innerHTML = `<div class="empty-state">Aún no hay suficientes datos para generar insights en este período.</div>`;
    return;
  }
  el.innerHTML = insights
    .map((text) => `<div class="insight-item"><span class="insight-dot"></span><span>${escapeHtml(text)}</span></div>`)
    .join("");
}

/* ---------------- Facturación table ---------------- */

const SEMAFORO_BADGE = {
  Cobrada: { cls: "paid", label: "Cobrada" },
  Vigente: { cls: "pending", label: "Vigente" },
  "Por vencer": { cls: "due-soon", label: "Por vencer" },
  Vencida: { cls: "overdue", label: "Vencida" },
};

function invoiceBadge(inv) {
  if (inv.isCancelled) return `<span class="badge cancelled">Cancelada</span>`;
  const b = SEMAFORO_BADGE[inv.semaforo] || SEMAFORO_BADGE.Vigente;
  return `<span class="badge ${b.cls}"><span class="badge-dot"></span>${b.label}</span>`;
}

// Tipo de cambio realmente aplicado a esta factura (histórico de Banxico si
// se encontró, o el de CATALOGOS si no) — se obtiene del propio resultado
// ya calculado, sin volver a decidir la fuente aquí.
function effectiveRate(inv) {
  if (inv.fxRate != null) return inv.fxRate;
  if (!inv.montoSinIva) return null;
  return inv.mxnEquivalente / inv.montoSinIva;
}

function montoCell(inv) {
  if (inv.moneda !== "USD") {
    return `<div>${formatMoney(inv.mxnEquivalente)}</div>`;
  }
  const rate = effectiveRate(inv);
  return `
    <div>${formatUsd(inv.monto)} USD</div>
    <div class="text-muted" style="font-size:11.5px; margin-top:2px;">
      ≈ ${formatMoney(inv.mxnEquivalente)} MXN · TC ${formatRate(rate)}
    </div>`;
}

export function renderFacturacionSummary(summary) {
  const el = $("#fac-summary");
  el.innerHTML = `
    <div class="summary-item">
      <div class="summary-label">MXN sin IVA</div>
      <div class="summary-value">${formatMoney(summary.mxnSinIva)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">MXN con IVA</div>
      <div class="summary-value">${formatMoney(summary.mxnConIva)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">USD</div>
      <div class="summary-value">${formatUsd(summary.usdOriginal)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">USD → MXN</div>
      <div class="summary-value">${formatMoney(summary.usdEnMxn)}</div>
    </div>
    <div class="summary-item total">
      <div class="summary-label">Total MXN (incl. USD)</div>
      <div class="summary-value">${formatMoney(summary.totalMxn)}</div>
    </div>
  `;
}

export function renderFacturacionTable(invoices, { sortKey, sortDir, expandedId }, onRowClick) {
  $("#fac-count").textContent = `${formatNumber(invoices.length)} factura${invoices.length === 1 ? "" : "s"}`;

  $$("#table-facturas thead th[data-sort]").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.sort === sortKey) th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
  });

  const tbody = $("#table-facturas tbody");
  if (!invoices.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No se encontraron facturas con estos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = invoices
    .map((inv) => {
      const rows = [`
        <tr class="clickable" data-id="${escapeAttr(inv.factura)}">
          <td class="mono">${escapeHtml(inv.factura)}</td>
          <td>${escapeHtml(inv.cliente)}</td>
          <td data-label="Fecha">${formatDate(inv.fecha)}</td>
          <td data-label="Moneda"><span class="badge currency">${inv.moneda}</span></td>
          <td class="num mono" data-label="Monto">${montoCell(inv)}</td>
          <td data-label="Estatus">${invoiceBadge(inv)}</td>
          <td data-label="Vencimiento">${formatDate(inv.vencimiento)}</td>
        </tr>`];

      if (expandedId === inv.factura) {
        rows.push(`
          <tr>
            <td colspan="7" style="padding:0 16px 14px;">
              <div class="detail-panel">
                <div><div class="dl-label">Monto original</div>${inv.moneda === "USD" ? formatUsd(inv.monto) : formatMoney(inv.monto)}</div>
                <div><div class="dl-label">Monto sin IVA</div>${inv.moneda === "USD" ? formatUsd(inv.montoSinIva) : formatMoney(inv.montoSinIva)}</div>
                ${inv.moneda === "USD" ? `
                <div><div class="dl-label">Equivalente MXN</div>${formatMoney(inv.mxnEquivalente)}</div>
                <div><div class="dl-label">Tipo de cambio</div>${formatRate(effectiveRate(inv))} <span class="text-muted">(${inv.fxRate != null ? "FIX Banxico" : "CATALOGOS"})</span></div>
                ` : ""}
                <div><div class="dl-label">Condición</div>${escapeHtml(inv.condicion || "—")}</div>
                <div><div class="dl-label">Días crédito</div>${inv.diasCredito ?? "—"}</div>
                <div><div class="dl-label">Estatus</div>${escapeHtml(inv.estatus)}</div>
                <div><div class="dl-label">Días de atraso</div>${inv.diasAtraso ?? "—"}</div>
              </div>
            </td>
          </tr>`);
      }
      return rows.join("");
    })
    .join("");

  $$("#table-facturas tbody tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => onRowClick(tr.dataset.id));
  });
}

export function wireFacturacionControls(onSearch, onSort) {
  $("#fac-search").addEventListener("input", (e) => onSearch(e.target.value));
  $$("#table-facturas thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => onSort(th.dataset.sort));
  });
}

export function wireFacturacionActions(onExport, onPrint) {
  $("#fac-export").addEventListener("click", onExport);
  $("#fac-print").addEventListener("click", onPrint);
}

export function renderPrintHeader(filterLabel, count) {
  const el = $("#print-header");
  const now = new Date().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  el.innerHTML = `
    <div class="print-title">TYMMSA — Detalle de facturación</div>
    <div class="print-meta">Filtros: ${escapeHtml(filterLabel)} · ${formatNumber(count)} factura${count === 1 ? "" : "s"} · Generado ${now}</div>
  `;
}

export function setExportButtonState(disabled, label) {
  const btn = $("#fac-export");
  btn.disabled = disabled;
  btn.textContent = label || "⬇ Exportar Excel";
}

/* ---------------- Clientes tab ---------------- */

export function renderClientesTable(ranking, selectedClient, onSelect) {
  const tbody = $("#table-clientes tbody");
  if (!ranking.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Sin datos para este período.</td></tr>`;
    $("#clientes-subtitle").textContent = "";
    return;
  }
  $("#clientes-subtitle").textContent = `${ranking.length} cliente${ranking.length === 1 ? "" : "s"} con facturación`;

  const maxVal = Math.max(...ranking.map((c) => c.mxnEquivalente));

  tbody.innerHTML = ranking
    .map(
      (c) => `
      <tr class="clickable client-row ${c.cliente === selectedClient ? "selected" : ""}" data-cliente="${escapeAttr(c.cliente)}">
        <td>${escapeHtml(c.cliente)}</td>
        <td class="num mono" data-label="Facturas">${formatNumber(c.facturas)}</td>
        <td class="num mono" data-label="Facturación">${formatMoney(c.mxnEquivalente)}</td>
        <td data-label="% del total">
          <div class="bar-cell">
            <div class="bar-track"><div class="bar-fill" style="width:${maxVal ? (c.mxnEquivalente / maxVal) * 100 : 0}%"></div></div>
            <span class="mono" style="font-size:12.5px; color:var(--text-muted); min-width:44px;">${formatPct(c.pctDelTotal)}</span>
          </div>
        </td>
        <td class="num mono" data-label="Ticket promedio">${formatMoney(c.ticketPromedio)}</td>
      </tr>`
    )
    .join("");

  $$("#table-clientes tbody tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => onSelect(tr.dataset.cliente));
  });
}

export function renderClientDetailHeader(cliente, totalYear) {
  const wrap = $("#client-detail");
  if (!cliente) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "";
  $("#client-detail-title").textContent = `Evolución — ${cliente}`;
  $("#client-detail-chip").innerHTML = `${formatMoney(totalYear)} <button id="client-detail-close" aria-label="Cerrar">✕</button>`;
}

export function wireClientDetailClose(onClose) {
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "client-detail-close") onClose();
  });
}

/* ---------------- Análisis tab ---------------- */

export function renderAnalisisGrid({ mix, concentration, aging, fx }) {
  const grid = $("#analisis-grid");

  const fxCaption = fx && fx.enabled && fx.historicalCount > 0
    ? `Conversión con tipo de cambio FIX de Banxico, según la fecha de cada factura${fx.fallbackCount ? ` (${fx.fallbackCount} con TC de respaldo de CATALOGOS)` : ""}.`
    : `Conversión con el tipo de cambio fijo de CATALOGOS.`;

  const mixCard = `
    <div class="card">
      <div class="section-title">Mezcla de moneda</div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
            <span>MXN</span><span class="mono">${formatPct(mix.mxnPct)}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${mix.mxnPct * 100}%; background:#2a78d6;"></div></div>
          <div class="text-muted mono" style="font-size:12px; margin-top:4px;">${formatMoney(mix.mxnTotalConIva)} facturado (con IVA)</div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
            <span>USD</span><span class="mono">${formatPct(mix.usdPct)}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${mix.usdPct * 100}%; background:#eb6834;"></div></div>
          <div class="text-muted mono" style="font-size:12px; margin-top:4px;">${formatUsd(mix.usdTotalOriginal)} facturado</div>
        </div>
        <div class="text-muted" style="font-size:11.5px; padding-top:4px; border-top:1px solid var(--border);">${fxCaption}</div>
      </div>
    </div>`;

  const riesgoColor = { ALTO: "overdue", MEDIO: "due-soon", BAJO: "paid" };
  const concentrationCard = `
    <div class="card">
      <div class="section-title">Concentración de clientes</div>
      ${concentration.top1 ? `
        <div class="kpi-value" style="font-size:26px;">${formatPct(concentration.top1Pct)}</div>
        <div class="kpi-sub" style="margin-bottom:12px;">${escapeHtml(concentration.top1.cliente)} · cliente principal</div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; margin-top:8px;">
          <span class="text-muted">Top 3 clientes</span>
          <span class="mono">${formatPct(concentration.top3Pct)}</span>
        </div>
        <div style="margin-top:10px;">
          <span class="badge ${riesgoColor[concentration.riesgo]}"><span class="badge-dot"></span>Riesgo ${concentration.riesgo.toLowerCase()}</span>
        </div>
      ` : `<div class="empty-state">Sin datos para este período.</div>`}
    </div>`;

  const agingCard = `
    <div class="card">
      <div class="section-title">Cartera por cobrar</div>
      ${aging.totalFacturas ? `
        <div class="kpi-value" style="font-size:26px;">${formatMoney(aging.total)}</div>
        <div class="kpi-sub" style="margin-bottom:12px;">${formatNumber(aging.totalFacturas)} factura${aging.totalFacturas === 1 ? "" : "s"} pendientes de cobro</div>
        ${agingRow("Vigente", aging.vigente, "good")}
        ${agingRow("Por vencer", aging.porVencer, "warning")}
        ${agingRow("Vencida", aging.vencida, "critical")}
      ` : `<div class="empty-state">Sin cartera pendiente en este período.</div>`}
    </div>`;

  grid.innerHTML = mixCard + concentrationCard + agingCard;
}

function agingRow(label, bucket, statusKey) {
  const colors = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" };
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:7px 0; border-top:1px solid var(--border);">
      <span style="display:flex; align-items:center; gap:7px;"><span style="width:7px;height:7px;border-radius:50%;background:${colors[statusKey]};"></span>${label}</span>
      <span class="mono">${formatMoney(bucket.monto)} <span class="text-muted">(${formatNumber(bucket.facturas)})</span></span>
    </div>`;
}

export function renderProjection(projection, year) {
  const el = $("#analisis-projection");
  if (!projection) {
    el.innerHTML = "";
    return;
  }
  const rows = [
    ["Conservador", projection.conservador],
    ["Base", projection.base],
    ["Optimista", projection.optimista],
  ];

  el.innerHTML = `
    <div class="card" style="margin-top:14px;">
      <div class="section-header">
        <div class="chart-title">Proyección de cierre ${year}</div>
        <span class="text-muted" style="font-size:12.5px;">${projection.mesesCerrados} meses cerrados · ${projection.mesesFaltantes} por facturar</span>
      </div>
      <div class="table-wrap" style="border:none;">
        <table>
          <thead>
            <tr><th>Escenario</th><th class="num">Promedio mensual</th><th class="num">Proyección de cierre</th>${projection.metaAnual ? '<th class="num">% de la meta</th>' : ""}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                ([label, s]) => `
              <tr>
                <td>${label}</td>
                <td class="num mono">${formatMoney(s.promedio)}</td>
                <td class="num mono">${formatMoney(s.proyeccion)}</td>
                ${projection.metaAnual ? `<td class="num mono">${formatPct(s.proyeccion / projection.metaAnual)}</td>` : ""}
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${projection.metaAnual ? `<div class="text-muted" style="font-size:12.5px; margin-top:10px;">Meta anual: ${formatMoney(projection.metaAnual)} · Avance real a la fecha: ${formatPct(projection.avanceMeta)} · Falta para la meta: ${formatMoney(projection.faltaParaMeta)}</div>` : ""}
    </div>`;
}

/* ---------------- helpers ---------------- */

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}
