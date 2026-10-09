/* E-046 · Lo que confirma el técnico en el wizard (medidorBidireccional: mono | trif | no) manda sobre las reglas S1-S5 sea cual sea
   el cargador; vacío → reglas de E-045; el calendario no lo cambia; una corrección manual (E-035) manda sobre todo. Reloj fijo. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { MEDIDORES_SOLAR, MEDIDOR_MONO, MEDIDOR_TECNICO, MEDIDOR_TRIF, medidorBidireccional } from '../../supabase/functions/_compartido/cierres';
import { medidorPorRevisar, medidorTecnico, registrarCierreLocal } from './cierres';
import { unidadesABordo } from './reglas';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 20, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

const DESC = 'INSTALACIÓN TIER 1 UNIFAM. Y EMPRESA MONOFÁSICO SOLAR', POLI = 'POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5', V2C = 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5';
function estado() {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  for (const [sku, name] of [[MEDIDOR_MONO, 'MEDIDOR BIDIRECCIONAL MONOFÁSICO'], [MEDIDOR_TRIF, 'MEDIDOR BIDIRECCIONAL TRIFÁSICO']])
    S.products.push({ sku, name, cat: 'aparamenta', unit: 'ud', contenido: 1, stock: 5, min: 0, supplier: '', propiedad: 'custodia', propietario: 'ESMOVE' } as Producto);
  S.equivalencias = [...MEDIDOR_TECNICO, ...MEDIDORES_SOLAR].map(r => ({ ...r, confirmada: true }) as Equivalencia);
  return S;
}
let n = 0;
const cierre = (S: ReturnType<typeof estado>, hardware: string, medidor?: string) => {
  const r = registrarCierreLocal(S, { numInst: `E26430${String(++n).padStart(2, '0')}`, equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString(), fase: 'mono', hardware,
    descInstalacion: DESC, ...(medidor !== undefined ? { medidorBidireccional: medidor } : {}) }, 'wizard');
  return S.cierres.find(c => c.id === r.id)!;
};
const bordo = (S: ReturnType<typeof estado>) => [unidadesABordo(S, 'V-F01', MEDIDOR_MONO), unidadesABordo(S, 'V-F01', MEDIDOR_TRIF)];

describe('el técnico confirma el medidor en el wizard', () => {
  it('lo que llega del wizard se entiende ("Sí · Monofásico", "trif", "No"…)', () => {
    expect(['mono', 'Monofásico', 'trif', 'TRIFÁSICO', 'no', 'No instalado', '', 'quizá'].map(medidorBidireccional)).toEqual(['mono', 'mono', 'trif', 'trif', 'no', 'no', '', '']);
  });

  it('Policharger SOLAR con "mono": descuenta el monofásico, sin aviso', () => {
    const S = estado(), c = cierre(S, POLI, 'mono');
    expect(bordo(S)).toEqual([-1, 0]);
    expect([medidorPorRevisar(S, c), medidorTecnico(c)]).toEqual([false, 'mono']);
    expect(S.lineasCierre.find(l => l.cierre === c.id && l.campo === 'descInstalacion')!.nota).toMatch(/confirmado por el técnico/);
  });

  it('V2C SOLAR con "no": no descuenta, sin aviso ni pendiente; "trif": el trifásico', () => {
    const S = estado(), c = cierre(S, V2C, 'no');
    expect(bordo(S)).toEqual([0, 0]);
    expect(medidorPorRevisar(S, c)).toBe(false);
    expect(S.lineasCierre.filter(l => l.cierre === c.id && l.campo === 'descInstalacion')).toEqual([]);
    cierre(S, POLI, 'trif');
    expect(bordo(S)).toEqual([0, -1]);
  });

  it('vacío: las reglas de E-045 (V2C automático; Policharger, aviso)', () => {
    const S = estado();
    cierre(S, V2C, '');
    expect(bordo(S)).toEqual([-1, 0]);
    expect(medidorPorRevisar(S, cierre(S, POLI))).toBe(true);
  });

  it('el calendario no cambia lo que dijo el técnico; una corrección manual manda sobre todo', () => {
    const S = estado(), c = cierre(S, V2C, 'no');
    registrarCierreLocal(S, { origen: 'calendario', numInst: c.numInst, atributos: { descInstalacion: DESC + ' (otra)' } }, 'calendario');
    expect(bordo(S)).toEqual([0, 0]);
    const d = cierre(S, POLI, 'mono');
    aplicarLocal(S, { op: 'corregirCierre', args: { id: d.id, correccion: { fijar: { descInstalacion: [{ sku: MEDIDOR_TRIF, cantidad: 1 }] } } } });
    expect(bordo(S)).toEqual([0, -1]);
    registrarCierreLocal(S, { numInst: d.numInst, version: 2, equipo: 'Búfala 1', fase: 'mono', hardware: POLI, descInstalacion: DESC, medidorBidireccional: 'mono', metrosLinea: 5 }, 'wizard');
    expect(bordo(S)).toEqual([0, -1]);
  });
});
