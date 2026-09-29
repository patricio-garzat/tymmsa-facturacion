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
 * El portal puede mostrar, junto a cada factura, la descripción del
 * artículo y los comentarios que existen en Ofiview (erp.ofiview.com).
 *
 * Ofiview ata cada sesión a la IP desde donde se inició — ni un login
 * automático ni reusar tu cookie desde un servidor funcionan, porque
 * Google (o cualquier backend) siempre tiene una IP distinta a la tuya
 * y Ofiview lo rechaza. Por eso esto NO es una conexión en vivo: es una
 * sincronización que TÚ corres manualmente, desde tu propia computadora,
 * cada cierto tiempo (por ejemplo una vez a la semana). Así:
 * 1. Inicia sesión normal en https://erp.ofiview.com en tu navegador.
 * 2. Abre la consola de JavaScript (DevTools) en esa misma pestaña.
 * 3. Pega el contenido de apps-script/ofiview-sync.js y presiona Enter.
 * 4. Ese script lee tus facturas recientes DESDE tu propia sesión (por
 *    eso sí funciona) y se las manda a este Apps Script por HTTP POST.
 * Este backend solo recibe y guarda esos datos en una pestaña nueva del
 * Sheet llamada OFIVIEW_DETALLE; nunca se conecta a Ofiview por su cuenta.
 */

var ACCESS_TOKEN = 'f1b0cxmucl1s7CLbdnaq0ysJ62pclPsT';

var SHEET_REGISTRO = 'REGISTRO';
var SHEET_CATALOGOS = 'CATALOGOS';
var SHEET_OFIVIEW = 'OFIVIEW_DETALLE';

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
      return jsonResponse(getOfiviewDetailFromSheet(factura), 200);
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

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== ACCESS_TOKEN) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    if (body.action === 'ofiview_sync') {
      var count = saveOfiviewRecords(body.records || []);
      return jsonResponse({ ok: true, count: count }, 200);
    }

    return jsonResponse({ error: 'acción no reconocida' }, 400);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

/* ---------------- Ofiview (ERP) — sincronizado a mano ---------------- */

function saveOfiviewRecords(records) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_OFIVIEW);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_OFIVIEW);
    sheet.getRange(1, 1, 1, 4).setValues([['Factura', 'Comentarios', 'Descripcion', 'ActualizadoEn']]);
  }

  var lastRow = sheet.getLastRow();
  var existingRowByFactura = {};
  if (lastRow > 1) {
    var current = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < current.length; i++) {
      if (current[i][0]) existingRowByFactura[String(current[i][0])] = i + 2;
    }
  }

  var now = new Date().toISOString();
  records.forEach(function (r) {
    var descripcion = (r.articulos || [])
      .map(function (a) { return a.producto + (a.cantidad ? ' x' + a.cantidad : ''); })
      .join(' | ');
    var rowValues = [r.factura, r.comentarios || '', descripcion, now];
    var rowIndex = existingRowByFactura[String(r.factura)];
    if (rowIndex) {
      sheet.getRange(rowIndex, 1, 1, 4).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
      existingRowByFactura[String(r.factura)] = sheet.getLastRow();
    }
  });

  return records.length;
}

function getOfiviewDetailFromSheet(factura) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_OFIVIEW);
  if (!sheet) return { found: false };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { found: false };

  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === factura) {
      return {
        found: true,
        factura: factura,
        comentarios: data[i][1] || '',
        descripcion: data[i][2] || '',
        actualizadoEn: data[i][3] ? String(data[i][3]) : null
      };
    }
  }
  return { found: false };
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
