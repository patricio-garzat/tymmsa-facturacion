// Configuración de conexión a datos.
// Una vez publicado el Apps Script Web App (ver apps-script/Code.gs),
// pega aquí la URL que termina en /exec y el mismo token del script.
export const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzb4MCEoq8zJzWsqcU-V7ltIFSHpkgBfHelz8RxN_KWpvECiwEpIqCo66WcQOY5EHLuew/exec",
  ACCESS_TOKEN: "f1b0cxmucl1s7CLbdnaq0ysJ62pclPsT",
  FALLBACK_DATA_URL: "data/sample-data.json",
  // Cada cuánto se vuelve a pedir la data al Apps Script (ms).
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,

  // Token gratuito de Banxico (Sistema de Información Económica), para
  // convertir facturas en USD con el tipo de cambio FIX real de cada fecha.
  // Se saca sin registro en https://www.banxico.org.mx/SieAPIRest/service/v1/token
  // Déjalo vacío ("") para usar siempre el tipo de cambio fijo de CATALOGOS.
  BANXICO_TOKEN: "7d716dfec17067f602f8d2d062ff3b161b215a8824cc856f95c2b7092171a9b2",
  BANXICO_SERIE_FIX: "SF43718",

  // Acceso al portal: no se guarda la contraseña en texto plano, sólo su
  // huella SHA-256. Para cambiarla, calcula el nuevo hash (por ejemplo en
  // la consola del navegador con:
  //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('tu-nueva-clave'))
  //     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
  // y pega el resultado aquí.
  AUTH_PASSWORD_HASH: "554b80355d291cbcfe28098f6448e18a3a0e3e00feed8878059da4b360ad8390",
};
