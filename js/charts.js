// Capa de visualización (gráficas).
// Usa Chart.js (cargado por CDN en index.html como `Chart` global).
// Paleta categórica y de estatus tomada del sistema de dataviz validado
// (ver skill "dataviz"): azul/naranja para series pareadas, semáforo
// good/warning/critical para estados de cobranza.

function isDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const SERIES_COLOR = {
  get primary() { return isDark() ? "#3987e5" : "#2a78d6"; },
  get secondary() { return isDark() ? "#d95926" : "#eb6834"; },
};

export const STATUS_COLOR = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
};

function chartFonts() {
  return {
    family: "'Inter', -apple-system, 'Segoe UI', sans-serif",
    size: 12,
  };
}

function chromeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue("--text-secondary").trim() || "#6b6b74",
    muted: styles.getPropertyValue("--text-muted").trim() || "#9a9aa2",
    grid: styles.getPropertyValue("--border").trim() || "#e7e7ea",
    surface: styles.getPropertyValue("--surface").trim() || "#ffffff",
  };
}

const registry = new Map();

function destroyIfExists(canvasId) {
  const existing = registry.get(canvasId);
  if (existing) {
    existing.destroy();
    registry.delete(canvasId);
  }
}

function baseTooltip(chrome) {
  return {
    backgroundColor: chrome.surface,
    titleColor: chrome.text,
    bodyColor: chrome.text,
    borderColor: chrome.grid,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxPadding: 4,
    titleFont: { weight: "600", ...chartFonts() },
    bodyFont: chartFonts(),
  };
}

/**
 * Gráfica principal: facturación mensual, con comparación opcional de
 * un segundo año (serie secundaria).
 */
export function renderMonthlyChart(canvasId, { labels, seriesA, labelA, seriesB, labelB, moneyFormatter }) {
  destroyIfExists(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const chrome = chromeColors();

  const datasets = [
    {
      label: labelA,
      data: seriesA,
      backgroundColor: SERIES_COLOR.primary,
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 34,
      categoryPercentage: seriesB ? 0.7 : 0.55,
      barPercentage: 0.9,
    },
  ];

  if (seriesB) {
    datasets.push({
      label: labelB,
      data: seriesB,
      backgroundColor: SERIES_COLOR.secondary,
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 34,
      categoryPercentage: 0.7,
      barPercentage: 0.9,
    });
  }

  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: !!seriesB,
          position: "top",
          align: "end",
          labels: { color: chrome.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", font: chartFonts() },
        },
        tooltip: {
          ...baseTooltip(chrome),
          callbacks: {
            label: (item) => `${item.dataset.label}: ${moneyFormatter(item.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: chrome.muted, font: chartFonts() },
        },
        y: {
          beginAtZero: true,
          grid: { color: chrome.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: chrome.muted,
            font: chartFonts(),
            callback: (v) => moneyFormatter(v, true),
            maxTicksLimit: 6,
          },
        },
      },
    },
  });

  registry.set(canvasId, chart);
  return chart;
}
