/* E-019 · Inventario completo en una sola lista: orden por columna, agrupado por categoría, CSV y vista de impresión de la lista filtrada */
import { ucDe } from './formatos';
import type { Estado, Producto } from '../data/tipos';
import { UNIT, catDe } from '../data/catalogo';
import { ORD, status, stockTotal, unidadesABordo, contenidoDe, nombreVehiculo } from './reglas';
import { redondea } from './formato';

export type ColOrden = 'sku' | 'nombre' | 'stock' | 'estado';
export interface Orden { col: ColOrden; dir: 1 | -1 }
export const ORDEN_DEFECTO: Orden = { col: 'estado', dir: 1 };

const cmp = { sku: (a: Producto, b: Producto) => a.sku.localeCompare(b.sku, 'es', { numeric: true }), nombre: (a: Producto, b: Producto) => a.name.localeCompare(b.name, 'es') };

/** Ordena la lista completa (no una página). Estado: primero lo crítico; a igualdad, por nombre */
export function ordenarInventario(lista: Producto[], o: Orden = ORDEN_DEFECTO): Producto[] {
  const f = (a: Producto, b: Producto) =>
    o.col === 'sku' ? cmp.sku(a, b) : o.col === 'nombre' ? cmp.nombre(a, b)
      : o.col === 'stock' ? a.stock - b.stock || cmp.nombre(a, b)
        : ORD[status(a)] - ORD[status(b)] || cmp.nombre(a, b);
  return [...lista].sort((a, b) => o.dir * f(a, b));
}
/** Toque en una cabecera: la misma columna invierte el sentido; otra columna empieza ascendente */
export const siguienteOrden = (o: Orden, col: ColOrden): Orden => (o.col === col ? { col, dir: o.dir === 1 ? -1 : 1 } : { col, dir: 1 });

/** Grupos por categoría (en el orden de la lista ya ordenada), con su número de referencias */
export function agruparPorCategoria(lista: Producto[]): { cat: string; label: string; items: Producto[] }[] {
  const g = new Map<string, Producto[]>();
  for (const p of lista) { const x = g.get(p.cat); if (x) x.push(p); else g.set(p.cat, [p]); }
  return [...g].map(([cat, items]) => ({ cat, label: catDe(cat).label, items })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

/** Filas del CSV de la lista filtrada completa (con la columna de cada vehículo) */
export function filasCsvInventario(E: Estado, lista: Producto[]): (string | number)[][] {
  const vs = E.vehiculos;
  return [
    ['SKU', 'Nombre', 'Categoría', 'Propiedad', 'Almacén', ...vs.map(v => `Vehículo ${nombreVehiculo(E, v.id)}`), 'En vehículos', 'Total', 'Unidad', 'Contenido', 'Unidad del contenido', 'Total en unidad del contenido', 'Mínimo almacén', 'Estado', 'Proveedor', 'Código proveedor', 'EAN'],
    ...lista.map(p => {
      const t = stockTotal(E, p);
      return [p.sku, p.name, catDe(p.cat).label, p.propiedad === 'custodia' ? `Custodia ${E.propietarios.find(o => o.id === p.propietario)?.nombre || ''}` : 'Propio',
        p.stock, ...vs.map(v => redondea(unidadesABordo(E, v.id, p.sku) / contenidoDe(p))), redondea(t - p.stock), t, UNIT[p.unit], p.contenido || 1, ucDe(p), redondea(t * contenidoDe(p)),
        p.minimoDefinido === false ? '' : p.min, { red: 'Crítico', amber: 'Bajo', green: 'Correcto' }[status(p)], p.supplier, p.supplierRef || '', p.ean || ''];
    }),
  ];
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Vista limpia para imprimir: código, descripción, categoría, almacén, cada vehículo y mínimo. Sin fotos. */
export function htmlImprimirInventario(E: Estado, lista: Producto[], titulo: string, filtros = ''): string {
  const vs = E.vehiculos.filter(v => lista.some(p => unidadesABordo(E, v.id, p.sku) !== 0));
  const n = (x: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 }).format(x);
  const filas = lista.map(p => `<tr><td class="m">${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(catDe(p.cat).label)}</td><td class="n">${n(p.stock)} ${esc(UNIT[p.unit])}</td>${vs.map(v => { const q = redondea(unidadesABordo(E, v.id, p.sku) / contenidoDe(p)); return `<td class="n">${q ? n(q) : ''}</td>`; }).join('')}<td class="n">${p.minimoDefinido === false ? '—' : n(p.min)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
body{font:12px/1.35 system-ui,sans-serif;margin:16px;color:#111}h1{font-size:17px;margin:0 0 2px}p{margin:0 0 10px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f1f3f8;font-size:11px;text-transform:uppercase}thead{display:table-header-group}tr{break-inside:avoid}.n{text-align:right;white-space:nowrap}.m{font-family:ui-monospace,monospace;white-space:nowrap}
</style></head><body><h1>${esc(titulo)}</h1><p>${lista.length} referencias${filtros ? ' · ' + esc(filtros) : ''} · ${esc(new Date().toLocaleString('es-ES'))}</p>
<table><thead><tr><th>Código</th><th>Descripción</th><th>Categoría</th><th class="n">Almacén</th>${vs.map(v => `<th class="n">${esc(nombreVehiculo(E, v.id))}</th>`).join('')}<th class="n">Mínimo</th></tr></thead><tbody>${filas}</tbody></table></body></html>`;
}
