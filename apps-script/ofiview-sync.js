/**
 * TYMMSA - Sincronización manual de Ofiview → Portal
 *
 * QUÉ HACE: lee las facturas recientes de Ofiview usando TU sesión (por
 * eso hay que correrlo mientras estás en erp.ofiview.com, ya con tu
 * sesión iniciada) y manda su descripción/comentarios al backend del
 * portal, que los guarda en una pestaña "OFIVIEW_DETALLE" del Sheet.
 *
 * CÓMO USARLO:
 * 1. Entra a https://erp.ofiview.com y asegúrate de tener sesión iniciada.
 * 2. Abre las Herramientas de desarrollador (Cmd+Opt+I en Mac) en esa
 *    misma pestaña, y ve a la pestaña "Console" (Consola).
 * 3. Copia TODO este archivo y pégalo en la consola. Presiona Enter.
 * 4. Espera — va mostrando el avance ahí mismo. Al terminar aparece una
 *    alerta con cuántas facturas se sincronizaron.
 * 5. Repite esto cada vez que quieras traer comentarios/descripciones
 *    nuevas al portal (por ejemplo, una vez por semana).
 *
 * Ajusta DAYS_BACK si quieres sincronizar más o menos historial.
 */
(async function () {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzb4MCEoq8zJzWsqcU-V7ltIFSHpkgBfHelz8RxN_KWpvECiwEpIqCo66WcQOY5EHLuew/exec";
  const ACCESS_TOKEN = "f1b0cxmucl1s7CLbdnaq0ysJ62pclPsT";
  const DAYS_BACK = 180;

  const BASE = "/rest/v1/ApplicationClients/9/Companies/49/Branches/65/Sales/SalesInvoices";

  function fmt(d) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status + " en " + path);
    return res.json();
  }

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - DAYS_BACK);

  console.log("[Ofiview sync] Buscando facturas de los últimos", DAYS_BACK, "días…");

  let page = 1;
  const rows = [];
  while (true) {
    const listPath = `${BASE}/?StartDate=${fmt(start)}&EndDate=${fmt(end)}&_search=false&rows=100&page=${page}&sidx=SalesInvoiceId&sord=desc`;
    const data = await fetchJson(listPath);
    rows.push(...(data.Rows || []));
    if (page >= (data.TotalPages || 1)) break;
    page++;
  }

  console.log(`[Ofiview sync] ${rows.length} facturas encontradas. Consultando descripciones…`);

  const records = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const detail = await fetchJson(`${BASE}/${row.SalesInvoiceId}`);
      const articulos = (detail.SalesInvoiceLineItems || []).map((li) => ({
        producto: li.ProductName,
        cantidad: li.Quantity,
      }));
      records.push({ factura: row.FullSequence, comentarios: row.Comments || "", articulos });
    } catch (err) {
      console.warn("[Ofiview sync] Error en factura", row.FullSequence, err);
    }
    if (i % 20 === 0) console.log(`[Ofiview sync] ${i}/${rows.length}…`);
  }

  console.log("[Ofiview sync] Enviando al portal…");

  const res = await fetch(`${APPS_SCRIPT_URL}?token=${ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: ACCESS_TOKEN, action: "ofiview_sync", records }),
  });
  const result = await res.json();

  console.log("[Ofiview sync] Listo:", result);
  alert(`Sincronización completa: ${records.length} facturas actualizadas en el portal.`);
})();
