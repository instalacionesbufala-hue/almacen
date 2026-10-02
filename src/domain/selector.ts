/* E-024 · Orden de los selectores de artículos: por nombre (A-Z) por defecto o por referencia (SKU), y agrupado por categoría si se pide */
import type { Estado, Producto } from '../data/tipos';
import { searchProducts } from './reglas';
import { agruparPorCategoria } from './listaInventario';

export type OrdenSelector = 'nombre' | 'sku';
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });

export function ordenarArticulos<T extends Pick<Producto, 'sku' | 'name'>>(lista: T[], orden: OrdenSelector = 'nombre'): T[] {
  return [...lista].sort((a, b) => (orden === 'sku' ? cmp(a.sku, b.sku) || cmp(a.name, b.name) : cmp(a.name, b.name) || cmp(a.sku, b.sku)));
}

/** Artículos que ofrece un selector: busca por nombre, SKU, EAN, código del proveedor y códigos alternativos; sin borradores salvo que se pidan */
export function articulosParaSelector(E: Estado, q: string, o: { orden?: OrdenSelector; filtro?: (p: Producto) => boolean; borradores?: boolean } = {}): Producto[] {
  const base = searchProducts(E, q).filter(p => (o.borradores || !p.borrador) && (!o.filtro || o.filtro(p)));
  return ordenarArticulos(base, o.orden);
}

/** Igual, en grupos por categoría (cada grupo con el mismo orden) */
export const gruposParaSelector = (lista: Producto[]) => agruparPorCategoria(lista);
