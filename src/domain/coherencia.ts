/* E-036 · Comprobación de formatos: artículos cuya unidad, contenido y stock no cuadran. Solo avisa; los arreglos los propone
   (un ajuste que el administrador confirma) y nunca los aplica solos.
   Caso real (RZ1-K 3G10, 6040615310): de "rollo de 100 m" se volvió a "metros" eligiendo "el stock ya está en metros" (se
   conservan los formatos): las furgonetas, que guardan metros, se dividieron entre 100 (80 m → 0,8 m; 131 m → 1,31 m). */
import type { Estado, Producto } from '../data/tipos';
import { UNIT } from '../data/catalogo';
import { fechaHora, num, redondea } from './formato';
import { contenidoDe, find, formatoEntero, nombreVehiculo } from './reglas';
import { ucDe } from './formatos';

export type TipoIncoherencia = 'conversion' | 'fraccion_almacen' | 'contenido_en_base' | 'formato_sin_contenido' | 'diminuto_a_bordo';
export interface Incoherencia {
  sku: string; nombre: string; tipo: TipoIncoherencia; texto: string;
  /** Ajuste propuesto en un vehículo (en unidades de contenido): el administrador lo confirma */
  arreglo?: { vehiculo: string; unidades: number; motivo: string };
}
export const MOTIVO_CORRECCION = 'Corrección de conversión de formato';

/** "131", "1.234,5" (servidor o app) → número */
const leeNum = (s: string) => Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);

/** Las conversiones de formato que multiplicaron o dividieron por 10 o más lo que llevaba una furgoneta, sin corregir después */
function conversionesSospechosas(S: Estado): Incoherencia[] {
  const out: Incoherencia[] = [];
  for (const m of S.movements) {
    if (m.reason !== 'Conversión de formato' || !m.vehiculo || !m.unidades) continue;
    const x = /(-?[\d.,]+) (m|ud) →/.exec(m.ref || ''); if (!x) continue;
    const antes = leeNum(x[1]), despues = redondea(antes + m.unidades);
    if (!(antes > 0) || (despues > antes / 10 && despues < antes * 10)) continue;
    const corregida = S.movements.some(c => c.ts >= m.ts && c.sku === m.sku && c.vehiculo === m.vehiculo && (c.reason || '').startsWith(MOTIVO_CORRECCION) && Math.abs(redondea((c.unidades ?? 0) + m.unidades!)) < 0.01);
    if (corregida) continue;
    const p = find(S, m.sku); if (!p) continue;
    const u = x[2], veh = nombreVehiculo(S, m.vehiculo);
    out.push({ sku: p.sku, nombre: p.name, tipo: 'conversion',
      texto: `${veh}: el cambio de formato del ${fechaHora(m.ts)} dejó ${num(antes)} ${u} en ${num(despues)} ${u}. Se eligió que el stock ya estaba en el formato nuevo, y lo que llevaba la furgoneta (que va en ${u}) se reescaló. Lo normal es que siga llevando ${num(antes)} ${u}.`,
      arreglo: { vehiculo: m.vehiculo, unidades: redondea(-m.unidades), motivo: `${MOTIVO_CORRECCION} del ${fechaHora(m.ts)} (${num(antes)} ${u} → ${num(despues)} ${u})` } });
  }
  return out;
}

export function incoherenciasFormato(S: Estado): Incoherencia[] {
  const out = conversionesSospechosas(S), conAviso = new Set(out.map(i => `${i.sku}|${i.arreglo?.vehiculo}`));
  for (const p of S.products as Producto[]) {
    if (p.borrador) continue;
    const c = contenidoDe(p), base = p.unit === 'm' || p.unit === 'ud';
    if (base && c !== 1) out.push({ sku: p.sku, nombre: p.name, tipo: 'contenido_en_base', texto: `Va en ${p.unit === 'm' ? 'metros' : 'unidades'}, pero dice que cada uno trae ${num(c)}: revisa el formato (¿es un ${p.unit === 'm' ? 'rollo' : 'bote o caja'} de ${num(c)}?).` });
    if (!base && c <= 1) out.push({ sku: p.sku, nombre: p.name, tipo: 'formato_sin_contenido', texto: `Se mueve por ${UNIT[p.unit]}, pero no dice cuánto trae cada ${UNIT[p.unit]}: en los cierres, 1 ${ucDe(p)} contaría como 1 ${UNIT[p.unit]}.` });
    if (formatoEntero(p) && redondea(p.stock) !== Math.trunc(redondea(p.stock)))
      out.push({ sku: p.sku, nombre: p.name, tipo: 'fraccion_almacen', texto: `El almacén tiene ${num(p.stock)} ${UNIT[p.unit]}s, pero se mueven ${UNIT[p.unit]}s enteros: haz un recuento.` });
    if (ucDe(p) === 'm') for (const b of S.aBordo) if (b.sku === p.sku && b.unidades && Math.abs(b.unidades) < 1 && !conAviso.has(`${p.sku}|${b.vehiculo}`))
      out.push({ sku: p.sku, nombre: p.name, tipo: 'diminuto_a_bordo', texto: `${nombreVehiculo(S, b.vehiculo)} lleva ${num(b.unidades)} m: ¿son de verdad ${num(b.unidades)} m o una conversión mal hecha? Revísalo con un recuento.` });
  }
  return out;
}
