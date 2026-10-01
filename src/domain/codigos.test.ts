/* E-020 / E-021 · Qué código manda, códigos alternativos y formato de SKU */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aplicarLocal, nuevoId } from '../store/ops';
import { elegirCodigo, guardarComoAlternativo, motivoSkuNoValido, siguienteSkuInterno, skuPropuesto, tipoCodigo } from './codigos';
import { formularioInicial, opDeAlta } from './altaCamara';
import { catalogoParaEmparejar, find, matchLine, resolveCode, searchProducts } from './reglas';

let S: Estado;
beforeEach(() => { S = fresh(); S.rol = 'admin'; });

describe('qué código manda en un fotograma', () => {
  it('un QR del almacén (BUF:) siempre gana', () => {
    expect(elegirCodigo([{ texto: '8412345678905', formato: 'EAN13' }, { texto: 'BUF:CAB-RZ1K-5G6', formato: 'QRCode' }])).toEqual({ tipo: 'codigo', codigo: 'BUF:CAB-RZ1K-5G6', formato: 'QRCode' });
  });
  it('un código de barras gana a la URL del QR del fabricante', () => {
    expect(elegirCodigo([{ texto: 'http://tag.yt/zeSA7', formato: 'QRCode' }, { texto: '3439510575536', formato: 'EAN13' }])).toEqual({ tipo: 'codigo', codigo: '3439510575536', formato: 'EAN13' });
  });
  it('solo una URL ajena: se avisa (no es un código del almacén); un QR que no es URL sí vale', () => {
    expect(elegirCodigo([{ texto: 'http://tag.yt/zeSA7', formato: 'QRCode' }])).toEqual({ tipo: 'ajena', url: 'http://tag.yt/zeSA7' });
    expect(elegirCodigo([{ texto: 'CP-VE-1F-40', formato: 'QRCode' }])).toMatchObject({ tipo: 'codigo', codigo: 'CP-VE-1F-40' });
    expect(elegirCodigo([])).toBeNull();
  });
  it('tipo del código para guardarlo', () => {
    expect(tipoCodigo('8412345678905', 'EAN13')).toBe('EAN');
    expect(tipoCodigo('BF-1', 'Code128')).toBe('Code 128');
    expect(tipoCodigo('http://x', 'QRCode')).toBe('QR');
    expect(tipoCodigo('8412345678905')).toBe('EAN');
    expect(tipoCodigo('ABC')).toBe('otro');
  });
});

describe('códigos alternativos (E-020)', () => {
  it('asociar un EAN a un artículo hace que el siguiente escaneo lo abra', () => {
    expect(resolveCode(S, '3439510575536')).toBeNull();
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '3439510575536', sku: 'CAB-RZ1K-5G6', tipo: 'EAN' } });
    expect(resolveCode(S, '3439510575536')!.p.sku).toBe('CAB-RZ1K-5G6');
    expect(searchProducts(S, '3439510575536').map(p => p.sku)).toEqual(['CAB-RZ1K-5G6']);
    expect(catalogoParaEmparejar(S).find(p => p.sku === 'CAB-RZ1K-5G6')!.codigos).toEqual(['3439510575536']);
    expect(matchLine(S, '3439510575536', 'lo que sea')).toMatchObject({ sku: 'CAB-RZ1K-5G6' });
  });
  it('un código no puede ser de dos artículos ni el SKU de otro', () => {
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '3439510575536', sku: 'CAB-RZ1K-5G6', tipo: 'EAN' } });
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '3439510575536', sku: 'CAB-RZ1K-5G6', tipo: 'EAN' } });     // el mismo: no duplica
    expect(S.codigos).toHaveLength(1);
    expect(() => aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '3439510575536', sku: '6040615316', tipo: 'EAN' } })).toThrow(/ya está asociado/);
    expect(() => aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '6040615316', sku: 'CAB-RZ1K-5G6', tipo: 'otro' } })).toThrow(/ya es de/);
  });
  it('el almacén asocia; solo el administrador quita', () => {
    S.rol = 'almacen';
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '111222333', sku: 'CAB-RZ1K-5G6', tipo: 'otro' } });
    expect(() => aplicarLocal(S, { op: 'quitarCodigo', args: { codigo: '111222333' } })).toThrow(/administrador/);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'quitarCodigo', args: { codigo: '111222333' } });
    expect(S.codigos).toHaveLength(0);
  });
  it('al fusionar, los códigos pasan al artículo que lo sustituye', () => {
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: '999', sku: '6040615316', tipo: 'otro' } });
    aplicarLocal(S, { op: 'fusionar', args: { origen: '6040615316', destino: '6040615310', motivo: 'Era el mismo' } });
    expect(S.codigos[0].sku).toBe('6040615310');
  });
  it('el código leído se guarda como alternativo del artículo creado si no es ya su SKU ni su EAN', () => {
    expect(guardarComoAlternativo('http://tag.yt/zeSA7', { sku: 'BF-000001' })).toBe(true);
    expect(guardarComoAlternativo('8412345678905', { sku: 'X', ean: '8412345678905' })).toBe(false);
    expect(guardarComoAlternativo('abc-1', { sku: 'ABC-1' })).toBe(false);
  });
  it('firmar una entrega no pide teléfono ni correo', () => {
    aplicarLocal(S, { op: 'prepararEntrega', args: { id: 'E1', equipo: 'F01', obra: '', lineas: [{ tipo: 'stock', sku: 'CAB-RZ1K-5G6', qty: 1, serials: [] }] } });
    aplicarLocal(S, { op: 'confirmarEntrega', args: { id: 'E1', firma: 'f', recoge: 'T1' } });
    expect(S.entregas.find(e => e.id === 'E1')!.estado).toBe('firmada');
  });
});

describe('formato de SKU y alta desde un código raro (E-021)', () => {
  it('solo letras, números, guion, guion bajo y punto, de 2 a 40', () => {
    expect(motivoSkuNoValido('6040615316')).toBeNull();
    expect(motivoSkuNoValido('TRY32-1-L10-P')).toBeNull();
    expect(motivoSkuNoValido('A.B_C-1')).toBeNull();
    expect(motivoSkuNoValido('HTTP://TAG.YT/ZESA7')).toMatch(/caracteres no válidos \(: \/\)/);
    expect(motivoSkuNoValido('CON ESPACIO')).toMatch(/espacios/);
    expect(motivoSkuNoValido('A')).toMatch(/al menos 2/);
    expect(motivoSkuNoValido('X'.repeat(41))).toMatch(/40/);
  });
  it('desde la URL del QR del fabricante se propone un SKU interno correlativo', () => {
    expect(siguienteSkuInterno(['BF-000007', 'X', 'BF-000002'])).toBe('BF-000008');
    expect(skuPropuesto(S, 'http://tag.yt/zeSA7')).toBe('BF-000001');
    expect(skuPropuesto(S, 'try32-1-l10-p')).toBe('TRY32-1-L10-P');
    const f = formularioInicial({ codigo: 'http://tag.yt/zeSA7', skuInterno: 'BF-000001' });
    expect(f).toMatchObject({ sku: 'BF-000001', supplierRef: '' });
    expect(() => opDeAlta('admin', { ...f, name: 'Clavos', sku: 'HTTP://TAG.YT/ZESA7' }, nuevoId())).toThrow(/caracteres no válidos/);
    const op = opDeAlta('admin', { ...f, name: 'Clavos' }, nuevoId());
    aplicarLocal(S, op);
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: 'http://tag.yt/zeSA7', sku: 'BF-000001', tipo: 'QR' } });
    expect(find(S, 'BF-000001')!.name).toBe('Clavos');
    expect(resolveCode(S, 'http://tag.yt/zeSA7')!.p.sku).toBe('BF-000001');
  });
});
