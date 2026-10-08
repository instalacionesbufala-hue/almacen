/* E-041 · Devolución de material de una furgoneta al almacén (= registrar_devolucion / anular_devolucion del servidor): cantidades
   en la unidad base (30 m de un rollo de 100 m = 0,3 rollos al almacén), línea "bien" (vuelve al stock) o "defectuoso" (merma;
   en custodia, incidencia del socio), quién devuelve (técnico del equipo), firma y albarán DEV-AAAA-NNNN. */
import type { Devolucion, Estado } from '../data/tipos';
import { contenidoDe, find, unidadesABordo } from './reglas';
import { redondea, uid } from './formato';

export const MOTIVO_DEVOLUCION: Record<Devolucion['motivo'], string> = { sobrante: 'Sobrante de obra', no_usado: 'No usado', cambio: 'Cambio de material', otro: 'Otro' };
export type LineaDev = { sku: string; unidades: number; estado: 'bien' | 'defectuoso'; motivoDefecto?: string };
export type DatosDevolucion = { vehiculo: string; tecnico: string; motivo: Devolucion['motivo']; motivoTexto?: string; obra?: string; firma: string; lineas: LineaDev[] };

export const numDevolucion = (d: Pick<Devolucion, 'numero'>) => d.numero || 'Pendiente de envío';
/** Técnicos actuales del equipo de esa furgoneta (los que pueden devolver y firmar) */
export function tecnicosDeVehiculo(S: Estado, vehiculo: string) {
  const v = S.vehiculos.find(x => x.id === vehiculo), eq = v?.equipo ? S.equipos.find(e => e.id === v.equipo) : undefined;
  return (eq?.tecnicos || []).map(t => S.tecnicos.find(x => x.id === t)).filter((t): t is NonNullable<typeof t> => !!t);
}
/** Avisos de la cesta (no impiden devolver: lo que no consta a bordo deja la furgoneta en negativo) */
export function avisosDevolucion(S: Estado, vehiculo: string, lineas: LineaDev[]) {
  const total = new Map<string, number>();
  for (const l of lineas) total.set(l.sku, redondea((total.get(l.sku) || 0) + l.unidades));
  return [...total].filter(([sku, u]) => u > unidadesABordo(S, vehiculo, sku)).map(([sku]) => {
    const p = find(S, sku), hay = unidadesABordo(S, vehiculo, sku);
    return `${p?.name || sku}: ${hay > 0 ? 'se devuelve más de lo que consta a bordo' : 'no consta a bordo'}. La furgoneta quedará en negativo; se corrige con un recuento.`;
  });
}

export function comprobarDevolucion(S: Estado, d: DatosDevolucion): string | null {
  const v = S.vehiculos.find(x => x.id === d.vehiculo); if (!v) return 'Elige la furgoneta que devuelve el material';
  if (!tecnicosDeVehiculo(S, d.vehiculo).some(t => t.id === d.tecnico)) return `Quien devuelve tiene que ser un técnico del equipo de ${v.matricula}`;
  if (d.motivo === 'otro' && !d.motivoTexto?.trim()) return 'Explica el motivo de la devolución';
  if (!d.lineas.length) return 'Añade al menos un artículo';
  const vistos = new Set<string>();
  for (const l of d.lineas) {
    const p = find(S, l.sku); if (!p || p.borrador || p.archivado) return `Artículo no encontrado: ${l.sku}`;
    if (!(l.unidades > 0)) return `Indica la cantidad de ${p.name}`;
    if (l.estado === 'defectuoso' && !l.motivoDefecto?.trim()) return `Indica qué le pasa a ${p.name} (defectuoso)`;
    if (vistos.has(`${l.sku}|${l.estado}`)) return `${p.name} está dos veces en la devolución`;
    vistos.add(`${l.sku}|${l.estado}`);
  }
  if (!d.firma) return 'Falta la firma de quien devuelve';
  return null;
}

export function registrarDevolucionLocal(S: Estado, id: string, d: DatosDevolucion, operario: string): Devolucion {
  const ya = (S.devoluciones ||= []).find(x => x.id === id); if (ya) return ya;
  const err = comprobarDevolucion(S, d); if (err) throw new Error(err);
  const v = S.vehiculos.find(x => x.id === d.vehiculo)!, ts = Date.now();
  const dev: Devolucion = { id, numero: `DEV-${new Date(ts).getFullYear()}-${String(S.devoluciones.length + 1).padStart(4, '0')}`, ts, vehiculo: v.id, equipo: v.equipo, tecnico: d.tecnico,
    motivo: d.motivo, motivoTexto: d.motivoTexto?.trim() || '', obra: d.obra?.trim() || '', firma: d.firma, estado: 'firmada', operator: operario,
    lineas: d.lineas.map(l => { const p = find(S, l.sku)!; return { sku: p.sku, nombre: p.name, unidades: l.unidades, cantidad: redondea(l.unidades / contenidoDe(p)), estado: l.estado, ...(l.estado === 'defectuoso' ? { motivoDefecto: l.motivoDefecto!.trim() } : {}) }; }) };
  const ref = `${dev.numero}${dev.obra ? ` · ${dev.obra}` : ''}`;
  for (const l of dev.lineas) {
    const p = find(S, l.sku)!, b = S.aBordo.find(x => x.vehiculo === v.id && x.sku === l.sku);
    if (b) b.unidades = redondea(b.unidades - l.unidades); else S.aBordo.push({ vehiculo: v.id, sku: l.sku, unidades: -l.unidades });
    if (l.estado === 'bien') {
      p.stock = redondea(p.stock + l.cantidad);
      S.movements.unshift({ id: uid('M'), ts, sku: l.sku, type: 'devolucion', qty: l.cantidad, reason: 'Devolución al almacén', ref, operator: operario, serials: [], vehiculo: v.id, equipo: v.equipo, unidades: -l.unidades, devolucion: id });
    } else {
      S.movements.unshift({ id: uid('M'), ts, sku: l.sku, type: 'merma', qty: l.cantidad, reason: `Devuelto defectuoso: ${l.motivoDefecto}`, ref, operator: operario, serials: [], vehiculo: v.id, equipo: v.equipo, unidades: -l.unidades, devolucion: id });
    }
  }
  S.devoluciones.unshift(dev);
  return dev;
}

export function anularDevolucionLocal(S: Estado, id: string, motivo: string, operario: string) {
  if (S.rol !== 'admin') throw new Error('Solo el administrador anula una devolución');
  const d = (S.devoluciones || []).find(x => x.id === id); if (!d) throw new Error('Devolución no encontrada');
  if (d.estado === 'anulada') return;
  if (!motivo.trim()) throw new Error('Indica el motivo de la anulación');
  const movs = S.movements.filter(m => m.devolucion === id && !m.corrige);
  for (const m of movs) if (m.type === 'devolucion') { const p = find(S, m.sku)!; if (p.stock < m.qty) throw new Error(`Ya no quedan ${m.qty} de ${p.name} en el almacén para devolverlos a la furgoneta`); }
  const ts = Date.now();
  for (const m of movs) {
    if (m.type === 'devolucion') { const p = find(S, m.sku)!; p.stock = redondea(p.stock - m.qty); }
    const b = S.aBordo.find(x => x.vehiculo === m.vehiculo && x.sku === m.sku);
    if (b) b.unidades = redondea(b.unidades - (m.unidades || 0)); else S.aBordo.push({ vehiculo: m.vehiculo!, sku: m.sku, unidades: -(m.unidades || 0) });
    S.movements.unshift({ id: uid('M'), ts, sku: m.sku, type: m.type === 'devolucion' ? 'traspaso' : 'ajuste', qty: m.qty, reason: `Anulación de devolución ${d.numero}`, ref: motivo.trim(), operator: operario, serials: [],
      vehiculo: m.vehiculo, equipo: m.equipo, unidades: -(m.unidades || 0), corrige: m.id, devolucion: id });
  }
  Object.assign(d, { estado: 'anulada', anuladaTs: ts, anuladaPor: operario, anulacionMotivo: motivo.trim() });
}
