/* E-037 · Extracto de un artículo en una furgoneta (en la app, = extracto_vehiculo del servidor): saldo acumulado que llega al
   stock a bordo, pieza entera, recuento, conversión, enlaces a la entrega y al cierre, descuadre provocado y socio sin nombres. */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { registrarCierreLocal } from './cierres';
import { cambiarFormatoLocal } from './formatos';
import { descuadresLocal, extractoLocal } from './extracto';
import { incoherenciasFormato } from './coherencia';
import { applyMovement } from './reglas';

const RZ = 'CAB-RZ1K-5G6', PVC = '6201000032';
const WZ = (lineas: Record<string, number>, n: string) => ({ numInst: n, cliente: 'Cliente inventado', equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3600e3).toISOString(), tipoLinea: 'manguera', ...lineas });

function estado() {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  S.products.push({ sku: PVC, name: 'TUBO PVC M-32', cat: 'tubos', unit: 'barra', contenido: 3, unidadContenido: 'm', piezaEntera: true, stock: 40, min: 0, supplier: '' } as Producto);
  S.equivalencias = [
    { id: 'L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: RZ, factor: 1 }], estimada: false, activa: true, orden: 1, confirmada: true },
    { id: 'P', campo: 'pvc32', formula: 'directa', condiciones: {}, articulos: [{ sku: PVC, factor: 1 }], estimada: false, activa: true, orden: 2, confirmada: true }] as Equivalencia[];
  return S;
}

describe('extracto de un artículo en una furgoneta', () => {
  it('entrega, cierre, ajuste, recuento y conversión: el saldo llega al stock a bordo, con enlaces', () => {
    const S = estado();
    const id = registrarCierreLocal(S, WZ({ metrosLinea: 30 }, 'E2639371'), 'wizard').id;            // 150 → 120 m
    aplicarLocal(S, { op: 'ajuste', args: { id: 'A1', sku: RZ, qty: -5, motivo: 'Rotura en obra', vehiculo: 'V-F01' } });   // 115 m
    aplicarLocal(S, { op: 'recuentoVehiculo', args: { id: 'R1', vehiculo: 'V-F01', lineas: [{ sku: RZ, contado: 110 }] } });  // 110 m
    const e = extractoLocal(S, 'V-F01', RZ);
    expect(e.filas.map(f => [f.tipo, f.unidades, f.saldo])).toEqual([['entrega', 150, 150], ['cierre', -30, 120], ['ajuste', -5, 115], ['recuento', -5, 110]]);
    expect([e.saldoFinal, e.saldoCalculado, e.stock]).toEqual([110, 110, 110]);
    expect(e.resumen).toEqual({ entregado: 150, consumido: -30, ajustes: -10, otros: 0 });
    expect(e.filas[0].entrega).toEqual({ id: 'ENT-2026-0412', numero: 'ENT-2026-0412', firmo: S.tecnicos.find(t => t.id === 'T1')!.nombre });
    expect(e.filas[1].cierre).toMatchObject({ id, numInst: 'E2639371', version: 1, origen: 'wizard', cliente: 'Cliente inventado' });
    expect(e.filas[3].recuento).toEqual({ constaba: 115, contado: 110 });
    // conversión de formato (manteniendo los formatos): también entra en el saldo
    cambiarFormatoLocal(S, RZ, { unit: 'bobina', contenido: 100, unidadContenido: 'm' }, 'formato', 'Admin');
    const e2 = extractoLocal(S, 'V-F01', RZ);
    expect(e2.filas.at(-1)).toMatchObject({ tipo: 'conversion', unidades: 10890, saldo: 11000 });
    expect([e2.saldoCalculado, e2.stock]).toEqual([11000, 11000]);
    // filtros
    expect(extractoLocal(S, 'V-F01', RZ, { tipo: 'cierres' }).filas.map(f => f.tipo)).toEqual(['cierre']);
    expect(extractoLocal(S, 'V-F01', RZ, { desde: Date.now() + 1000 })).toMatchObject({ saldoInicial: 11000, filas: [], saldoFinal: 11000 });
  });

  it('pieza entera: "62 m → 63 m"', () => {
    const S = estado();
    applyMovement(S, { sku: PVC, type: 'traspaso', qty: 25, reason: 'Entrega a equipo', ref: 'ENT-PRUEBA', vehiculo: 'V-F01', equipo: 'F01' });
    registrarCierreLocal(S, WZ({ pvc32: 62 }, 'E2639372'), 'wizard');
    const e = extractoLocal(S, 'V-F01', PVC);
    expect(e.filas.map(f => [f.tipo, f.unidades])).toEqual([['entrega', 75], ['cierre', -63]]);
    expect(e.filas[1].pieza).toEqual({ real: 62, consumo: 63 });
  });

  it('un descuadre provocado se ve en el extracto y en la comprobación de Inventario', () => {
    const S = estado();
    expect(descuadresLocal(S)).toEqual([]);
    S.aBordo.find(b => b.vehiculo === 'V-F01' && b.sku === RZ)!.unidades += 5;
    const e = extractoLocal(S, 'V-F01', RZ);
    expect([e.saldoCalculado, e.stock]).toEqual([150, 155]);
    const d = descuadresLocal(S);
    expect(d).toEqual([{ vehiculo: 'V-F01', sku: RZ, stock: 155, calculado: 150 }]);
    expect(incoherenciasFormato(S, d)[0]).toMatchObject({ tipo: 'descuadre', vehiculo: 'V-F01', texto: expect.stringMatching(/Diferencia de 5 m/) });
  });

  it('el socio no ve nombres', () => {
    const S = estado();
    const e = extractoLocal(S, 'V-F01', 'WBX-PULSAR-22', {}, true);
    expect(e.filas[0]).toMatchObject({ quien: 'Técnico del equipo', entrega: { firmo: 'Técnico del equipo' } });
  });
});
