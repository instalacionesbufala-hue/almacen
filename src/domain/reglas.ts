/* Reglas de negocio (ver CLAUDE.md → "Reglas de negocio"). Funciones puras sobre el estado.
   E-013: sin precios, sin números de serie y sin pasillo/estantería. El material está en el ALMACÉN (Producto.stock, en formatos)
   o a bordo de un VEHÍCULO (Estado.aBordo, en unidades de contenido). Entregar a un equipo es un traspaso almacén → vehículo. */
import type { Estado, LineaEntrega, Movimiento, Producto, Semaforo, TipoMov, Unidad } from '../data/tipos';
import { CATS, UNIT } from '../data/catalogo';
import { norm, num, redondea, uid } from './formato';
import { emparejar, type ItemCatalogo } from '../../supabase/functions/_compartido/albaran';

export const find = (S: Estado, sku: string) => S.products.find(p => p.sku === sku);

/** Semáforo del ALMACÉN (los avisos de mínimo miran solo el almacén): rojo si stock < min, amarillo si < 1,5 × min */
export function status(p: Pick<Producto, 'stock' | 'min'>): Semaforo {
  if (p.stock < p.min) return 'red';
  if (p.stock < p.min * 1.5) return 'amber';
  return 'green';
}
export const ORD: Record<Semaforo, number> = { red: 0, amber: 1, green: 2 };

/* ---------- Formatos de venta ---------- */
const PLURAL: Record<Unidad, string> = { m: 'm', ud: 'ud', bote: 'botes', sobre: 'sobres', bolsa: 'bolsas', pack: 'packs', caja: 'cajas' };
export const unidadTxt = (u: Unidad, n: number) => (Math.abs(n) === 1 ? UNIT[u] : PLURAL[u]);
export const contenidoDe = (p: Pick<Producto, 'contenido'>) => p.contenido && p.contenido > 0 ? p.contenido : 1;
/** En el almacén y en las entregas se mueven formatos enteros (bote completo); solo los metros admiten decimales */
export const formatoEntero = (p: Pick<Producto, 'unit'>) => p.unit !== 'm';
export const qtyTxt = (p: Pick<Producto, 'unit'>, q: number) => `${num(q)} ${unidadTxt(p.unit, q)}`;
/** "bote de 1000 ud" (vacío en m y ud) */
export const contenidoTxt = (p: Pick<Producto, 'unit' | 'contenido'>) => p.unit !== 'm' && p.unit !== 'ud' && contenidoDe(p) > 1 ? `${UNIT[p.unit]} de ${num(contenidoDe(p))} ud` : '';

export const critical = (S: Estado) => S.products.filter(p => !p.borrador && status(p) === 'red');
export const warning = (S: Estado) => S.products.filter(p => !p.borrador && status(p) === 'amber');
export const esCustodia = (p: Pick<Producto, 'propiedad'>) => p.propiedad === 'custodia';

/* ---------- Vehículos y stock a bordo ---------- */
/** Vehículo de un equipo en una fecha (historial de asignaciones); sin fecha, el actual */
export function vehiculoDeEquipo(S: Estado, equipo: string, fecha?: number): string | undefined {
  if (fecha === undefined) return S.equipos.find(e => e.id === equipo)?.vehiculo;
  return S.asignaciones.filter(a => a.tipo === 'vehiculo' && a.equipo === equipo && a.desde <= fecha && (a.hasta === undefined || a.hasta > fecha))
    .sort((a, b) => b.desde - a.desde)[0]?.sujeto;
}
export const equipoDeVehiculo = (S: Estado, veh: string) => S.equipos.find(e => e.vehiculo === veh);
export const nombreVehiculo = (S: Estado, veh?: string) => {
  const v = S.vehiculos.find(x => x.id === veh); if (!v) return veh || '—';
  const e = equipoDeVehiculo(S, v.id);
  return `${e ? e.nombre + ' · ' : ''}${v.matricula}`;
};
/** Unidades de un artículo a bordo de un vehículo */
export const unidadesABordo = (S: Estado, veh: string, sku: string) => S.aBordo.find(x => x.vehiculo === veh && x.sku === sku)?.unidades || 0;
/** Lo que lleva un vehículo, en formatos (0,92 sobres si se gastaron 2 RJ45 de 25) */
export function stockDeVehiculo(S: Estado, veh: string): (LineaEntrega & { unidades: number })[] {
  return S.aBordo.filter(x => x.vehiculo === veh && x.unidades !== 0).flatMap(x => {
    const p = find(S, x.sku); return p ? [{ sku: x.sku, qty: redondea(x.unidades / contenidoDe(p)), unidades: x.unidades, serials: [] }] : [];
  });
}
/** Stock a bordo del vehículo que lleva ahora el equipo */
export const vanStock = (S: Estado, eqId: string) => { const v = vehiculoDeEquipo(S, eqId); return v ? stockDeVehiculo(S, v) : []; };
/** Dónde está un artículo: almacén y cada vehículo, en formatos */
export function ubicaciones(S: Estado, p: Producto): { donde: string; vehiculo?: string; qty: number }[] {
  return [{ donde: 'Almacén', qty: p.stock }, ...S.aBordo.filter(x => x.sku === p.sku && x.unidades !== 0)
    .map(x => ({ donde: S.equipos.find(e => e.vehiculo === x.vehiculo)?.nombre || S.vehiculos.find(v => v.id === x.vehiculo)?.matricula || x.vehiculo, vehiculo: x.vehiculo, qty: redondea(x.unidades / contenidoDe(p)) }))];
}
/** Stock total = almacén + vehículos (en formatos) */
export const stockTotal = (S: Estado, p: Producto) => redondea(ubicaciones(S, p).reduce((a, u) => a + u.qty, 0));

/* ---------- Reservas de entregas preparadas (E-007) ---------- */
export function reservado(S: Estado, sku: string, excepto?: string, ahora = Date.now()) {
  let n = 0;
  for (const e of S.entregas) if (e.estado === 'preparada' && (e.caduca ?? 0) > ahora && e.id !== excepto)
    for (const l of e.lineas) if ((l.tipo ?? 'stock') === 'stock' && l.sku === sku) n += l.qty;
  return redondea(n);
}
export const disponibleReal = (S: Estado, p: Producto, excepto?: string) => redondea(p.stock - reservado(S, p.sku, excepto));

/* ---------- Movimientos ---------- */
export interface MovInput { id?: string; sku: string; type: TipoMov; qty: number; reason: string; ref?: string; serials?: string[]; equipo?: string; entrega?: string; vehiculo?: string; cierre?: string }
/** Variación del stock del ALMACÉN (el ajuste lleva su signo; traspaso resta, devolución suma, consumo no toca el almacén) */
export const delta = (type: TipoMov, qty: number) =>
  type === 'entrada' || type === 'ajuste' || type === 'devolucion' ? qty : type === 'consumo' ? 0 : -qty;
export interface MovResult { p: Producto; before: Semaforo; after: Semaforo; m: Movimiento }

const comprobarBasico = (p: Producto, type: TipoMov, qty: number, reason: string) => {
  if (type === 'ajuste' ? !qty : !(qty > 0)) throw new Error(type === 'ajuste' ? 'Indica una cantidad distinta de cero' : 'Indica una cantidad mayor que cero');
  if (!String(reason || '').trim()) throw new Error('Indica el motivo del movimiento');
  if (p.borrador) throw new Error(`${p.name} está en borrador: el administrador debe completarla antes de moverla`);
};

/** Aplica un movimiento (almacén o, con vehiculo, a bordo). Lanza Error si no es válido y no deja el estado a medias. Misma regla que el servidor. */
export function applyMovement(S: Estado, i: MovInput, ahora = Date.now()): MovResult {
  const p = find(S, i.sku); if (!p) throw new Error('Producto no encontrado');
  const qty = Number(i.qty), type = i.type, ref = i.ref || '';
  comprobarBasico(p, type, qty, i.reason);
  const entera = type !== 'consumo' && (!i.vehiculo || type === 'traspaso' || type === 'devolucion');
  if (entera && formatoEntero(p) && qty !== Math.trunc(qty)) throw new Error(`En el almacén ${p.name} se mueve por ${UNIT[p.unit]} entero: indica un número sin decimales`);
  if ((type === 'traspaso' || type === 'devolucion' || type === 'consumo') && !i.vehiculo) throw new Error('Indica el vehículo');
  const before = status(p);
  let unidades: number | undefined;
  if (i.vehiculo) {
    const v = S.vehiculos.find(x => x.id === i.vehiculo); if (!v) throw new Error('Vehículo no encontrado');
    const abordo = unidadesABordo(S, v.id, p.sku), u = qty * contenidoDe(p);
    if (type === 'traspaso') {
      if (p.stock < qty) throw new Error(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name} en el almacén`);
      const r = reservado(S, p.sku, i.entrega); if (p.stock - qty < r) throw new Error(`Hay ${qtyTxt(p, r)} reservadas para entregas preparadas de ${p.name}: no se pueden usar`);
      unidades = u;
    } else if (type === 'devolucion' || type === 'merma') {
      if (abordo < u) throw new Error(`El vehículo ${v.matricula} solo lleva ${qtyTxt(p, redondea(abordo / contenidoDe(p)))} de ${p.name}`);
      unidades = -u;
    } else if (type === 'ajuste') unidades = u;
    else if (type === 'consumo') unidades = -u;       // puede dejar el vehículo en negativo: discrepancia (E-012)
    else throw new Error('Tipo de movimiento de vehículo no válido');
    if (type === 'traspaso' || type === 'devolucion') p.stock = redondea(p.stock + delta(type, qty));
    const x = S.aBordo.find(y => y.vehiculo === v.id && y.sku === p.sku);
    if (x) x.unidades = redondea(x.unidades + unidades); else S.aBordo.push({ vehiculo: v.id, sku: p.sku, unidades });
  } else {
    if (!['entrada', 'salida', 'merma', 'ajuste'].includes(type)) throw new Error('Tipo de movimiento no válido');
    const d = delta(type, qty);
    if (p.stock + d < 0) throw new Error(`Solo hay ${qtyTxt(p, p.stock)} de ${p.name} en el almacén`);
    if (esCustodia(p) && type === 'salida' && !ref.trim()) throw new Error(`Indica la obra o instalación de destino: ${p.name} está en custodia de ${S.propietarios?.find(o => o.id === p.propietario)?.nombre || 'otro propietario'}`);
    if (d < 0 && S.entregas?.length) {
      const r = reservado(S, p.sku, i.entrega);
      if (p.stock + d < r) throw new Error(`Hay ${qtyTxt(p, r)} reservadas para entregas preparadas de ${p.name}: no se pueden usar`);
    }
    p.stock = redondea(p.stock + d);
  }
  if (p.stock > 0 && S.pedidos[p.sku] && p.stock >= p.min) delete S.pedidos[p.sku];
  const m: Movimiento = { id: i.id || uid('M'), ts: ahora, sku: p.sku, type, qty, reason: i.reason, ref, operator: S.operator, serials: [], equipo: i.equipo, entrega: i.entrega, vehiculo: i.vehiculo, unidades, ...(i.cierre ? { cierre: i.cierre } : {}) };
  S.movements.unshift(m);
  return { p, before, after: status(p), m };
}

/** Buscador: todos los términos en nombre, SKU, EAN, ref. proveedor, categoría o proveedor. `ubi`: 'almacen' o id de vehículo */
export function searchProducts(S: Estado, q: string, f: { cat?: string; est?: string; prop?: string; ubi?: string } = {}) {
  const { cat = 'all', est = 'all', prop = 'all', ubi = 'all' } = f;
  const toks = norm(q).split(/\s+/).filter(Boolean);
  return S.products.filter(p => {
    if (cat !== 'all' && p.cat !== cat) return false;
    if (est !== 'all' && status(p) !== est) return false;
    if (prop !== 'all' && (p.propiedad || 'propia') !== prop) return false;
    if (ubi === 'almacen' && !(p.stock > 0)) return false;
    if (ubi !== 'all' && ubi !== 'almacen' && !(unidadesABordo(S, ubi, p.sku) !== 0)) return false;
    if (!toks.length) return true;
    const hay = norm([p.name, p.sku, p.ean, p.supplierRef, CATS[p.cat]?.label, p.supplier, p.modelo, p.talla ? 'talla ' + p.talla : ''].join(' '));
    return toks.every(t => hay.includes(t) || (t.endsWith('s') && hay.includes(t.slice(0, -1))));
  }).sort((a, b) => ORD[status(a)] - ORD[status(b)] || a.name.localeCompare(b.name));
}

/** Emparejado de una línea de albarán (cualquier proveedor). La lógica vive en el módulo compartido con el servidor (E-003). */
export const catalogoParaEmparejar = (S: Estado): ItemCatalogo[] =>
  S.products.map(p => ({ sku: p.sku, ref: p.supplierRef, ean: p.ean, nombre: p.name, unidad: contenidoTxt(p) || UNIT[p.unit], proveedor: p.supplier, custodia: p.propiedad === 'custodia' }));
export function matchLine(S: Estado, code: string | undefined, desc: string | undefined): { sku: string | null; how: string | null } {
  return emparejar(catalogoParaEmparejar(S), code, desc);
}

/** Contenido del QR de estantería: BUF:<SKU> (E-013: sin n.º de serie) */
export const qrContenido = (sku: string) => `BUF:${sku}`;

/** Resuelve un código leído: QR propio (BUF:SKU; un "|SN:…" antiguo se ignora), SKU, EAN o ref. del proveedor */
export function resolveCode(S: Estado, raw: string): { p: Producto } | null {
  const t = String(raw || '').trim(); if (!t) return null;
  const u = (x?: string) => String(x || '').toUpperCase().replace(/\s/g, '');
  const qr = /^BUF:([^|]+)/i.exec(t), code = qr ? qr[1].trim() : t;
  const p = S.products.find(x => [x.sku, x.ean, x.supplierRef].some(v => v && u(v) === u(code)));
  return p ? { p } : null;
}

/** Número visible de una entrega: el del servidor, el local (modo demo) o "pendiente" mientras está en la cola */
export const numEntrega = (e: { id: string; numero?: string }) => e.numero || (/^ENT-/.test(e.id) ? e.id : 'Pendiente de envío');

/** Cantidad sugerida para reponer (E-006): objetivo − stock del almacén (objetivo por defecto 2 × mínimo), en formatos enteros salvo metros */
export function pedidoSugerido(p: Pick<Producto, 'stock' | 'min' | 'unit'> & { objetivo?: number }) {
  const objetivo = p.objetivo ?? p.min * 2, falta = objetivo - p.stock;
  if (falta <= 0) return 0;
  return p.unit === 'm' ? redondea(falta) : Math.ceil(falta);
}
