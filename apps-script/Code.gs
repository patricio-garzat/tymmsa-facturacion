/**
 * TYMMSA - Portal de Facturación
 * API de solo lectura que expone REGISTRO y CATALOGOS como JSON
 * para el portal web, sin compartir el Google Sheet directamente.
 *
 * INSTALACIÓN:
 * 1. Abre el Google Sheet "FACTURACION 2026 - TYMMSA".
 * 2. Extensiones > Apps Script.
 * 3. Borra el contenido de Code.gs y pega este archivo completo.
 * 4. Cambia el valor de ACCESS_TOKEN por una cadena secreta propia
 *    (o deja la generada aquí, pero no la compartas fuera del equipo).
 * 5. Guarda. Luego: Implementar > Nueva implementación.
 *    - Tipo: Aplicación web
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quién tiene acceso: Cualquier usuario
 * 6. Copia la URL que termina en /exec y pégala en js/config.js
 *    como APPS_SCRIPT_URL, junto con el mismo ACCESS_TOKEN.
 * 7. Cada vez que edites este script, vuelve a "Implementar > Gestionar
 *    implementaciones > Editar > Nueva versión" para que los cambios apliquen.
 *
 * El tipo de cambio histórico (Banxico) se trae directamente desde el
 * portal (ver js/fxService.js) porque el API de Banxico acepta llamadas
 * de navegador (CORS); este script no necesita tocarlo.
 *
 * DETALLE DE FACTURAS DESDE OFIVIEW (ERP):
 * Este script también puede consultar, bajo demanda, el comentario y la
 * descripción de una factura directamente desde Ofiview (erp.ofiview.com).
 * El usuario/contraseña de Ofiview NUNCA se escriben en este archivo
 * (es un script público en GitHub). Se configuran así:
 * 1. En el editor de Apps Script: ⚙️ Configuración del proyecto.
 * 2. Baja hasta "Propiedades del script" > "Añadir propiedad del script".
 * 3. Agrega OFIVIEW_USERNAME con tu usuario de Ofiview.
 * 4. Agrega OFIVIEW_PASSWORD con tu contraseña de Ofiview.
 * 5. Guarda. No hace falta volver a desplegar para que tomen efecto.
 */

var ACCESS_TOKEN = 'f1b0cxmucl1s7CLbdnaq0ysJ62pclPsT';

var SHEET_REGISTRO = 'REGISTRO';
var SHEET_CATALOGOS = 'CATALOGOS';

var OFIVIEW_BASE = 'https://erp.ofiview.com';
var OFIVIEW_APP_CLIENT_ID = 9;
var OFIVIEW_COMPANY_ID = 49;
var OFIVIEW_BRANCH_ID = 65;
var OFIVIEW_SESSION_CACHE_KEY = 'ofiview_session_cookie';
var OFIVIEW_SESSION_TTL_SECONDS = 900; // 15 minutos

function doGet(e) {
  try {
    var token = e && e.parameter ? e.parameter.token : null;
    if (token !== ACCESS_TOKEN) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    var action = e.parameter.action || 'sheet';

    if (action === 'ofiview') {
      var factura = String(e.parameter.factura || '').trim();
      if (!factura) return jsonResponse({ error: 'factura requerida' }, 400);
      return jsonResponse(getOfiviewInvoiceDetail(factura), 200);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var payload = {
      generatedAt: new Date().toISOString(),
      params: readParams(ss),
      invoices: readInvoices(ss)
    };

    return jsonResponse(payload, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

/* ---------------- Ofiview (ERP) ---------------- */

function getOfiviewSessionCookie(forceNew) {
  var cache = CacheService.getScriptCache();
  if (!forceNew) {
    var cached = cache.get(OFIVIEW_SESSION_CACHE_KEY);
    if (cached) return cached;
  }

  var props = PropertiesService.getScriptProperties();
  var username = props.getProperty('OFIVIEW_USERNAME');
  var password = props.getProperty('OFIVIEW_PASSWORD');
  if (!username || !password) {
    throw new Error('Faltan OFIVIEW_USERNAME / OFIVIEW_PASSWORD en las propiedades del script');
  }

  var response = UrlFetchApp.fetch(OFIVIEW_BASE + '/Account/Login', {
    method: 'post',
    payload: { UserName: username, Password: password },
    followRedirects: false,
    muteHttpExceptions: true
  });

  var headers = response.getAllHeaders();
  var cookies = headers['Set-Cookie'] || headers['set-cookie'];
  if (!cookies) throw new Error('Ofiview no devolvió sesión al iniciar sesión (revisa OFIVIEW_USERNAME / OFIVIEW_PASSWORD)');

  var cookieArray = Array.isArray(cookies) ? cookies : [cookies];
  var cookieHeader = cookieArray.map(function (c) { return c.split(';')[0]; }).join('; ');

  cache.put(OFIVIEW_SESSION_CACHE_KEY, cookieHeader, OFIVIEW_SESSION_TTL_SECONDS);
  return cookieHeader;
}

function ofiviewFetch(path, cookieHeader) {
  var response = UrlFetchApp.fetch(OFIVIEW_BASE + path, {
    method: 'get',
    headers: { Cookie: cookieHeader },
    followRedirects: false,
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('sesión inválida (' + code + ')');
  }
  return JSON.parse(response.getContentText());
}

function ofiviewSalesInvoicePath(suffix) {
  return '/rest/v1/ApplicationClients/' + OFIVIEW_APP_CLIENT_ID +
    '/Companies/' + OFIVIEW_COMPANY_ID + '/Branches/' + OFIVIEW_BRANCH_ID +
    '/Sales/SalesInvoices' + suffix;
}

function getOfiviewInvoiceDetail(factura) {
  var attempt = function (forceNew) {
    var cookieHeader = getOfiviewSessionCookie(forceNew);

    var listPath = ofiviewSalesInvoicePath(
      '/?FullSequence=' + encodeURIComponent(factura) +
      '&_search=false&rows=10&page=1&sidx=SalesInvoiceId&sord=desc'
    );
    var listResult = ofiviewFetch(listPath, cookieHeader);
    var row = listResult && listResult.Rows && listResult.Rows[0];
    if (!row) return { found: false };

    var detail = ofiviewFetch(ofiviewSalesInvoicePath('/' + row.SalesInvoiceId), cookieHeader);
    var items = (detail.SalesInvoiceLineItems || []).map(function (li) {
      return { producto: li.ProductName, cantidad: li.Quantity, precioUnitario: li.UnitPrice };
    });

    return {
      found: true,
      factura: row.FullSequence,
      comentarios: row.Comments || '',
      articulos: items
    };
  };

  try {
    return attempt(false);
  } catch (err) {
    // La sesión guardada pudo caducar o invalidarse; intenta una vez más
    // con un login nuevo antes de rendirse.
    return attempt(true);
  }
}

function readInvoices(ss) {
  var sheet = ss.getSheetByName(SHEET_REGISTRO);
  if (!sheet) throw new Error('No se encontró la hoja ' + SHEET_REGISTRO);

  var lastRow = sheet.getLastRow();
  var lastCol = 14; // A..N
  if (lastRow < 4) return [];

  var range = sheet.getRange(4, 1, lastRow - 3, lastCol);
  var values = range.getValues();

  var invoices = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var factura = r[0];
    if (factura === '' || factura === null) continue;

    invoices.push({
      factura: String(factura),
      cliente: String(r[1] || '').trim(),
      fecha: toIsoDate(r[2]),
      mes: r[3],
      moneda: r[4],
      monto: toNumber(r[5]),
      montoSinIva: toNumber(r[6]),
      mxnEquivalente: toNumber(r[7]),
      estatus: r[8],
      condicion: r[9],
      diasCredito: toNumber(r[10]),
      vencimiento: toIsoDate(r[11]),
      diasAtraso: toNumber(r[12]),
      semaforo: r[13]
    });
  }
  return invoices;
}

function readParams(ss) {
  var sheet = ss.getSheetByName(SHEET_CATALOGOS);
  if (!sheet) throw new Error('No se encontró la hoja ' + SHEET_CATALOGOS);

  return {
    iva: sheet.getRange('B5').getValue(),
    tipoCambio: sheet.getRange('B6').getValue(),
    metaAnual: sheet.getRange('B7').getValue(),
    mesesCerrados: sheet.getRange('B8').getValue(),
    ajusteConservador: sheet.getRange('B9').getValue(),
    ajusteOptimista: sheet.getRange('B10').getValue(),
    diasAlertaPorVencer: sheet.getRange('B11').getValue()
  };
}

function toIsoDate(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'America/Mexico_City', 'yyyy-MM-dd');
  }
  return String(value);
}

function toNumber(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  var n = Number(value);
  return isNaN(n) ? null : n;
}

function jsonResponse(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
