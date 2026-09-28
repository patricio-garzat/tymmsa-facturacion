# TYMMSA — Portal de Facturación

Dashboard privado de facturación para TYMMSA. Lee los datos directamente del
Google Sheet "FACTURACION 2026 - TYMMSA" (hoja `REGISTRO` + parámetros de
`CATALOGOS`) y calcula todos los indicadores en el navegador — nada está
hardcodeado ni precalculado en el portal.

## Estructura del proyecto

```
tymmsa-portal/
├── index.html              Estructura de la página
├── css/styles.css          Sistema de diseño (claro, minimalista)
├── data/sample-data.json   Snapshot de respaldo (se usa si no hay conexión en vivo)
├── apps-script/Code.gs     Backend de solo lectura para publicar en Google Apps Script
└── js/
    ├── config.js           URL del Apps Script + token
    ├── dataService.js      Obtención de datos (fetch al Apps Script o al snapshot)
    ├── processing.js       Normalización del JSON crudo a un modelo tipado
    ├── filters.js          Estado y aplicación de filtros (año/mes/cliente/moneda)
    ├── calculations.js     Todos los cálculos: KPIs, series mensuales, ranking
    │                       de clientes, mezcla de moneda, cartera, proyección
    ├── insights.js         Genera las frases de "Insights" a partir de los cálculos
    ├── charts.js           Gráficas (Chart.js)
    ├── ui.js                Renderizado a DOM y wiring de eventos
    └── main.js             Orquesta todo lo anterior
```

Esta separación existe para que, si más adelante cambia la fuente de datos
(otro Sheet, una base de datos, etc.), sólo haya que tocar `dataService.js` —
el resto de la app no sabe de dónde vienen los datos.

## Cómo conectar el portal en vivo a Google Sheets

El Sheet es privado (compartido sólo con el equipo), así que el portal no lo
lee directamente. En su lugar, un pequeño script de Google Apps Script —
que corre dentro de tu propia cuenta de Google, sin servidores de por medio —
expone sólo el JSON que el portal necesita.

1. Abre el Google Sheet **"FACTURACION 2026 - TYMMSA"**.
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido de `Code.gs` y pega el contenido de
   [`apps-script/Code.gs`](apps-script/Code.gs) de este proyecto.
4. (Opcional pero recomendado) Cambia el valor de `ACCESS_TOKEN` por uno
   propio — es lo único que evita que alguien más adivine la URL y lea los
   datos.
5. Guarda. Luego **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo** (tu cuenta)
   - Quién tiene acceso: **Cualquier usuario**
6. Copia la URL que termina en `/exec`.
7. Abre [`js/config.js`](js/config.js) y pega esa URL en `APPS_SCRIPT_URL`,
   con el mismo `ACCESS_TOKEN` que pusiste en el script.
8. Recarga el portal. El indicador junto al logo debe decir
   "Conectado a Google Sheets".

Cada vez que agregues o edites una factura en `REGISTRO` (o cambies un
parámetro en `CATALOGOS`), el portal la reflejará la próxima vez que se
recargue o se actualice automáticamente (cada 5 minutos, configurable en
`CONFIG.REFRESH_INTERVAL_MS`).

Si en algún momento modificas `Code.gs`, debes volver a
**Implementar → Gestionar implementaciones → Editar (lápiz) → Nueva versión**
para que los cambios se publiquen.

## Tipo de cambio histórico (Banxico)

Por defecto, todas las facturas en USD se convierten a MXN usando el tipo de
cambio fijo de `CATALOGOS` (igual que hace el propio Sheet). Opcionalmente,
el portal puede usar el **tipo de cambio FIX real del día en que se facturó
cada factura**, tomado del API oficial de Banco de México (el mismo valor
que publica el DOF), sin tocar el Google Sheet.

Para activarlo:

1. Saca un token gratuito (sin registro, solo un captcha) en
   [banxico.org.mx/SieAPIRest/service/v1/token](https://www.banxico.org.mx/SieAPIRest/service/v1/token).
2. Pégalo en `BANXICO_TOKEN` dentro de `apps-script/Code.gs` (en el Apps
   Script del Sheet, no solo en este repo).
3. Vuelve a implementar una **Nueva versión** del Web App (mismo paso de
   siempre: Implementar → Gestionar implementaciones → Editar → Nueva
   versión). La URL no cambia.

Si `BANXICO_TOKEN` queda vacío, o el API de Banxico falla momentáneamente,
el portal sigue funcionando normal usando el tipo de cambio de `CATALOGOS`
como respaldo — nunca se rompe por esto. La pestaña **Análisis → Mezcla de
moneda** siempre indica qué tipo de cambio se está usando.

## Cómo se calculan los números

- **Facturación (MXN equivalente, sin IVA)** es la columna `MXN EQUIVALENTE`
  de `REGISTRO` para facturas en MXN (monto sin IVA). Para facturas en USD,
  el portal recalcula este valor con el tipo de cambio histórico de Banxico
  de la fecha de la factura cuando está disponible (ver arriba), o con el
  tipo de cambio de `CATALOGOS` si no.
- Las **facturas con estatus "Cancelada"** no cuentan en ningún total, pero
  siguen siendo visibles (con una etiqueta) en la tabla de Facturación, para
  no perder trazabilidad.
- La **comparación "vs. período anterior"** compara meses contra el mes
  anterior, o años completos contra el año anterior recortado a los mismos
  meses transcurridos (comparación "a la fecha", no un año parcial contra
  uno completo).
- La **proyección de cierre de año** replica la metodología del propio Sheet:
  promedio de los "meses cerrados" (parámetro editable en `CATALOGOS`)
  extrapolado a los meses restantes, con los ajustes de escenario
  conservador/optimista también definidos ahí.
- Los **insights** del dashboard sólo aparecen si hay datos reales que los
  sustenten (por ejemplo, no hay comparación año contra año si sólo existe
  un año de datos todavía).

## Contraseña de acceso

El portal pide una contraseña antes de mostrar cualquier dato (pantalla en
`index.html#auth-gate`, lógica en [`js/auth.js`](js/auth.js)). No se guarda
la contraseña en texto plano en el código, sólo su huella SHA-256, en
`CONFIG.AUTH_PASSWORD_HASH` dentro de [`js/config.js`](js/config.js).

**Para cambiar la contraseña:**

1. Abre la consola del navegador (F12) en cualquier página y ejecuta:
   ```js
   crypto.subtle.digest('SHA-256', new TextEncoder().encode('tu-nueva-clave'))
     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
   ```
2. Copia el resultado y pégalo como `AUTH_PASSWORD_HASH` en `js/config.js`.
3. Vuelve a publicar los archivos.

Quien entra correctamente queda "recordado" en ese navegador (hasta que
alguien use el botón **Cerrar sesión** o borre los datos del sitio). Cada
persona del equipo escribe la contraseña una sola vez por dispositivo.

**Importante — qué tan segura es:** esto es una barrera simple para que no
cualquiera que encuentre el link entre a ver facturación real; no es
autenticación de verdad. Como todo el código corre en el navegador, alguien
con conocimientos técnicos podría inspeccionarlo y saltársela. Si más
adelante se necesita seguridad real (cuentas por persona, imposible de
evadir), la opción es agregar **Cloudflare Access** delante del sitio
(gratis hasta 50 usuarios) — pregúntame cuando lo quieras y te ayudo a
configurarlo.

## Ver el portal localmente

No requiere build ni dependencias. Basta con servirlo como archivos
estáticos (no abrir `index.html` con doble clic — necesita `http://`, no
`file://`, porque usa módulos de JavaScript):

```bash
cd tymmsa-portal
python3 -m http.server 8080
```

Y abrir `http://localhost:8080`.

## Publicarlo en facturacion.tymmsa.com (hosting en Wix)

Wix no permite subir una app de varios archivos como esta directamente (no
tiene hosting de archivos tipo FTP). La solución estándar: alojar los
archivos gratis en **Netlify**, y usar Wix únicamente para apuntar el
subdominio `facturacion.tymmsa.com` hacia allá. El dominio principal
(`tymmsa.com`) sigue funcionando en Wix exactamente igual que ahora — esto
sólo agrega un subdominio nuevo.

**1. Subir el portal a Netlify (gratis):**

1. Ve a [app.netlify.com](https://app.netlify.com) y crea una cuenta
   (puedes usar tu cuenta de Google).
2. En el dashboard, busca la zona que dice **"Drag and drop your site
   output folder here"** (o "Add new site" → "Deploy manually").
3. Arrastra la carpeta completa `tymmsa-portal` ahí.
4. En unos segundos te da una URL tipo
   `https://algo-al-azar-123.netlify.app` — ya funciona ahí mismo.
5. (Opcional) En **Site settings → Change site name**, cámbiale el nombre
   a algo como `tymmsa-facturacion` para que la URL quede más limpia.

**2. Conectar el subdominio en Netlify:**

1. En el sitio recién creado: **Domain settings → Add a domain** (o
   "Add custom domain").
2. Escribe `facturacion.tymmsa.com` y confírmalo.
3. Netlify te va a mostrar un registro DNS para agregar (normalmente un
   **CNAME** apuntando a tu sitio de Netlify, ej.
   `tymmsa-facturacion.netlify.app`). Déjalo abierto en esa pantalla.

**3. Agregar el registro DNS en Wix:**

1. En el panel de Wix, ve a **Domains** (o "Manage Domains") → selecciona
   `tymmsa.com` → busca la sección de **DNS records / Advanced DNS**.
2. Agrega un registro nuevo:
   - Tipo: **CNAME**
   - Host/Nombre: `facturacion`
   - Apunta a / Valor: lo que te dio Netlify en el paso anterior
3. Guarda. La propagación puede tardar desde minutos hasta un par de horas.

**4. Confirmar:**

Vuelve a Netlify — en cuanto detecte el DNS correcto, activa HTTPS
automático (gratis, vía Let's Encrypt) para `facturacion.tymmsa.com`. Una
vez listo, esa es la URL que le compartes al equipo.

Si prefieres que te acompañe paso a paso mientras lo haces (por ejemplo
confirmando capturas de pantalla de Netlify o de Wix), dímelo.
