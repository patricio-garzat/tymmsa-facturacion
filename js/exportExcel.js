// Capa de exportación (Excel).
// Responsabilidad única: convertir una lista de facturas ya filtradas y su
// resumen en un archivo .xlsx descargable. Usa SheetJS (cargado por CDN en
// index.html como `XLSX` global). No decide qué facturas exportar ni
// calcula nada — eso ya viene resuelto desde afuera.

const HEADERS = [
  "Factura", "Cliente", "Fecha", "Moneda", "Monto original",
  "Tipo de cambio", "Equivalente MXN", "Monto sin IVA", "Estatus",
  "Condición", "Vencimiento", "Días de atraso", "Semáforo cobranza",
];

const MONEY_COLS = [4, 6, 7];
const DATE_COLS = [2, 10];
const RATE_COL = 5;

function effectiveRate(inv) {
  if (inv.fxRate != null) return inv.fxRate;
  if (inv.moneda !== "USD" || !inv.montoSinIva) return null;
  return inv.mxnEquivalente / inv.montoSinIva;
}

function invoiceRow(inv) {
  return [
    inv.factura,
    inv.cliente,
    inv.fecha instanceof Date ? inv.fecha : null,
    inv.moneda,
    inv.monto,
    inv.moneda === "USD" ? effectiveRate(inv) : null,
    inv.mxnEquivalente,
    inv.montoSinIva,
    inv.isCancelled ? "Cancelada" : inv.estatus,
    inv.condicion || "",
    inv.vencimiento instanceof Date ? inv.vencimiento : null,
    inv.diasAtraso ?? "",
    inv.semaforo,
  ];
}

/**
 * @param {object} opts
 * @param {Array} opts.invoices  facturas ya filtradas (mismo orden de la tabla)
 * @param {object} opts.summary  resultado de computeFacturacionSummary
 * @param {string} opts.filterLabel  descripción legible de los filtros activos
 * @param {string} [opts.fileName]
 * @returns {boolean} true si se generó el archivo, false si SheetJS no cargó
 */
export function exportInvoicesToExcel({ invoices, summary, filterLabel, fileName }) {
  if (typeof XLSX === "undefined") return false;

  const summaryRows = [
    ["TYMMSA — Detalle de facturación"],
    [`Filtros: ${filterLabel}`],
    [`Generado: ${new Date().toLocaleString("es-MX")}`],
    [],
    ["MXN sin IVA", summary.mxnSinIva],
    ["MXN con IVA", summary.mxnConIva],
    ["USD", summary.usdOriginal],
    ["USD → MXN", summary.usdEnMxn],
    ["Total MXN (incl. USD)", summary.totalMxn],
    [],
    HEADERS,
  ];

  const dataRows = invoices.map(invoiceRow);
  const sheetData = summaryRows.concat(dataRows);
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  const headerRowIndex = summaryRows.length - 1;
  dataRows.forEach((_, i) => {
    const r = headerRowIndex + 1 + i;
    MONEY_COLS.forEach((c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
    });
    const rateCell = ws[XLSX.utils.encode_cell({ r, c: RATE_COL })];
    if (rateCell && typeof rateCell.v === "number") rateCell.z = "0.0000";
    DATE_COLS.forEach((c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v instanceof Date) cell.z = "dd/mm/yyyy";
    });
  });

  [4, 6, 7].forEach((r) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
  });

  ws["!cols"] = [
    { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 8 }, { wch: 14 },
    { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
    { wch: 12 }, { wch: 10 }, { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Facturación");
  XLSX.writeFile(wb, fileName || "tymmsa-facturacion.xlsx");
  return true;
}
