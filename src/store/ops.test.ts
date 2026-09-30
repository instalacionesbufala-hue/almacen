/* Operaciones en local: lo que ve el usuario al momento, antes de que responda el servidor */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aplicarLocal, nuevoId } from './ops';
import { find } from '../domain/reglas';

let S: Estado;
beforeEach(() => { S = fresh(); });

describe('rol almacén (E-004)', () => {
  beforeEach(() => { S.rol = 'almacen'; });
  it('E-013: la merma se aplica al momento y queda como aviso para el administrador', () => {
    aplicarLocal(S, { op: 'movimiento', args: { id: nuevoId(), sku: '6040615316', tipo: 'merma', qty: 10, motivo: 'Corte sobrante', ref: '', series: [] } });
    expect(find(S, '6040615316')!.stock).toBe(295);
    expect(S.pendientes[0]).toMatchObject({ tipo: 'merma', sku: '6040615316', qty: 10, reason: 'Corte sobrante', estado: 'aplicada' });
  });
  it('no puede hacer ajustes ni validar ni borrar referencias', () => {
    expect(() => aplicarLocal(S, { op: 'movimiento', args: { id: nuevoId(), sku: 'BF-FIX-SX8', tipo: 'ajuste', qty: -1, motivo: 'x', ref: '', series: [] } })).toThrow(/administrador/);
    expect(() => aplicarLocal(S, { op: 'validarPendiente', args: { id: 'x', aprobar: true, nota: '' } })).toThrow(/administrador/);
    expect(() => aplicarLocal(S, { op: 'borrarProducto', args: { sku: 'BF-FIX-SX8' } })).toThrow(/administrador/);
  });
  it('el recuento deja las diferencias pendientes', () => {
    aplicarLocal(S, { op: 'recuento', args: { id: nuevoId(), pasillo: 'P03', lineas: [{ sku: 'BF-FIX-SX6', contado: 2 }, { sku: 'BF-FIX-SX8', contado: 12 }] } });
    expect(find(S, 'BF-FIX-SX6')!.stock).toBe(3);
    expect(S.pendientes).toHaveLength(1);
    expect(S.pendientes[0]).toMatchObject({ tipo: 'recuento', qty: -1 });
  });
  it('crea borradores con el código escaneado', () => {
    aplicarLocal(S, { op: 'borrador', args: { sku: '', ean: '8412345678905', nombre: 'Caja estanca', cat: 'aparamenta' } });
    expect(find(S, 'BORR-8412345678905')).toMatchObject({ borrador: true, stock: 0 });
    expect(() => aplicarLocal(S, { op: 'borrador', args: { sku: '', ean: '8412345678905', nombre: 'otra', cat: 'aparamenta' } })).toThrow(/Ya existe/);
  });
});

describe('rol administrador', () => {
  it('el recuento ajusta y la validación aplica o rechaza', () => {
    aplicarLocal(S, { op: 'recuento', args: { id: nuevoId(), pasillo: 'P03', lineas: [{ sku: 'BF-FIX-SX6', contado: 2 }] } });
    expect(find(S, 'BF-FIX-SX6')!.stock).toBe(2);
    S.pendientes.push({ id: 'p1', ts: 0, tipo: 'merma', sku: 'BF-FIX-SX8', qty: 2, reason: 'Rotura', ref: '', serials: [], operator: 'x', estado: 'pendiente' });
    aplicarLocal(S, { op: 'validarPendiente', args: { id: 'p1', aprobar: true, nota: '' } });
    expect(find(S, 'BF-FIX-SX8')!.stock).toBe(10);
    expect(S.pendientes.find(p => p.id === 'p1')!.estado).toBe('aprobado');
  });
  it('solo borra referencias sin stock ni historial', () => {
    expect(() => aplicarLocal(S, { op: 'borrarProducto', args: { sku: 'BF-FIX-SX8' } })).toThrow(/historial|sin stock/);
    aplicarLocal(S, { op: 'borrador', args: { sku: 'NUEVA', ean: '', nombre: 'x', cat: 'aparamenta' } });
    aplicarLocal(S, { op: 'borrarProducto', args: { sku: 'NUEVA' } });
    expect(find(S, 'NUEVA')).toBeUndefined();
  });
});
