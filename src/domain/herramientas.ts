/* Reglas de la dotación (herramientas, EPIs y ropa): estados, incidencias, caducidades y asignación a equipo y/o técnico */
import type { ClaseDotacion, Estado, EstadoHerramienta, Herramienta, IncidenciaHerramienta, TipoIncidencia } from '../data/tipos';
import { uid } from './formato';

export const ESTADO_HERR: Record<EstadoHerramienta, { t: string; c: string }> = {
  operativa: { t: 'Operativa', c: 'bg-tertiary-fixed/30 text-tertiary' },
  deteriorada: { t: 'Deteriorada', c: 'bg-amber-100 text-amber-800' },
  rota: { t: 'Rota', c: 'bg-error-container text-error' },
  perdida: { t: 'Perdida', c: 'bg-error-container text-error' },
  baja: { t: 'De baja', c: 'bg-surface-container-high text-secondary' },
};
export const INCIDENCIA: Record<TipoIncidencia, { t: string; icon: string }> = {
  alta: { t: 'Alta', icon: 'add_circle' },
  asignacion: { t: 'Asignación', icon: 'assignment_ind' },
  deterioro: { t: 'Deterioro', icon: 'healing' },
  rotura: { t: 'Rotura', icon: 'broken_image' },
  perdida: { t: 'Pérdida', icon: 'search_off' },
  reparacion: { t: 'Reparación', icon: 'build' },
  reposicion: { t: 'Reposición', icon: 'autorenew' },
  baja: { t: 'Baja', icon: 'delete' },
};

/** Qué incidencias se pueden registrar según el estado actual */
export function incidenciasPosibles(h: Herramienta): TipoIncidencia[] {
  switch (h.estado) {
    case 'operativa': return ['deterioro', 'rotura', 'perdida', 'baja'];
    case 'deteriorada': return ['reparacion', 'rotura', 'perdida', 'reposicion', 'baja'];
    case 'rota': return ['reparacion', 'reposicion', 'baja'];
    case 'perdida': return ['reposicion', 'baja'];
    case 'baja': return [];
  }
}
const DESTINO: Partial<Record<TipoIncidencia, EstadoHerramienta>> = { deterioro: 'deteriorada', rotura: 'rota', perdida: 'perdida', reparacion: 'operativa', reposicion: 'operativa', baja: 'baja' };

export const CLASE: Record<ClaseDotacion, { t: string; plural: string; icon: string }> = {
  herramienta: { t: 'Herramienta', plural: 'Herramientas', icon: 'construction' },
  epi: { t: 'EPI', plural: 'EPIs', icon: 'health_and_safety' },
  ropa: { t: 'Ropa de trabajo', plural: 'Ropa de trabajo', icon: 'apparel' },
};

/** Caducidad o revisión de un EPI: vencido, próximo (30 días) o correcto */
export function caducidad(h: Herramienta, hoy = new Date()): { estado: 'vencido' | 'proximo' | 'ok' | 'sin'; dias: number } {
  if (!h.caduca || h.estado === 'baja') return { estado: 'sin', dias: 0 };
  const d0 = new Date(hoy); d0.setHours(0, 0, 0, 0);
  const dias = Math.round((new Date(h.caduca + 'T00:00:00').getTime() - d0.getTime()) / 864e5);
  return { estado: dias < 0 ? 'vencido' : dias <= 30 ? 'proximo' : 'ok', dias };
}
export const avisosDotacion = (S: Estado) => S.herramientas.filter(h => h.estado !== 'baja' && (h.estado !== 'operativa' || ['vencido', 'proximo'].includes(caducidad(h).estado)));

export const herramienta = (S: Estado, id: string) => S.herramientas.find(h => h.id === id);

export function registrarIncidencia(S: Estado, id: string, tipo: TipoIncidencia, datos: { nota?: string; coste?: number; serieNueva?: string; caducaNueva?: string } = {}, ahora = Date.now()): IncidenciaHerramienta {
  const h = herramienta(S, id); if (!h) throw new Error('Herramienta no encontrada');
  if (!incidenciasPosibles(h).includes(tipo)) throw new Error(`No se puede registrar “${INCIDENCIA[tipo].t}” en una herramienta ${ESTADO_HERR[h.estado].t.toLowerCase()}`);
  if (datos.coste !== undefined && !(datos.coste >= 0)) throw new Error('El coste no puede ser negativo');
  const inc: IncidenciaHerramienta = { id: uid('I'), ts: ahora, tipo, nota: (datos.nota || '').trim(), operator: S.operator, coste: datos.coste };
  if (tipo === 'reposicion') {
    const nueva = (datos.serieNueva || '').trim();
    if (nueva && nueva === h.serie) throw new Error('La unidad nueva debe tener otro n.º de serie');
    inc.serieAnterior = h.serie;
    if (nueva) h.serie = nueva;
    if (datos.caducaNueva) h.caduca = datos.caducaNueva;
  }
  h.estado = DESTINO[tipo]!;
  if (tipo === 'baja') { h.equipo = undefined; h.tecnico = undefined; }
  h.historial.push(inc);
  return inc;
}

/** Asigna a un equipo, a un técnico o a ambos. Si el técnico pertenece a un equipo, se toma ese equipo. */
export function asignarHerramienta(S: Estado, id: string, equipo?: string, tecnico?: string, ahora = Date.now()) {
  const h = herramienta(S, id); if (!h) throw new Error('Herramienta no encontrada');
  if (h.estado === 'baja') throw new Error('Una herramienta de baja no se puede asignar');
  if (tecnico && !S.tecnicos.some(t => t.id === tecnico)) throw new Error('Técnico no encontrado');
  if (equipo && !S.equipos.some(e => e.id === equipo)) throw new Error('Equipo no encontrado');
  const eqDelTec = tecnico ? S.equipos.find(e => e.tecnicos.includes(tecnico))?.id : undefined;
  h.equipo = equipo || eqDelTec; h.tecnico = tecnico || undefined;
  const quien = [h.equipo && S.equipos.find(e => e.id === h.equipo)?.nombre, h.tecnico && S.tecnicos.find(t => t.id === h.tecnico)?.nombre].filter(Boolean).join(' · ') || 'Almacén (sin asignar)';
  h.historial.push({ id: uid('I'), ts: ahora, tipo: 'asignacion', nota: `Asignada a ${quien}`, operator: S.operator });
}

export const herramientasDe = (S: Estado, f: { equipo?: string; tecnico?: string }) =>
  S.herramientas.filter(h => h.estado !== 'baja' && (f.equipo ? h.equipo === f.equipo : true) && (f.tecnico ? h.tecnico === f.tecnico : true));

/** Coste acumulado de reparaciones y reposiciones */
export const costeIncidencias = (h: Herramienta) => h.historial.reduce((a, i) => a + (i.coste || 0), 0);
