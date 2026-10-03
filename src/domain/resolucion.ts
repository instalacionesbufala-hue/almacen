/* E-030 · Resolver una línea "sin equivalencia" con varios artículos (los 3 o 5 conductores H07Z1-K de la línea, o la
   manguera RZ1-K) y deshacer una resolución. Lo mismo que resolver_linea_varios y deshacer_resolucion del servidor. */
import type { CierreApp, Equivalencia, Estado, LineaCierre, Producto } from '../data/tipos';
import { redondea } from './formato';
import { sincronizarCierreLocal } from './cierres';
import { find } from './reglas';

/** Regla del usuario: monofásica = fase marrón, neutro azul y tierra amarillo/verde; trifásica = 3 fases (marrón, negro, gris), neutro y tierra */
export const COLORES = {
  mono: [['MARRON', 'Fase (marrón)'], ['AZUL', 'Neutro (azul)'], ['AMVERDE', 'Tierra (amarillo/verde)']],
  trif: [['MARRON', 'Fase L1 (marrón)'], ['NEGRO', 'Fase L2 (negro)'], ['GRIS', 'Fase L3 (gris)'], ['AZUL', 'Neutro (azul)'], ['AMVERDE', 'Tierra (amarillo/verde)']],
} as const;
const COLOR_TXT: Record<string, string> = { MARRON: 'MARRÓN', AZUL: 'AZUL', AMVERDE: 'AMARILLO/VERDE', NEGRO: 'NEGRO', GRIS: 'GRIS' };

const plano = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const num = (t: string) => Number(t.replace(',', '.'));
export const esH07 = (p: Producto) => /H07Z1-?K/.test(plano(p.name));
export const esRZ1K = (p: Producto) => /RZ1-?K/.test(plano(p.name));
/** "AMVERDE" | "MARRON" | … (amarillo/verde antes que verde o amarillo sueltos) */
export function colorDe(nombre: string): string | undefined {
  const t = plano(nombre);
  if (/\bAM(ARILLO)?\s*[/-]?\s*VERDE\b|\bVERDE\s*[/-]?\s*AM(ARILLO)?\b/.test(t)) return 'AMVERDE';
  for (const c of ['MARRON', 'AZUL', 'NEGRO', 'GRIS']) if (new RegExp(`\\b${c}\\b`).test(t)) return c;
}
/** Sección en mm²: "10MM" en un conductor; "3G10" en una manguera */
export function seccionDe(nombre: string): number | undefined {
  const t = plano(nombre);
  const g = t.match(/\b(\d)\s*G\s*(\d+(?:[.,]\d+)?)/);
  if (g) return num(g[2]);
  const m = t.match(/\b(\d+(?:[.,]\d+)?)\s*MM/);
  return m ? num(m[1]) : undefined;
}
const conductoresManguera = (nombre: string) => Number(plano(nombre).match(/\b(\d)\s*G\s*\d/)?.[1]) || undefined;

/** Datos de la línea que vienen en el cierre */
export function datosLinea(c: Pick<CierreApp, 'datos'>) {
  const d = (c.datos || {}) as Record<string, unknown>;
  const fase: 'mono' | 'trif' = /tri/i.test(String(d.fase ?? '')) ? 'trif' : 'mono';
  const s = num(String(d.seccion ?? '')); return { fase, seccion: Number.isFinite(s) && s > 0 ? s : undefined, tipoLinea: String(d.tipoLinea ?? '') };
}

const disponibles = (S: Estado) => S.products.filter(p => !p.borrador && !p.archivado);
export interface Propuesta { etiqueta: string; sku?: string; falta?: string; cantidad: number }

/** Conductores sueltos H07Z1-K de esa sección: 3 (mono) o 5 (trif), cada uno con los metros de la partida. Si falta un color, lo dice. */
export function conductoresSueltos(S: Estado, seccion: number | undefined, fase: 'mono' | 'trif', metros: number): Propuesta[] {
  const cand = disponibles(S).filter(p => esH07(p) && (seccion === undefined || seccionDe(p.name) === seccion)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return COLORES[fase].map(([color, etiqueta]) => {
    const p = cand.find(x => colorDe(x.name) === color);
    return p ? { etiqueta, sku: p.sku, cantidad: metros } : { etiqueta, cantidad: metros, falta: `No hay H07Z1-K${seccion ? ` ${String(seccion).replace('.', ',')} mm²` : ''} ${COLOR_TXT[color]} en el catálogo` };
  });
}
/** Manguera RZ1-K de esa sección (3G para mono, 5G para trif): la que mejor encaja, y el filtro para el selector */
export function mangueraRZ1K(S: Estado, seccion: number | undefined, fase: 'mono' | 'trif', metros: number): Propuesta {
  const n = fase === 'trif' ? 5 : 3;
  const p = disponibles(S).filter(filtroRZ1K(seccion)).sort((a, b) => Number(conductoresManguera(b.name) === n) - Number(conductoresManguera(a.name) === n) || a.name.localeCompare(b.name, 'es'))[0];
  const etiqueta = `Manguera RZ1-K ${n}G${seccion ? String(seccion).replace('.', ',') : ''}`;
  return p && (!conductoresManguera(p.name) || conductoresManguera(p.name) === n) ? { etiqueta, sku: p.sku, cantidad: metros } : { etiqueta, cantidad: metros, falta: `No hay ${etiqueta} en el catálogo` };
}
export const filtroRZ1K = (seccion?: number) => (p: Producto) => esRZ1K(p) && (seccion === undefined || seccionDe(p.name) === seccion);

/** Regla de equivalencia con lo elegido, para las próximas instalaciones iguales (no se guarda sola: la app pregunta) */
export function reglaDeResolucion(S: Pick<Estado, 'equivalencias'>, c: Pick<CierreApp, 'datos'>, l: Pick<LineaCierre, 'campo' | 'formula' | 'cantidad'>, articulos: { sku: string; cantidad: number }[]): Equivalencia {
  const { fase, seccion, tipoLinea } = datosLinea(c);
  const condiciones: Record<string, string> = {};
  if (tipoLinea) condiciones.tipoLinea = tipoLinea;
  condiciones.fase = fase;
  if (seccion) condiciones.seccion = String(seccion);
  return { id: `R${Date.now().toString(36)}`, campo: l.campo, formula: l.formula as Equivalencia['formula'], condiciones,
    articulos: articulos.map(a => ({ sku: a.sku, factor: l.cantidad ? redondea(a.cantidad / l.cantidad) : 1 })), estimada: false, activa: true,
    orden: Math.max(0, ...S.equivalencias.map(x => x.orden)) + 10, nota: 'Guardada al resolver una línea a mano', confirmada: true };
}

/* ---------- Aplicar y deshacer en el estado local ---------- */
const consumoDe = (S: Estado, id: string) => { const m = new Map<string, number>(); for (const x of S.movements) if (x.cierre === id) m.set(x.sku, redondea((m.get(x.sku) || 0) - (x.unidades || 0))); return m; };
function versionAdmin(S: Estado, c: CierreApp, antes: Map<string, number>, documento: string) {
  const despues = consumoDe(S, c.id);
  const diferencia = [...new Set([...antes.keys(), ...despues.keys()])].sort().map(sku => ({ sku, unidades: redondea((despues.get(sku) || 0) - (antes.get(sku) || 0)) })).filter(d => d.unidades);
  c.version++;
  (c.versiones ||= []).push({ n: c.version, origen: 'admin', documento, recibido: Date.now(), diferencia });
}

export interface ArticuloResolucion { id: string; sku: string; cantidad: number }
export function resolverVariosLocal(S: Estado, linea: string, grupo: string, articulos: ArticuloResolucion[], operario: string) {
  const l = S.lineasCierre.find(x => x.id === linea); if (!l) throw new Error('Línea no encontrada');
  if (l.estado !== 'pendiente' && l.estado !== 'sin_equivalencia') return;
  if (!articulos.length) throw new Error('Elige al menos un artículo');
  if (articulos.length > 10) throw new Error('Como mucho 10 artículos por línea');
  for (const a of articulos) {
    const p = find(S, a.sku); if (!p || p.borrador || p.archivado) throw new Error(`Artículo no encontrado: ${a.sku}`);
    if (!(a.cantidad > 0)) throw new Error(`La cantidad de ${a.sku} debe ser mayor que 0`);
  }
  const c = S.cierres.find(x => x.id === l.cierre)!, antes = consumoDe(S, c.id), n = articulos.length;
  const [primero, ...resto] = articulos;
  l.previo = { estado: l.estado, sku: l.sku, cantidad: l.cantidad, nota: l.nota };
  Object.assign(l, { sku: primero.sku.toUpperCase(), cantidad: primero.cantidad, estado: 'resuelta', resolucion: grupo, nota: `${l.nota} · resuelta por ${operario}${n > 1 ? ` (${n} artículos)` : ''}`.trim() });
  resto.forEach((a, i) => S.lineasCierre.push({ id: a.id, cierre: l.cierre, campo: l.campo, formula: l.formula, valor: l.valor, sku: a.sku.toUpperCase(), cantidad: a.cantidad,
    estimada: l.estimada, estado: 'resuelta', nota: `resuelta por ${operario} (${i + 2} de ${n})`, resolucion: grupo }));
  sincronizarCierreLocal(S, c.id);
  versionAdmin(S, c, antes, `Línea ${l.campo} resuelta por ${operario}: ${articulos.map(a => find(S, a.sku)?.name || a.sku).join(' + ')}`);
}
export function deshacerResolucionLocal(S: Estado, linea: string, operario: string) {
  const l = S.lineasCierre.find(x => x.id === linea); if (!l) throw new Error('Línea no encontrada');
  if (l.estado !== 'resuelta') throw new Error('Esta línea no está resuelta a mano');
  const c = S.cierres.find(x => x.id === l.cierre)!, antes = consumoDe(S, c.id);
  const base = l.resolucion ? S.lineasCierre.find(x => x.resolucion === l.resolucion && x.previo) || l : l;
  if (l.resolucion && base.previo) {
    S.lineasCierre = S.lineasCierre.filter(x => x.resolucion !== l.resolucion || x.id === base.id);
    Object.assign(base, { estado: base.previo.estado, sku: base.previo.sku || undefined, cantidad: base.previo.cantidad, nota: base.previo.nota });
  } else Object.assign(base, { estado: 'sin_equivalencia', sku: undefined, nota: base.nota.replace(/\s*·\s*resuelta por .*$/, '').trim() });
  delete base.resolucion; delete base.previo;
  sincronizarCierreLocal(S, c.id);
  versionAdmin(S, c, antes, `Resolución de ${base.campo} deshecha por ${operario}`);
}
