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
var ALMACEN_CAMPOS = ['materialEspecial', 'numInst', 'esbrainUuid', 'cliente', 'direccion', 'fechaCierreIso', 'fechaIso', 'equipo', 'hardware', 'despFallido', 'version',
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
    almacenCompletarDesdeCalendario_(c);   // modelo del cargador y material especial del calendario si el cierre no los trae
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
      var r = almacenLlamar_({ cierres: lote, origen: 'historico' });   // E-026: misma instalación = mismo cierre
      total.enviados += lote.length; total.errores += r.errores || 0;
      (r.resultados || []).filter(function (x) { return x.error; }).forEach(function (x) { almacenLog_('ERROR', x.numInst, x.error, null); });
    } catch (e) { total.errores += lote.length; almacenLog_('ERROR', 'lote ' + (i / 100 + 1), e.message || e, null); }
  }
  almacenLog_('HISTORICO', '', JSON.stringify(total), null);
  Logger.log(total);
}

/* ===== Chat (02/10) · Modelo del cargador desde el calendario (hoja "🔗 ESBRAIN") =====
   El cierre y la hoja "Registro" no siempre traen el modelo del cargador (V2C 5 m, V2C 10 m, Policharger…).
   El calendario sí: columnas "Nº PRESUPUESTO", "HARDWARE" y "MATERIAL ESPECIAL". */
var ALMACEN_CAL_CACHE_ = null;
function almacenCalendario_() {
  if (ALMACEN_CAL_CACHE_) return ALMACEN_CAL_CACHE_;
  var mapa = {};
  try {
    var hoja = (typeof _hojaEsbrain_ === 'function') ? _hojaEsbrain_() : almacenLibro_().getSheetByName(typeof ESBRAIN_SHEET_NAME !== 'undefined' ? ESBRAIN_SHEET_NAME : '🔗 ESBRAIN');
    var v = hoja.getDataRange().getValues(), fc = -1, cPre = -1, cHw = -1, cMat = -1;
    for (var r = 0; r < Math.min(6, v.length) && fc < 0; r++) {
      var cab = v[r].map(function (h) { return String(h).trim().toUpperCase(); });
      if (cab.indexOf('HARDWARE') >= 0 && cab.indexOf('Nº PRESUPUESTO') >= 0) { fc = r; cPre = cab.indexOf('Nº PRESUPUESTO'); cHw = cab.indexOf('HARDWARE'); cMat = cab.indexOf('MATERIAL ESPECIAL'); }
    }
    if (fc >= 0) for (var i = fc + 1; i < v.length; i++) {
      var k = String(v[i][cPre] || '').trim().toUpperCase(); if (!k) continue;
      mapa[k] = { hardware: String(v[i][cHw] || '').trim(), materialEspecial: cMat >= 0 ? String(v[i][cMat] || '').trim() : '' };
    }
  } catch (e) { Logger.log('Calendario no disponible: ' + e); }
  ALMACEN_CAL_CACHE_ = mapa;
  return mapa;
}
function almacenCompletarDesdeCalendario_(c) {
  if (!c || !c.numInst) return c;
  var x = almacenCalendario_()[String(c.numInst).trim().toUpperCase()];
  if (x) { if (!c.hardware && x.hardware) c.hardware = x.hardware; if (!c.materialEspecial && x.materialEspecial) c.materialEspecial = x.materialEspecial; }
  return c;
}

/** Prueba: muestra el modelo de cargador que el calendario da para los cierres desde el 30/09 (no envía nada) */
function probarCalendarioAlmacen() {
  var c = histLeer_(), sin = 0;
  c.forEach(function (x) { almacenCompletarDesdeCalendario_(x); if (!x.hardware) sin++; Logger.log(x.numInst + ' · ' + x.equipo + ' · HARDWARE: ' + (x.hardware || '(no está en el calendario)') + (x.materialEspecial ? ' · MATERIAL ESPECIAL: ' + x.materialEspecial : '')); });
  Logger.log('Cierres: ' + c.length + ' · sin modelo de cargador: ' + sin);
}

/**
 * Chat (02/10) · Carga ÚNICA del histórico de cierres desde la hoja "Registro" (cabeceras en la fila 2).
 * Pega esto al FINAL de Almacen.gs, guarda y ejecuta UNA vez: cargarHistoricoRegistro
 *  - Solo envía cierres desde la apertura (30/09/2026). El almacén ignora los anteriores igualmente.
 *  - "Registro" no guarda el modelo del cargador: el histórico descuenta material, no cargadores.
 *  - Se ejecuta UNA sola vez (deja la marca ALMACEN_HISTORICO_HECHO). Repetirlo duplicaría consumos,
 *    porque aquí la fecha va sin hora y los cierres en directo llegan con hora.
 */
var HIST_DESDE = new Date(2026, 8, 30);                       // 30/09/2026 (los meses empiezan en 0)
var HIST_MAPA = {                                             // cabecera de "Registro" → campo del wizard
  'FECHA': 'fechaCierreIso', 'EQUIPO': 'equipo', 'Nº INST.': 'numInst', 'CLIENTE': 'cliente', 'DIRECCIÓN': 'direccion',
  'M. LÍNEA': 'metrosLinea', 'TIPO LÍNEA': 'tipoLinea', 'SECCIÓN': 'seccion', 'FASE': 'fase',
  'M. UTP': 'metrosUtp', 'RJ45': 'rj45', 'CABLE DATOS': 'cableDatos',
  'BORNAS MONO': 'bornasMono', 'BORNAS TRIF': 'bornasTrif',
  'MAG 10-25A': 'mag1025', 'MAG 32A': 'mag32', 'MAG 40A': 'mag40', 'PICA TIERRA': 'pica',
  'ACERO 32MM': 'acero32', 'CANALETA': 'canaleta', 'CORRUGADO M': 'corr32', 'TUBO PVC M': 'pvc32',
  'DESP. FALL.': 'despFallido'
};
var HIST_NUM = ['metrosLinea', 'metrosUtp', 'rj45', 'bornasMono', 'bornasTrif', 'mag1025', 'mag32', 'mag40', 'pica', 'acero32', 'canaleta', 'corr32', 'pvc32'];

function histSinTildes_(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function histNum_(v) { if (typeof v === 'number') return v; var t = String(v || '').trim(); if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.'); var n = parseFloat(t); return isNaN(n) ? 0 : n; }
function histValor_(campo, v) {
  if (HIST_NUM.indexOf(campo) >= 0) return histNum_(v);
  var t = histSinTildes_(v);
  if (campo === 'fase') return /tri/.test(t) ? 'trif' : (/mono/.test(t) ? 'mono' : t);
  if (campo === 'tipoLinea') return /mang/.test(t) ? 'manguera' : (/tub/.test(t) ? 'tubo' : t);
  if (campo === 'seccion') { var m = String(v).match(/\d+(?:[.,]\d+)?/); return m ? m[0].replace(',', '.') : t; }
  if (campo === 'despFallido') return v === true || /^(si|s|x|1|true|fallido)$/.test(t);
  return typeof v === 'string' ? v.trim() : v;
}

/** Primero: muestra lo que enviaría (5 ejemplos y el total) SIN enviar nada */
function probarHistoricoRegistro() { var c = histLeer_(); Logger.log('Cierres a enviar desde el 30/09: ' + c.length); c.slice(0, 5).forEach(function (x) { Logger.log(JSON.stringify(x)); }); }

function histLeer_() {
  var hoja = almacenLibro_().getSheetByName(typeof REGISTRO_SHEET_NAME !== 'undefined' && REGISTRO_SHEET_NAME ? REGISTRO_SHEET_NAME : 'Registro');
  var v = hoja.getDataRange().getValues();
  var fCab = 1;                                               // fila 2 (índice 1)
  var cab = v[fCab].map(function (h) { return String(h).trim().toUpperCase(); });
  var col = {};
  Object.keys(HIST_MAPA).forEach(function (h) { var i = cab.indexOf(h.toUpperCase()); if (i >= 0) col[HIST_MAPA[h]] = i; });
  ['fechaCierreIso', 'numInst', 'equipo'].forEach(function (k) { if (col[k] === undefined) throw new Error('Falta la columna de ' + k + ' en la fila 2 de Registro'); });
  var out = [];
  for (var r = fCab + 1; r < v.length; r++) {
    var fila = v[r], f = fila[col.fechaCierreIso];
    var fecha = f instanceof Date ? f : (f ? new Date(f) : null);
    if (!fecha || isNaN(fecha) || fecha < HIST_DESDE) continue;
    var o = {};
    Object.keys(col).forEach(function (k) { o[k] = k === 'fechaCierreIso' ? fecha.toISOString() : histValor_(k, fila[col[k]]); });
    if (!o.numInst) continue;
    o.numInst = String(o.numInst).trim();
    out.push(o);
  }
  return out;
}

/** Envío ÚNICO al almacén */
function cargarHistoricoRegistro() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ALMACEN_HISTORICO_HECHO')) throw new Error('El histórico ya se cargó el ' + props.getProperty('ALMACEN_HISTORICO_HECHO') + '. No se repite para no duplicar consumos.');
  var cierres = histLeer_().map(almacenCompletarDesdeCalendario_), total = { enviados: 0, errores: 0, ignorados: 0 };
  for (var i = 0; i < cierres.length; i += 100) {
    var lote = cierres.slice(i, i + 100);
    try {
      var r = almacenLlamar_({ cierres: lote, origen: 'historico' });   // E-026: misma instalación = mismo cierre
      total.enviados += lote.length; total.errores += r.errores || 0;
      (r.resultados || []).forEach(function (x) { if (x.error) almacenLog_('ERROR', x.numInst, x.error, null); if (x.estado === 'ignorado') total.ignorados++; });
    } catch (e) { total.errores += lote.length; almacenLog_('ERROR', 'lote ' + (i / 100 + 1), e.message || e, null); }
  }
  if (total.enviados && total.errores < total.enviados) props.setProperty('ALMACEN_HISTORICO_HECHO', new Date().toISOString());
  almacenLog_('HISTORICO', '', JSON.stringify(total), null);
  Logger.log(total);
}
