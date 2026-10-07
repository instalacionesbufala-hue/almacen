/* E-038 · Retirada de material en custodia por el socio (o un tercero en su nombre), = registrar_retirada / anular_retirada del
   servidor: solo artículos en custodia de ese socio, sin pasar del stock (ni de lo reservado), del almacén o de un vehículo,
   con firma y número RET-AAAA-NNNN. Una retirada mal hecha se anula con movimientos inversos enlazados. */
import type { Estado, Retirada } from '../data/tipos';
import { contenidoDe, esCustodia, find, formatoEntero, nombreVehiculo, qtyTxt, reservado, unidadesABordo } from './reglas';
import { redondea, uid } from './formato';

export const MOTIVO_RETIRADA: Record<Retirada['motivo'], string> = { devolucion: 'Devolución al socio', traslado: 'Traslado a otro instalador', garantia: 'Garantía o RMA', otro: 'Otro' };
export type DatosRetirada = Omit<Retirada, 'id' | 'numero' | 'ts' | 'lineas' | 'hash' | 'estado' | 'operator' | 'anuladaTs' | 'anuladaPor' | 'anulacionMotivo'> & { lineas: { sku: string; cantidad: number }[] };

export const numRetirada = (r: Pick<Retirada, 'numero' | 'id'>) => r.numero || 'Pendiente de envío';
/** Lo que se puede retirar ahora de ese artículo (en formatos) desde el almacén o un vehículo */
export function disponibleRetirada(S: Estado, sku: string, vehiculo?: string) {
  const p = find(S, sku); if (!p) return 0;
  return vehiculo ? redondea(unidadesABordo(S, vehiculo, sku) / contenidoDe(p)) : redondea(p.stock - reservado(S, sku));
}
/** Avisos de la cesta (vacío = se puede firmar) */
export function comprobarRetirada(S: Estado, d: Pick<DatosRetirada, 'socio' | 'vehiculo' | 'lineas'>): string[] {
  const out: string[] = [], socio = S.propietarios.find(o => o.id === d.socio);
  if (!socio) return ['Elige el socio que retira el material'];
  if (!d.lineas.length) out.push('Añade al menos un artículo');
  for (const l of d.lineas) {
    const p = find(S, l.sku);
    if (!p || p.borrador || p.archivado) { out.push(`Artículo no encontrado: ${l.sku}`); continue; }
    if (!esCustodia(p) || p.propietario !== d.socio) { out.push(`${p.name} no es material en custodia de ${socio.nombre}: solo se retira lo suyo`); continue; }
    if (!(l.cantidad > 0)) { out.push(`Indica la cantidad de ${p.name}`); continue; }
    if (!d.vehiculo && formatoEntero(p) && l.cantidad !== Math.trunc(l.cantidad)) out.push(`En el almacén ${p.name} se mueve por formato entero`);
    const disp = disponibleRetirada(S, l.sku, d.vehiculo);
    if (l.cantidad > disp) out.push(`Solo hay ${qtyTxt(p, Math.max(0, disp))} de ${p.name} ${d.vehiculo ? `en ${nombreVehiculo(S, d.vehiculo)}` : 'disponibles en el almacén'}`);
  }
  return out;
}

export function registrarRetiradaLocal(S: Estado, id: string, d: DatosRetirada, operario: string): Retirada {
  const ya = (S.retiradas ||= []).find(r => r.id === id); if (ya) return ya;
  const errores = comprobarRetirada(S, d);
  if (!d.recoge.trim()) errores.push('Indica quién recoge el material');
  if (d.enNombre === 'tercero' && !d.tercero?.trim()) errores.push('Indica el tercero autorizado en cuyo nombre se recoge');
  if (d.motivo === 'otro' && !d.motivoTexto?.trim()) errores.push('Explica el motivo de la retirada');
  if (!d.firma) errores.push('Falta la firma de quien recoge');
  if (errores.length) throw new Error(errores[0]);
  const ts = Date.now(), n = S.retiradas.length + 1;
  const r: Retirada = { ...d, id, numero: `RET-${new Date(ts).getFullYear()}-${String(n).padStart(4, '0')}`, ts, estado: 'firmada', operator: operario,
    lineas: d.lineas.map(l => { const p = find(S, l.sku)!; return { sku: p.sku, nombre: p.name, cantidad: l.cantidad, unidades: redondea(l.cantidad * contenidoDe(p)) }; }) };
  for (const l of r.lineas) {
    const p = find(S, l.sku)!;
    if (r.vehiculo) {
      const b = S.aBordo.find(x => x.vehiculo === r.vehiculo && x.sku === l.sku)!; b.unidades = redondea(b.unidades - l.unidades);
      S.movements.unshift({ id: uid('M'), ts, sku: l.sku, type: 'consumo', qty: l.cantidad, reason: 'Retirada por el socio', ref: r.numero!, operator: operario, serials: [], vehiculo: r.vehiculo, unidades: -l.unidades, retirada: id,
        equipo: S.vehiculos.find(v => v.id === r.vehiculo)?.equipo });
    } else {
      p.stock = redondea(p.stock - l.cantidad);
      S.movements.unshift({ id: uid('M'), ts, sku: l.sku, type: 'salida', qty: l.cantidad, reason: 'Retirada por el socio', ref: r.numero!, operator: operario, serials: [], retirada: id });
    }
  }
  S.retiradas.unshift(r);
  return r;
}

export function anularRetiradaLocal(S: Estado, id: string, motivo: string, operario: string) {
  if (S.rol !== 'admin') throw new Error('Solo el administrador anula una retirada');
  const r = (S.retiradas || []).find(x => x.id === id); if (!r) throw new Error('Retirada no encontrada');
  if (r.estado === 'anulada') return;
  if (!motivo.trim()) throw new Error('Indica el motivo de la anulación');
  const ts = Date.now();
  for (const m of S.movements.filter(x => x.retirada === id && !x.corrige)) {
    if (m.vehiculo) {
      const b = S.aBordo.find(x => x.vehiculo === m.vehiculo && x.sku === m.sku);
      if (b) b.unidades = redondea(b.unidades - (m.unidades || 0)); else S.aBordo.push({ vehiculo: m.vehiculo, sku: m.sku, unidades: -(m.unidades || 0) });
      S.movements.unshift({ id: uid('M'), ts, sku: m.sku, type: 'ajuste', qty: m.qty, reason: `Anulación de retirada ${r.numero}`, ref: motivo.trim(), operator: operario, serials: [], vehiculo: m.vehiculo, unidades: -(m.unidades || 0), corrige: m.id, retirada: id, equipo: m.equipo });
    } else {
      const p = find(S, m.sku)!; p.stock = redondea(p.stock + m.qty);
      S.movements.unshift({ id: uid('M'), ts, sku: m.sku, type: 'entrada', qty: m.qty, reason: `Anulación de retirada ${r.numero}`, ref: motivo.trim(), operator: operario, serials: [], corrige: m.id, retirada: id });
    }
  }
  Object.assign(r, { estado: 'anulada', anuladaTs: ts, anuladaPor: operario, anulacionMotivo: motivo.trim() });
}
