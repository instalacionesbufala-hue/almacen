/* E-015 · Alta de artículos con la cámara */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { buscarExistente, formularioInicial, opDeAlta, parecidos, type PropuestaIA } from './altaCamara';
import { fotoDe } from './fotos';
import { find } from './reglas';

const propuesta: PropuestaIA = { tipo: 'material', nombre: 'Bote 500 tacos nylon SX 10×50', marca: 'Fischer', modelo: 'SX 10', referencia: '', ean: '4006381333931',
  categoria: 'fijaciones', unidad: 'bote', contenido: 500, talla: '', confianza: 0.9, nota: '' };

describe('duplicados', () => {
  const S = fresh();
  it('por código: SKU, EAN, código del proveedor, QR de estantería y etiqueta con sufijo', () => {
    expect(buscarExistente(S, 'bf-fix-sx8')?.sku).toBe('BF-FIX-SX8');
    expect(buscarExistente(S, find(S, 'BF-FIX-SX8')!.ean!)?.sku).toBe('BF-FIX-SX8');
    expect(buscarExistente(S, 'BUF:BF-FIX-SX8')?.sku).toBe('BF-FIX-SX8');
    expect(buscarExistente(S, 'A9F74240')?.sku).toBe('SCH-IC60N-40');
    expect(buscarExistente(S, '6040615306-02')?.sku).toBe('6040615306');       // Saltoki añade sufijos
    expect(buscarExistente(S, '9999999999999')).toBeNull();
  });
  it('por nombre: "¿Es alguno de estos?"', () => {
    expect(parecidos(S, 'caja tacos nylon SX 8x40').map(p => p.sku)).toContain('BF-FIX-SX8');
    expect(parecidos(S, 'Detector de humo óptico')).toEqual([]);
  });
});

describe('formulario y guardado', () => {
  it('la propuesta de la IA llega al formulario con unidad y contenido; el código escaneado manda', () => {
    const f = formularioInicial({ codigo: '6000650999', propuesta });
    expect(f).toMatchObject({ sku: '6000650999', supplierRef: '6000650999', ean: '4006381333931', name: 'Bote 500 tacos nylon SX 10×50', cat: 'fijaciones', unit: 'bote', contenido: '500' });
    expect(formularioInicial({ codigo: '4006381333931', propuesta: null })).toMatchObject({ sku: '4006381333931', ean: '4006381333931', supplierRef: '', name: '' });
  });
  it('alta sin IA: formulario vacío que se rellena a mano', () => {
    const S = fresh(); S.rol = 'admin';
    const f = { ...formularioInicial({ id: 'X1' }), name: 'Regleta 6 tomas', cat: 'aparamenta' as const, stock: '4' };
    expect(f.sku).toBe('ART-X1');
    aplicarLocal(S, opDeAlta('admin', f, 'id'));
    expect(find(S, 'ART-X1')).toMatchObject({ name: 'Regleta 6 tomas', stock: 4 });
    expect(find(S, 'ART-X1')!.borrador).toBeFalsy();
    expect(S.movements[0]).toMatchObject({ sku: 'ART-X1', type: 'entrada', reason: 'Alta de artículo' });
  });
  it('el almacén crea un borrador: su stock no entra hasta que el administrador lo aprueba', () => {
    const S = fresh(); S.rol = 'almacen';
    const f = { ...formularioInicial({ codigo: 'NUEVO-1', propuesta }), stock: '3', min: '5' };
    const op = opDeAlta('almacen', f, 'id');
    expect(op.op).toBe('borradorArticulo');
    const movs = S.movements.length;
    aplicarLocal(S, op);
    expect(find(S, 'NUEVO-1')).toMatchObject({ borrador: true, stock: 0, stockPropuesto: 3, unit: 'bote', contenido: 500, minimoDefinido: false });   // el mínimo es del administrador
    expect(S.movements.length).toBe(movs);
    expect(() => aplicarLocal(S, { op: 'movimiento', args: { id: 'm', sku: 'NUEVO-1', tipo: 'salida', qty: 1, motivo: 'Obra', ref: '', series: [] } })).toThrow(/borrador/);
    // el administrador lo completa: entra el stock contado como "Alta de artículo"
    S.rol = 'admin';
    const p = find(S, 'NUEVO-1')!;
    aplicarLocal(S, { op: 'producto', args: { producto: { ...p, min: 2, minimoDefinido: true }, nuevo: false, stockInicial: p.stockPropuesto! } });
    expect(find(S, 'NUEVO-1')).toMatchObject({ borrador: false, stock: 3, min: 2, stockPropuesto: undefined });
    expect(S.movements[0]).toMatchObject({ sku: 'NUEVO-1', type: 'entrada', qty: 3, reason: 'Alta de artículo', ref: 'Borrador aprobado' });
    // otra edición ya no vuelve a meter stock
    aplicarLocal(S, { op: 'producto', args: { producto: find(S, 'NUEVO-1')!, nuevo: false, stockInicial: 0 } });
    expect(find(S, 'NUEVO-1')!.stock).toBe(3);
  });
  it('no crea un duplicado por código', () => {
    const S = fresh(); S.rol = 'almacen';
    const f = { ...formularioInicial({ codigo: 'X-2', propuesta }), ean: find(S, 'BF-FIX-SX8')!.ean! };
    expect(() => aplicarLocal(S, opDeAlta('almacen', f, 'id'))).toThrow(/Ya existe una referencia con ese código: BF-FIX-SX8/);
  });
  it('la foto tomada queda como foto del artículo (también en el borrador del almacén)', () => {
    const S = fresh(); S.rol = 'almacen';
    aplicarLocal(S, opDeAlta('almacen', { ...formularioInicial({ codigo: 'CON-FOTO-1', propuesta }), stock: '1' }, 'id'));
    aplicarLocal(S, { op: 'foto', args: { sku: 'CON-FOTO-1', foto: 'productos/CON-FOTO-1/a.webp', mini: 'productos/CON-FOTO-1/a-mini.webp', origen: 'propia' } });
    expect(fotoDe(S, find(S, 'CON-FOTO-1'))).toEqual({ foto: 'productos/CON-FOTO-1/a.webp', mini: 'productos/CON-FOTO-1/a-mini.webp' });
  });
  it('herramientas: ficha de dotación, solo el administrador', () => {
    const S = fresh();
    const f = { ...formularioInicial({ tipo: 'herramienta' }), name: 'Taladro atornillador', marca: 'Makita', modelo: 'DDF484', serie: 'MK-1' };
    expect(() => opDeAlta('almacen', f, 'H900')).toThrow(/administrador/);
    aplicarLocal(S, opDeAlta('admin', f, 'H900'));
    expect(S.herramientas.find(h => h.id === 'H900')).toMatchObject({ clase: 'herramienta', nombre: 'Taladro atornillador', marca: 'Makita', modelo: 'Makita DDF484', serie: 'MK-1', estado: 'operativa' });
  });
  it('ropa y EPIs: artículo del catálogo con modelo y talla', () => {
    const S = fresh(); S.rol = 'admin';
    const f = { ...formularioInicial({ tipo: 'ropa', id: 'R1' }), name: 'Polo manga corta', talla: 'XL', stock: '6' };
    aplicarLocal(S, opDeAlta('admin', f, 'id'));
    expect(find(S, 'ART-R1')).toMatchObject({ cat: 'ropa', modelo: 'Polo manga corta', talla: 'XL', stock: 6 });
  });
});
