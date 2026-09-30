/* E-012 · Cierres en la app: la misma lógica que el servidor (_registrar_cierre y _sincronizar_cierre) para la demostración
   y para la carga del histórico en local; y los resúmenes para las pantallas (consumo por obra, por equipo y periodo, discrepancias). */
import type { CierreApp, Equivalencia, Estado, LineaCierre } from '../data/tipos';
import { claveCierre, traducirCierre, type Cierre, type LineaTraducida, type Regla } from '../../supabase/functions/_compartido/cierres';
import { applyMovement, contenidoDe, find, vehiculoDeEquipo } from './reglas';
import { redondea, uid } from './formato';

export { CAMPOS_MATERIAL, EQUIVALENCIAS_PROPUESTA, KITS_PROPUESTA, normalizarCierre, traducirCierre, type Cierre, type LineaTraducida } from '../../supabase/functions/_compartido/cierres';

/** Reglas que se aplican: activas y confirmadas por el administrador */
export const reglasVigentes = (S: Pick<Estado, 'equivalencias'>): Regla[] => S.equivalencias.filter(r => r.confirmada && r.activa);
export const traducirEnApp = (S: Estado, c: Cierre): LineaTraducida[] =>
  traducirCierre(c, reglasVigentes(S), S.kits, S.configApp.kitFijacion || 'A', new Set(S.products.filter(p => !p.borrador).map(p => p.sku)));

/** Consume del vehículo hasta el objetivo de cada artículo (solo la diferencia) y recalcula discrepancias y estado */
export function sincronizarCierreLocal(S: Estado, id: string) {
  const ci = S.cierres.find(c => c.id === id)!;
  if (ci.estado === 'ignorado') return;
  const lineas = S.lineasCierre.filter(l => l.cierre === id);
  if (ci.vehiculo) {
    const objetivo = new Map<string, number>(), hecho = new Map<string, number>();
    if (!ci.despFallido) for (const l of lineas) if (l.sku && ['aplicada', 'discrepancia', 'resuelta'].includes(l.estado)) objetivo.set(l.sku, (objetivo.get(l.sku) || 0) + l.cantidad);
    for (const m of S.movements) if (m.cierre === id) hecho.set(m.sku, (hecho.get(m.sku) || 0) - (m.unidades || 0));
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

/** Registra (o actualiza con una versión nueva) un cierre en el estado local. Devuelve el estado resultante. */
export function registrarCierreLocal(S: Estado, c: Cierre, lineas: LineaTraducida[], origen: CierreApp['origen'] = 'historico'): { estado: string; id: string } {
  const clave = claveCierre(c), fecha = Date.parse(c.fechaCierreIso) || Date.now();
  let ci = S.cierres.find(x => x.clave === clave);
  if (ci && ci.version >= c.version) return { estado: 'duplicado', id: ci.id };
  const eq = S.equipos.find(e => e.nombre.trim().toLowerCase() === c.equipo.trim().toLowerCase());
  const veh = eq ? vehiculoDeEquipo(S, eq.id, fecha) : undefined;
  const apertura = S.configApp.aperturaCierres ?? S.configApp.demoBorrada;
  if (ci) Object.assign(ci, { version: c.version, numInst: c.numInst, cliente: c.cliente, direccion: c.direccion, fecha, equipoWizard: c.equipo, equipo: eq?.id, vehiculo: ci.vehiculo ?? veh, hardware: c.hardware, despFallido: c.despFallido });
  else {
    ci = { id: uid('C'), clave, version: c.version, numInst: c.numInst, cliente: c.cliente, direccion: c.direccion, fecha, equipoWizard: c.equipo, equipo: eq?.id, vehiculo: veh,
      hardware: c.hardware, despFallido: c.despFallido, estado: apertura && fecha < apertura ? 'ignorado' : 'aplicado', origen, recibido: Date.now() };
    S.cierres.unshift(ci);
    if (ci.estado === 'ignorado') return { estado: 'ignorado', id: ci.id };
  }
  const id = ci.id;
  const resueltos = new Set(S.lineasCierre.filter(l => l.cierre === id && l.estado === 'resuelta').map(l => l.campo));
  S.lineasCierre = S.lineasCierre.filter(l => l.cierre !== id || l.estado === 'resuelta');
  for (const l of lineas) {
    if (l.estado !== 'aplicable' && resueltos.has(l.campo)) continue;
    const sku = l.sku && find(S, l.sku) && !find(S, l.sku)!.borrador ? l.sku : undefined;
    S.lineasCierre.push({ id: uid('L'), cierre: id, campo: l.campo, formula: l.formula, valor: l.valor, sku, cantidad: l.cantidad, estimada: l.estimada,
      estado: l.estado === 'aplicable' && sku ? 'aplicada' : l.estado === 'pendiente' ? 'pendiente' : 'sin_equivalencia', nota: l.nota });
  }
  sincronizarCierreLocal(S, id);
  return { estado: ci.estado, id };
}

/* ---------- Resúmenes para las pantallas ---------- */
export const lineasDe = (S: Pick<Estado, 'lineasCierre'>, cierre: string) => S.lineasCierre.filter(l => l.cierre === cierre);

/** Consumo por artículo de un conjunto de cierres (equipo y periodo), en unidades de contenido y en formatos */
export function consumoPorArticulo(S: Estado, cierres: CierreApp[]) {
  const ids = new Set(cierres.filter(c => c.estado !== 'fallido' && c.estado !== 'ignorado').map(c => c.id));
  const m = new Map<string, { sku: string; unidades: number; estimada: boolean }>();
  for (const l of S.lineasCierre) {
    if (!ids.has(l.cierre) || !l.sku || !['aplicada', 'discrepancia', 'resuelta'].includes(l.estado)) continue;
    const x = m.get(l.sku) || { sku: l.sku, unidades: 0, estimada: false };
    x.unidades = redondea(x.unidades + l.cantidad); x.estimada ||= l.estimada; m.set(l.sku, x);
  }
  return [...m.values()].map(x => { const p = find(S, x.sku); return { ...x, nombre: p?.name || x.sku, formatos: p ? redondea(x.unidades / contenidoDe(p)) : x.unidades, unidad: p?.unit || 'ud' }; })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
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
