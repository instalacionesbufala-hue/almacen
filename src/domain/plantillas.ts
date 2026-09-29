/* E-007 · Resolver una plantilla para un técnico o un equipo:
   - ropa y EPIs: la talla sale de la ficha del técnico (no de la plantilla);
   - modo kit: la plantilla es el contenido objetivo de la furgoneta y se entrega solo la diferencia;
   - avisa de lo que no hay y propone entregar lo disponible. */
import type { Estado, Herramienta, LineaPlantilla, Plantilla, Producto, TipoTalla } from '../data/tipos';
import { disponibleReal, find, vanStock } from './reglas';

export const NOMBRE_TALLA: Record<TipoTalla, string> = { camiseta: 'camiseta', pantalon: 'pantalón', calzado: 'calzado', guantes: 'guantes' };

export interface LineaResuelta {
  clave: string;
  tipo: 'stock' | 'herramienta';
  sku?: string;
  modelo?: string;
  nombre: string;
  cantidad: number;        // propuesta (ya limitada a lo disponible)
  pedida: number;          // lo que marca la plantilla (o la diferencia en modo kit)
  editable: boolean;
  disponible: number;
  serials: string[];       // artículos con n.º de serie: se escanean o eligen al preparar
  herramientas: string[];  // ids de dotación elegidos (tipo herramienta)
  aviso?: string;
}

/** Variante de ropa o EPI de un modelo en una talla */
export const varianteDe = (S: Estado, modelo: string, talla?: string): Producto | undefined =>
  talla ? S.products.find(p => (p.cat === 'ropa' || p.cat === 'epis') && p.modelo === modelo && String(p.talla).toUpperCase() === talla.toUpperCase()) : undefined;

/** Herramientas de un modelo operativas, sin asignar y sin reservar */
export function herramientasLibres(S: Estado, modelo: string, ahora = Date.now()): Herramienta[] {
  const reservadas = new Set(S.entregas.filter(e => e.estado === 'preparada' && (e.caduca ?? 0) > ahora).flatMap(e => e.lineas.map(l => l.dotacion).filter(Boolean)));
  return S.herramientas.filter(h => h.clase === 'herramienta' && h.modelo === modelo && h.estado === 'operativa' && !h.equipo && !h.tecnico && !reservadas.has(h.id));
}

export function resolverPlantilla(S: Estado, pl: Plantilla, equipo: string, receptor?: string): LineaResuelta[] {
  const tec = S.tecnicos.find(t => t.id === receptor);
  const aBordo = new Map(pl.modoKit ? vanStock(S, equipo).map(x => [x.sku, x.qty]) : []);
  const out: LineaResuelta[] = [];
  pl.lineas.forEach((l: LineaPlantilla, i) => {
    if (l.tipo === 'herramienta') {
      const libres = herramientasLibres(S, l.modelo!), n = Math.round(l.cantidad);
      out.push({ clave: `h${i}`, tipo: 'herramienta', modelo: l.modelo, nombre: `${l.modelo} (herramienta)`, cantidad: Math.min(n, libres.length), pedida: n, editable: l.editable,
        disponible: libres.length, serials: [], herramientas: libres.slice(0, n).map(h => h.id), aviso: libres.length < n ? `Solo hay ${libres.length} de repuesto` : undefined });
      return;
    }
    let p: Producto | undefined, aviso: string | undefined;
    if (l.tipo === 'modelo') {
      const talla = tec?.tallas?.[l.tipoTalla!];
      if (!talla) { out.push({ clave: `m${i}`, tipo: 'stock', modelo: l.modelo, nombre: l.modelo!, cantidad: 0, pedida: l.cantidad, editable: l.editable, disponible: 0, serials: [], herramientas: [], aviso: `Falta la talla de ${NOMBRE_TALLA[l.tipoTalla!]} en la ficha de ${tec?.nombre || 'el técnico'}` }); return; }
      p = varianteDe(S, l.modelo!, talla);
      if (!p) { out.push({ clave: `m${i}`, tipo: 'stock', modelo: l.modelo, nombre: `${l.modelo} · talla ${talla}`, cantidad: 0, pedida: l.cantidad, editable: l.editable, disponible: 0, serials: [], herramientas: [], aviso: `No hay ${l.modelo} en talla ${talla} en el catálogo` }); return; }
    } else p = find(S, l.sku!);
    if (!p) return;
    const pedida = pl.modoKit ? Math.max(0, l.cantidad - (aBordo.get(p.sku) || 0)) : l.cantidad;
    if (pl.modoKit && pedida === 0) return; // la furgoneta ya lo lleva
    const disp = Math.max(0, disponibleReal(S, p));
    const cantidad = p.serialized ? Math.min(Math.floor(pedida), disp) : Math.min(pedida, disp);
    if (disp < pedida) aviso = disp > 0 ? `Solo hay ${disp} disponibles: se propone entregar lo que hay` : 'Sin stock disponible';
    const libres = p.serialized ? (p.serials || []).filter(s => !S.entregas.some(e => e.estado === 'preparada' && (e.caduca ?? 0) > Date.now() && e.lineas.some(x => x.serials.includes(s)))) : [];
    out.push({ clave: `s${i}`, tipo: 'stock', sku: p.sku, modelo: l.modelo, nombre: p.name, cantidad, pedida, editable: l.editable, disponible: disp, serials: libres.slice(0, cantidad), herramientas: [], aviso });
  });
  return out;
}
