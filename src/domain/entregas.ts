/* E-011 · Cesta libre de entrega: el almacén elige los artículos (buscador o escáner seguido) y el técnico firma.
   Sin plantillas ni nada predeterminado. Reglas puras sobre la cesta, probadas en entregas.test.ts:
   - leer dos veces el mismo código suma cantidad;
   - E-013: sin n.º de serie; se entregan formatos enteros (el bote completo); el material de instalación entra en el vehículo del equipo;
   - ropa y EPIs: la talla se elige en la línea; si la ficha del técnico la tiene, sale preseleccionada;
   - nunca más de lo disponible (stock menos lo reservado para otras entregas preparadas). */
import type { Cesta, Estado, Herramienta, LineaEntrega, Producto, TipoTalla } from '../data/tipos';
import { disponibleReal, find, formatoEntero, resolveCode, vehiculoDeEquipo } from './reglas';
import { cantTxt } from './formatos';
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
/** Ropa y EPIs son dotación personal: van al técnico, no al vehículo */
export const esPersonal = esPrenda;
const linea = (c: Cesta, sku: string) => c.lineas.find(l => l.sku === sku && (l.tipo ?? 'stock') === 'stock');
const limpiar = (c: Cesta) => { c.lineas = c.lineas.filter(l => l.qty > 0); };

/** Lo que aún se puede meter en la cesta de un artículo */
export function disponibleEnCesta(S: Estado, c: Cesta, p: Producto): number {
  return redondea(Math.max(0, disponibleReal(S, p)) - (linea(c, p.sku)?.qty || 0));
}
export interface Resultado { ok: boolean; aviso?: string; sku?: string }

/** Suma a la cesta n formatos (o metros). Nunca más de lo disponible; en formatos, números enteros */
export function sumar(S: Estado, c: Cesta, sku: string, o: { n?: number } = {}): Resultado {
  const p = find(S, sku);
  if (!p) return { ok: false, aviso: 'Artículo no encontrado' };
  if (p.borrador) return { ok: false, aviso: `${p.name} está en borrador: el administrador debe completarlo` };
  let l = linea(c, sku);
  if (!l) { l = { tipo: 'stock', sku, qty: 0, serials: [] }; c.lineas.push(l); }
  let r: Resultado = { ok: true, sku };
  const n = o.n ?? pasoDe(p), disp = Math.max(0, disponibleReal(S, p));
  if (disp <= 0) r = { ok: false, sku, aviso: `Sin stock disponible de ${p.name}` };
  else if (l.qty + n > disp) { l.qty = disp; r = { ok: false, sku, aviso: `Solo hay ${cantTxt(p, disp)} disponibles de ${p.name}` }; }
  else l.qty = redondea(l.qty + n);
  limpiar(c);
  return r;
}

export function restar(S: Estado, c: Cesta, sku: string): void {
  const p = find(S, sku), l = linea(c, sku); if (!p || !l) return;
  l.qty = Math.max(0, redondea(l.qty - pasoDe(p)));
  limpiar(c);
}

export function fijar(S: Estado, c: Cesta, sku: string, q: number): Resultado {
  const p = find(S, sku), l = linea(c, sku); if (!p || !l || !(q >= 0)) return { ok: false };
  const disp = Math.max(0, disponibleReal(S, p)), pedido = formatoEntero(p) ? Math.floor(q) : q;
  l.qty = redondea(Math.min(pedido, disp));
  limpiar(c);
  return q > disp ? { ok: false, sku, aviso: `Solo hay ${cantTxt(p, disp)} disponibles de ${p.name}` } : { ok: true, sku };
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

/** Escáner en modo seguido: cada lectura suma a la cesta (un código repetido suma cantidad) */
export function escanear(S: Estado, c: Cesta, raw: string): Resultado {
  const r = resolveCode(S, raw);
  if (!r) return { ok: false, aviso: `"${String(raw).trim()}" no está en el catálogo` };
  return sumar(S, c, r.p.sku);
}

/** Lo que impide entregar (vacío = se puede firmar o guardar preparada) */
export function problemas(S: Estado, c: Cesta): string[] {
  const out: string[] = [];
  // E-017: la entrega es para un EQUIPO; quién recoge y firma se elige al firmar, entre sus técnicos
  const eq = S.equipos.find(e => e.id === c.equipo);
  if (!eq) out.push('Elige el equipo que recibe el material');
  else if (!eq.tecnicos.length) out.push(`${eq.nombre} no tiene técnicos: asígnale alguno en Equipos y técnicos para que puedan firmar la recogida`);
  else if (!vehiculoDeEquipo(S, eq.id) && c.lineas.some(l => { const p = find(S, l.sku); return p && !esPersonal(p); }))
    out.push(`${eq.nombre} no tiene vehículo asignado: asígnale uno en Equipos para entregarle material de instalación (la ropa y los EPIs sí se pueden entregar)`);
  if (!c.lineas.length) out.push('La cesta está vacía');
  for (const l of c.lineas) {
    const p = find(S, l.sku);
    if (!p) { out.push(`El artículo ${l.sku} ya no existe`); continue; }
    const disp = Math.max(0, disponibleReal(S, p));
    if (l.qty > disp) out.push(`Solo hay ${cantTxt(p, disp)} disponibles de ${p.name}`);
    if (formatoEntero(p) && l.qty !== Math.trunc(l.qty)) out.push(`${p.name} se entrega por formato entero`);
  }
  return out;
}

export const aLineas = (c: Cesta): LineaEntrega[] =>
  c.lineas.filter(l => l.qty > 0).map(l => ({ tipo: 'stock' as const, sku: l.sku, qty: l.qty, serials: [] }));

export const cestaVacia = (equipo = ''): Cesta => ({ equipo, receptor: null, lineas: [], obra: '', paso: 1 });

/** E-017: quién puede recoger y firmar una entrega del equipo (sus técnicos actuales) */
export const firmantesDe = (S: Pick<Estado, 'equipos' | 'tecnicos'>, equipo: string) => {
  const eq = S.equipos.find(e => e.id === equipo);
  return eq ? S.tecnicos.filter(t => eq.tecnicos.includes(t.id)) : [];
};

/** Correo válido (el mismo criterio que el servidor) */
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/* ---------- E-025 · Asignar artículos a un equipo desde su vehículo (todo el catálogo, también los de 0 ud) ---------- */
/** Prepara la entrega para ese equipo con los artículos ya en la cesta (luego, el flujo y la firma de siempre).
    Si la cesta tenía material para OTRO equipo, se vacía antes (la pantalla lo pregunta). */
export function asignarAEquipo(S: Estado, c: Cesta, equipo: string, skus: string[]): { anadidos: string[]; avisos: string[] } {
  if (c.equipo !== equipo && c.lineas.length) c.lineas = [];
  c.equipo = equipo; c.receptor = null; c.paso = 2;
  const anadidos: string[] = [], avisos: string[] = [];
  for (const sku of skus) {
    const p = find(S, sku);
    if (!p || p.borrador || p.archivado) { avisos.push(`${sku}: no se puede entregar (no está en el catálogo activo)`); continue; }
    if (c.lineas.some(l => l.sku === sku)) { anadidos.push(sku); continue; }       // ya estaba: no se suma otra vez
    const r = anadir(S, c, sku);
    if (r.ok) anadidos.push(r.sku || sku); else avisos.push(`${p.name}: ${r.aviso || 'no se ha podido añadir'}`);
  }
  return { anadidos, avisos };
}
