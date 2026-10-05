/* E-018 · Ajuste de inventario (solo el administrador; el almacén lo propone) y aviso de código ya ingresado por albarán */
import type { Estado } from '../data/tipos';
import { redondea } from './formato';
import { applyMovement, contenidoDe, find, formatoEntero, unidadesABordo } from './reglas';

export interface AjusteInput { sku: string; qty: number; motivo: string; vehiculo?: string }

/** "De X a Y" en la ubicación elegida (almacén o vehículo, en formatos). Lanza Error si el ajuste no es válido. Misma regla que el servidor. */
export function previsionAjuste(S: Estado, a: AjusteInput): { de: number; a: number } {
  const p = find(S, a.sku); if (!p) throw new Error('Producto no encontrado');
  if (p.borrador) throw new Error(`${p.name} está en borrador: el administrador debe completarla antes de moverla`);
  if (!a.qty) throw new Error('Indica una cantidad distinta de cero');
  if (!a.motivo.trim()) throw new Error('Indica el motivo del ajuste');
  let de: number;
  if (a.vehiculo) {
    if (!S.vehiculos.some(v => v.id === a.vehiculo)) throw new Error('Vehículo no encontrado');
    de = redondea(unidadesABordo(S, a.vehiculo, p.sku) / contenidoDe(p));
  } else {
    // E-031: un formato en metros puede quedar empezado (un rollo abierto): el ajuste admite decimales
    if (formatoEntero(p) && p.unidadContenido !== 'm' && a.qty !== Math.trunc(a.qty)) throw new Error(`En el almacén ${p.name} se mueve por ${p.unit} entero: indica un número sin decimales`);
    de = p.stock;
  }
  const hasta = redondea(de + a.qty);
  if (hasta < 0) throw new Error(`No se puede dejar en negativo: ${a.vehiculo ? 'el vehículo' : 'el almacén'} tiene ${de}`);
  return { de, a: hasta };
}

/** Aplica el ajuste del administrador: movimiento de tipo "ajuste" con el motivo (no es merma, ni salida, ni consumo) */
export function ajustarLocal(S: Estado, a: AjusteInput & { id?: string }) {
  if (S.rol !== 'admin') throw new Error('Solo el administrador puede hacer ajustes de inventario');
  const r = previsionAjuste(S, a);
  applyMovement(S, { id: a.id, sku: a.sku, type: 'ajuste', qty: a.qty, reason: a.motivo.trim(), ref: 'Ajuste de inventario', vehiculo: a.vehiculo });
  return r;
}

const limpio = (c: string) => String(c || '').replace(/\s/g, '').toUpperCase();

/** Albaranes ingresados en los que aparece ese código: impreso en una línea, o como artículo de una entrada */
export function albaranesConCodigo(S: Estado, codigo: string): string[] {
  const c = limpio(codigo); if (!c) return [];
  const ids = new Set(S.movements.filter(m => m.type === 'entrada' && m.albaran && m.sku === c).map(m => m.albaran!));
  return S.albaranes.filter(al => (al.id && ids.has(al.id)) || (al.codigos || []).some(x => limpio(x) === c)).map(al => al.numero);
}

/** Aviso al crear un artículo con stock inicial cuyo código ya ha entrado por un albarán (null si no hace falta) */
export function avisoStockInicial(S: Estado, codigo: string, stockInicial: number): string | null {
  if (!(stockInicial > 0)) return null;
  const nums = albaranesConCodigo(S, codigo);
  return nums.length ? `Ese código ya ha entrado por el albarán ${nums.join(', ')}; ¿seguro que quieres añadir stock inicial?` : null;
}
