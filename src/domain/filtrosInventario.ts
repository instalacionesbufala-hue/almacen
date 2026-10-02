/* E-024 · Filtros del inventario: lo que aplica cada recuadro (KPI) de arriba y los chips del filtro activo.
   Un recuadro limpia los demás filtros (categoría, texto, ubicación, propiedad) y aplica solo el suyo. */
import type { Estado } from '../data/tipos';
import { catDe } from '../data/catalogo';
import { nombreVehiculo } from './reglas';

const TXT_EST: Record<string, string> = { red: 'Stock crítico', amber: 'Stock bajo', green: 'En stock' };

export interface FiltrosInv { q: string; cat: string; est: string; prop: string; ubi: string }
export const SIN_FILTROS: FiltrosInv = { q: '', cat: 'all', est: 'all', prop: 'all', ubi: 'all' };

/** Estado "sin mínimo": artículos a los que aún no se les ha puesto mínimo */
export const EST_SIN_MINIMO = 'sinmin';
/** Propiedad de un socio concreto: "custodia:<id>" */
export const propDeSocio = (id: string) => `custodia:${id}`;
export const socioDeProp = (prop: string) => (prop.startsWith('custodia:') ? prop.slice(9) : null);

export type Recuadro = { k: 'sinmin' } | { k: 'bajo' } | { k: 'custodia'; socio?: string };
/** Lo que deja el recuadro: todos los filtros limpios menos el suyo */
export function filtroDeRecuadro(r: Recuadro): FiltrosInv {
  if (r.k === 'sinmin') return { ...SIN_FILTROS, est: EST_SIN_MINIMO };
  if (r.k === 'bajo') return { ...SIN_FILTROS, est: 'red' };
  return { ...SIN_FILTROS, prop: r.socio ? propDeSocio(r.socio) : 'custodia' };
}

export const textoEstado = (est: string) => (est === EST_SIN_MINIMO ? 'Sin mínimo' : TXT_EST[est] || est);
export function textoPropiedad(E: Pick<Estado, 'propietarios'>, prop: string) {
  if (prop === 'propia') return 'Material propio';
  const s = socioDeProp(prop);
  if (s) return `Custodia ${E.propietarios.find(o => o.id === s)?.nombre || s}`;
  return 'En custodia';
}

/** Un chip por filtro activo, con lo que hay que poner para quitarlo */
export function chipsFiltros(E: Estado, f: FiltrosInv): { clave: keyof FiltrosInv; texto: string; quitar: Partial<FiltrosInv> }[] {
  const r: { clave: keyof FiltrosInv; texto: string; quitar: Partial<FiltrosInv> }[] = [];
  if (f.q.trim()) r.push({ clave: 'q', texto: `“${f.q.trim()}”`, quitar: { q: '' } });
  if (f.est !== 'all') r.push({ clave: 'est', texto: textoEstado(f.est), quitar: { est: 'all' } });
  if (f.prop !== 'all') r.push({ clave: 'prop', texto: textoPropiedad(E, f.prop), quitar: { prop: 'all' } });
  if (f.cat !== 'all') r.push({ clave: 'cat', texto: catDe(f.cat).label || f.cat, quitar: { cat: 'all' } });
  if (f.ubi !== 'all') r.push({ clave: 'ubi', texto: f.ubi === 'almacen' ? 'En el almacén' : nombreVehiculo(E, f.ubi), quitar: { ubi: 'all' } });
  return r;
}
