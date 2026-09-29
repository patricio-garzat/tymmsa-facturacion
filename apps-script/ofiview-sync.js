/**
 * TYMMSA - Sincronización manual de Ofiview → Portal
 *
 * QUÉ HACE: lee las facturas recientes de Ofiview usando TU sesión (por
 * eso hay que correrlo mientras estás en erp.ofiview.com, ya con tu
 * sesión iniciada) y manda su descripción/comentarios al backend del
 * portal, que los guarda en una pestaña "OFIVIEW_DETALLE" del Sheet.
 *
 * Pide los datos en bloques de 30 días (el mismo tamaño que usa la
 * pantalla normal de "Lista de Facturas" de Ofiview) para no chocar con
 * el límite de tamaño por consulta que tiene el servidor.
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
 * Ajusta TOTAL_DAYS_BACK si quieres sincronizar más o menos historial
 * (se sigue pidiendo en bloques de 30 días, solo que corre más bloques).
 */
(async function () {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzb4MCEoq8zJzWsqcU-V7ltIFSHpkgBfHelz8RxN_KWpvECiwEpIqCo66WcQOY5EHLuew/exec";
  const ACCESS_TOKEN = "f1b0cxmucl1s7CLbdnaq0ysJ62pclPsT";
  const TOTAL_DAYS_BACK = 30;
  const CHUNK_DAYS = 30;
  const ROWS_PER_PAGE = 10;

  const BASE = "/rest/v1/ApplicationClients/9/Companies/49/Branches/65/Sales/SalesInvoices";

  function fmt(d) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  // Usamos el jQuery que ya está cargado en la página (Ofiview corre sobre
  // jQuery) en vez de fetch() directo: sus peticiones internas agregan
  // encabezados/config que el servidor exige y que un fetch() manual no
  // replica, lo que causaba 403 Forbidden aunque la URL fuera idéntica.
  function fetchJson(path) {
    return new Promise((resolve, reject) => {
      jQuery.ajax({
        url: path,
        method: "GET",
        dataType: "json",
        success: resolve,
        error: (xhr) => reject(new Error("HTTP " + xhr.status + " en " + path)),
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  console.log(`[Ofiview sync] Buscando facturas de los últimos ${TOTAL_DAYS_BACK} días, en bloques de ${CHUNK_DAYS}…`);

  const rows = [];
  const seenIds = new Set();
  let chunkEnd = new Date();
  let daysCovered = 0;

  while (daysCovered < TOTAL_DAYS_BACK) {
    const chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() - CHUNK_DAYS);

    let page = 1;
    while (true) {
      const listPath = `${BASE}/?StartDate=${fmt(chunkStart)}&EndDate=${fmt(chunkEnd)}&_search=false&rows=${ROWS_PER_PAGE}&page=${page}&sidx=SalesInvoiceId&sord=desc`;
      const data = await fetchJson(listPath);
      (data.Rows || []).forEach((r) => {
        if (!seenIds.has(r.SalesInvoiceId)) {
          seenIds.add(r.SalesInvoiceId);
          rows.push(r);
        }
      });
      if (page >= (data.TotalPages || 1)) break;
      page++;
      await sleep(150);
    }

    console.log(`[Ofiview sync] Bloque ${fmt(chunkStart)} a ${fmt(chunkEnd)}: ${rows.length} facturas acumuladas…`);
    chunkEnd = chunkStart;
    daysCovered += CHUNK_DAYS;
    await sleep(150);
  }

  console.log(`[Ofiview sync] ${rows.length} facturas encontradas en total. Consultando descripciones…`);

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
    await sleep(80);
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
