/* E-045 · El medidor SOLAR solo es automático con cargador V2C (Trydan). Con Policharger u otro: sin medidor y "¿se instaló?";
   "Sí" lo añade (corregir cierre, E-035), "No" lo marca como revisado; la regla editada por el usuario se aplica; y el caso real
   E2632493 (V2C Trydan, MONOFÁSICO SOLAR) sigue descontando el monofásico. Datos inventados salvo ese patrón; reloj fijo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { MEDIDORES_SOLAR, MEDIDOR_MONO, MEDIDOR_TRIF } from '../../supabase/functions/_compartido/cierres';
import { condicionesLegibles, medidorDe, medidorPorRevisar, registrarCierreLocal } from './cierres';
import { unidadesABordo } from './reglas';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 20, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

const DESC = 'INSTALACIÓN TIER 1 UNIFAM. Y EMPRESA MONOFÁSICO SOLAR';
function estado() {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  for (const [sku, name] of [[MEDIDOR_MONO, 'V2C MEDIDOR BIDIRECCIONAL MONOFÁSICO'], [MEDIDOR_TRIF, 'MEDIDOR BIDIRECCIONAL TRIFÁSICO']])
    S.products.push({ sku, name, cat: 'aparamenta', unit: 'ud', contenido: 1, stock: 5, min: 0, supplier: '', propiedad: 'custodia', propietario: 'ESMOVE' } as Producto);
  S.equivalencias = MEDIDORES_SOLAR.map(r => ({ ...r, confirmada: true }) as Equivalencia);
  return S;
}
let n = 0;
const cierre = (S: ReturnType<typeof estado>, hardware: string, extra: Record<string, unknown> = {}) => {
  const r = registrarCierreLocal(S, { numInst: `E26420${String(++n).padStart(2, '0')}`, equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString(), fase: 'mono', hardware, descInstalacion: DESC, ...extra }, 'wizard');
  return S.cierres.find(c => c.id === r.id)!;
};
const mono = (S: ReturnType<typeof estado>) => unidadesABordo(S, 'V-F01', MEDIDOR_MONO);

describe('medidor SOLAR solo automático con V2C', () => {
  it('el caso real E2632493: V2C Trydan + MONOFÁSICO SOLAR → 1 monofásico, sin aviso', () => {
    const S = estado(), c = cierre(S, 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5');
    expect(mono(S)).toBe(-1);
    expect(medidorPorRevisar(S, c)).toBe(false);
  });

  it('SOLAR + Policharger: sin medidor, sin "sin equivalencia" y con el aviso "¿se instaló?"; también sin cargador conocido', () => {
    const S = estado(), c = cierre(S, 'POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5');
    expect(mono(S)).toBe(0);
    expect(S.lineasCierre.filter(l => l.cierre === c.id && l.campo === 'descInstalacion')).toEqual([]);
    expect(medidorPorRevisar(S, c)).toBe(true);
    expect(medidorPorRevisar(S, cierre(S, ''))).toBe(true);
    expect(medidorPorRevisar(S, cierre(S, 'POLICHARGER NW', { descInstalacion: 'INSTALACIÓN HASTA 30M COMUNITARIO' }))).toBe(false);     // sin SOLAR, nada
  });

  it('"Sí, monofásico" añade la línea como corrección manual (con versión) y quita el aviso', () => {
    const S = estado(), c = cierre(S, 'POLICHARGER NW MONOFÁSICO');
    aplicarLocal(S, { op: 'corregirCierre', args: { id: c.id, correccion: { fijar: { descInstalacion: [{ sku: medidorDe(S, 'mono'), cantidad: 1 }] } } } });
    expect(mono(S)).toBe(-1);
    expect(medidorPorRevisar(S, c)).toBe(false);
    expect(S.lineasCierre.find(l => l.cierre === c.id && l.campo === 'descInstalacion')).toMatchObject({ sku: MEDIDOR_MONO, manual: true });
    expect(c.versiones!.at(-1)!.documento).toMatch(/^Corrección manual/);
    expect(medidorDe(S, 'trif')).toBe(MEDIDOR_TRIF);
  });

  it('"No" lo marca como revisado (solo el administrador) y no descuenta nada', () => {
    const S = estado(), c = cierre(S, 'POLICHARGER NW MONOFÁSICO');
    S.rol = 'almacen';
    expect(() => aplicarLocal(S, { op: 'revisarMedidorSolar', args: { id: c.id, nota: '' } })).toThrow(/administrador/);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'revisarMedidorSolar', args: { id: c.id, nota: '' } });
    expect([medidorPorRevisar(S, c), mono(S)]).toEqual([false, 0]);
  });

  it('la regla editada por el usuario (Policharger también) se aplica; las condiciones se leen en lenguaje normal', () => {
    const S = estado(), s1 = S.equivalencias.find(r => r.id === 'S1')!;
    expect(condicionesLegibles(s1.condiciones)).toBe('Descripción de la instalación contiene: Solar · Fase: mono · Cargador contiene: V2C o Trydan');
    aplicarLocal(S, { op: 'equivalencia', args: { regla: { ...s1, condiciones: { ...s1.condiciones, 'hardware~': ['v2c', 'trydan', 'policharger'] } } } });
    const c = cierre(S, 'POLICHARGER NW MONOFÁSICO');
    expect([mono(S), medidorPorRevisar(S, c)]).toEqual([-1, false]);
  });
});
