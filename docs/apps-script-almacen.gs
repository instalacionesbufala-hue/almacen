/**
 * E-012 · Envío de los cierres del wizard al almacén (Supabase → función "registrar-cierre").
 * Pegar en el proyecto de Google Apps Script del wizard (el de WEB_APP_URL), en un archivo nuevo "Almacen.gs".
 *
 * 1) Proyecto de Apps Script → Configuración del proyecto → Propiedades del script → añade:
 *      ALMACEN_URL    https://<tu-referencia>.supabase.co/functions/v1/registrar-cierre
 *      ALMACEN_TOKEN  (el token que da la app en Configuración → Integraciones; se enseña una sola vez)
 *    El token NUNCA va en el HTML del wizard ni en el código: solo en estas propiedades.
 * 2) En este proyecto la llamada va en procesarEnvio_(datos), justo después de escribirEnRegistro_ (doPost solo encola):   enviarAlAlmacen(datos);
 *    (datos = el objeto del cierre que ya recibes del wizard). Si el envío falla, el cierre se guarda igual
 *    en "Registro" y el error queda en la hoja "Almacén-log" para reintentarlo con reintentarAlmacen().
 * 3) Histórico: ejecuta una vez cargarHistoricoAlAlmacen() desde el editor (menú Ejecutar). Lee "Registro" y envía los
 *    cierres en lotes; los anteriores a la apertura del inventario (Configuración → Integraciones) se ignoran solos.
 *    Reenviar es seguro: la app no descuenta dos veces el mismo cierre.
 */

// Solo lo que el almacén necesita (sin fotos, vídeos ni actas)
var ALMACEN_CAMPOS = ['numInst', 'esbrainUuid', 'cliente', 'direccion', 'fechaCierreIso', 'fechaIso', 'equipo', 'hardware', 'materialEspecial', 'despFallido', 'version',
  'tipoLinea', 'fase', 'seccion', 'cableDatos', 'metrosLinea', 'metrosUtp', 'rj45', 'bornasMono', 'bornasTrif',
  'pvc32', 'corr32', 'acero32', 'acero40', 'canaleta', 'sot50', 'sot90',
  'cajaReg', 'caja6', 'caja12', 'caja18', 'cerradura', 'perfTab', 'perfForj', 'pica', 'preinst', 'mag1025', 'mag32', 'mag40'];

/** Chat (02/10): este proyecto NO está unido a la hoja (usa SpreadsheetApp.openById(SHEETS_ID)), así que no vale
    getActiveSpreadsheet(). Se usa la misma hoja que el resto del backend. */
function almacenLibro_() {
  return (typeof SHEETS_ID !== 'undefined' && SHEETS_ID) ? SpreadsheetApp.openById(SHEETS_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function almacenRecortar_(datos) {
  var out = {};
  ALMACEN_CAMPOS.forEach(function (k) { if (datos[k] !== undefined && datos[k] !== null && datos[k] !== '') out[k] = datos[k]; });
  return out;
}

function almacenLlamar_(cuerpo) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('ALMACEN_URL'), token = props.getProperty('ALMACEN_TOKEN');
  if (!url || !token) throw new Error('Faltan ALMACEN_URL o ALMACEN_TOKEN en las Propiedades del script');
  var ultimo = '';
  for (var intento = 1; intento <= 3; intento++) {
    try {
      var r = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo),
        headers: { 'X-Integracion': token }, muteHttpExceptions: true,
      });
      var code = r.getResponseCode(), texto = r.getContentText();
      if (code >= 200 && code < 300) return JSON.parse(texto);
      ultimo = code + ' ' + texto;
      if (code === 401 || code === 400) break;              // token revocado o datos mal formados: no sirve reintentar
    } catch (e) { ultimo = String(e); }
    Utilities.sleep(1500 * intento);
  }
  throw new Error(ultimo);
}

function almacenLog_(estado, numInst, detalle, datos) {
  try {
    var ss = almacenLibro_();
    var hoja = ss.getSheetByName('Almacén-log') || ss.insertSheet('Almacén-log');
    if (hoja.getLastRow() === 0) hoja.appendRow(['Fecha', 'Estado', 'numInst', 'Detalle', 'Datos (para reintentar)']);
    hoja.appendRow([new Date(), estado, numInst || '', String(detalle).slice(0, 500), datos ? JSON.stringify(datos) : '']);
  } catch (eLog) { Logger.log('Almacén-log no disponible: ' + eLog); }
}

/** Llamar desde doPost después de guardar la fila en "Registro". Nunca rompe el guardado del cierre. */
function enviarAlAlmacen(datos) {
  var c = almacenRecortar_(datos || {});
  try {
    var r = almacenLlamar_(c);
    if (r && r.estado && r.estado !== 'aplicado' && r.estado !== 'duplicado') almacenLog_(r.estado, c.numInst, JSON.stringify(r), null);
    return r;
  } catch (e) {
    almacenLog_('ERROR', c.numInst, e.message || e, c);
    return null;
  }
}

/** Reintenta los envíos que fallaron (filas "ERROR" del log con sus datos) */
function reintentarAlmacen() {
  var hoja = almacenLibro_().getSheetByName('Almacén-log');
  if (!hoja || hoja.getLastRow() < 2) return;
  var filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, 5).getValues();
  filas.forEach(function (f, i) {
    if (f[1] !== 'ERROR' || !f[4]) return;
    try { almacenLlamar_(JSON.parse(f[4])); hoja.getRange(i + 2, 2).setValue('REENVIADO'); }
    catch (e) { hoja.getRange(i + 2, 4).setValue(String(e.message || e).slice(0, 500)); }
  });
}

/** Carga inicial: envía los cierres de la hoja "Registro" en lotes de 100. Las cabeceras deben llamarse como los campos del wizard
    (numInst, esbrainUuid, fechaCierreIso, equipo, hardware, metrosLinea, pvc32…). Las columnas que no reconoce se ignoran. */
function cargarHistoricoAlAlmacen() {
  var hoja = almacenLibro_().getSheetByName(typeof REGISTRO_SHEET_NAME !== 'undefined' && REGISTRO_SHEET_NAME ? REGISTRO_SHEET_NAME : 'Registro');
  var valores = hoja.getDataRange().getValues();
  var cab = valores.shift().map(function (h) { return String(h).trim(); });
  var mapa = {};
  cab.forEach(function (h, i) { var k = ALMACEN_CAMPOS.filter(function (c) { return c.toLowerCase() === h.toLowerCase(); })[0]; if (k) mapa[i] = k; });
  if (!Object.keys(mapa).length) throw new Error('Ninguna cabecera de "Registro" coincide con los campos del wizard');
  var cierres = valores.map(function (fila) {
    var o = {};
    Object.keys(mapa).forEach(function (i) { var v = fila[i]; o[mapa[i]] = v instanceof Date ? v.toISOString() : v; });
    return almacenRecortar_(o);
  }).filter(function (o) { return o.numInst || o.esbrainUuid; });
  var total = { enviados: 0, errores: 0 };
  for (var i = 0; i < cierres.length; i += 100) {
    var lote = cierres.slice(i, i + 100);
    try {
      var r = almacenLlamar_({ cierres: lote, origen: 'historico' });   // E-026: misma instalación = mismo cierre (no duplica lo llegado en directo)
      total.enviados += lote.length; total.errores += r.errores || 0;
      (r.resultados || []).filter(function (x) { return x.error; }).forEach(function (x) { almacenLog_('ERROR', x.numInst, x.error, null); });
    } catch (e) { total.errores += lote.length; almacenLog_('ERROR', 'lote ' + (i / 100 + 1), e.message || e, null); }
  }
  almacenLog_('HISTORICO', '', JSON.stringify(total), null);
  Logger.log(total);
}
