// Capa de exportación (PDF).
// Responsabilidad única: convertir las facturas que el usuario está viendo
// (ya filtradas y ordenadas) en un reporte PDF con el diseño del portal.
// jsPDF y autoTable se cargan bajo demanda (no pesan en cada visita).

import { monthShortName } from "./processing.js?v=20261102d";
import { formatMoney, formatUsd, formatDate, formatNumber, formatPct } from "./format.js?v=20261102d";

const JSPDF_SRC = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
const AUTOTABLE_SRC = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";

/* ---------- Paleta (misma del portal) ---------- */
const NAVY = [21, 47, 93];
const NAVY_DEEP = [11, 28, 61];
const INK = [22, 22, 26];
const MUTED = [107, 107, 116];
const SOFT = [154, 154, 162];
const LINE = [231, 231, 234];
const PANEL = [246, 246, 247];
const ZEBRA = [250, 250, 251];
const CHIP = [232, 236, 245];
const POS = [22, 121, 79];
const WARN = [181, 121, 10];
const NEG = [194, 59, 59];
const NEUTRAL = [141, 153, 176];

const PAGE_W = 612;
const PAGE_H = 792;
const M = 40;
const CW = PAGE_W - 2 * M;
const FOOT = 46;

// Colores de relleno (barras, puntos) y de texto (el gris azulado de
// "Vigente" se lee muy tenue como texto, por eso tiene versión más oscura).
const STATUS_COLOR = {
  Cobrada: POS,
  Vigente: NEUTRAL,
  "Por vencer": WARN,
  Vencida: NEG,
};
const STATUS_TEXT = { ...STATUS_COLOR, Vigente: MUTED };

/* ---------- Carga de librerías y logo (una sola vez) ---------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.head.appendChild(s);
  });
}

async function loadLogo() {
  try {
    const svgText = await (await fetch("assets/tymmsa-logo-white.svg")).text();
    const sized = svgText.replace("<svg ", '<svg width="2172" height="406" ');
    const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok;
      img.onerror = fail;
      img.src = url;
    });
    const w = 760;
    const h = Math.round((w * 405.5) / 2171.7);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return { data: canvas.toDataURL("image/png"), ratio: 2171.7 / 405.5 };
  } catch {
    return null;
  }
}

let preparePromise = null;

/** Precarga librerías y logo para que el clic genere el PDF al instante. */
export function preparePdfExport() {
  if (!preparePromise) {
    preparePromise = (async () => {
      if (!window.jspdf) await loadScript(JSPDF_SRC);
      if (!window.jspdf.jsPDF.API.autoTable) await loadScript(AUTOTABLE_SRC);
      const logo = await loadLogo();
      return { logo };
    })().catch((err) => {
      preparePromise = null;
      throw err;
    });
  }
  return preparePromise;
}

/* ---------- Utilidades ---------- */

// Helvetica (la fuente estándar del PDF) no tiene espacios finos/duros que
// Intl a veces mete en fechas y montos; se normalizan a espacio normal.
const clean = (s) => String(s ?? "").replace(/[  ]/g, " ");

function compactMoney(v) {
  const n = Math.abs(v);
  if (n >= 1e6) return `$${(v / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

function usdCell(inv) {
  return `US${formatUsd(inv.monto)}`;
}

function fit(doc, text, maxW) {
  let t = clean(text);
  if (doc.getTextWidth(t) <= maxW) return t;
  while (t.length > 1 && doc.getTextWidth(t + "…") > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

function parseFilterChips(filterLabel) {
  const chips = [];
  String(filterLabel || "")
    .split(" · ")
    .forEach((part) => {
      const i = part.indexOf(": ");
      if (i < 0) return;
      const label = part.slice(0, i);
      const value = part.slice(i + 2);
      if (value === "Todos" || value === "Todas") return;
      chips.push({ label, value: value.replace(/^"|"$/g, "") });
    });
  return chips;
}

/* ---------- Modelo del reporte ---------- */

function buildModel(invoices) {
  const active = invoices.filter((i) => !i.isCancelled);
  const total = active.reduce((a, i) => a + i.mxnEquivalente, 0);

  const monthly = new Map();
  const clients = new Map();
  const status = {
    Cobrada: { count: 0, total: 0 },
    Vigente: { count: 0, total: 0 },
    "Por vencer": { count: 0, total: 0 },
    Vencida: { count: 0, total: 0 },
  };

  active.forEach((i) => {
    const key = i.anio * 100 + i.mes;
    if (!monthly.has(key)) monthly.set(key, { anio: i.anio, mes: i.mes, count: 0, total: 0 });
    const m = monthly.get(key);
    m.count += 1;
    m.total += i.mxnEquivalente;

    if (!clients.has(i.cliente)) clients.set(i.cliente, { cliente: i.cliente, count: 0, total: 0 });
    const c = clients.get(i.cliente);
    c.count += 1;
    c.total += i.mxnEquivalente;

    const s = status[i.semaforo] || status.Vigente;
    s.count += 1;
    s.total += i.mxnEquivalente;
  });

  const dates = active.map((i) => i.fecha.getTime());
  const mxn = active.filter((i) => i.moneda === "MXN");
  const usd = active.filter((i) => i.moneda === "USD");

  return {
    active,
    total,
    count: active.length,
    ticket: active.length ? total / active.length : 0,
    clientCount: clients.size,
    buckets: Array.from(monthly.values()).sort((a, b) => a.anio * 100 + a.mes - (b.anio * 100 + b.mes)),
    clients: Array.from(clients.values()).sort((a, b) => b.total - a.total),
    status,
    from: dates.length ? new Date(Math.min(...dates)) : null,
    to: dates.length ? new Date(Math.max(...dates)) : null,
    mxn: {
      count: mxn.length,
      sinIva: mxn.reduce((a, i) => a + i.montoSinIva, 0),
      conIva: mxn.reduce((a, i) => a + i.monto, 0),
    },
    usd: {
      count: usd.length,
      original: usd.reduce((a, i) => a + i.monto, 0),
      enMxn: usd.reduce((a, i) => a + i.mxnEquivalente, 0),
    },
    attention: active
      .filter((i) => i.semaforo === "Vencida" || i.semaforo === "Por vencer")
      .sort((a, b) => {
        if (a.semaforo !== b.semaforo) return a.semaforo === "Vencida" ? -1 : 1;
        return (b.diasAtraso || 0) - (a.diasAtraso || 0) || a.vencimiento - b.vencimiento;
      }),
  };
}

/* ---------- Bloques de dibujo ---------- */

function drawHeader(doc, logo, generatedAt) {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 92, "F");
  doc.setFillColor(...NAVY_DEEP);
  doc.rect(0, 92, PAGE_W, 4, "F");

  if (logo) {
    const h = 25;
    doc.addImage(logo.data, "PNG", M, 33, h * logo.ratio, h);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text("TYMMSA", M, 52);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text("Reporte de facturación", PAGE_W - M, 46, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(196, 207, 230);
  doc.text(clean(`Generado el ${generatedAt}`), PAGE_W - M, 62, { align: "right" });
}

function drawFilters(doc, chips, model, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...SOFT);
  if (doc.setCharSpace) doc.setCharSpace(0.7);
  doc.text("FILTROS APLICADOS", M, y);
  if (doc.setCharSpace) doc.setCharSpace(0);
  y += 8;

  let x = M;
  const h = 19;
  const list = chips.length ? chips : [{ label: "Sin filtros", value: "todo el historial" }];

  list.forEach((chip) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const lw = doc.getTextWidth(chip.label + "  ");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const vw = doc.getTextWidth(clean(chip.value));
    const w = lw + vw + 20;
    if (x + w > M + CW) {
      x = M;
      y += h + 6;
    }
    doc.setFillColor(...CHIP);
    doc.roundedRect(x, y, w, h, 9.5, 9.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(chip.label, x + 10, y + 12.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text(clean(chip.value), x + 10 + lw, y + 12.5);
    x += w + 6;
  });

  y += h + 14;
  if (model.from) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const periodo =
      model.from.getTime() === model.to.getTime()
        ? formatDate(model.from)
        : `${formatDate(model.from)} a ${formatDate(model.to)}`;
    doc.text(clean(`Facturas emitidas del ${periodo}`), M, y);
    y += 6;
  }
  return y + 12;
}

function drawHero(doc, model, y) {
  const h = 78;
  doc.setFillColor(...NAVY);
  doc.roundedRect(M, y, CW, h, 8, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(176, 190, 222);
  if (doc.setCharSpace) doc.setCharSpace(0.7);
  doc.text("TOTAL FACTURADO (MXN, SIN IVA)", M + 18, y + 22);
  if (doc.setCharSpace) doc.setCharSpace(0);

  doc.setFontSize(25);
  doc.setTextColor(255, 255, 255);
  doc.text(clean(formatMoney(model.total)), M + 18, y + 54);

  const stats = [
    ["FACTURAS", formatNumber(model.count)],
    ["TICKET PROMEDIO", formatMoney(model.ticket)],
    ["CLIENTES", formatNumber(model.clientCount)],
  ];
  const colW = [64, 104, 56];
  let sx = M + CW - 18 - colW.reduce((a, b) => a + b, 0);
  stats.forEach(([label, value], idx) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(176, 190, 222);
    doc.text(label, sx, y + 30);
    doc.setFontSize(12.5);
    doc.setTextColor(255, 255, 255);
    doc.text(clean(value), sx, y + 50);
    sx += colW[idx];
  });
  return y + h + 10;
}

function drawCards(doc, cards, y) {
  const gap = 8;
  const w = (CW - gap * (cards.length - 1)) / cards.length;
  const h = 46;
  cards.forEach((c, idx) => {
    const x = M + idx * (w + gap);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, y, w, h, 7, 7, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...SOFT);
    if (doc.setCharSpace) doc.setCharSpace(0.5);
    doc.text(c.label, x + 12, y + 17);
    if (doc.setCharSpace) doc.setCharSpace(0);
    doc.setFontSize(12);
    doc.setTextColor(...INK);
    doc.text(clean(c.value), x + 12, y + 35);
  });
  return y + h + 22;
}

function sectionTitle(doc, title, y, subtitle) {
  doc.setFillColor(...NAVY);
  doc.roundedRect(M, y - 9, 3, 13, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(title, M + 11, y + 1);
  if (subtitle) {
    const tw = doc.getTextWidth(title);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SOFT);
    doc.text(clean(subtitle), M + 11 + tw + 8, y + 1);
  }
  return y + 18;
}

function drawCobranza(doc, model, y) {
  const order = ["Cobrada", "Vigente", "Por vencer", "Vencida"];
  const barH = 11;

  doc.setFillColor(...PANEL);
  doc.rect(M, y, CW, barH, "F");
  let x = M;
  order.forEach((k) => {
    const w = CW * (model.total ? model.status[k].total / model.total : 0);
    if (w < 0.5) return;
    doc.setFillColor(...STATUS_COLOR[k]);
    doc.rect(x, y, w, barH, "F");
    x += w;
  });
  // Separadores blancos entre segmentos
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.5);
  x = M;
  order.forEach((k) => {
    const w = CW * (model.total ? model.status[k].total / model.total : 0);
    x += w;
    if (w > 0.5 && x < M + CW - 1) doc.line(x, y, x, y + barH);
  });

  y += barH + 18;
  const colW = CW / 4;
  order.forEach((k, idx) => {
    const cx = M + idx * colW;
    const s = model.status[k];
    doc.setFillColor(...STATUS_COLOR[k]);
    doc.circle(cx + 3.5, y - 2.5, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(k, cx + 12, y);
    doc.setFontSize(11.5);
    doc.text(clean(formatMoney(s.total)), cx, y + 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const pct = model.total ? formatPct(s.total / model.total) : "0.0%";
    doc.text(clean(`${formatNumber(s.count)} factura${s.count === 1 ? "" : "s"} · ${pct}`), cx, y + 28);
  });
  return y + 28 + 24;
}

function drawMonthlyChart(doc, buckets, y) {
  const h = 150;
  const left = M + 36;
  const plotW = CW - 36;
  const top = y + 14;
  const bottom = y + h - 26;
  const plotH = bottom - top;
  const max = Math.max(...buckets.map((b) => b.total)) || 1;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  [0, 0.5, 1].forEach((f) => {
    const gy = bottom - plotH * f;
    doc.line(left, gy, left + plotW, gy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...SOFT);
    doc.text(f === 0 ? "$0" : compactMoney(max * f), left - 6, gy + 2.3, { align: "right" });
  });

  const slot = plotW / buckets.length;
  const bw = Math.min(36, slot * 0.62);
  const peak = buckets.reduce((p, b, i) => (b.total > buckets[p].total ? i : p), 0);
  const dense = buckets.length > 14;

  buckets.forEach((b, i) => {
    const bh = Math.max(1, (b.total / max) * plotH);
    const bx = left + slot * i + (slot - bw) / 2;
    doc.setFillColor(...NAVY);
    doc.roundedRect(bx, bottom - bh, bw, bh, Math.min(2.5, bw / 4), Math.min(2.5, bw / 4), "F");
    doc.rect(bx, bottom - Math.min(bh, 3), bw, Math.min(bh, 3), "F");

    if (!dense || i === peak || i === buckets.length - 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(dense ? 6 : 7);
      doc.setTextColor(...INK);
      doc.text(compactMoney(b.total), bx + bw / 2, bottom - bh - 4, { align: "center" });
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(dense ? 5.8 : 7.5);
    doc.setTextColor(...MUTED);
    doc.text(monthShortName(b.mes), bx + bw / 2, bottom + 11, { align: "center" });
    const prev = buckets[i - 1];
    if (!prev || prev.anio !== b.anio) {
      doc.setFontSize(6);
      doc.setTextColor(...SOFT);
      doc.text(String(b.anio), bx + bw / 2, bottom + 20, { align: "center" });
    }
  });
  return y + h + 12;
}

function drawClients(doc, clients, total, y, ensure) {
  const MAXROWS = 8;
  let rows = clients.slice(0, MAXROWS);
  if (clients.length > MAXROWS) {
    const rest = clients.slice(MAXROWS);
    rows = rows.concat({
      cliente: `Otros (${rest.length} clientes)`,
      count: rest.reduce((a, c) => a + c.count, 0),
      total: rest.reduce((a, c) => a + c.total, 0),
      isOther: true,
    });
  }

  const rowH = 21;
  const colCount = M + 262;
  const colTotal = M + 372;
  const barX = M + 394;
  const barW = 82;

  y = ensure(rows.length * rowH + 22, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...SOFT);
  if (doc.setCharSpace) doc.setCharSpace(0.5);
  doc.text("CLIENTE", M, y);
  doc.text("FACTURAS", colCount, y, { align: "right" });
  doc.text("TOTAL MXN", colTotal, y, { align: "right" });
  doc.text("PARTICIPACIÓN", barX, y);
  if (doc.setCharSpace) doc.setCharSpace(0);
  y += 6;

  const maxTotal = Math.max(...rows.map((r) => r.total)) || 1;
  rows.forEach((r) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.line(M, y, M + CW, y);

    doc.setFont("helvetica", r.isOther ? "normal" : "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...(r.isOther ? MUTED : INK));
    doc.text(fit(doc, r.cliente, 200), M, y + 13.5);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(formatNumber(r.count), colCount, y + 13.5, { align: "right" });
    doc.text(clean(formatMoney(r.total)), colTotal, y + 13.5, { align: "right" });

    doc.setFillColor(...PANEL);
    doc.roundedRect(barX, y + 8, barW, 6, 3, 3, "F");
    doc.setFillColor(...(r.isOther ? NEUTRAL : NAVY));
    doc.roundedRect(barX, y + 8, Math.max(4, barW * (r.total / maxTotal)), 6, 3, 3, "F");

    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(formatPct(total ? r.total / total : 0), M + CW, y + 13.5, { align: "right" });
    y += rowH;
  });
  doc.setDrawColor(...LINE);
  doc.line(M, y, M + CW, y);
  return y + 22;
}

/* ---------- Reporte completo ---------- */

/**
 * @param {object} opts
 * @param {Array} opts.invoices facturas ya filtradas (mismo orden de la tabla)
 * @param {string} opts.filterLabel descripción de los filtros activos
 * @returns {Promise<boolean>}
 */
export async function exportFacturacionPdf({ invoices, filterLabel }) {
  let libs;
  try {
    libs = await preparePdfExport();
  } catch {
    return false;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const model = buildModel(invoices);
  const generatedAt = new Date().toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const ensure = (needed, y) => {
    if (y + needed > PAGE_H - FOOT) {
      doc.addPage();
      return M + 4;
    }
    return y;
  };

  /* Página 1: encabezado, filtros y resumen */
  drawHeader(doc, libs.logo, generatedAt);
  let y = drawFilters(doc, parseFilterChips(filterLabel), model, 124);
  y = drawHero(doc, model, y);

  const cards = [];
  if (model.mxn.count) {
    cards.push({ label: "MXN SIN IVA", value: formatMoney(model.mxn.sinIva) });
    cards.push({ label: "MXN CON IVA", value: formatMoney(model.mxn.conIva) });
  }
  if (model.usd.count) {
    cards.push({ label: "USD FACTURADO", value: `US${formatUsd(model.usd.original)}` });
    cards.push({ label: "USD CONVERTIDO A MXN", value: formatMoney(model.usd.enMxn) });
  }
  if (cards.length) y = drawCards(doc, cards, y);

  if (model.count) {
    y = ensure(110, y);
    y = sectionTitle(doc, "Estado de cobranza", y, "monto sin IVA en MXN");
    y = drawCobranza(doc, model, y);

    if (model.buckets.length >= 2) {
      y = ensure(190, y);
      y = sectionTitle(doc, "Facturación por mes", y, "MXN, sin IVA");
      y = drawMonthlyChart(doc, model.buckets, y);
    }

    if (model.clients.length >= 2) {
      const clientRows = Math.min(model.clients.length, 8) + (model.clients.length > 8 ? 1 : 0);
      y = ensure(18 + 12 + clientRows * 21 + 30, y);
      y = sectionTitle(doc, "Facturación por cliente", y);
      y = drawClients(doc, model.clients, model.total, y, ensure);
    }

    if (model.attention.length) {
      const MAXROWS = 15;
      const shown = model.attention.slice(0, MAXROWS);
      y = ensure(90, y);
      y = sectionTitle(doc, "Facturas por vencer y vencidas", y, `${formatNumber(model.attention.length)} en total`);
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, top: M + 4, bottom: FOOT },
        theme: "plain",
        head: [["Factura", "Cliente", "Vencimiento", "Situación", "Monto MXN"]],
        body: shown.map((i) => [
          i.factura,
          i.cliente,
          formatDate(i.vencimiento),
          i.semaforo === "Vencida" ? `Vencida${i.diasAtraso ? ` · ${i.diasAtraso} días` : ""}` : "Por vencer",
          formatMoney(i.mxnEquivalente),
        ].map(clean)),
        styles: { font: "helvetica", fontSize: 8, textColor: INK, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
        headStyles: { fillColor: PANEL, textColor: MUTED, fontStyle: "bold", fontSize: 6.8 },
        columnStyles: {
          0: { cellWidth: 62, fontStyle: "bold" },
          1: { cellWidth: "auto" },
          2: { cellWidth: 80 },
          3: { cellWidth: 100 },
          4: { cellWidth: 90, halign: "right" },
        },
        didParseCell(data) {
          if (data.section === "head" && data.column.index === 4) data.cell.styles.halign = "right";
          if (data.section === "body" && data.column.index === 3) {
            const vencida = String(data.cell.raw).startsWith("Vencida");
            data.cell.styles.textColor = vencida ? NEG : WARN;
            data.cell.styles.fontStyle = "bold";
          }
        },
        didDrawCell(data) {
          if (data.section !== "body") return;
          doc.setDrawColor(...LINE);
          doc.setLineWidth(0.6);
          const by = data.cell.y + data.cell.height;
          doc.line(data.cell.x, by, data.cell.x + data.cell.width, by);
        },
        rowPageBreak: "avoid",
      });
      y = doc.lastAutoTable.finalY + 8;
      if (model.attention.length > MAXROWS) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(`y ${formatNumber(model.attention.length - MAXROWS)} más (ver detalle completo en las siguientes páginas).`, M, y + 8);
        y += 12;
      }
    }
  }

  /* Detalle de facturas (anexo) */
  // Si queda poco espacio en la hoja actual, el detalle arranca en una nueva;
  // si no, continúa abajo para no dejar media hoja vacía.
  if (y > PAGE_H - FOOT - 190) {
    doc.addPage();
    y = M + 4;
  } else {
    y += 14;
  }
  y = sectionTitle(doc, "Detalle de facturas", y, `${formatNumber(invoices.length)} registro${invoices.length === 1 ? "" : "s"}`);

  const hasCancelled = invoices.some((i) => i.isCancelled);
  doc.autoTable({
    startY: y,
    margin: { left: M, right: M, top: M + 4, bottom: FOOT },
    theme: "plain",
    showFoot: "lastPage",
    head: [["Factura", "Cliente", "Fecha", "Vence", "Mon.", "Monto con IVA", "MXN sin IVA", "Estatus"]],
    body: invoices.map((i) => {
      const monto = i.moneda === "USD" ? `${usdCell(i)}${i.fxRate ? `\nTC ${i.fxRate.toFixed(4)}` : ""}` : formatMoney(i.monto);
      let estatus = i.isCancelled ? "Cancelada" : i.semaforo;
      if (!i.isCancelled && i.semaforo === "Vencida" && i.diasAtraso) estatus += `\n${i.diasAtraso} días`;
      return [i.factura, i.cliente, formatDate(i.fecha), formatDate(i.vencimiento), i.moneda, monto, formatMoney(i.mxnEquivalente), estatus].map(clean);
    }),
    foot: [[
      { content: clean(`TOTAL · ${formatNumber(model.count)} factura${model.count === 1 ? "" : "s"}`), colSpan: 6, styles: { halign: "right" } },
      { content: clean(formatMoney(model.total)), styles: { halign: "right" } },
      "",
    ]],
    styles: { font: "helvetica", fontSize: 7.5, textColor: INK, cellPadding: { top: 5, bottom: 5, left: 5, right: 5 }, overflow: "linebreak" },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, cellPadding: { top: 6, bottom: 6, left: 5, right: 5 } },
    footStyles: { fillColor: PANEL, textColor: INK, fontStyle: "bold", fontSize: 8, cellPadding: { top: 7, bottom: 7, left: 5, right: 5 } },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: {
      0: { cellWidth: 50, fontStyle: "bold" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 52 },
      3: { cellWidth: 52 },
      4: { cellWidth: 26 },
      5: { cellWidth: 78, halign: "right" },
      6: { cellWidth: 74, halign: "right" },
      7: { cellWidth: 58 },
    },
    didParseCell(data) {
      if (data.section === "head" && (data.column.index === 5 || data.column.index === 6)) data.cell.styles.halign = "right";
      if (data.section !== "body") return;
      const inv = invoices[data.row.index];
      if (inv && inv.isCancelled) {
        data.cell.styles.textColor = SOFT;
        return;
      }
      if (data.column.index === 7 && inv) {
        data.cell.styles.textColor = STATUS_TEXT[inv.semaforo] || INK;
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 5 && inv && inv.moneda === "USD") data.cell.styles.fontSize = 7.2;
    },
    didDrawCell(data) {
      if (data.section !== "body") return;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      const by = data.cell.y + data.cell.height;
      doc.line(data.cell.x, by, data.cell.x + data.cell.width, by);
    },
    rowPageBreak: "avoid",
  });

  if (hasCancelled) {
    const fy = doc.lastAutoTable.finalY + 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("Las facturas canceladas aparecen en gris y no se incluyen en los totales ni en los análisis.", M, Math.min(fy, PAGE_H - FOOT + 6));
  }

  /* Pie de página en todas las hojas */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.line(M, PAGE_H - 32, M + CW, PAGE_H - 32);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text("TYMMSA", M, PAGE_H - 19);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...SOFT);
    doc.text("· Reporte de facturación", M + 36, PAGE_H - 19);
    doc.text(`Página ${p} de ${pages}`, M + CW, PAGE_H - 19, { align: "right" });
  }

  const name = `tymmsa-reporte-facturacion-${new Date().toISOString().slice(0, 10)}.pdf`;
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

  // Desde el ícono de la pantalla de inicio (iOS) un PDF descargado
  // reemplazaría la app sin botón de regreso: se abre la hoja de compartir
  // (Guardar en Archivos, Imprimir, AirDrop…).
  if (standalone && navigator.canShare) {
    const file = new File([doc.output("blob")], name, { type: "application/pdf" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Reporte de facturación TYMMSA" });
        return true;
      } catch (err) {
        if (err && err.name === "AbortError") return true;
      }
    }
  }

  doc.save(name);
  return true;
}
