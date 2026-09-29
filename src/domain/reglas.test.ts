import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { applyMovement, esCustodia, find, invValue, resolveCode as resolver, matchLine, pedidoSugerido, qrContenido, resolveCode, searchProducts, status, vanStock } from './reglas';
import { csvTexto } from './csv';
import { hashEntrega } from './hash';
import { parseSN, toNum } from './formato';

let S: Estado;
beforeEach(() => { S = fresh(); });

describe('semáforo', () => {
  it('rojo por debajo del mínimo, amarillo por debajo de 1,5 × mínimo, verde si no', () => {
    expect(status({ stock: 99, min: 100 })).toBe('red');
    expect(status({ stock: 100, min: 100 })).toBe('amber');
    expect(status({ stock: 149, min: 100 })).toBe('amber');
    expect(status({ stock: 150, min: 100 })).toBe('green');
  });
  it('mínimos de referencia: tacos 100 ud y cargadores 2 ud', () => {
    expect(status(find(S, 'BF-FIX-SX6')!)).toBe('red');   // 80 tacos
    expect(status(find(S, 'BF-VE-WBX74')!)).toBe('red');  // 1 cargador
    expect(status(find(S, 'BF-VE-POL74')!)).toBe('amber'); // 2 cargadores
  });
});

describe('movimientos', () => {
  it('una entrada suma stock y deja rastro con operario', () => {
    const r = applyMovement(S, { sku: 'BF-FIX-SX8', type: 'entrada', qty: 100, reason: 'Compra a proveedor', ref: 'Alb. 1' });
    expect(r.p.stock).toBe(1300);
    expect(S.movements[0]).toMatchObject({ sku: 'BF-FIX-SX8', type: 'entrada', qty: 100, operator: 'Oficina' });
  });
  it('no permite salida ni merma mayor que el stock', () => {
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX6', type: 'salida', qty: 81, reason: 'x' })).toThrow(/Solo hay/);
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX6', type: 'merma', qty: 81, reason: 'x' })).toThrow(/Solo hay/);
    expect(find(S, 'BF-FIX-SX6')!.stock).toBe(80);
  });
  it('rechaza cantidades cero o negativas', () => {
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX8', type: 'entrada', qty: 0, reason: 'x' })).toThrow();
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX8', type: 'entrada', qty: -5, reason: 'x' })).toThrow();
  });
  it('los cargadores exigen un n.º de serie por unidad y sin duplicados', () => {
    expect(() => applyMovement(S, { sku: 'BF-VE-POL74', type: 'entrada', qty: 2, reason: 'x', serials: ['A-1'] })).toThrow(/n.º de serie/);
    expect(() => applyMovement(S, { sku: 'BF-VE-POL74', type: 'entrada', qty: 1, reason: 'x', serials: ['PCH74-26-0412'] })).toThrow(/ya está en stock/);
    expect(() => applyMovement(S, { sku: 'BF-VE-POL74', type: 'entrada', qty: 2, reason: 'x', serials: ['N-1', 'N-1'] })).toThrow(/repetidos/);
    expect(() => applyMovement(S, { sku: 'BF-VE-POL74', type: 'salida', qty: 1, reason: 'x', ref: 'Obra', serials: ['NO-EXISTE'] })).toThrow(/no está en stock/);
    const r = applyMovement(S, { sku: 'BF-VE-POL74', type: 'salida', qty: 1, reason: 'x', ref: 'Garaje C/ Eros 10', serials: ['PCH74-26-0412'] });
    expect(r.p.serials).toEqual(['PCH74-26-0419']);
    expect(r.p.stock).toBe(1);
  });
  it('una entrada que recupera el mínimo cierra el pedido de reposición', () => {
    S.pedidos['BF-FIX-SX6'] = { ts: 0, qty: 200 };
    applyMovement(S, { sku: 'BF-FIX-SX6', type: 'entrada', qty: 10, reason: 'x' });
    expect(S.pedidos['BF-FIX-SX6']).toBeDefined();
    applyMovement(S, { sku: 'BF-FIX-SX6', type: 'entrada', qty: 20, reason: 'x' });
    expect(S.pedidos['BF-FIX-SX6']).toBeUndefined();
  });
  it('los metros admiten decimales sin errores de redondeo', () => {
    applyMovement(S, { sku: 'BF-TUB-CM20', type: 'salida', qty: 0.1, reason: 'x' });
    applyMovement(S, { sku: 'BF-TUB-CM20', type: 'salida', qty: 0.2, reason: 'x' });
    expect(find(S, 'BF-TUB-CM20')!.stock).toBe(599.7);
  });
});

describe('buscador', () => {
  it('encuentra por varios términos, sin tildes y en plural', () => {
    expect(searchProducts(S, 'tacos sx 8').map(p => p.sku)).toContain('BF-FIX-SX8');
    expect(searchProducts(S, 'magnetotermico').length).toBeGreaterThan(0);
  });
  it('encuentra por EAN, ubicación y n.º de serie', () => {
    expect(searchProducts(S, '4006209700985')[0].sku).toBe('BF-FIX-SX6');
    expect(searchProducts(S, 'P06-E02').every(p => p.loc.startsWith('P06-E02'))).toBe(true);
    expect(searchProducts(S, 'CC-9915')[0].sku).toBe('CIR-ENEXT-S');
  });
  it('filtra por categoría, estado y pasillo y ordena lo crítico primero', () => {
    const r = searchProducts(S, '', { cat: 'fijaciones' });
    expect(r.every(p => p.cat === 'fijaciones')).toBe(true);
    expect(status(r[0])).toBe('red');
    expect(searchProducts(S, '', { est: 'red' }).every(p => status(p) === 'red')).toBe(true);
    expect(searchProducts(S, '', { pas: 'P06' }).every(p => p.cat === 'cargadores' || p.cat === 'cuadros')).toBe(true);
  });
});

describe('emparejado de albaranes (cualquier proveedor)', () => {
  it('por código exacto, EAN o referencia del proveedor', () => {
    expect(matchLine(S, '7280040020', '')).toEqual({ sku: '7280040020', how: 'código' });
    expect(matchLine(S, '4006209701234', '').sku).toBe('BF-FIX-SX8');
    expect(matchLine(S, 'A9F74240', 'lo que sea').sku).toBe('SCH-IC60N-40'); // Schneider, no Saltoki
    expect(matchLine(S, 'pol-74-t2', '').sku).toBe('BF-VE-POL74');
  });
  it('por prefijo cuando el proveedor añade sufijos', () => {
    expect(matchLine(S, '6040615306724', '')).toEqual({ sku: '6040615306', how: 'código (prefijo)' });
  });
  it('por descripción cuando no hay código', () => {
    expect(matchLine(S, '', 'Taco nylon SX 8x40 caja 100').sku).toBe('BF-FIX-SX8');
  });
  it('no inventa correspondencias', () => {
    expect(matchLine(S, 'XX-123', 'Bolsa de plástico')).toEqual({ sku: null, how: null });
  });
});

describe('códigos escaneados', () => {
  it('QR propio BUF:<SKU>|SN:<serie>', () => {
    expect(qrContenido('BF-VE-POL74', 'PCH74-26-0412')).toBe('BUF:BF-VE-POL74|SN:PCH74-26-0412');
    const r = resolveCode(S, 'BUF:BF-VE-POL74|SN:PCH74-26-0412')!;
    expect(r.p.sku).toBe('BF-VE-POL74'); expect(r.serial).toBe('PCH74-26-0412'); expect(r.nuevo).toBe(false);
    expect(resolveCode(S, 'BUF:BF-VE-POL74|SN:PCH74-26-0999')!.nuevo).toBe(true);
    expect(resolveCode(S, 'BUF:BF-FIX-SX8')!.p.sku).toBe('BF-FIX-SX8');
  });
  it('SKU, EAN y n.º de serie sueltos', () => {
    expect(resolveCode(S, 'bf-fix-sx8')!.p.sku).toBe('BF-FIX-SX8');
    expect(resolveCode(S, '4006209700985')!.p.sku).toBe('BF-FIX-SX6');
    expect(resolveCode(S, 'WBX-22-899281')).toMatchObject({ serial: 'WBX-22-899281' });
    expect(resolveCode(S, 'WBX-22-899399')).toMatchObject({ serial: 'WBX-22-899399', nuevo: true });
  });
  it('devuelve null si no lo conoce', () => {
    expect(resolveCode(S, 'DESCONOCIDO')).toBeNull();
    expect(resolveCode(S, '   ')).toBeNull();
  });
});

describe('furgonetas y entregas', () => {
  it('el stock a bordo es lo entregado menos lo devuelto', () => {
    expect(vanStock(S, 'F01').find(x => x.sku === 'CAB-RZ1K-5G6')!.qty).toBe(150);
    applyMovement(S, { sku: 'CAB-RZ1K-5G6', type: 'entrada', qty: 50, reason: 'Devolución de obra', equipo: 'F01' });
    expect(vanStock(S, 'F01').find(x => x.sku === 'CAB-RZ1K-5G6')!.qty).toBe(100);
  });
  it('la huella cambia si se altera la entrega', async () => {
    const e = S.entregas[0], h = await hashEntrega(e);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashEntrega({ ...e, lineas: [{ ...e.lineas[0], qty: 99 }] })).not.toBe(h);
  });
  it('el pedido sugerido llega a 2 × mínimo en formatos completos', () => {
    expect(pedidoSugerido(find(S, 'BF-FIX-SX6')!)).toBe(200); // 80 → hasta 200, cajas de 100
    expect(pedidoSugerido(find(S, 'BF-VE-WBX74')!)).toBe(3);
  });
});

describe('utilidades', () => {
  it('CSV con punto y coma, coma decimal y comillas', () => {
    expect(csvTexto([['a;b', 1.5, 'x"y']])).toBe('﻿"a;b";1,5;"x""y"');
  });
  it('números con coma y listas de series', () => {
    expect(toNum('2,5')).toBe(2.5);
    expect(parseSN('A-1\nB-2, C-3')).toEqual(['A-1', 'B-2', 'C-3']);
  });
});

describe('custodia de Esmove (E-008)', () => {
  it('el valor del inventario no suma el material en custodia', () => {
    const propio = S.products.filter(p => !esCustodia(p)).reduce((a, p) => a + p.stock * p.price, 0);
    expect(invValue(S)).toBeCloseTo(propio);
    const wbx = find(S, 'WBX-PULSAR-22')!; wbx.price = 999; // aunque alguien le pusiera precio, no cuenta
    expect(invValue(S)).toBeCloseTo(propio);
  });
  it('cargadores y cuadros están en custodia de Esmove; solo los cargadores llevan n.º de serie', () => {
    const c = S.products.filter(p => p.cat === 'cargadores' || p.cat === 'cuadros');
    expect(c.length).toBeGreaterThan(4);
    expect(c.every(p => p.propiedad === 'custodia' && p.propietario === 'ESMOVE')).toBe(true);
    expect(c.filter(p => p.cat === 'cargadores').every(p => p.serialized)).toBe(true);
    expect(c.filter(p => p.cat === 'cuadros').some(p => p.serialized)).toBe(false);
  });
  it('los cuadros se mueven por cantidad, sin pedir n.º de serie, y se encuentran por el código de su pegatina', () => {
    applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'entrada', qty: 2, reason: 'Recepción en custodia', ref: 'Alb. Esmove 1' });
    expect(find(S, 'ESM-CPVE-MONO')!.stock).toBe(5);
    expect(() => applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'salida', qty: 1, reason: 'x', ref: 'Obra', serials: ['X'] })).toThrow(/no lleva control por n.º de serie/);
    expect(resolver(S, 'CP-VE-1F-40')!.p.sku).toBe('ESM-CPVE-MONO');
  });
  it('una salida de custodia sin obra de destino se rechaza', () => {
    expect(() => applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'salida', qty: 1, reason: 'Instalado en obra', ref: ' ' })).toThrow(/obra o instalación de destino/);
    applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'salida', qty: 1, reason: 'Instalado en obra', ref: 'Garaje C/ Recogidas 12' });
    expect(find(S, 'ESM-CPVE-MONO')!.stock).toBe(2);
  });
  it('los ajustes llevan signo y exigen motivo', () => {
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX8', type: 'ajuste', qty: -5, reason: '' })).toThrow(/motivo/);
    applyMovement(S, { sku: 'BF-FIX-SX8', type: 'ajuste', qty: -5, reason: 'Recuento' });
    expect(find(S, 'BF-FIX-SX8')!.stock).toBe(1195);
  });
});

describe('lectura de la pegatina de los cuadros (E-008)', () => {
  it('encuentra el código del modelo entre el texto leído', async () => {
    const { candidatos, codigoConocido } = await import('../features/escaner/texto');
    const texto = 'ESMOVE S.L.\nCUADRO PROTECCIONES VE\nMOD: CP-VE-3F-32  230/400V\nLote 2026';
    expect(candidatos(texto)).toContain('CP-VE-3F-32');
    expect(codigoConocido(S, texto)).toBe('CP-VE-3F-32');
    expect(codigoConocido(S, 'nada que ver 1234')).toBeNull();
  });
});
