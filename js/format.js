// Utilidades de formato compartidas por UI, charts e insights.

const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const mxnFormatterCompact = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value) {
  return mxnFormatter.format(value || 0);
}

export function formatMoneyCompact(value) {
  return mxnFormatterCompact.format(value || 0);
}

export function formatUsd(value) {
  return usdFormatter.format(value || 0);
}

export function formatPct(value, digits = 1) {
  if (value === null || value === undefined || isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return "—";
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatNumber(value) {
  return new Intl.NumberFormat("es-MX").format(value || 0);
}

export function formatRate(value) {
  if (value === null || value === undefined || isNaN(value)) return "—";
  return value.toFixed(4);
}

export function formatRelativeDays(days) {
  if (days === null || days === undefined || isNaN(days)) return "—";
  if (days <= 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  if (days < 30) return `Hace ${days} días`;
  if (days < 60) return "Hace 1 mes";
  if (days < 365) return `Hace ${Math.round(days / 30)} meses`;
  const years = Math.round(days / 365);
  return `Hace ${years} año${years === 1 ? "" : "s"}`;
}
