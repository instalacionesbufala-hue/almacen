/* E-044 · Medidor bidireccional en las instalaciones "SOLAR": la descripción de la instalación (del calendario) en el cierre, en la
   prefactura o completada después ("calendario"), 1 medidor por instalación según la fase, sin duplicar. Datos inventados; reloj fijo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { MEDIDORES_SOLAR, MEDIDOR_MONO, MEDIDOR_TRIF, normalizarCierre, prepararVersion, traducirCierre } from '../../supabase/functions/_compartido/cierres';
import { descInstalacion, registrarCierreLocal } from './cierres';
import { corregirCierreLocal } from './corregir';
import { unidadesABordo } from './reglas';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 20, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

const DESC = 'INSTALACIÓN TIER 1 UNIFAM. Y EMPRESA MONOFÁSICO SOLAR';
const medidores = (c: Record<string, unknown>) => traducirCierre(normalizarCierre(c), MEDIDORES_SOLAR, {}).map(l => [l.sku, l.cantidad, l.estado]);

describe('qué medidor lleva cada instalación', () => {
  it('SOLAR mono → monofásico; trif → trifásico; sin SOLAR, ninguno; sin fase, la de la descripción; sin nada, para elegir', () => {
    expect(medidores({ descInstalacion: DESC, fase: 'mono' })).toEqual([[MEDIDOR_MONO, 1, 'aplicable']]);
    expect(medidores({ descInstalacion: 'INSTALACIÓN TIER 2 TRIFÁSICO solar', fase: 'trif' })).toEqual([[MEDIDOR_TRIF, 1, 'aplicable']]);
    expect(medidores({ descInstalacion: 'INSTALACIÓN TIER 1 UNIFAM. MONOFÁSICO', fase: 'mono' })).toEqual([]);
    expect(medidores({ fase: 'mono' })).toEqual([]);
    expect(medidores({ descInstalacion: DESC })).toEqual([[MEDIDOR_MONO, 1, 'aplicable']]);              // "MONOFÁSICO" sin tilde ni mayúsculas
    expect(medidores({ descInstalacion: 'INSTALACIÓN SOLAR' })).toEqual([[null, 1, 'sin_equivalencia']]);
    expect(traducirCierre(normalizarCierre({ descInstalacion: DESC, fase: 'mono' }), MEDIDORES_SOLAR, {})[0].nota).toMatch(/^Instalación SOLAR/);
  });
});

function estado() {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  for (const [sku, name] of [[MEDIDOR_MONO, 'V2C MEDIDOR BIDIRECCIONAL MONOFÁSICO'], [MEDIDOR_TRIF, 'MEDIDOR BIDIRECCIONAL TRIFÁSICO']])
    S.products.push({ sku, name, cat: 'aparamenta', unit: 'ud', contenido: 1, stock: 5, min: 0, supplier: '', propiedad: 'custodia', propietario: 'ESMOVE' } as Producto);
  S.equivalencias = MEDIDORES_SOLAR.map(r => ({ ...r, confirmada: true }) as Equivalencia);
  return S;
}
const WZ = { numInst: 'E2641001', equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString(), fase: 'mono', tipoLinea: 'tubo', seccion: '6' };

describe('en los cierres', () => {
  it('cierre del wizard con la descripción SOLAR: 1 medidor monofásico de la furgoneta', () => {
    const S = estado(), r = registrarCierreLocal(S, { ...WZ, descInstalacion: DESC }, 'wizard');
    expect(unidadesABordo(S, 'V-F01', MEDIDOR_MONO)).toBe(-1);
    expect(descInstalacion(S.cierres.find(c => c.id === r.id)!)).toBe(DESC);
  });

  it('calendario sobre un cierre que ya existe: versión nueva solo con esos datos, añade el medidor y no lo duplica', () => {
    const S = estado(), r = registrarCierreLocal(S, WZ, 'wizard');
    expect(unidadesABordo(S, 'V-F01', MEDIDOR_MONO)).toBe(0);
    const cal = { origen: 'calendario', numInst: 'E2641001', atributos: { descInstalacion: DESC, equipo: 'Búfala 3' } };
    const v = registrarCierreLocal(S, cal, 'calendario');
    expect(v).toMatchObject({ estado: expect.any(String), diferencia: [{ sku: MEDIDOR_MONO, unidades: 1 }] });
    const c = S.cierres.find(x => x.id === r.id)!;
    expect(c.versiones!.at(-1)).toMatchObject({ origen: 'calendario', documento: 'Datos del calendario' });
    expect(c.equipoWizard).toBe('Búfala 1');                                      // el equipo del wizard no lo cambia el calendario
    expect(registrarCierreLocal(S, cal, 'calendario').estado).toBe('duplicado');
    expect(unidadesABordo(S, 'V-F01', MEDIDOR_MONO)).toBe(-1);
    // otra versión del wizard (sin descripción) no la pierde
    registrarCierreLocal(S, { ...WZ, version: 2, metrosLinea: 10 }, 'wizard');
    expect(unidadesABordo(S, 'V-F01', MEDIDOR_MONO)).toBe(-1);
  });

  it('el calendario respeta lo corregido a mano (E-035): con la fase corregida a trifásica, el medidor trifásico', () => {
    const S = estado(), r = registrarCierreLocal(S, WZ, 'wizard');
    corregirCierreLocal(S, r.id, { datos: { fase: 'trif' } }, 'Admin');
    registrarCierreLocal(S, { origen: 'calendario', numInst: 'E2641001', atributos: { descInstalacion: 'INSTALACIÓN SOLAR' } }, 'calendario');
    expect([unidadesABordo(S, 'V-F01', MEDIDOR_MONO), unidadesABordo(S, 'V-F01', MEDIDOR_TRIF)]).toEqual([0, -1]);
  });

  it('prefactura con descInstalacion en los atributos; el del wizard manda sobre el de la prefactura', () => {
    const S = estado();
    registrarCierreLocal(S, { origen: 'holded', numInst: 'E2641002', documento: 'PF-1', fechaAprobacion: WZ.fechaCierreIso, equipo: 'Búfala 1',
      atributos: { fase: 'Trifásica', descInstalacion: 'TIER 2 TRIFÁSICO SOLAR', fechaCierreIso: WZ.fechaCierreIso }, lineas: { metrosLinea: 10 } }, 'holded');
    expect(unidadesABordo(S, 'V-F01', MEDIDOR_TRIF)).toBe(-1);
    const v = prepararVersion({ version: 1, wizard: { ...WZ, descInstalacion: 'SIN PLACAS' }, holded: { documento: 'PF-2', fechaAprobacion: '', lineas: {}, atributos: { descInstalacion: DESC } }, origenes: ['wizard', 'holded'] }, 'holded',
      { numInst: 'E2641001', documento: 'PF-3', lineas: { metrosLinea: 12 } });
    expect(v.efectivo.descInstalacion).toBe('SIN PLACAS');
  });

  it('los datos del calendario de un cierre que aún no ha llegado no crean nada', () => {
    expect(() => prepararVersion(null, 'calendario', { numInst: 'E2649999', atributos: { descInstalacion: DESC } })).toThrow(/Aún no ha llegado/);
  });
});
