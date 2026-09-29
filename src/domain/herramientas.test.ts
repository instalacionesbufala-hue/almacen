import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { asignarHerramienta, avisosDotacion, caducidad, costeIncidencias, herramienta, herramientasDe, incidenciasPosibles, registrarIncidencia } from './herramientas';

let S: Estado;
beforeEach(() => { S = fresh(); });

describe('herramientas', () => {
  it('rotura → reparación devuelve la herramienta a operativa y suma el coste', () => {
    registrarIncidencia(S, 'H002', 'rotura', { nota: 'Se cayó del andamio' });
    expect(herramienta(S, 'H002')!.estado).toBe('rota');
    registrarIncidencia(S, 'H002', 'reparacion', { coste: 85 });
    const h = herramienta(S, 'H002')!;
    expect(h.estado).toBe('operativa');
    expect(costeIncidencias(h)).toBe(85);
    expect(h.historial.map(i => i.tipo)).toEqual(['alta', 'rotura', 'reparacion']);
  });
  it('una pérdida solo se resuelve reponiendo, con otro n.º de serie', () => {
    registrarIncidencia(S, 'H003', 'perdida');
    expect(incidenciasPosibles(herramienta(S, 'H003')!)).toEqual(['reposicion', 'baja']);
    expect(() => registrarIncidencia(S, 'H003', 'reparacion')).toThrow();
    expect(() => registrarIncidencia(S, 'H003', 'reposicion', { serieNueva: 'FL-376-22817' })).toThrow(/otro n.º de serie/);
    const inc = registrarIncidencia(S, 'H003', 'reposicion', { serieNueva: 'FL-376-30001', coste: 520 });
    expect(inc.serieAnterior).toBe('FL-376-22817');
    expect(herramienta(S, 'H003')).toMatchObject({ estado: 'operativa', serie: 'FL-376-30001' });
  });
  it('la baja libera la asignación y bloquea nuevas incidencias', () => {
    registrarIncidencia(S, 'H006', 'baja', { nota: 'Irreparable' });
    const h = herramienta(S, 'H006')!;
    expect(h).toMatchObject({ estado: 'baja', equipo: undefined, tecnico: undefined });
    expect(() => registrarIncidencia(S, 'H006', 'reparacion')).toThrow();
    expect(() => asignarHerramienta(S, 'H006', 'F01')).toThrow(/baja/);
  });
  it('asignar a un técnico toma su equipo y deja rastro', () => {
    asignarHerramienta(S, 'H001', undefined, 'T3');
    expect(herramienta(S, 'H001')).toMatchObject({ equipo: 'F02', tecnico: 'T3' });
    expect(herramienta(S, 'H001')!.historial.at(-1)!.tipo).toBe('asignacion');
    expect(herramientasDe(S, { tecnico: 'T3' }).map(h => h.id)).toContain('H001');
  });
  it('rechaza costes negativos', () => {
    expect(() => registrarIncidencia(S, 'H001', 'rotura', { coste: -1 })).toThrow();
    expect(herramienta(S, 'H001')!.estado).toBe('operativa');
  });
});

describe('EPIs y ropa', () => {
  it('avisa de EPIs vencidos o que vencen en 30 días', () => {
    const hoy = new Date('2026-09-29T10:00:00');
    const h = (caduca: string) => ({ ...herramienta(S, 'E001')!, caduca });
    expect(caducidad(h('2026-09-28'), hoy)).toEqual({ estado: 'vencido', dias: -1 });
    expect(caducidad(h('2026-10-29'), hoy).estado).toBe('proximo');
    expect(caducidad(h('2026-12-31'), hoy).estado).toBe('ok');
    expect(caducidad({ ...h('2026-01-01'), estado: 'baja' }, hoy).estado).toBe('sin');
  });
  it('la reposición renueva la fecha de caducidad del EPI', () => {
    registrarIncidencia(S, 'E003', 'perdida');
    registrarIncidencia(S, 'E003', 'reposicion', { serieNueva: 'IR-5000-9001', caducaNueva: '2031-01-01' });
    expect(herramienta(S, 'E003')).toMatchObject({ estado: 'operativa', caduca: '2031-01-01' });
  });
  it('los avisos incluyen lo vencido, lo roto y lo deteriorado', () => {
    const ids = avisosDotacion(S).map(h => h.id);
    expect(ids).toEqual(expect.arrayContaining(['E003', 'H004', 'H006', 'R003']));
    expect(ids).not.toContain('E002');
  });
});
