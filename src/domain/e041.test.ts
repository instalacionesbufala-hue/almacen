/* E-041 · Devolución de una furgoneta al almacén (en la app, = registrar_devolucion / anular_devolucion): metros sueltos de un
   artículo por rollos, línea defectuosa como merma, custodia que vuelve a su socio, anulación, el extracto que cuadra y lo que ve
   el socio. Reloj fijo (la semilla pone entregas a horas del día: ver la revisión del chat del 08/10). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fresh } from '../data/semilla';
import type { Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { applyMovement, unidadesABordo } from './reglas';
import { avisosDevolucion, comprobarDevolucion, type DatosDevolucion } from './devoluciones';
import { extractoLocal } from './extracto';
import { filtrarParaSocio } from './socio';
import { incoherenciasFormato } from './coherencia';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); const d = new Date(); d.setHours(20, 0, 0, 0); vi.setSystemTime(d); });
afterEach(() => { vi.useRealTimers(); });

const MANG = 'T-MANG-RZ1K';
function estado() {
  const S = fresh(); S.rol = 'admin';
  S.products.push({ sku: MANG, name: 'Manguera RZ1-K de prueba', cat: 'cables', unit: 'rollo', contenido: 100, unidadContenido: 'm', stock: 2, min: 0, supplier: '' } as Producto);
  applyMovement(S, { sku: MANG, type: 'traspaso', qty: 1, reason: 'Entrega a equipo', ref: 'ENT-PRUEBA', vehiculo: 'V-F01', equipo: 'F01' });
  return S;
}
const BASE: Omit<DatosDevolucion, 'lineas'> = { vehiculo: 'V-F01', tecnico: 'T1', motivo: 'sobrante', obra: 'E2639410', firma: 'data:image/png;base64,AA' };
const devolver = (S: ReturnType<typeof fresh>, lineas: DatosDevolucion['lineas'], id = 'D1') => aplicarLocal(S, { op: 'devolucion', args: { id, datos: { ...BASE, lineas } } });
const stock = (S: ReturnType<typeof fresh>, sku: string) => S.products.find(p => p.sku === sku)!.stock;

describe('devolución de una furgoneta en la app', () => {
  it('100 m entregados, 30 m devueltos: almacén +0,3 rollos, furgoneta −30 m; DEV-; el extracto cuadra', () => {
    const S = estado();
    expect([stock(S, MANG), unidadesABordo(S, 'V-F01', MANG)]).toEqual([1, 100]);
    devolver(S, [{ sku: MANG, unidades: 30, estado: 'bien' }]);
    expect([stock(S, MANG), unidadesABordo(S, 'V-F01', MANG)]).toEqual([1.3, 70]);
    const d = S.devoluciones![0];
    expect(d).toMatchObject({ numero: expect.stringMatching(/^DEV-\d{4}-0001$/), tecnico: 'T1', lineas: [{ sku: MANG, unidades: 30, cantidad: 0.3, estado: 'bien' }] });
    devolver(S, [{ sku: MANG, unidades: 30, estado: 'bien' }]);                 // idempotente
    expect(unidadesABordo(S, 'V-F01', MANG)).toBe(70);
    const e = extractoLocal(S, 'V-F01', MANG);
    expect(e.filas.map(f => [f.tipo, f.unidades, f.referencia])).toEqual([['entrega', 100, 'ENT-PRUEBA'], ['devolucion', -30, `${d.numero} · E2639410`]]);
    expect([e.saldoCalculado, e.stock]).toEqual([70, 70]);
    // un rollo empezado en el almacén (1,3 rollos) no es una incoherencia
    expect(incoherenciasFormato(S).filter(i => i.sku === MANG)).toEqual([]);
  });

  it('defectuoso: merma desde la furgoneta, sin sumar al almacén', () => {
    const S = estado();
    devolver(S, [{ sku: MANG, unidades: 20, estado: 'bien' }, { sku: MANG, unidades: 10, estado: 'defectuoso', motivoDefecto: 'Cubierta dañada' }]);
    expect([stock(S, MANG), unidadesABordo(S, 'V-F01', MANG)]).toEqual([1.2, 70]);
    expect(S.movements.find(m => m.type === 'merma')).toMatchObject({ reason: 'Devuelto defectuoso: Cubierta dañada', vehiculo: 'V-F01', unidades: -10, devolucion: 'D1' });
    expect(comprobarDevolucion(S, { ...BASE, lineas: [{ sku: MANG, unidades: 1, estado: 'defectuoso' }] })).toMatch(/qué le pasa/);
  });

  it('custodia vuelve a su socio; lo que no consta a bordo avisa (queda en negativo); técnico del equipo', () => {
    const S = estado(), antes = stock(S, 'WBX-PULSAR-22');
    devolver(S, [{ sku: 'WBX-PULSAR-22', unidades: 1, estado: 'bien' }]);
    expect([stock(S, 'WBX-PULSAR-22'), unidadesABordo(S, 'V-F01', 'WBX-PULSAR-22')]).toEqual([antes + 1, 1]);
    expect(S.products.find(p => p.sku === 'WBX-PULSAR-22')).toMatchObject({ propiedad: 'custodia', propietario: 'ESMOVE' });
    expect(avisosDevolucion(S, 'V-F01', [{ sku: 'BF-FIX-SX8', unidades: 5, estado: 'bien' }])[0]).toMatch(/no consta a bordo.*negativo/);
    expect(comprobarDevolucion(S, { ...BASE, tecnico: 'T5', lineas: [{ sku: MANG, unidades: 1, estado: 'bien' }] })).toMatch(/técnico del equipo/);
  });

  it('anulación (solo administrador): todo vuelve y el extracto sigue cuadrando', () => {
    const S = estado();
    devolver(S, [{ sku: MANG, unidades: 30, estado: 'bien' }, { sku: MANG, unidades: 10, estado: 'defectuoso', motivoDefecto: 'Cortada' }]);
    S.rol = 'almacen';
    expect(() => aplicarLocal(S, { op: 'anularDevolucion', args: { id: 'D1', motivo: 'Error' } })).toThrow(/administrador/);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'anularDevolucion', args: { id: 'D1', motivo: 'Se contó mal' } });
    expect([stock(S, MANG), unidadesABordo(S, 'V-F01', MANG)]).toEqual([1, 100]);
    expect(S.devoluciones![0]).toMatchObject({ estado: 'anulada', anulacionMotivo: 'Se contó mal' });
    const e = extractoLocal(S, 'V-F01', MANG);
    expect([e.saldoCalculado, e.stock]).toEqual([100, 100]);
  });

  it('el socio ve las devoluciones de su material, sin técnico ni firma', () => {
    const S = estado();
    devolver(S, [{ sku: 'WBX-PULSAR-22', unidades: 1, estado: 'bien' }, { sku: MANG, unidades: 10, estado: 'bien' }]);
    const V = filtrarParaSocio(S, 'ESMOVE');
    expect(V.devoluciones).toHaveLength(1);
    expect(V.devoluciones![0]).toMatchObject({ tecnico: undefined, firma: '', operator: 'Búfala', lineas: [{ sku: 'WBX-PULSAR-22' }] });
  });
});
