/* E-031 · Formatos en metros (rollo, bobina, barra; también caja y pack de 305 m): textos con su equivalencia, recuento
   mixto ("2 rollos y 15 m") y conversión del stock al cambiar el formato (= cambiar_formato del servidor). */
import type { Estado, Producto, Unidad } from '../data/tipos';
import { UNIT } from '../data/catalogo';
import { num, redondea } from './formato';
import { contenidoDe, unidadTxt } from './reglas';

type P = Pick<Producto, 'unit' | 'contenido' | 'unidadContenido'>;
/** Unidad en la que va el contenido: m (rollo de 50 m) o ud (bote de 1000 ud) */
export const ucDe = (p: P): 'm' | 'ud' => p.unit === 'm' ? 'm' : p.unit === 'ud' ? 'ud' : p.unidadContenido === 'm' ? 'm' : 'ud';
/** Formatos con contenido en metros: se cuentan también en metros y pueden quedar empezados */
export const enMetros = (p: P) => ucDe(p) === 'm' && p.unit !== 'm' && contenidoDe(p) > 1;
/** "150 m" (lo que son esos formatos en la unidad del contenido), vacío si el formato es la propia unidad */
export const equivTxt = (p: P, formatos: number) => contenidoDe(p) > 1 && p.unit !== 'm' && p.unit !== 'ud' ? `${num(redondea(formatos * contenidoDe(p)))} ${ucDe(p)}` : '';
/** "3 rollos (150 m)" a partir de formatos */
export const cantTxt = (p: P, formatos: number) => { const q = redondea(formatos), e = equivTxt(p, q); return `${num(q)} ${unidadTxt(p.unit, q)}${e ? ` (${e})` : ''}`; };
/** "2,64 rollos (132 m)" a partir de unidades de contenido (lo que guarda un vehículo) */
export const cantVehiculoTxt = (p: P, unidades: number) => cantTxt(p, unidades / contenidoDe(p));
/** Recuento mixto: formatos enteros + sueltos en la unidad del contenido → formatos ("2 rollos y 15 m" = 2,3) */
export const deMixto = (p: P, formatos: number, sueltos: number) => redondea((formatos || 0) + (sueltos || 0) / contenidoDe(p));

/* ---------- Cambiar el formato ---------- */
export type ModoConversion = 'contenido' | 'formato';
export interface NuevoFormato { unit: Unidad; contenido: number; unidadContenido: 'm' | 'ud' }
export const normalizarFormato = (f: NuevoFormato): NuevoFormato => f.unit === 'm' || f.unit === 'ud' ? { unit: f.unit, contenido: 1, unidadContenido: f.unit } : f;
export const cambiaFormato = (p: P, f: NuevoFormato) => { const n = normalizarFormato(f); return p.unit !== n.unit || contenidoDe(p) !== n.contenido || ucDe(p) !== n.unidadContenido; };
export const formatoTxt = (f: Pick<NuevoFormato, 'unit' | 'contenido'> & { unidadContenido?: 'm' | 'ud' }) => f.unit === 'm' ? 'metros' : f.unit === 'ud' ? 'unidades' : `${UNIT[f.unit]} de ${num(f.contenido)} ${f.unidadContenido || 'ud'}`;

/** Qué quedaría en el almacén y en cada vehículo con cada modo (para la pregunta antes de guardar) */
export function previsionConversion(S: Pick<Estado, 'aBordo'>, p: Producto, f: NuevoFormato, modo: ModoConversion) {
  const n = normalizarFormato(f), c0 = contenidoDe(p);
  const stock = modo === 'contenido' ? redondea(p.stock * c0 / n.contenido) : p.stock;
  const vehiculos = S.aBordo.filter(b => b.sku === p.sku && b.unidades !== 0).map(b => {
    const despues = modo === 'contenido' ? b.unidades : redondea(b.unidades * n.contenido / c0);
    return { vehiculo: b.vehiculo, antes: b.unidades, despues, formatos: redondea(despues / n.contenido) };
  });
  return { stock, vehiculos };
}

/** Aplica el cambio en el estado local: misma conversión, ajuste de conversión enlazado (sin cambio físico) */
export function cambiarFormatoLocal(S: Estado, sku: string, f: NuevoFormato, modo: ModoConversion, operario: string) {
  const p = S.products.find(x => x.sku === sku); if (!p) throw new Error(`Producto no encontrado: ${sku}`);
  const n = normalizarFormato(f);
  if (!(n.contenido > 0)) throw new Error(`Indica cuánto trae cada ${UNIT[n.unit]}`);
  if (!cambiaFormato(p, n)) return;
  if (S.entregas.some(e => e.estado === 'preparada' && e.lineas.some(l => l.sku === p.sku))) throw new Error(`Hay entregas preparadas con ${p.name} sin firmar: fírmalas o anúlalas antes de cambiar el formato`);
  const antesTxt = formatoTxt({ unit: p.unit, contenido: contenidoDe(p), unidadContenido: ucDe(p) }), despuesTxt = formatoTxt(n), c0 = contenidoDe(p);
  const prev = previsionConversion(S, p, n, modo), ts = Date.now();
  if (modo === 'contenido') {
    const d = redondea(prev.stock - p.stock);
    if (d) S.movements.unshift({ id: `M${ts.toString(36)}`, ts, sku: p.sku, type: 'ajuste', qty: d, serials: [], reason: 'Conversión de formato', ref: `${num(p.stock)} ${antesTxt} → ${num(prev.stock)} ${despuesTxt} (sin cambio físico)`, operator: operario });
    p.stock = prev.stock; p.min = redondea(p.min * c0 / n.contenido);
    if (p.objetivo != null) p.objetivo = redondea(p.objetivo * c0 / n.contenido);
  } else {
    for (const v of prev.vehiculos) {
      const b = S.aBordo.find(x => x.vehiculo === v.vehiculo && x.sku === p.sku)!, d = redondea(v.despues - v.antes); if (!d) continue;
      b.unidades = v.despues;
      S.movements.unshift({ id: `M${ts.toString(36)}${v.vehiculo}`, ts, sku: p.sku, type: 'ajuste', qty: redondea(d / n.contenido) || Math.sign(d) * 0.001, serials: [], reason: 'Conversión de formato',
        ref: `${num(v.antes)} ${ucDe(p)} → ${despuesTxt} (sin cambio físico)`, operator: operario, vehiculo: v.vehiculo, unidades: d });
    }
  }
  Object.assign(p, { unit: n.unit, contenido: n.contenido, unidadContenido: n.unidadContenido, metrosSueltos: !!p.metrosSueltos && n.unidadContenido === 'm' });
}
