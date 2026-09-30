/* E-012 · Cierres en la app (demostración): misma lógica que el servidor, resúmenes y edición de reglas en texto */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { articulosTexto, cierresDeCsv, condicionesTexto, consumoPorArticulo, discrepancias, normalizarCierre, parseArticulos, parseCondiciones, registrarCierreLocal, traducirEnApp } from './cierres';
import { unidadesABordo } from './reglas';

const REGLAS: Equivalencia[] = [
  { id: 'A', campo: 'metrosLinea', formula: 'directa', condiciones: { tipoLinea: 'manguera' }, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 1, confirmada: true },
  { id: 'B', campo: 'rj45', formula: 'directa', condiciones: {}, articulos: [{ sku: '7280040020', factor: 1 }], estimada: false, activa: true, orden: 2, confirmada: true },
  { id: 'C', campo: 'pvc32', formula: 'directa', condiciones: {}, articulos: [{ sku: 'BF-TUB-CM20', factor: 1 }], estimada: false, activa: true, orden: 3, confirmada: false },   // borrador: no aplica
];
const base = { numInst: 'I-1', esbrainUuid: 'u-1', cliente: 'Cliente', direccion: 'Calle', fechaCierreIso: new Date().toISOString(), equipo: 'Búfala 1' };
const estado = () => { const S = fresh(); S.rol = 'admin'; S.equivalencias = REGLAS.map(r => ({ ...r })); S.configApp.demoBorrada = undefined; return S; };
const enviar = (S: ReturnType<typeof fresh>, x: Record<string, unknown>) => { const c = normalizarCierre({ ...base, ...x }); return registrarCierreLocal(S, c, traducirEnApp(S, c)); };

describe('cierres en la app', () => {
  it('consume del vehículo del equipo, con formatos fraccionados; solo reglas confirmadas', () => {
    const S = estado();
    expect(enviar(S, { tipoLinea: 'manguera', metrosLinea: 20, rj45: 2, pvc32: 5 }).estado).toBe('discrepancia');   // RJ45 no constaba en el vehículo
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(130);
    expect(unidadesABordo(S, 'V-F01', '7280040020')).toBe(-2);
    expect(unidadesABordo(S, 'V-F01', 'BF-TUB-CM20')).toBe(0);                                      // su regla es borrador
    expect(S.lineasCierre.find(l => l.campo === 'pvc32')?.estado).toBe('sin_equivalencia');
    expect(S.movements.find(m => m.sku === '7280040020')).toMatchObject({ type: 'consumo', qty: 0.08, reason: 'Consumo en obra', ref: 'I-1 · Cliente · Calle', cierre: expect.any(String) });
    expect(discrepancias(S).map(d => d.sku)).toEqual(['7280040020']);
  });
  it('idempotente y con versiones: solo la diferencia', () => {
    const S = estado();
    enviar(S, { tipoLinea: 'manguera', metrosLinea: 20 });
    expect(enviar(S, { tipoLinea: 'manguera', metrosLinea: 20 }).estado).toBe('duplicado');
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(130);
    enviar(S, { version: 2, tipoLinea: 'manguera', metrosLinea: 25 });
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(125);
    enviar(S, { version: 3, despFallido: true });                                                     // corregido a fallido: se devuelve todo
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(150);
    expect(S.cierres[0].estado).toBe('fallido');
  });
  it('los anteriores a la apertura se ignoran; un equipo desconocido queda sin vehículo', () => {
    const S = estado(); S.configApp.aperturaCierres = Date.now() + 864e5;
    expect(enviar(S, { tipoLinea: 'manguera', metrosLinea: 5 }).estado).toBe('ignorado');
    S.configApp.aperturaCierres = undefined;
    expect(enviar(S, { esbrainUuid: 'u-2', equipo: 'Búfala 7', tipoLinea: 'manguera', metrosLinea: 5 }).estado).toBe('sin_vehiculo');
  });
  it('el administrador resuelve una línea pendiente y se descuenta', () => {
    const S = estado();
    const r = enviar(S, { hardware: 'Marca rara' });
    expect(r.estado).toBe('parcial');
    const l = S.lineasCierre.find(x => x.cierre === r.id && x.campo === 'hardware')!;
    aplicarLocal(S, { op: 'resolverLinea', args: { linea: l.id, sku: 'WBX-PULSAR-22' } });
    expect(unidadesABordo(S, 'V-F01', 'WBX-PULSAR-22')).toBe(1);
    expect(S.cierres.find(c => c.id === r.id)!.estado).toBe('aplicado');
  });
  it('consumo por artículo del periodo', () => {
    const S = estado();
    enviar(S, { tipoLinea: 'manguera', metrosLinea: 20, rj45: 5 });
    enviar(S, { esbrainUuid: 'u-2', tipoLinea: 'manguera', metrosLinea: 10, rj45: 20 });
    const c = consumoPorArticulo(S, S.cierres);
    expect(c.find(x => x.sku === 'CAB-RZ1K-5G6')).toMatchObject({ unidades: 30, formatos: 30 });
    expect(c.find(x => x.sku === '7280040020')).toMatchObject({ unidades: 25, formatos: 1 });          // 25 RJ45 = 1 sobre
  });
  it('recuento de vehículo: el almacén deja pendiente; el administrador ajusta', () => {
    const S = estado(); S.rol = 'almacen';
    aplicarLocal(S, { op: 'recuentoVehiculo', args: { id: 'r1', vehiculo: 'V-F01', lineas: [{ sku: 'CAB-RZ1K-5G6', contado: 140 }] } });
    expect(S.pendientes[0]).toMatchObject({ tipo: 'recuento', qty: -10, vehiculo: 'V-F01' });
    S.rol = 'admin';
    aplicarLocal(S, { op: 'recuentoVehiculo', args: { id: 'r2', vehiculo: 'V-F01', lineas: [{ sku: 'CAB-RZ1K-5G6', contado: 140 }] } });
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(140);
  });
});

describe('edición de reglas y histórico', () => {
  it('condiciones y artículos en texto, ida y vuelta', () => {
    const c = { tipoLinea: 'tubo', 'hardware~': ['v2c', 'trydan'] };
    expect(condicionesTexto(c)).toBe('tipoLinea=tubo; hardware~v2c|trydan');
    expect(parseCondiciones('tipoLinea=tubo; hardware~v2c|trydan')).toEqual(c);
    expect(() => parseCondiciones('tipoLinea tubo')).toThrow(/Condición no válida/);
    const a = [{ sku: '6000650603', factor: 1 }, { sku: null, factor: 1, nombre: 'clavo' }];
    expect(articulosTexto(a)).toBe('6000650603×1, ?clavo×1');
    expect(parseArticulos('6000650603×1, ?clavo×1')).toEqual(a);
    expect(parseArticulos('abc x 2.5, bf-fix-sx8*3')).toEqual([{ sku: 'ABC', factor: 2.5 }, { sku: 'BF-FIX-SX8', factor: 3 }]);
  });
  it('CSV de "Registro" → cierres (con comillas y separador ;)', () => {
    const f = cierresDeCsv('﻿numInst;esbrainUuid;equipo;metrosLinea;cliente\nI-9;;Búfala 2;12;"Pérez; S.L."\n;;;;\n');
    expect(f).toEqual([{ numInst: 'I-9', esbrainUuid: '', equipo: 'Búfala 2', metrosLinea: '12', cliente: 'Pérez; S.L.' }]);
    expect(normalizarCierre(f[0]).metrosLinea).toBe(12);
  });
});
