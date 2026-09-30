/* E-011 · Cesta libre de entrega: el almacén elige los artículos (buscador o escáner seguido) y el técnico firma.
   Sin plantillas ni nada predeterminado. Reglas puras sobre la cesta, probadas en entregas.test.ts:
   - leer dos veces el mismo código suma cantidad;
   - los cargadores van con n.º de serie (leído o elegido) y un n.º de serie no se repite;
   - ropa y EPIs: la talla se elige en la línea; si la ficha del técnico la tiene, sale preseleccionada;
   - nunca más de lo disponible (stock menos lo reservado para otras entregas preparadas). */
import type { Cesta, Estado, Herramienta, LineaEntrega, Producto, TipoTalla } from '../data/tipos';
import { disponibleReal, find, qtyTxt, resolveCode, seriesReservadas } from './reglas';
import { redondea } from './formato';

export const NOMBRE_TALLA: Record<TipoTalla, string> = { camiseta: 'camiseta', pantalon: 'pantalón', calzado: 'calzado', guantes: 'guantes' };
export const esPrenda = (p: Pick<Producto, 'cat'>) => p.cat === 'ropa' || p.cat === 'epis';

/** Qué talla de la ficha del técnico corresponde a una prenda (por su modelo o nombre) */
export function tipoTalla(p: Pick<Producto, 'modelo' | 'name'>): TipoTalla {
  const t = `${p.modelo || ''} ${p.name}`;
  return /guant/i.test(t) ? 'guantes' : /calz|bota|zapat/i.test(t) ? 'calzado' : /pantal/i.test(t) ? 'pantalon' : 'camiseta';
}

const ORDEN_TALLAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const ordenTalla = (t?: string) => { const u = String(t || '').toUpperCase(), i = ORDEN_TALLAS.indexOf(u); return i >= 0 ? i : 100 + (Number(u) || 0); };

/** Tallas disponibles del mismo modelo (la propia incluida), de menor a mayor */
export function variantes(S: Pick<Estado, 'products'>, p: Producto): Producto[] {
  if (!esPrenda(p) || !p.modelo) return [p];
  return S.products.filter(x => esPrenda(x) && x.modelo === p.modelo && !x.borrador).sort((a, b) => ordenTalla(a.talla) - ordenTalla(b.talla));
}
export const varianteDe = (S: Pick<Estado, 'products'>, modelo: string, talla?: string): Producto | undefined =>
  talla ? S.products.find(p => esPrenda(p) && p.modelo === modelo && String(p.talla).toUpperCase() === talla.toUpperCase()) : undefined;

/** La talla de la ficha del técnico, si existe en el catálogo; si no, la prenda tal cual */
export function tallaPreferida(S: Pick<Estado, 'products' | 'tecnicos'>, receptor: string | null | undefined, p: Producto): Producto {
  if (!esPrenda(p) || !p.modelo) return p;
  const talla = S.tecnicos.find(t => t.id === receptor)?.tallas?.[tipoTalla(p)];
  return varianteDe(S, p.modelo, talla) || p;
}

/** Herramientas de un modelo operativas, sin asignar y sin reservar */
export function herramientasLibres(S: Estado, modelo: string, ahora = Date.now()): Herramienta[] {
  const reservadas = new Set(S.entregas.filter(e => e.estado === 'preparada' && (e.caduca ?? 0) > ahora).flatMap(e => e.lineas.map(l => l.dotacion).filter(Boolean)));
  return S.herramientas.filter(h => h.clase === 'herramienta' && h.modelo === modelo && h.estado === 'operativa' && !h.equipo && !h.tecnico && !reservadas.has(h.id));
}

export const pasoDe = (p: Pick<Producto, 'unit'>) => (p.unit === 'm' ? 10 : 1);
const linea = (c: Cesta, sku: string) => c.lineas.find(l => l.sku === sku && (l.tipo ?? 'stock') === 'stock');
const limpiar = (c: Cesta) => { c.lineas = c.lineas.filter(l => l.qty > 0); };

/** Lo que aún se puede meter en la cesta de un artículo */
export function disponibleEnCesta(S: Estado, c: Cesta, p: Producto): number {
  return redondea(Math.max(0, disponibleReal(S, p)) - (linea(c, p.sku)?.qty || 0));
}
/** N.º de serie en stock, no reservados para otra entrega y que no están ya en la cesta */
export function seriesLibres(S: Estado, c: Cesta, p: Producto): string[] {
  const reservadas = new Set(seriesReservadas(S, p.sku)), enCesta = new Set(linea(c, p.sku)?.serials || []);
  return (p.serials || []).filter(s => !reservadas.has(s) && !enCesta.has(s));
}

export interface Resultado { ok: boolean; aviso?: string; sku?: string }

/** Suma a la cesta: n unidades (o metros), o un n.º de serie concreto en los artículos con serie */
export function sumar(S: Estado, c: Cesta, sku: string, o: { n?: number; serie?: string } = {}): Resultado {
  const p = find(S, sku);
  if (!p) return { ok: false, aviso: 'Artículo no encontrado' };
  if (p.borrador) return { ok: false, aviso: `${p.name} está en borrador: el administrador debe completarlo` };
  let l = linea(c, sku);
  if (!l) { l = { tipo: 'stock', sku, qty: 0, serials: [] }; c.lineas.push(l); }
  let r: Resultado = { ok: true, sku };
  if (p.serialized) {
    const u = (x: string) => x.toUpperCase();
    if (o.serie) {
      const s = (p.serials || []).find(x => u(x) === u(o.serie!));
      if (l.serials.some(x => u(x) === u(o.serie!))) r = { ok: false, sku, aviso: `El n.º de serie ${o.serie} ya está en la cesta` };
      else if (!s) r = { ok: false, sku, aviso: `El n.º de serie ${o.serie} no está en stock` };
      else if (seriesReservadas(S, sku).includes(s)) r = { ok: false, sku, aviso: `El n.º de serie ${s} está reservado para otra entrega preparada` };
      else l.serials.push(s);
    } else {
      const libre = seriesLibres(S, c, p)[0];
      if (libre) l.serials.push(libre); else r = { ok: false, sku, aviso: `No quedan ${p.name} libres` };
    }
    l.qty = l.serials.length;
  } else {
    const n = o.n ?? pasoDe(p), disp = Math.max(0, disponibleReal(S, p));
    if (disp <= 0) r = { ok: false, sku, aviso: `Sin stock disponible de ${p.name}` };
    else if (l.qty + n > disp) { l.qty = disp; r = { ok: false, sku, aviso: `Solo hay ${qtyTxt(p, disp)} disponibles de ${p.name}` }; }
    else l.qty = redondea(l.qty + n);
  }
  limpiar(c);
  return r;
}

export function restar(S: Estado, c: Cesta, sku: string): void {
  const p = find(S, sku), l = linea(c, sku); if (!p || !l) return;
  if (p.serialized) { l.serials.pop(); l.qty = l.serials.length; }
  else l.qty = Math.max(0, redondea(l.qty - pasoDe(p)));
  limpiar(c);
}

export function fijar(S: Estado, c: Cesta, sku: string, q: number): Resultado {
  const p = find(S, sku), l = linea(c, sku); if (!p || !l || !(q >= 0)) return { ok: false };
  if (p.serialized) return { ok: false, aviso: 'En los artículos con n.º de serie la cantidad sale de los números elegidos' };
  const disp = Math.max(0, disponibleReal(S, p));
  l.qty = redondea(Math.min(q, disp));
  limpiar(c);
  return q > disp ? { ok: false, sku, aviso: `Solo hay ${qtyTxt(p, disp)} disponibles de ${p.name}` } : { ok: true, sku };
}

export function alternarSerie(S: Estado, c: Cesta, sku: string, serie: string): Resultado {
  const l = linea(c, sku);
  if (l?.serials.includes(serie)) { l.serials = l.serials.filter(x => x !== serie); l.qty = l.serials.length; limpiar(c); return { ok: true, sku }; }
  return sumar(S, c, sku, { serie });
}

/** Cambia la talla de una línea de ropa o EPI: la cantidad pasa a la otra talla (sin superar lo disponible) */
export function cambiarTalla(S: Estado, c: Cesta, sku: string, nuevo: string): Resultado {
  const l = linea(c, sku), p = find(S, nuevo); if (!l || !p || sku === nuevo) return { ok: false };
  const q = l.qty;
  c.lineas = c.lineas.filter(x => x !== l);
  return sumar(S, c, nuevo, { n: q });
}

/** Añadir desde el buscador: en ropa y EPIs, en la talla de la ficha del técnico */
export function anadir(S: Estado, c: Cesta, sku: string): Resultado {
  const p = find(S, sku); if (!p) return { ok: false, aviso: 'Artículo no encontrado' };
  return sumar(S, c, tallaPreferida(S, c.receptor, p).sku);
}

/** Escáner en modo seguido: cada lectura suma a la cesta (un código repetido suma cantidad; un QR de cargador, su n.º de serie) */
export function escanear(S: Estado, c: Cesta, raw: string): Resultado {
  const r = resolveCode(S, raw);
  if (!r) return { ok: false, aviso: `"${String(raw).trim()}" no está en el catálogo` };
  if (r.nuevo) return { ok: false, sku: r.p.sku, aviso: `El n.º de serie ${r.serial} de ${r.p.name} no está en stock` };
  return sumar(S, c, r.p.sku, r.serial ? { serie: r.serial } : {});
}

/** Lo que impide entregar (vacío = se puede firmar o guardar preparada) */
export function problemas(S: Estado, c: Cesta): string[] {
  const out: string[] = [];
  const t = S.tecnicos.find(x => x.id === c.receptor), eq = S.equipos.find(e => e.id === c.equipo);
  if (!t) out.push('Elige quién recibe el material');
  else if (!eq || !eq.tecnicos.includes(t.id)) out.push(`${t.nombre} no tiene equipo asignado: asígnalo en Equipos y técnicos`);
  if (!c.lineas.length) out.push('La cesta está vacía');
  for (const l of c.lineas) {
    const p = find(S, l.sku);
    if (!p) { out.push(`El artículo ${l.sku} ya no existe`); continue; }
    const disp = Math.max(0, disponibleReal(S, p));
    if (l.qty > disp) out.push(`Solo hay ${qtyTxt(p, disp)} disponibles de ${p.name}`);
    if (p.serialized && l.serials.length !== l.qty) out.push(`${p.name}: indica los n.º de serie`);
  }
  return out;
}

export const aLineas = (c: Cesta): LineaEntrega[] =>
  c.lineas.filter(l => l.qty > 0).map(l => ({ tipo: 'stock' as const, sku: l.sku, qty: l.qty, serials: [...l.serials] }));

export const cestaVacia = (equipo = ''): Cesta => ({ equipo, receptor: null, lineas: [], obra: '', paso: 1 });

/** Correo válido (el mismo criterio que el servidor) */
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
