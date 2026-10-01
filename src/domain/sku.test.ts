/* E-021 · SKU válido en todas las altas, carpeta segura de las fotos y reparación de un artículo con código no válido */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { MOTIVO_FOTO_SKU, motivoLegible } from '../store/motivos';
import { claveSku, destinoDeFoto, rutasFoto } from './fotos';
import { find, resolveCode } from './reglas';

let S: Estado;
beforeEach(() => { S = fresh(); S.rol = 'admin'; });
const RARO = 'HTTP://TAG.YT/ZESA7';
const prod = (sku: string) => ({ sku, name: 'Clavos', cat: 'fijaciones', unit: 'ud' as const, contenido: 1, stock: 0, min: 0, minimoDefinido: true, supplier: '' });

describe('carpeta de las fotos', () => {
  it('para un SKU válido es el propio SKU (las fotos subidas no cambian de ruta), con punto y guion', () => {
    expect(rutasFoto('sal.dif-40', 'webp', 'm1')).toEqual({ foto: 'productos/SAL.DIF-40/m1.webp', mini: 'productos/SAL.DIF-40/m1-mini.webp' });
  });
  it('un SKU antiguo con "/" y ":" se codifica igual que en el servidor (_clave_sku)', () => {
    expect(claveSku(RARO)).toBe('HTTP!3A!2F!2FTAG.YT!2FZESA7');
    expect(rutasFoto(RARO, 'webp', 'a').foto).toBe('productos/HTTP!3A!2F!2FTAG.YT!2FZESA7/a.webp');
    expect(claveSku('Ñ 1')).toBe('!C3!91!201');
  });
});

describe('SKU válido en todas las altas (misma regla que el servidor)', () => {
  it('alta a mano, borrador, importación y cambio de código rechazan una URL', () => {
    expect(() => aplicarLocal(S, { op: 'producto', args: { producto: prod(RARO), nuevo: true, stockInicial: 0 } })).toThrow(/caracteres no válidos/);
    expect(() => aplicarLocal(S, { op: 'importarCatalogo', args: { filas: [{ sku: 'A/B', nombre: 'x', categoria: 'fijaciones', unidad: 'ud', contenido: 1, minimo: null, proveedor: '', ref_proveedor: '', propiedad: 'propia', propietario: '', stock: null }], actualizar: false } } as never)).toThrow(/caracteres no válidos/);
    expect(() => aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: '6040615316', nuevo: 'X:1' } })).toThrow(/caracteres no válidos/);
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '8412345678905', sku: 'CAB-RZ1K-5G6', tipo: 'EAN' } });
    expect(() => aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: '6040615316', nuevo: '8412345678905' } })).toThrow(/código alternativo/);
    expect(() => aplicarLocal(S, { op: 'producto', args: { producto: prod('8412345678905'), nuevo: true, stockInicial: 0 } })).toThrow(/código alternativo/);
    aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: 'CAB-RZ1K-5G6', nuevo: '8412345678905' } });                        // el suyo sí: pasa a ser su SKU
    expect(S.codigos.some(c => c.codigo === '8412345678905')).toBe(false);
    S.rol = 'almacen';
    expect(() => aplicarLocal(S, { op: 'borrador', args: { sku: 'CON ESPACIO', ean: '', nombre: 'x', cat: 'fijaciones' } })).toThrow(/espacios/);
  });
});

describe('reparar un artículo antiguo con código no válido', () => {
  it('se cambia el código, el antiguo queda como alternativo y la foto en cola va al código nuevo', () => {
    S.products.push({ ...prod(RARO), stock: 6 });
    aplicarLocal(S, { op: 'producto', args: { producto: { ...prod(RARO), name: 'Clavos HC6-27' }, nuevo: false, stockInicial: 0 } });   // editarlo sin cambiar el código se puede
    aplicarLocal(S, { op: 'cambiarCodigo', args: { sku: RARO, nuevo: '3439510575536' } });
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: RARO, sku: '3439510575536', tipo: 'QR' } });
    expect(find(S, '3439510575536')).toMatchObject({ name: 'Clavos HC6-27', stock: 6 });
    expect(resolveCode(S, 'http://tag.yt/zeSA7')!.p.sku).toBe('3439510575536');
    expect(destinoDeFoto(S, RARO)).toBe('3439510575536');
    expect(destinoDeFoto(S, '3439510575536')).toBe('3439510575536');
    expect(destinoDeFoto(S, 'NO-EXISTE')).toBeNull();
  });
  it('el error de la foto se explica en lenguaje normal', () => {
    expect(motivoLegible('Ruta de la foto no válida')).toBe(MOTIVO_FOTO_SKU);
    expect(motivoLegible('new row violates row-level security policy')).toBe(MOTIVO_FOTO_SKU);
    expect(motivoLegible('Error: Solo hay 3 ud')).toBe('Solo hay 3 ud');
  });
});
