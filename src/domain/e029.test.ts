/* E-029 · En la app (demostración, mismas reglas que el servidor): cierres "Equipo sin vehículo" porque la asignación se
   registró más tarde; corregir la fecha de inicio y reprocesar, el atajo del vehículo actual, el consumo del periodo sin
   los no entregados y el filtro de fechas por defecto. */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { cierresAfectados, claveAsignacion, validarInicioAsignacion } from './asignaciones';
import { consumoPorArticulo, desdeCierresPorDefecto, noEntregadosPorArticulo, registrarCierreLocal } from './cierres';
import { unidadesABordo } from './reglas';

const REGLAS: Equivalencia[] = [
  { id: 'L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 1, confirmada: true },
  { id: 'H', campo: 'hardware', formula: 'unidad', condiciones: { 'hardware~': 'cuadro' }, articulos: [{ sku: 'ESM-CPVE-MONO', factor: 1 }], estimada: false, activa: true, orden: 2, confirmada: true },
];
const H = (h: number) => Date.now() + h * 3600e3;
/** Como el 30/09: furgonetas asignadas hace 1 h y cierres de hace 6-3 h; el "cargador" (custodia) solo consta a bordo de V-F01 */
function estado() {
  const S = fresh(); S.rol = 'admin'; S.equivalencias = REGLAS.map(r => ({ ...r })); S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = H(48);
  S.asignaciones.filter(a => a.tipo === 'vehiculo').forEach(a => { a.desde = H(-1); });
  S.aBordo.push({ vehiculo: 'V-F01', sku: 'ESM-CPVE-MONO', unidades: 1 });
  for (const c of [
    { numInst: 'E2632246', equipo: 'Búfala 1', fechaCierreIso: new Date(H(-5)).toISOString(), hardware: 'Cuadro VE', metrosLinea: 5 },
    { numInst: 'E2631828', equipo: 'Búfala 2', fechaCierreIso: new Date(H(-4)).toISOString(), hardware: 'Cuadro VE', metrosLinea: 0 },
    { numInst: 'E2632105', equipo: 'Búfala 3', fechaCierreIso: new Date(H(-3)).toISOString(), hardware: 'Cuadro VE', metrosLinea: 0 },
  ]) expect(registrarCierreLocal(S, c, 'historico').estado).toBe('sin_vehiculo');
  return S;
}
const ci = (S: ReturnType<typeof fresh>, n: string) => S.cierres.find(c => c.numInst === n)!;
const asigVeh = (S: ReturnType<typeof fresh>, v: string) => S.asignaciones.find(a => a.tipo === 'vehiculo' && a.sujeto === v && a.hasta === undefined)!;

describe('editar la fecha de inicio de una asignación', () => {
  it('adelantar la de V-F01 → Búfala 1 y reprocesar: descuenta lo de ese cierre (el cargador a bordo queda en 0) y deja versión', () => {
    const S = estado(), a = asigVeh(S, 'V-F01');
    expect(cierresAfectados(S, a, H(-8))).toEqual([ci(S, 'E2632246').id]);
    const nuevo = H(-8);
    aplicarLocal(S, { op: 'editarInicioAsignacion', args: { clave: claveAsignacion(a), tipo: 'vehiculo', desde: nuevo } });
    expect(a.desde).toBe(nuevo);
    aplicarLocal(S, { op: 'reprocesarCierres', args: { ids: [ci(S, 'E2632246').id] } });
    const c = ci(S, 'E2632246');
    expect(c.estado).toBe('aplicado');
    expect(unidadesABordo(S, 'V-F01', 'ESM-CPVE-MONO')).toBe(0);
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(150 - 5);
    expect(c.versiones!.map(v => v.origen)).toEqual(['historico', 'admin']);
    expect(c.versiones![1].documento).toMatch(/^Reprocesado por .+ \(historial de asignaciones\)$/);
    expect(c.versiones![1].diferencia).toEqual([{ sku: 'CAB-RZ1K-5G6', unidades: 5 }, { sku: 'ESM-CPVE-MONO', unidades: 1 }]);
  });

  it('sin solapes ni fechas futuras; tocarse en el borde sí vale', () => {
    const S = estado(), a = asigVeh(S, 'V-F01');
    S.asignaciones.push({ tipo: 'vehiculo', sujeto: 'V-F01', equipo: 'F03', desde: H(-20), hasta: H(-7) });
    expect(validarInicioAsignacion(S, a, H(-8))).toMatch(/^Se solapa con otra asignación \(.+ en Búfala 3 desde/);
    expect(validarInicioAsignacion(S, a, H(1))).toBe('La fecha de inicio no puede ser futura');
    expect(validarInicioAsignacion(S, a, H(-7))).toBeNull();
    // el mismo equipo con otro vehículo a la vez
    S.asignaciones.push({ tipo: 'vehiculo', sujeto: 'V-F03', equipo: 'F02', desde: H(-30), hasta: H(-10) });
    expect(validarInicioAsignacion(S, asigVeh(S, 'V-F02'), H(-12))).toMatch(/^Se solapa/);
    expect(() => aplicarLocal(S, { op: 'editarInicioAsignacion', args: { clave: claveAsignacion(a), tipo: 'vehiculo', desde: H(-8) } })).toThrow(/Se solapa/);
  });
});

describe('atajo: usar el vehículo que el equipo tiene ahora', () => {
  it('procesa todos, deja constancia en la versión y no toca el historial', () => {
    const S = estado(), antes = JSON.stringify(S.asignaciones);
    aplicarLocal(S, { op: 'usarVehiculoActual', args: { ids: S.cierres.map(c => c.id) } });
    expect(S.cierres.every(c => c.estado !== 'sin_vehiculo')).toBe(true);
    expect(JSON.stringify(S.asignaciones)).toBe(antes);
    expect(unidadesABordo(S, 'V-F01', 'ESM-CPVE-MONO')).toBe(0);
    expect(ci(S, 'E2632105').versiones!.at(-1)!.documento).toMatch(/^Vehículo asignado a mano por .+: .+ \(el que el equipo tiene ahora\)$/);
    // los de Búfala 2 y 3 no constaban a bordo: no entregados, no se descuentan
    expect(S.lineasCierre.filter(l => l.sku === 'ESM-CPVE-MONO').map(l => l.estado).sort()).toEqual(['aplicada', 'no_entregado', 'no_entregado']);
  });
});

describe('consumo del periodo', () => {
  it('no cuenta los cierres sin vehículo ni los no entregados; estos van aparte', () => {
    const S = estado();
    // sin procesar: nada descontado, nada en el consumo (antes salían "2 ud" de cargadores que no se habían descontado)
    expect(consumoPorArticulo(S, S.cierres)).toEqual([]);
    aplicarLocal(S, { op: 'usarVehiculoActual', args: { ids: S.cierres.map(c => c.id) } });
    const consumo = consumoPorArticulo(S, S.cierres), aparte = noEntregadosPorArticulo(S, S.cierres);
    expect(Object.fromEntries(consumo.map(x => [x.sku, x.unidades]))).toEqual({ 'ESM-CPVE-MONO': 1, 'CAB-RZ1K-5G6': 5 });
    expect(aparte.map(x => [x.sku, x.unidades])).toEqual([['ESM-CPVE-MONO', 2]]);
    // el consumo cuadra con lo descontado de los vehículos
    const descontado = -S.movements.filter(m => m.cierre && m.sku === 'ESM-CPVE-MONO').reduce((s, m) => s + (m.unidades || 0), 0);
    expect(descontado).toBe(1);
  });
});

describe('filtro de fechas de la lista de cierres', () => {
  it('por defecto desde la apertura del inventario si es de los últimos 30 días; si no, hace 30 días', () => {
    const ahora = new Date(2026, 9, 3, 12).getTime();
    expect(desdeCierresPorDefecto({ configApp: { modoDemo: false, aperturaCierres: new Date(2026, 8, 30, 20, 3).getTime() } }, ahora)).toBe('2026-09-30');
    expect(desdeCierresPorDefecto({ configApp: { modoDemo: false, aperturaCierres: new Date(2026, 0, 1).getTime() } }, ahora)).toBe('2026-09-03');
    expect(desdeCierresPorDefecto({ configApp: { modoDemo: false } }, ahora)).toBe('2026-09-03');
    // los del 30/09 entran con el filtro por defecto del 03/10 (antes, "desde el día 1 del mes", se quedaban fuera)
    expect(desdeCierresPorDefecto({ configApp: { modoDemo: false, demoBorrada: new Date(2026, 8, 30, 20, 3).getTime() } }, ahora) <= '2026-09-30').toBe(true);
  });
});
