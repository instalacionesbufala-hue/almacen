/* E-018 · Ajuste de inventario en local (misma regla que el servidor) y aviso de código ya ingresado por albarán */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aplicarLocal, nuevoId } from '../store/ops';
import { construirInforme } from '../../supabase/functions/_compartido/informe';
import { albaranesConCodigo, avisoStockInicial, previsionAjuste } from './ajuste';
import { find, unidadesABordo } from './reglas';

let S: Estado;
beforeEach(() => { S = fresh(); S.rol = 'admin'; });
const aj = (sku: string, qty: number, motivo: string, vehiculo?: string) => aplicarLocal(S, { op: 'ajuste', args: { id: nuevoId(), sku, qty, motivo, vehiculo } });

describe('ajuste de inventario', () => {
  it('el administrador ajusta en negativo y en positivo; "de X a Y" antes de confirmar', () => {
    expect(previsionAjuste(S, { sku: '6040615316', qty: -20, motivo: 'x' })).toEqual({ de: 305, a: 285 });
    aj('6040615316', -20, 'Duplicado de la corrección del albarán 3.322.577');
    expect(find(S, '6040615316')!.stock).toBe(285);
    aj('6040615316', 5, 'Rollo encontrado');
    expect(find(S, '6040615316')!.stock).toBe(290);
    expect(S.movements[1]).toMatchObject({ type: 'ajuste', qty: -20, reason: 'Duplicado de la corrección del albarán 3.322.577', ref: 'Ajuste de inventario' });
  });
  it('en un vehículo cambia lo que lleva a bordo, no el almacén', () => {
    const v = S.aBordo.find(x => x.unidades > 10)!, p = find(S, v.sku)!, antes = p.stock, abordo = unidadesABordo(S, v.vehiculo, v.sku);
    aj(v.sku, -1, 'Recuento mal hecho', v.vehiculo);
    expect(unidadesABordo(S, v.vehiculo, v.sku)).toBe(abordo - (p.contenido || 1));
    expect(p.stock).toBe(antes);
  });
  it('motivo obligatorio, distinto de cero y sin dejar el stock en negativo', () => {
    expect(() => aj('6040615316', -1, '  ')).toThrow(/motivo/);
    expect(() => aj('6040615316', 0, 'x')).toThrow(/distinta de cero/);
    expect(() => aj('6040615316', -9999, 'x')).toThrow(/negativo/);
    expect(find(S, '6040615316')!.stock).toBe(305);
  });
  it('el rol almacén no puede ajustar: lo propone y el administrador lo aplica desde la bandeja', () => {
    S.rol = 'almacen';
    expect(() => aj('6040615316', -10, 'Contado dos veces')).toThrow(/Solo el administrador/);
    const id = nuevoId();
    aplicarLocal(S, { op: 'proponerAjuste', args: { id, sku: '6040615316', qty: -10, motivo: 'Contado dos veces' } });
    expect(S.pendientes[0]).toMatchObject({ id, tipo: 'ajuste', qty: -10, reason: 'Contado dos veces', estado: 'pendiente' });
    expect(find(S, '6040615316')!.stock).toBe(305);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'validarPendiente', args: { id, aprobar: true, nota: '' } });
    expect(find(S, '6040615316')!.stock).toBe(295);
    expect(S.movements[0]).toMatchObject({ type: 'ajuste', qty: -10, reason: 'Contado dos veces' });
  });
  it('no cuenta como merma, ni como salida a obra, ni como consumo', () => {
    const pend = S.pendientes.length;
    aj('6040615316', -20, 'Duplicado');
    expect(S.pendientes.length).toBe(pend);
    const inf = construirInforme({ propietario: 'x', desde: 0, hasta: Date.now() + 1, actas: [],
      productos: [{ sku: '6040615316', nombre: 'Cable', unidad: 'm', stock: 285, minimo: 0 }],
      movimientos: S.movements.filter(m => m.sku === '6040615316' && m.type === 'ajuste').map(m => ({ ts: m.ts, sku: m.sku, tipo: m.type, cantidad: m.qty, motivo: m.reason, referencia: m.ref, series: [], operario: m.operator })) });
    expect(inf.resumen).toMatchObject({ salidas: 0, incidencias: 0 });
    expect(inf.secciones.find(s => s.titulo === 'Diferencias de recuento')!.filas).toHaveLength(1);
  });
});

describe('aviso de código ya ingresado por albarán', () => {
  it('avisa si el código aparece impreso en un albarán, aunque se emparejara con otro artículo', () => {
    aplicarLocal(S, { op: 'albaran', args: { id: 'A1', cabecera: { numero: '3.322.577', proveedor: 'Saltoki', cif: '', fecha: '', confianza: 1, modo: 'ia' },
      lineas: [{ sku: '6040615316', cantidad: 20, series: [], codigo: '6222 106082' }] } });
    expect(albaranesConCodigo(S, '6222106082')).toEqual(['3.322.577']);
    expect(avisoStockInicial(S, '6222106082', 20)).toBe('Ese código ya ha entrado por el albarán 3.322.577; ¿seguro que quieres añadir stock inicial?');
    expect(avisoStockInicial(S, '6222106082', 0)).toBeNull();          // sin stock inicial no hace falta avisar
    expect(avisoStockInicial(S, '9999999999', 20)).toBeNull();
  });
});
