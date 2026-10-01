/* E-022 · Borrar, archivar, restaurar, deshacer fusión y reutilizar el código de un archivado (en local, mismas reglas que el servidor) */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado, Producto } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aplicarLocal, nuevoId } from '../store/ops';
import { reaplicarCola } from '../store/nube/sync';
import { rastro } from './archivo';
import { find, resolveCode, searchProducts } from './reglas';

let S: Estado;
beforeEach(() => { S = fresh(); S.rol = 'admin'; });
const prod = (sku: string, name = `Artículo ${sku}`): Producto => ({ sku, name, cat: 'cargadores', unit: 'ud', contenido: 1, stock: 0, min: 0, minimoDefinido: true, supplier: '' });
const alta = (sku: string, stockInicial = 0, name?: string) => aplicarLocal(S, { op: 'producto', args: { producto: prod(sku, name), nuevo: true, stockInicial } });

describe('borrar y archivar', () => {
  it('sin rastro se borra; con rastro no, y dice qué la retiene', () => {
    alta('NUEVO-1');
    aplicarLocal(S, { op: 'borrarProducto', args: { sku: 'NUEVO-1' } });
    expect(find(S, 'NUEVO-1')).toBeUndefined();
    alta('NUEVO-2', 1);
    S.rol = 'almacen'; aplicarLocal(S, { op: 'proponerAjuste', args: { id: nuevoId(), sku: 'NUEVO-2', qty: -1, motivo: 'Contado dos veces' } }); S.rol = 'admin';
    expect(rastro(S, 'NUEVO-2').texto).toBe('Tiene 1 movimiento y 1 pendiente en tu bandeja');
    expect(() => aplicarLocal(S, { op: 'borrarProducto', args: { sku: 'NUEVO-2' } })).toThrow(/No se puede borrar definitivamente: Tiene 1 movimiento y 1 pendiente en tu bandeja\. Archívala/);
    expect(find(S, 'NUEVO-2')).toBeTruthy();
  });
  it('archivar exige stock 0; deja de salir en listas, buscador y escáner; restaurar lo devuelve', () => {
    expect(() => aplicarLocal(S, { op: 'archivarProducto', args: { sku: '6040615316', motivo: '' } })).toThrow(/en el almacén: haz antes un ajuste/);
    aplicarLocal(S, { op: 'ajuste', args: { id: nuevoId(), sku: '6040615316', qty: -305, motivo: 'Ya no se usa' } });
    aplicarLocal(S, { op: 'archivarProducto', args: { sku: '6040615316', motivo: 'Ya no se usa' } });
    expect(S.products.some(p => p.sku === '6040615316')).toBe(false);
    expect(S.archivados!.find(p => p.sku === '6040615316')).toMatchObject({ archivado: true, archivadoPor: S.operator });
    expect(searchProducts(S, '6040615316')).toEqual([]);
    expect(resolveCode(S, '6040615316')).toBeNull();
    aplicarLocal(S, { op: 'restaurarProducto', args: { sku: '6040615316' } });
    expect(S.products.some(p => p.sku === '6040615316')).toBe(true);
  });
});

describe('los archivados no bloquean su código', () => {
  it('el caso del Trydan: cambiar el código del activo al de un fusionado lo reactiva y se queda con todo', () => {
    alta('TRY32-1-L10-P', 6, 'Trydan 7,4 kW 10 m');
    alta('8900500020');
    aplicarLocal(S, { op: 'fusionar', args: { origen: '8900500020', destino: 'TRY32-1-L10-P', motivo: 'Era el mismo' } });
    aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: 'TRY32-1-L10-P', nuevo: '8900500020' } });
    expect(S.products.find(p => p.sku === '8900500020')).toMatchObject({ name: 'Trydan 7,4 kW 10 m', stock: 6 });
    expect(S.archivados!.find(p => p.sku === 'TRY32-1-L10-P')!.fusionadoEn).toBe('8900500020');
    expect(S.archivados!.some(p => p.sku === '8900500020')).toBe(false);
    expect(resolveCode(S, 'TRY32-1-L10-P')!.p.sku).toBe('8900500020');
  });
  it('dar de alta con el código de un archivado lo reactiva; chocar con un activo dice cuál es', () => {
    aplicarLocal(S, { op: 'fusionar', args: { origen: '6040615316', destino: '6040615310', motivo: '' } });
    alta('6040615316', 3, 'Cable nuevo');
    expect(S.products.find(p => p.sku === '6040615316')).toMatchObject({ name: 'Cable nuevo', stock: 3 });
    expect(S.archivados!.some(p => p.sku === '6040615316')).toBe(false);
    expect(() => aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: '6040615316', nuevo: '6040615310' } })).toThrow(/Ya existe un artículo activo con el código 6040615310: Cable RZ1-K/);
  });
});

describe('deshacer una fusión', () => {
  it('revierte los ajustes si el destino aún tiene lo recibido; si no, lo explica', () => {
    aplicarLocal(S, { op: 'fusionar', args: { origen: '6040615316', destino: '6040615310', motivo: 'Error' } });   // 305 m pasan (125 → 430)
    expect(find(S, '6040615310')!.stock).toBe(430);
    aplicarLocal(S, { op: 'deshacerFusion', args: { sku: '6040615316' } });
    expect([find(S, '6040615316')!.stock, find(S, '6040615310')!.stock]).toEqual([305, 125]);
    expect(S.products.some(p => p.sku === '6040615316')).toBe(true);
    aplicarLocal(S, { op: 'fusionar', args: { origen: '6040615316', destino: '6040615310', motivo: 'Error' } });
    aplicarLocal(S, { op: 'ajuste', args: { id: nuevoId(), sku: '6040615310', qty: -400, motivo: 'Consumido' } });
    expect(() => aplicarLocal(S, { op: 'deshacerFusion', args: { sku: '6040615316' } })).toThrow(/ya no tiene las 305 m que recibió/);
  });
});

describe('operación rechazada por el servidor', () => {
  it('no se reaplica sobre el estado real: el cambio local se deshace y la operación queda rechazada en la cola', () => {
    const real = fresh(); real.rol = 'admin'; real.products.push(prod('SIN-RASTRO'));
    const op = { op: 'borrarProducto' as const, args: { sku: 'SIN-RASTRO' } };
    const pendiente = reaplicarCola(structuredClone(real), [{ op, ts: 0, estado: 'pendiente', desc: '' }]);
    expect(find(pendiente, 'SIN-RASTRO')).toBeUndefined();                       // mientras espera, se ve aplicado …
    const rechazada = reaplicarCola(structuredClone(real), [{ op, ts: 0, estado: 'rechazada', motivo: 'No se puede borrar definitivamente…', desc: '' }]);
    expect(find(rechazada, 'SIN-RASTRO')).toBeTruthy();                         // …y al rechazarse vuelve a salir tal como está en el servidor
  });
});

describe('EAN al fusionar y EAN repetido (E-023)', () => {
  it('el caso actual del usuario: TRY32 (con EAN) se fusiona en el 8900500020 vacío y este se queda las 6 ud y el EAN', () => {
    aplicarLocal(S, { op: 'producto', args: { producto: { ...prod('TRY32-1-L10-P'), ean: '8900500020' }, nuevo: true, stockInicial: 6 } });
    alta('8900500020');
    aplicarLocal(S, { op: 'fusionar', args: { origen: 'TRY32-1-L10-P', destino: '8900500020', motivo: 'Era el mismo' } });
    expect(S.products.find(p => p.sku === '8900500020')).toMatchObject({ stock: 6, ean: '8900500020' });
    expect(S.archivados!.find(p => p.sku === 'TRY32-1-L10-P')!.ean).toBeUndefined();
  });
  it('un EAN que ya tiene otro artículo se rechaza diciendo cuál', () => {
    aplicarLocal(S, { op: 'producto', args: { producto: { ...prod('A-1'), ean: '8436000000031' }, nuevo: true, stockInicial: 0 } });
    expect(() => aplicarLocal(S, { op: 'producto', args: { producto: { ...prod('B-1'), ean: '8436000000031' }, nuevo: true, stockInicial: 0 } })).toThrow(/El EAN 8436000000031 ya lo tiene el artículo A-1/);
  });
});
