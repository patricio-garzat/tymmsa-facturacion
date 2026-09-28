// Capa de filtros.
// Responsabilidad única: mantener el estado de filtros activos y aplicar
// ese estado sobre una lista de facturas. No sabe nada de UI ni de cálculos.

export const ALL = "Todos";

export function createFilterState() {
  return {
    anio: ALL,
    mes: ALL,
    cliente: ALL,
    moneda: ALL,
  };
}

/**
 * Aplica el filtro de facturas canceladas siempre (no cuentan como venta),
 * más los filtros activos de año / mes / cliente / moneda.
 */
export function applyFilters(invoices, filters, { includeCancelled = false } = {}) {
  return invoices.filter((inv) => {
    if (!includeCancelled && inv.isCancelled) return false;
    if (filters.anio !== ALL && inv.anio !== filters.anio) return false;
    if (filters.mes !== ALL && inv.mes !== filters.mes) return false;
    if (filters.cliente !== ALL && inv.cliente !== filters.cliente) return false;
    if (filters.moneda !== ALL && inv.moneda !== filters.moneda) return false;
    return true;
  });
}

/** Igual que applyFilters pero ignorando el filtro de mes (para "acumulado del año"). */
export function applyFiltersIgnoringMonth(invoices, filters) {
  return applyFilters(invoices, { ...filters, mes: ALL });
}
