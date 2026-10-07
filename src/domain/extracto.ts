/* E-037 · Extracto de un artículo en una furgoneta: todos sus movimientos, del más antiguo al más reciente, con el saldo
   acumulado, el resumen y la comprobación "saldo calculado = stock mostrado". En la nube lo calcula extracto_vehiculo()
   (paginado); en modo local, extractoLocal() con el mismo resultado. */
import type { Estado } from '../data/tipos';
import { consumoPorPieza, find } from './reglas';
import { redondea } from './formato';

export type TipoExtracto = 'entrega' | 'cierre' | 'correccion_cierre' | 'ajuste' | 'recuento' | 'conversion' | 'devolucion' | 'merma' | 'retirada' | 'otro';
export type FiltroTipo = '' | 'entregas' | 'cierres' | 'ajustes';
export const TIPO_EXTRACTO: Record<TipoExtracto, string> = {
  entrega: 'Entrega', cierre: 'Consumo de cierre', correccion_cierre: 'Corrección de cierre', ajuste: 'Ajuste', recuento: 'Recuento',
  conversion: 'Conversión de formato', devolucion: 'Devolución', merma: 'Merma', retirada: 'Retirada por el socio', otro: 'Movimiento',
};
const GRUPO: Record<Exclude<FiltroTipo, ''>, TipoExtracto[]> = { entregas: ['entrega', 'devolucion', 'retirada'], cierres: ['cierre', 'correccion_cierre'], ajustes: ['ajuste', 'recuento', 'conversion', 'merma'] };

export interface FilaExtracto {
  id: string; ts: number; tipo: TipoExtracto; motivo: string; referencia: string;
  /** Efecto en la furgoneta, en unidades de contenido (m o ud), con signo */
  unidades: number; saldo: number; quien: string;
  entrega?: { id: string; numero: string; firmo: string };
  cierre?: { id: string; numInst: string; cliente: string; version: number | null; origen: string; documento: string };
  /** Por pieza entera (E-036): lo que pedía el cierre y lo que se descontó */
  pieza?: { real: number; consumo: number };
  recuento?: { constaba: number; contado: number };
}
export interface Extracto {
  saldoInicial: number; filas: FilaExtracto[]; total: number; saldoFinal: number;
  /** Stock a bordo que muestra la app, y el saldo de TODO el historial: deben coincidir */
  stock: number; saldoCalculado: number;
  resumen: { entregado: number; consumido: number; ajustes: number; otros: number };
}
export interface FiltrosExtracto { desde?: number | null; hasta?: number | null; tipo?: FiltroTipo; limite?: number; offset?: number }

/** Mismo criterio que el servidor */
export function clasificar(m: { type: string; reason: string; entrega?: string; cierre?: string }): TipoExtracto {
  if (m.reason === 'Retirada por el socio' || m.reason?.startsWith('Anulación de retirada')) return 'retirada';
  if (m.cierre) return m.reason === 'Consumo en obra' ? 'cierre' : 'correccion_cierre';
  if (m.entrega || m.type === 'traspaso') return 'entrega';
  if (m.reason === 'Recuento de vehículo') return 'recuento';
  if (m.reason === 'Conversión de formato' || m.reason?.startsWith('Corrección de conversión')) return 'conversion';
  if (m.type === 'devolucion') return 'devolucion';
  if (m.type === 'merma') return 'merma';
  if (m.type === 'ajuste') return 'ajuste';
  return 'otro';
}
export const enGrupo = (t: TipoExtracto, f?: FiltroTipo) => !f || GRUPO[f].includes(t);

export function extractoLocal(S: Estado, vehiculo: string, sku: string, f: FiltrosExtracto = {}, socio = false): Extracto {
  const p = find(S, sku);
  // los movimientos van del más reciente al más antiguo: a igual hora, manda ese orden
  const pos = new Map(S.movements.map((m, i) => [m, i]));
  const movs = S.movements.filter(m => m.vehiculo === vehiculo && m.sku === sku && m.unidades != null).sort((a, b) => a.ts - b.ts || pos.get(b)! - pos.get(a)!);
  let saldo = 0, saldoInicial = 0;
  const todas: FilaExtracto[] = [];
  for (const m of movs) {
    saldo = redondea(saldo + m.unidades!);
    if (f.desde != null && m.ts < f.desde) { saldoInicial = saldo; continue; }
    if (f.hasta != null && m.ts > f.hasta) continue;
    const tipo = clasificar(m);
    const fila: FilaExtracto = { id: m.id, ts: m.ts, tipo, motivo: m.reason, referencia: m.ref, unidades: m.unidades!, saldo, quien: socio ? (tipo === 'entrega' ? 'Técnico del equipo' : 'Búfala') : m.operator };
    const e = tipo === 'entrega' ? S.entregas.find(x => x.id === m.entrega || (x.numero && (x.numero === m.entrega || x.numero === m.ref)) || x.id === m.ref) : undefined;
    if (e || m.entrega) {
      const firmo = socio ? 'Técnico del equipo' : S.tecnicos.find(t => t.id === e?.receptor)?.nombre || '';
      fila.entrega = { id: e?.id || m.entrega!, numero: e?.numero || e?.id || m.entrega!, firmo };
      if (!socio && firmo) fila.quien = firmo;
    }
    if (m.cierre) {
      const c = S.cierres.find(x => x.id === m.cierre);
      const v = [...(c?.versiones || [])].filter(x => x.recibido <= m.ts + 5000).sort((a, b) => b.n - a.n)[0];
      fila.cierre = { id: m.cierre, numInst: c?.numInst || '', cliente: c?.cliente || '', version: v?.n ?? null, origen: v?.origen || c?.origen || '', documento: v?.documento || '' };
      if (tipo === 'cierre' && p?.piezaEntera) {
        const real = redondea(S.lineasCierre.filter(l => l.cierre === m.cierre && l.sku === sku && ['aplicada', 'discrepancia', 'resuelta'].includes(l.estado)).reduce((a, l) => a + l.cantidad, 0));
        const consumo = consumoPorPieza(p, real);
        if (real && consumo !== real) fila.pieza = { real, consumo };
      }
    }
    if (tipo === 'recuento') fila.recuento = { constaba: redondea(saldo - m.unidades!), contado: saldo };
    todas.push(fila);
  }
  const filtradas = todas.filter(x => enGrupo(x.tipo, f.tipo));
  const sum = (ts: TipoExtracto[]) => redondea(todas.filter(x => ts.includes(x.tipo)).reduce((a, x) => a + x.unidades, 0));
  const off = f.offset || 0, lim = f.limite || 200;
  return {
    saldoInicial, filas: filtradas.slice(off, off + lim), total: filtradas.length, saldoFinal: todas.length ? todas[todas.length - 1].saldo : saldoInicial,
    stock: S.aBordo.find(b => b.vehiculo === vehiculo && b.sku === sku)?.unidades ?? 0, saldoCalculado: saldo,
    resumen: { entregado: sum(['entrega']), consumido: sum(['cierre', 'correccion_cierre']), ajustes: sum(['ajuste', 'recuento', 'conversion', 'merma']), otros: sum(['devolucion', 'retirada', 'otro']) },
  };
}

/** E-037 · Furgonetas cuyo stock a bordo no coincide con la suma de sus movimientos (en modo local; en la nube, descuadres_a_bordo()) */
export function descuadresLocal(S: Estado): { vehiculo: string; sku: string; stock: number; calculado: number }[] {
  const suma = new Map<string, number>();
  for (const m of S.movements) if (m.vehiculo && m.unidades != null) suma.set(`${m.vehiculo}|${m.sku}`, redondea((suma.get(`${m.vehiculo}|${m.sku}`) || 0) + m.unidades));
  const out: { vehiculo: string; sku: string; stock: number; calculado: number }[] = [];
  const claves = new Set([...suma.keys(), ...S.aBordo.map(b => `${b.vehiculo}|${b.sku}`)]);
  for (const k of claves) {
    const [vehiculo, sku] = k.split('|'), stock = S.aBordo.find(b => b.vehiculo === vehiculo && b.sku === sku)?.unidades ?? 0, calculado = suma.get(k) ?? 0;
    if (Math.abs(stock - calculado) > 0.001) out.push({ vehiculo, sku, stock, calculado });
  }
  return out;
}
