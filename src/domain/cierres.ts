/* E-012 · Cierres en la app: la misma lógica que el servidor (_registrar_cierre y _sincronizar_cierre) para la demostración
   y para la carga del histórico en local; y los resúmenes para las pantallas (consumo por obra, por equipo y periodo, discrepancias). */
import type { CierreApp, Equivalencia, Estado, LineaCierre } from '../data/tipos';
import { claveCierre, prepararVersion, traducirCierre, type Cierre, type LineaTraducida, type OrigenVersion, type PrefacturaHolded, type PrevioCierre, type Regla, type Version } from '../../supabase/functions/_compartido/cierres';
import { applyMovement, consumoPorPieza, contenidoDe, find, unidadesABordo, vehiculoDeEquipo } from './reglas';
import { redondea, uid } from './formato';

export { CAMPOS_FACTURABLES, CAMPOS_MATERIAL, EQUIVALENCIAS_PROPUESTA, KITS_PROPUESTA, normalizarCierre, traducirCierre, type Cierre, type LineaTraducida, type OrigenVersion, type PrevioCierre } from '../../supabase/functions/_compartido/cierres';

/** Reglas que se aplican: activas y confirmadas por el administrador */
export const reglasVigentes = (S: Pick<Estado, 'equivalencias'>): Regla[] => S.equivalencias.filter(r => r.confirmada && r.activa);
export const traducirEnApp = (S: Estado, c: Cierre): LineaTraducida[] =>
  traducirCierre(c, reglasVigentes(S), S.kits, S.configApp.kitFijacion || 'A', new Set(S.products.filter(p => !p.borrador).map(p => p.sku)));

/** E-026: hasta esta fecha, un cargador (categoría cargadores o material en custodia) solo se descuenta si consta a bordo al procesar */
const esCargador = (S: Estado, sku?: string) => { const p = sku ? find(S, sku) : undefined; return !!p && (p.cat === 'cargadores' || p.propiedad === 'custodia'); };
const consumoDe = (S: Estado, id: string) => { const m = new Map<string, number>(); for (const x of S.movements) if (x.cierre === id) m.set(x.sku, redondea((m.get(x.sku) || 0) - (x.unidades || 0))); return m; };

/** Consume del vehículo hasta el objetivo de cada artículo (solo la diferencia) y recalcula discrepancias y estado (= _sincronizar_cierre) */
export function sincronizarCierreLocal(S: Estado, id: string) {
  const ci = S.cierres.find(c => c.id === id)!;
  if (ci.estado === 'ignorado') return;
  const lineas = S.lineasCierre.filter(l => l.cierre === id);
  if (ci.vehiculo) {
    const hasta = S.configApp.cargadoresABordoHasta;
    if (hasta && ci.fecha < hasta && !ci.despFallido) {
      const hechoAntes = consumoDe(S, id);
      for (const l of lineas) if (['aplicada', 'discrepancia', 'no_entregado'].includes(l.estado) && esCargador(S, l.sku)) {
        const disp = unidadesABordo(S, ci.vehiculo, l.sku!) + (hechoAntes.get(l.sku!) || 0);
        l.estado = disp >= l.cantidad ? (l.estado === 'no_entregado' ? 'aplicada' : l.estado) : 'no_entregado';
      }
    }
    const objetivo = new Map<string, number>(), hecho = consumoDe(S, id);
    if (!ci.despFallido) for (const l of lineas) if (l.sku && ['aplicada', 'discrepancia', 'resuelta'].includes(l.estado)) objetivo.set(l.sku, (objetivo.get(l.sku) || 0) + l.cantidad);
    for (const [sku, q] of objetivo) objetivo.set(sku, consumoPorPieza(find(S, sku), q));      // E-036: por pieza entera
    const ref = [ci.numInst, ci.cliente, ci.direccion].filter(Boolean).join(' · ');
    for (const sku of new Set([...objetivo.keys(), ...hecho.keys()])) {
      const d = redondea((objetivo.get(sku) || 0) - (hecho.get(sku) || 0)); if (!d) continue;
      const p = find(S, sku)!, operario = S.operator;
      S.operator = `Cierre ${ci.equipoWizard || 'del wizard'}`;
      try { applyMovement(S, { sku, type: d > 0 ? 'consumo' : 'ajuste', qty: Math.abs(d) / contenidoDe(p), reason: d > 0 ? 'Consumo en obra' : 'Corrección de cierre', ref, equipo: ci.equipo, vehiculo: ci.vehiculo, cierre: id }); }
      finally { S.operator = operario; }
    }
    for (const l of lineas) if (l.estado === 'aplicada' || l.estado === 'discrepancia')
      l.estado = (S.aBordo.find(b => b.vehiculo === ci.vehiculo && b.sku === l.sku)?.unidades ?? 0) < 0 ? 'discrepancia' : 'aplicada';
  }
  ci.estado = ci.despFallido ? 'fallido' : !ci.vehiculo ? 'sin_vehiculo' : lineas.some(l => l.estado === 'discrepancia') ? 'discrepancia'
    : lineas.some(l => l.estado === 'sin_equivalencia' || l.estado === 'pendiente') ? 'parcial' : 'aplicado';
}

/** E-036 · Tras activar o quitar "pieza entera": vuelve a sincronizar los cierres ya aplicados de ese artículo desde una fecha,
    con una versión por cierre que cambie (= recalcular_consumo_piezas del servidor) */
export function recalcularConsumoPiezasLocal(S: Estado, sku: string, desde: number, operario: string) {
  const p = find(S, sku); if (!p) throw new Error(`Producto no encontrado: ${sku}`);
  let cierres = 0, unidades = 0;
  const lista = S.cierres.filter(c => c.fecha >= desde && c.vehiculo && !['ignorado', 'fallido', 'sin_vehiculo'].includes(c.estado) && S.lineasCierre.some(l => l.cierre === c.id && l.sku === p.sku));
  for (const ci of lista.sort((a, b) => a.fecha - b.fecha)) {
    const antes = consumoDe(S, ci.id);
    sincronizarCierreLocal(S, ci.id);
    const despues = consumoDe(S, ci.id);
    const diferencia = [...new Set([...antes.keys(), ...despues.keys()])].sort().map(k => ({ sku: k, unidades: redondea((despues.get(k) || 0) - (antes.get(k) || 0)) })).filter(d => d.unidades);
    if (!diferencia.length) continue;
    ci.version++;
    (ci.versiones ||= []).push({ n: ci.version, origen: 'admin', documento: `Consumo de ${p.name} recalculado por ${operario} (${p.piezaEntera ? 'por pieza entera' : 'sin redondear'})`, recibido: Date.now(), diferencia });
    cierres++; unidades = redondea(unidades + (diferencia.find(d => d.sku === p.sku)?.unidades || 0));
  }
  return { cierres, unidades };
}

/* ---------- E-026 · Versiones: una instalación = un cierre ---------- */
export interface EnvioCierre { efectivo: Cierre; lineas: LineaTraducida[]; meta: { clave: string; accion: Version['accion']; origen: OrigenVersion; documento: string; base: number; wizard: Cierre | null; holded: PrefacturaHolded | null; entrada: Record<string, unknown> } }
/** Lo que ya se sabe de esa instalación en este dispositivo */
export function previoLocal(S: Estado, clave: string): PrevioCierre | null {
  const ci = S.cierres.find(c => c.clave === clave);
  return ci ? { version: ci.version, wizard: ci.datosWizard || ci.datos || null, holded: ci.holded || null, origenes: [...new Set((ci.versiones || []).map(v => v.origen))], correccion: ci.correccion || null } : null;
}
/** Prepara lo que se envía (o se aplica en local): la decisión de versión, los datos efectivos y su traducción */
export function prepararEnvio(S: Estado, raw: Record<string, unknown>, origen: OrigenVersion, previo?: PrevioCierre | null): EnvioCierre {
  const clave = claveCierre({ numInst: String(raw.numInst ?? ''), esbrainUuid: String(raw.esbrainUuid ?? '') });
  const p = previo === undefined ? previoLocal(S, clave) : previo;
  const v = prepararVersion(p, origen, raw);
  return { efectivo: v.efectivo, lineas: v.accion === 'nueva' ? traducirEnApp(S, v.efectivo) : [],
    meta: { clave, accion: v.accion, origen, documento: v.documento, base: p?.version || 0, wizard: v.wizard, holded: v.holded, entrada: raw } };
}

/** Estado de una línea traducida al guardarla (E-032: no_gestionado se conserva) */
export const estadoLinea = (l: LineaTraducida, sku?: string): LineaCierre['estado'] =>
  l.estado === 'aplicable' && sku ? 'aplicada' : l.estado === 'pendiente' ? 'pendiente' : l.estado === 'no_gestionado' ? 'no_gestionado' : 'sin_equivalencia';
/** E-032: una partida que una regla ya cubre sustituye su resolución manual (si no, se sumarían las dos) */
export function quitarResueltasCubiertas(S: Estado, cierre: string, lineas: LineaTraducida[]) {
  const cubiertos = new Set(lineas.filter(l => l.estado === 'aplicable' && l.sku && find(S, l.sku) && !find(S, l.sku)!.borrador).map(l => l.campo));
  if (cubiertos.size) S.lineasCierre = S.lineasCierre.filter(l => l.cierre !== cierre || l.estado !== 'resuelta' || l.manual || !cubiertos.has(l.campo));
}

/** Guarda una versión de un cierre en el estado local (= _registrar_version_cierre) */
export function registrarVersionLocal(S: Estado, a: EnvioCierre): { estado: string; id: string; version?: number; diferencia?: { sku: string; unidades: number }[] } {
  const { efectivo: c, lineas, meta } = a;
  let ci = S.cierres.find(x => x.clave === meta.clave);
  if (meta.accion !== 'nueva') return { estado: meta.accion, id: ci?.id || '', version: ci?.version };
  if ((ci?.version || 0) !== meta.base) throw new Error(`El cierre ${c.numInst} ha cambiado mientras se procesaba: vuelve a enviarlo`);
  const fecha = ci?.fecha ?? (Date.parse(c.fechaCierreIso) || Date.now());
  const eq = S.equipos.find(e => e.nombre.trim().toLowerCase() === c.equipo.trim().toLowerCase());
  const veh = eq ? vehiculoDeEquipo(S, eq.id, fecha) : undefined;
  const apertura = S.configApp.aperturaCierres ?? S.configApp.demoBorrada;
  const me = String(c.materialEspecial || '');
  if (ci) {
    if (ci.estado === 'ignorado') return { estado: 'ignorado', id: ci.id };
    Object.assign(ci, { version: ci.version + 1, numInst: c.numInst, cliente: c.cliente || ci.cliente, direccion: c.direccion || ci.direccion, equipoWizard: c.equipo, equipo: eq?.id,
      vehiculo: ci.vehiculo ?? veh, hardware: c.hardware, despFallido: c.despFallido, datos: { ...c }, datosWizard: meta.wizard ? { ...meta.wizard } : ci.datosWizard, holded: meta.holded || ci.holded,
      materialRevisado: me === (ci.materialEspecial || '') ? ci.materialRevisado : !me, materialEspecial: me });
  } else {
    ci = { id: uid('C'), clave: meta.clave, version: 1, numInst: c.numInst, cliente: c.cliente, direccion: c.direccion, fecha, equipoWizard: c.equipo, equipo: eq?.id, vehiculo: veh,
      hardware: c.hardware, despFallido: c.despFallido, estado: apertura && fecha < apertura ? 'ignorado' : 'aplicado', origen: meta.origen === 'historico' ? 'historico' : meta.origen === 'holded' ? 'holded' : 'integracion',
      recibido: Date.now(), datos: { ...c }, datosWizard: meta.wizard ? { ...meta.wizard } : undefined, holded: meta.holded || undefined, materialEspecial: me, materialRevisado: !me, versiones: [] };
    S.cierres.unshift(ci);
  }
  const version = { n: ci.version, origen: meta.origen, documento: meta.documento, recibido: Date.now(), diferencia: [] as { sku: string; unidades: number }[] };
  (ci.versiones ||= []).push(version);
  if (ci.estado === 'ignorado') return { estado: 'ignorado', id: ci.id };
  const id = ci.id, antes = consumoDe(S, id);
  quitarResueltasCubiertas(S, id, lineas);
  const resueltos = new Set(S.lineasCierre.filter(l => l.cierre === id && l.estado === 'resuelta').map(l => l.campo));
  S.lineasCierre = S.lineasCierre.filter(l => l.cierre !== id || l.estado === 'resuelta' || l.manual);
  const fijadas = new Set(S.lineasCierre.filter(l => l.cierre === id && l.manual).map(l => l.campo));      // E-035: lo corregido a mano no se toca
  for (const l of lineas) {
    if (fijadas.has(l.campo)) continue;
    if (l.estado !== 'aplicable' && resueltos.has(l.campo)) continue;
    const sku = l.sku && find(S, l.sku) && !find(S, l.sku)!.borrador ? l.sku : undefined;
    S.lineasCierre.push({ id: uid('L'), cierre: id, campo: l.campo, formula: l.formula, valor: l.valor, sku, cantidad: l.cantidad, estimada: l.estimada,
      estado: estadoLinea(l, sku), nota: l.nota });
  }
  sincronizarCierreLocal(S, id);
  const despues = consumoDe(S, id);
  version.diferencia = [...new Set([...antes.keys(), ...despues.keys()])].sort().map(sku => ({ sku, unidades: redondea((despues.get(sku) || 0) - (antes.get(sku) || 0)) })).filter(d => d.unidades);
  return { estado: ci.estado, id, version: ci.version, diferencia: version.diferencia };
}
/** Atajo para la demostración y las pruebas: prepara y aplica en local */
export const registrarCierreLocal = (S: Estado, raw: Record<string, unknown>, origen: OrigenVersion = 'historico') => registrarVersionLocal(S, prepararEnvio(S, raw, origen));

/** "+2 Caja registro 100x100 · −8 m Manguera…" (en formatos) */
export function textoDiferencia(S: Estado, d: { sku: string; unidades: number }[]): string {
  if (!d.length) return 'sin cambios en el consumo';
  return d.map(x => { const p = find(S, x.sku), q = p ? redondea(x.unidades / contenidoDe(p)) : x.unidades;
    return `${q > 0 ? '+' : '−'}${String(Math.abs(q)).replace('.', ',')} ${p?.name || x.sku}`; }).join(' · ');
}
export const ORIGEN_VERSION: Record<string, string> = { wizard: 'wizard (directo)', historico: 'histórico de Registro', holded: 'prefactura Holded', admin: 'recalculado' };

/* ---------- Resúmenes para las pantallas ---------- */
export const lineasDe = (S: Pick<Estado, 'lineasCierre'>, cierre: string) => S.lineasCierre.filter(l => l.cierre === cierre);

/** Consumo por artículo de un conjunto de cierres (equipo y periodo), en unidades de contenido y en formatos */
/** Lo que los cierres han descontado de verdad, por artículo. E-029: sin los cierres "sin vehículo" (aún no descuentan nada)
    ni las líneas no_entregado (cargadores que no salieron del almacén: van en noEntregadosPorArticulo) */
export const consumoPorArticulo = (S: Estado, cierres: CierreApp[]) => resumenLineas(S, cierres, ['aplicada', 'discrepancia', 'resuelta']);
/** E-029 · Instalados que no entregó el almacén (antes de la fecha de los cargadores): se ven aparte, no se descuentan */
export const noEntregadosPorArticulo = (S: Estado, cierres: CierreApp[]) => resumenLineas(S, cierres, ['no_entregado']);
function resumenLineas(S: Estado, cierres: CierreApp[], estados: string[]) {
  const ids = new Set(cierres.filter(c => c.estado !== 'fallido' && c.estado !== 'ignorado' && c.estado !== 'sin_vehiculo').map(c => c.id));
  const m = new Map<string, { sku: string; unidades: number; estimada: boolean }>(), porCierre = new Map<string, number>();
  for (const l of S.lineasCierre) {
    if (!ids.has(l.cierre) || !l.sku || !estados.includes(l.estado)) continue;
    const x = m.get(l.sku) || { sku: l.sku, unidades: 0, estimada: false };
    x.estimada ||= l.estimada; m.set(l.sku, x);
    porCierre.set(`${l.cierre}|${l.sku}`, redondea((porCierre.get(`${l.cierre}|${l.sku}`) || 0) + l.cantidad));
  }
  // E-036: lo que de verdad se descuenta (por pieza entera, cada cierre redondea hacia arriba)
  for (const [k, q] of porCierre) { const x = m.get(k.split('|')[1])!; x.unidades = redondea(x.unidades + consumoPorPieza(find(S, x.sku), q)); }
  return [...m.values()].map(x => { const p = find(S, x.sku); return { ...x, nombre: p?.name || x.sku, formatos: p ? redondea(x.unidades / contenidoDe(p)) : x.unidades, unidad: p?.unit || 'ud' }; })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** E-032 · Partidas con material no gestionado en el almacén: cuánto y en cuántos cierres (no descuentan) */
export function noGestionadoPorPartida(S: Estado, cierres: CierreApp[]) {
  const ids = new Set(cierres.filter(c => c.estado !== 'fallido' && c.estado !== 'ignorado').map(c => c.id));
  const m = new Map<string, { campo: string; cantidad: number; cierres: Set<string> }>();
  for (const l of S.lineasCierre) if (ids.has(l.cierre) && l.estado === 'no_gestionado') {
    const x = m.get(l.campo) || { campo: l.campo, cantidad: 0, cierres: new Set<string>() };
    x.cantidad = redondea(x.cantidad + l.cantidad); x.cierres.add(l.cierre); m.set(l.campo, x);
  }
  return [...m.values()].map(x => ({ campo: x.campo, cantidad: x.cantidad, cierres: x.cierres.size })).sort((a, b) => a.campo.localeCompare(b.campo));
}

/** E-029 · Desde qué día enseña la lista de cierres por defecto: la apertura del inventario, o hace 30 días si es anterior o no hay */
export function desdeCierresPorDefecto(S: Pick<Estado, 'configApp'>, ahora = Date.now()): string {
  const hace30 = ahora - 30 * 864e5, ap = S.configApp.aperturaCierres ?? S.configApp.demoBorrada;
  const d = new Date(ap && ap > hace30 ? ap : hace30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Artículos con stock negativo en algún vehículo (discrepancias a revisar con un recuento) */
export const discrepancias = (S: Estado) => S.aBordo.filter(b => b.unidades < 0).map(b => ({ ...b, producto: find(S, b.sku), vehiculoObj: S.vehiculos.find(v => v.id === b.vehiculo) }));

/** Reglas propuestas → formato de la app (llegan como borrador: sin confirmar) */
export const aEquivalencias = (reglas: Regla[]): Equivalencia[] => reglas.map(r => ({ ...r, confirmada: false }));
export type { LineaCierre };

/* ---------- Edición de reglas en texto (pantalla de equivalencias) ---------- */
/** { tipoLinea: 'tubo', 'hardware~': ['v2c', 'trydan'] } ⇄ "tipoLinea=tubo; hardware~v2c|trydan" */
export function condicionesTexto(c: Record<string, string | string[]>): string {
  return Object.entries(c || {}).map(([k, v]) => `${k.endsWith('~') ? k : k + '='}${(Array.isArray(v) ? v : [v]).join('|')}`).join('; ');
}
export function parseCondiciones(t: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const parte of t.split(';').map(x => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9_]+)\s*(~|=)\s*(.+)$/.exec(parte);
    if (!m) throw new Error(`Condición no válida: "${parte}" (usa campo=valor o campo~texto)`);
    const vals = m[3].split('|').map(x => x.trim()).filter(Boolean);
    out[m[2] === '~' ? m[1] + '~' : m[1]] = vals.length === 1 ? vals[0] : vals;
  }
  return out;
}
/** [{ sku: '6000650603', factor: 1 }, { sku: null, nombre: 'clavo' }] ⇄ "6000650603×1, ?clavo×1" */
export const articulosTexto = (a: { sku: string | null; factor: number; nombre?: string }[]) => a.map(x => `${x.sku ?? '?' + (x.nombre || 'sin artículo')}×${x.factor}`).join(', ');
export function parseArticulos(t: string): { sku: string | null; factor: number; nombre?: string }[] {
  return t.split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const m = /^(\?)?(.+?)(?:\s*(?:×|\*|\sx)\s*([\d.]+))?$/i.exec(x);   // SKU×2 · SKU*2 · SKU x 2 (el SKU puede llevar una x)
    if (!m) throw new Error(`Artículo no válido: "${x}" (usa SKU×cantidad)`);
    const factor = m[3] ? Number(m[3]) : 1;
    if (!(factor > 0)) throw new Error(`Cantidad no válida en "${x}"`);
    return m[1] ? { sku: null, factor, nombre: m[2].trim() } : { sku: m[2].trim().toUpperCase(), factor };
  });
}

/** Histórico: CSV exportado de "Registro" (cabeceras con los nombres de los campos del wizard) → cierres */
export function cierresDeCsv(texto: string): Record<string, string>[] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lineas.length < 2) return [];
  const sep = lineas[0].includes(';') ? ';' : ',';
  const campos = (l: string) => { const o: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { o.push(cur); cur = ''; } else cur += c; }
    o.push(cur); return o.map(x => x.trim()); };
  const cab = campos(lineas[0]);
  return lineas.slice(1).map(l => { const v = campos(l); return Object.fromEntries(cab.map((h, i) => [h, v[i] ?? ''])); }).filter(o => o.numInst || o.esbrainUuid);
}
