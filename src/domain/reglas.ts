/* Reglas de negocio (ver CLAUDE.md → "Reglas de negocio"). Funciones puras sobre el estado. */
import type { Estado, LineaEntrega, Movimiento, Producto, Semaforo, TipoMov } from '../data/tipos';
import { CATS, UNIT } from '../data/catalogo';
import { norm, num, redondea, uid } from './formato';
import { emparejar, type ItemCatalogo } from '../../supabase/functions/_compartido/albaran';

export const find = (S: Estado, sku: string) => S.products.find(p => p.sku === sku);

/** Semáforo: rojo si stock < min, amarillo si stock < 1,5 × min, verde en otro caso */
export function status(p: Pick<Producto, 'stock' | 'min'>): Semaforo {
  if (p.stock < p.min) return 'red';
  if (p.stock < p.min * 1.5) return 'amber';
  return 'green';
}
export const ORD: Record<Semaforo, number> = { red: 0, amber: 1, green: 2 };
export const qtyTxt = (p: Pick<Producto, 'unit'>, q: number) => `${num(q)} ${UNIT[p.unit]}`;
export const aisle = (loc: string) => String(loc).split('-')[0];
export function locTxt(loc: string) {
  const [a, b, c] = String(loc).split('-');
  return `Pasillo ${(a || '').replace('P', '')} · Est. ${(b || '').replace('E', '')} · Nivel ${(c || '').replace('N', '')}`;
}
export const LOC_RE = /^P\d{1,3}-E\d{1,3}-N\d{1,2}$/;
export const critical = (S: Estado) => S.products.filter(p => status(p) === 'red');
export const warning = (S: Estado) => S.products.filter(p => status(p) === 'amber');
/** E-008: el material en custodia no es nuestro y no tiene precio: nunca suma en euros */
export const esCustodia = (p: Pick<Producto, 'propiedad'>) => p.propiedad === 'custodia';
export const valorProducto = (p: Producto) => esCustodia(p) ? 0 : p.stock * (p.price || 0);
export const invValue = (S: Estado) => S.products.reduce((a, p) => a + valorProducto(p), 0);
export const aisles = (S: Estado) => [...new Set(S.products.map(p => aisle(p.loc)))].sort();

/** E-007: lo apartado para entregas preparadas y vigentes (excepto la indicada) */
export function reservado(S: Estado, sku: string, excepto?: string, ahora = Date.now()) {
  let n = 0;
  for (const e of S.entregas) if (e.estado === 'preparada' && (e.caduca ?? 0) > ahora && e.id !== excepto)
    for (const l of e.lineas) if ((l.tipo ?? 'stock') === 'stock' && l.sku === sku) n += l.qty;
  return redondea(n);
}
export const seriesReservadas = (S: Estado, sku: string, excepto?: string, ahora = Date.now()) =>
  S.entregas.filter(e => e.estado === 'preparada' && (e.caduca ?? 0) > ahora && e.id !== excepto).flatMap(e => e.lineas.filter(l => l.sku === sku).flatMap(l => l.serials));
export const disponibleReal = (S: Estado, p: Producto, excepto?: string) => redondea(p.stock - reservado(S, p.sku, excepto));

export interface MovInput { id?: string; sku: string; type: TipoMov; qty: number; reason: string; ref?: string; serials?: string[]; equipo?: string; entrega?: string }
/** Variación de stock de un movimiento (el ajuste lleva su signo) */
export const delta = (type: TipoMov, qty: number) => type === 'entrada' || type === 'ajuste' ? qty : -qty;
export interface MovResult { p: Producto; before: Semaforo; after: Semaforo; m: Movimiento }

/** Aplica un movimiento. Lanza Error si no es válido (no deja el estado a medias). */
export function applyMovement(S: Estado, { id, sku, type, qty, reason, ref = '', serials = [], equipo, entrega }: MovInput, ahora = Date.now()): MovResult {
  const p = find(S, sku); if (!p) throw new Error('Producto no encontrado');
  qty = Number(qty);
  if (type === 'ajuste' ? !qty : !(qty > 0)) throw new Error(type === 'ajuste' ? 'Indica una cantidad distinta de cero' : 'Indica una cantidad mayor que cero');
  if (!String(reason || '').trim()) throw new Error('Indica el motivo del movimiento');
  const d = delta(type, qty);
  if (p.stock + d < 0) throw new Error(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name}`);
  if (esCustodia(p) && type === 'salida' && !String(ref || '').trim()) throw new Error(`Indica la obra o instalación de destino: ${p.name} está en custodia de ${S.propietarios?.find(o => o.id === p.propietario)?.nombre || 'otro propietario'}`);
  if (p.serialized) {
    if (serials.length !== Math.abs(qty)) throw new Error(`${p.name}: indica ${Math.abs(qty)} n.º de serie (hay ${serials.length})`);
    if (new Set(serials).size !== serials.length) throw new Error('Hay números de serie repetidos');
    if (d > 0) { const dup = serials.find(s => (p.serials || []).includes(s)); if (dup) throw new Error(`El n.º de serie ${dup} ya está en stock`); }
    else { const f = serials.find(s => !(p.serials || []).includes(s)); if (f) throw new Error(`El n.º de serie ${f} no está en stock`); }
  } else if (serials.length) throw new Error(`${p.name} no lleva control por n.º de serie`);
  if (d < 0 && S.entregas?.length) {
    const r = reservado(S, sku, entrega);
    if (p.stock + d < r) throw new Error(`Hay ${qtyTxt(p, r)} reservadas para entregas preparadas de ${p.name}: no se pueden usar`);
    const sr = seriesReservadas(S, sku, entrega), choca = serials.find(s => sr.includes(s));
    if (choca) throw new Error(`El n.º de serie ${choca} está reservado para otra entrega preparada`);
  }
  const before = status(p);
  if (d > 0) { if (p.serialized) p.serials = [...(p.serials || []), ...serials]; }
  else if (p.serialized) p.serials = (p.serials || []).filter(s => !serials.includes(s));
  p.stock = redondea(p.stock + d);
  if (d > 0 && S.pedidos[sku] && p.stock >= p.min) delete S.pedidos[sku];
  const m: Movimiento = { id: id || uid('M'), ts: ahora, sku, type, qty, reason, ref, operator: S.operator, serials, equipo, entrega };
  S.movements.unshift(m);
  return { p, before, after: status(p), m };
}

/** Buscador inteligente: todos los términos deben aparecer en nombre, SKU, EAN, ref. proveedor, ubicación, categoría, proveedor o n.º de serie */
export function searchProducts(S: Estado, q: string, f: { cat?: string; pas?: string; est?: string; prop?: string } = {}) {
  const { cat = 'all', pas = 'all', est = 'all', prop = 'all' } = f;
  const toks = norm(q).split(/\s+/).filter(Boolean);
  return S.products.filter(p => {
    if (cat !== 'all' && p.cat !== cat) return false;
    if (pas !== 'all' && aisle(p.loc) !== pas) return false;
    if (est !== 'all' && status(p) !== est) return false;
    if (prop !== 'all' && (p.propiedad || 'propia') !== prop) return false;
    if (!toks.length) return true;
    const hay = norm([p.name, p.sku, p.ean, p.supplierRef, p.loc, p.loc.replace(/-/g, ' '), locTxt(p.loc), CATS[p.cat]?.label, p.supplier, (p.serials || []).join(' ')].join(' '));
    return toks.every(t => hay.includes(t) || (t.endsWith('s') && hay.includes(t.slice(0, -1))));
  }).sort((a, b) => ORD[status(a)] - ORD[status(b)] || a.loc.localeCompare(b.loc));
}

/** Emparejado de una línea de albarán (cualquier proveedor). La lógica vive en el módulo compartido con el servidor (E-003). */
export const catalogoParaEmparejar = (S: Estado): ItemCatalogo[] =>
  S.products.map(p => ({ sku: p.sku, ref: p.supplierRef, ean: p.ean, nombre: p.name, unidad: UNIT[p.unit], proveedor: p.supplier, custodia: p.propiedad === 'custodia' }));
export function matchLine(S: Estado, code: string | undefined, desc: string | undefined): { sku: string | null; how: string | null } {
  return emparejar(catalogoParaEmparejar(S), code, desc);
}

/** Contenido del QR de una referencia: BUF:<SKU> o BUF:<SKU>|SN:<serie> */
export const qrContenido = (sku: string, serie?: string) => `BUF:${sku}${serie ? `|SN:${serie}` : ''}`;

/** Resuelve un código leído: QR propio (BUF:SKU|SN:serie), SKU, EAN, ref. proveedor o n.º de serie */
export function resolveCode(S: Estado, raw: string): { p: Producto; serial: string; nuevo?: boolean } | null {
  const t = String(raw || '').trim(); if (!t) return null;
  const u = (x?: string) => String(x || '').toUpperCase();
  let code = t, serial = '';
  const qr = /^BUF:([^|]+)(?:\|SN:(.+))?$/i.exec(t);
  if (qr) { code = qr[1].trim(); serial = (qr[2] || '').trim(); }
  let p = S.products.find(p => [p.sku, p.ean, p.supplierRef].some(v => v && u(v) === u(code)));
  if (p) return { p, serial, nuevo: !!serial && !(p.serials || []).some(s => u(s) === u(serial)) };
  p = S.products.find(p => (p.serials || []).some(s => u(s) === u(code)));
  if (p) return { p, serial: p.serials!.find(s => u(s) === u(code))! };
  // n.º de serie aún no registrado que sigue el patrón de un modelo con serie (mismo prefijo de dos bloques)
  const pre = (s: string) => u(s).split('-').slice(0, 2).join('-');
  if (code.includes('-')) {
    p = S.products.find(p => p.serialized && (p.serials || []).some(s => s.includes('-') && pre(s) === pre(code)));
    if (p) return { p, serial: u(code), nuevo: true };
  }
  return null;
}

/** Stock a bordo de una furgoneta: entregado − devuelto */
export function vanStock(S: Estado, eqId: string): LineaEntrega[] {
  const m: Record<string, LineaEntrega> = {};
  // solo lo firmado está a bordo: lo preparado sigue reservado en el almacén y lo anulado no salió
  for (const e of S.entregas) if (e.equipo === eqId && (e.estado ?? 'firmada') === 'firmada') for (const l of e.lineas) {
    if (l.tipo === 'herramienta') continue;
    m[l.sku] = m[l.sku] || { sku: l.sku, qty: 0, serials: [] };
    m[l.sku].qty = redondea(m[l.sku].qty + l.qty); m[l.sku].serials.push(...(l.serials || []));
  }
  for (const mv of S.movements) if (mv.equipo === eqId && mv.type === 'entrada' && mv.reason === 'Devolución de obra' && m[mv.sku]) {
    m[mv.sku].qty = redondea(m[mv.sku].qty - mv.qty);
    m[mv.sku].serials = m[mv.sku].serials.filter(s => !(mv.serials || []).includes(s));
  }
  return Object.values(m).filter(x => x.qty > 0 && find(S, x.sku));
}

/** Número visible de una entrega: el del servidor, el local (modo demo) o "pendiente" mientras está en la cola */
export const numEntrega = (e: { id: string; numero?: string }) => e.numero || (/^ENT-/.test(e.id) ? e.id : 'Pendiente de envío');

/** Cantidad sugerida para reponer (E-006): objetivo − stock (objetivo por defecto 2 × mínimo), redondeada al formato de compra.
    Misma regla que la función SQL cantidad_sugerida. */
export function pedidoSugerido(p: Pick<Producto, 'stock' | 'min' | 'pack'> & { objetivo?: number }) {
  const pack = p.pack || 1, objetivo = p.objetivo ?? p.min * 2, falta = objetivo - p.stock;
  if (falta <= 0) return 0;
  return Math.max(pack, Math.ceil(falta / pack) * pack);
}
