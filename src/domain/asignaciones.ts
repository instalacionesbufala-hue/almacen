/* E-029 · Corregir la fecha de inicio de una asignación y desbloquear los cierres "Equipo sin vehículo"
   (lo mismo que editar_inicio_asignacion, reprocesar_cierres y usar_vehiculo_actual del servidor). */
import type { Asignacion, CierreApp, Estado } from '../data/tipos';
import { fechaHora, redondea } from './formato';
import { vehiculoDeEquipo } from './reglas';
import { sincronizarCierreLocal } from './cierres';

/** Identifica una asignación (las de la nube traen id; las de la demostración, no) */
export const claveAsignacion = (a: Asignacion) => a.id || `${a.tipo}:${a.sujeto}:${a.desde}`;
const nombreEquipo = (S: Estado, id: string) => S.equipos.find(e => e.id === id)?.nombre || id;
const quien = (S: Estado, a: Asignacion) => a.tipo === 'tecnico' ? (S.tecnicos.find(t => t.id === a.sujeto)?.nombre || a.sujeto) : (S.vehiculos.find(v => v.id === a.sujeto)?.matricula || a.sujeto);

/** null si se puede; si no, el motivo. Sin solapes: el mismo vehículo (o técnico) en otro tramo, o el mismo equipo con otro vehículo a la vez */
export function validarInicioAsignacion(S: Estado, a: Asignacion, desde: number, ahora = Date.now()): string | null {
  if (!Number.isFinite(desde)) return 'Falta la fecha de inicio';
  if (desde > ahora) return 'La fecha de inicio no puede ser futura';
  if (a.hasta !== undefined && desde > a.hasta) return `La fecha de inicio no puede ser posterior a la de fin (${fechaHora(a.hasta)})`;
  const fin = a.hasta ?? Infinity, k = claveAsignacion(a);
  const choque = S.asignaciones.filter(o => claveAsignacion(o) !== k && o.tipo === a.tipo && (o.sujeto === a.sujeto || (a.tipo === 'vehiculo' && o.equipo === a.equipo)))
    .filter(o => o.desde < fin && desde < (o.hasta ?? Infinity)).sort((x, y) => x.desde - y.desde)[0];
  return choque ? `Se solapa con otra asignación (${quien(S, choque)} en ${nombreEquipo(S, choque.equipo)} desde ${fechaHora(choque.desde)}): corrige esa primero` : null;
}

const equipoDeCierre = (S: Estado, c: CierreApp) => c.equipo || S.equipos.find(e => e.nombre.trim().toLowerCase() === c.equipoWizard.trim().toLowerCase())?.id;

/** Cierres "sin vehículo" de ese equipo cuya fecha cae en el tramo [desde, hasta) de la asignación de vehículo */
export function cierresAfectados(S: Estado, a: Asignacion, desde = a.desde): string[] {
  if (a.tipo !== 'vehiculo') return [];
  return S.cierres.filter(c => c.estado === 'sin_vehiculo' && equipoDeCierre(S, c) === a.equipo && c.fecha >= desde && (a.hasta === undefined || c.fecha < a.hasta))
    .sort((x, y) => x.fecha - y.fecha).map(c => c.id);
}

/** Cambia la fecha de inicio (validada) y devuelve los cierres afectados */
export function editarInicioAsignacionLocal(S: Estado, clave: string, desde: number): string[] {
  const a = S.asignaciones.find(x => claveAsignacion(x) === clave);
  if (!a) throw new Error('Asignación no encontrada');
  const motivo = validarInicioAsignacion(S, a, desde); if (motivo) throw new Error(motivo);
  a.desde = desde;
  return cierresAfectados(S, a);
}

const consumoDe = (S: Estado, id: string) => { const m = new Map<string, number>(); for (const x of S.movements) if (x.cierre === id) m.set(x.sku, redondea((m.get(x.sku) || 0) - (x.unidades || 0))); return m; };
/** Procesa un cierre con ese vehículo y deja una versión con quién lo hizo y lo que descontó (= _procesar_cierre_con_vehiculo) */
function procesarConVehiculo(S: Estado, c: CierreApp, vehiculo: string, documento: string) {
  const antes = consumoDe(S, c.id);
  c.vehiculo = vehiculo;
  sincronizarCierreLocal(S, c.id);
  const despues = consumoDe(S, c.id);
  const diferencia = [...new Set([...antes.keys(), ...despues.keys()])].sort().map(sku => ({ sku, unidades: redondea((despues.get(sku) || 0) - (antes.get(sku) || 0)) })).filter(d => d.unidades);
  c.version++;
  (c.versiones ||= []).push({ n: c.version, origen: 'admin', documento, recibido: Date.now(), diferencia });
}

export interface ResultadoReproceso { procesados: number; siguen: string[] }
/** Con el vehículo que tenía el equipo en la fecha de cada cierre (tras corregir el historial) */
export function reprocesarCierresLocal(S: Estado, ids: string[], operario: string): ResultadoReproceso {
  const r: ResultadoReproceso = { procesados: 0, siguen: [] };
  for (const c of S.cierres.filter(x => ids.includes(x.id) && x.estado === 'sin_vehiculo').sort((x, y) => x.fecha - y.fecha)) {
    const eq = equipoDeCierre(S, c), veh = eq ? vehiculoDeEquipo(S, eq, c.fecha) : undefined;
    if (!veh) { r.siguen.push(c.numInst); continue; }
    c.equipo = eq;
    procesarConVehiculo(S, c, veh, `Reprocesado por ${operario} con ${S.vehiculos.find(v => v.id === veh)?.matricula || veh} (historial de asignaciones)`);
    r.procesados++;
  }
  return r;
}
/** Atajo: el vehículo que el equipo tiene AHORA (no toca el historial de asignaciones) */
export function usarVehiculoActualLocal(S: Estado, ids: string[], operario: string): ResultadoReproceso {
  const r: ResultadoReproceso = { procesados: 0, siguen: [] };
  for (const c of S.cierres.filter(x => ids.includes(x.id) && x.estado === 'sin_vehiculo').sort((x, y) => x.fecha - y.fecha)) {
    const eq = equipoDeCierre(S, c), veh = eq ? S.vehiculos.find(v => v.equipo === eq) : undefined;
    if (!eq || !veh) { r.siguen.push(c.numInst); continue; }
    c.equipo = eq;
    procesarConVehiculo(S, c, veh.id, `Vehículo asignado a mano por ${operario}: ${veh.matricula} (el que el equipo tiene ahora)`);
    r.procesados++;
  }
  return r;
}
/** Vehículo que el equipo de ese cierre tiene ahora (para el texto del botón) */
export const vehiculoActualDeCierre = (S: Estado, c: CierreApp) => { const eq = equipoDeCierre(S, c); return eq ? S.vehiculos.find(v => v.equipo === eq) : undefined; };
/** Vehículo que el historial da al equipo de ese cierre en su fecha (si no hay, "Reprocesar" no lo desbloquea) */
export const vehiculoHistorialDeCierre = (S: Estado, c: CierreApp) => { const eq = equipoDeCierre(S, c); return eq ? vehiculoDeEquipo(S, eq, c.fecha) : undefined; };
