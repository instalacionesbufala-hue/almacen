import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { applyMovement, contenidoTxt, find, matchLine, pedidoSugerido, qrContenido, qtyTxt, resolveCode, searchProducts, status, stockDeVehiculo, stockTotal,
  ubicaciones, unidadesABordo, vanStock, vehiculoDeEquipo } from './reglas';
import { csvTexto } from './csv';
import { hashEntrega } from './hash';
import { toNum } from './formato';
import { aplicarLocal } from '../store/ops';

let S: Estado;
beforeEach(() => { S = fresh(); });

describe('semáforo del almacén', () => {
  it('rojo por debajo del mínimo, amarillo por debajo de 1,5 × mínimo, verde si no', () => {
    expect(status({ stock: 99, min: 100 })).toBe('red');
    expect(status({ stock: 100, min: 100 })).toBe('amber');
    expect(status({ stock: 149, min: 100 })).toBe('amber');
    expect(status({ stock: 150, min: 100 })).toBe('green');
  });
  it('los avisos de mínimo miran solo el almacén, no lo que llevan los vehículos', () => {
    const p = find(S, 'CAB-RZ1K-5G6')!;                  // 800 m en almacén + 150 m en Búfala 1, mínimo 200
    applyMovement(S, { sku: p.sku, type: 'salida', qty: 650, reason: 'Obra', ref: 'x' });
    expect(status(p)).toBe('red');
    expect(stockTotal(S, p)).toBe(300);                   // el vehículo no "tapa" la falta del almacén
  });
});

describe('formatos de venta (E-013)', () => {
  it('bote, sobre, bolsa y caja con su contenido; se escriben en plural', () => {
    const tacos = find(S, 'BF-FIX-SX6')!, rj = find(S, '7280040020')!;
    expect(contenidoTxt(tacos)).toBe('bote de 1000 ud');
    expect(qtyTxt(tacos, 3)).toBe('3 botes');
    expect(qtyTxt(rj, 1)).toBe('1 sobre');
    expect(qtyTxt(find(S, 'CAB-RZ1K-5G6')!, 12.5)).toBe('12,5 m');
  });
  it('en el almacén se mueven formatos enteros (el bote completo); los metros admiten decimales', () => {
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX6', type: 'salida', qty: 0.5, reason: 'Obra', ref: 'x' })).toThrow(/entero/);
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX6', type: 'entrada', qty: 1.5, reason: 'Compra' })).toThrow(/entero/);
    applyMovement(S, { sku: 'BF-TUB-CM20', type: 'salida', qty: 0.1, reason: 'x' });
    applyMovement(S, { sku: 'BF-TUB-CM20', type: 'salida', qty: 0.2, reason: 'x' });
    expect(find(S, 'BF-TUB-CM20')!.stock).toBe(599.7);
  });
  it('a bordo se cuenta en unidades: 2 RJ45 gastados de un sobre de 25 dejan 0,92 sobres', () => {
    applyMovement(S, { sku: '7280040020', type: 'traspaso', qty: 1, reason: 'Entrega a equipo', vehiculo: 'V-F01' });
    expect(unidadesABordo(S, 'V-F01', '7280040020')).toBe(25);
    applyMovement(S, { sku: '7280040020', type: 'consumo', qty: 2 / 25, reason: 'Consumo en obra', vehiculo: 'V-F01' });
    expect(unidadesABordo(S, 'V-F01', '7280040020')).toBe(23);
    expect(stockDeVehiculo(S, 'V-F01').find(x => x.sku === '7280040020')!.qty).toBe(0.92);
  });
});

describe('movimientos del almacén', () => {
  it('una entrada suma stock y deja rastro con operario', () => {
    const r = applyMovement(S, { sku: 'BF-FIX-SX8', type: 'entrada', qty: 3, reason: 'Compra a proveedor', ref: 'Alb. 1' });
    expect(r.p.stock).toBe(15);
    expect(S.movements[0]).toMatchObject({ sku: 'BF-FIX-SX8', type: 'entrada', qty: 3, operator: 'Oficina' });
  });
  it('no permite salida ni merma mayor que el stock; rechaza cero o negativo', () => {
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX6', type: 'salida', qty: 4, reason: 'x' })).toThrow(/Solo hay/);
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX6', type: 'merma', qty: 4, reason: 'x' })).toThrow(/Solo hay/);
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX8', type: 'entrada', qty: 0, reason: 'x' })).toThrow();
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX8', type: 'entrada', qty: -5, reason: 'x' })).toThrow();
    expect(find(S, 'BF-FIX-SX6')!.stock).toBe(3);
  });
  it('los cargadores van por modelo y cantidad, sin n.º de serie', () => {
    const r = applyMovement(S, { sku: 'WBX-PULSAR-22', type: 'salida', qty: 2, reason: 'Instalado en obra', ref: 'Garaje C/ Eros 10' });
    expect(r.p.stock).toBe(4);
    expect(r.p).not.toHaveProperty('serials');
    expect(S.movements[0].serials).toEqual([]);
  });
  it('una entrada que recupera el mínimo cierra el pedido de reposición', () => {
    S.pedidos['BF-FIX-SX6'] = { ts: 0, qty: 1 };
    applyMovement(S, { sku: 'BF-FIX-SX6', type: 'entrada', qty: 1, reason: 'x' });
    expect(S.pedidos['BF-FIX-SX6']).toBeUndefined();
  });
  it('los ajustes llevan signo y exigen motivo', () => {
    expect(() => applyMovement(S, { sku: 'BF-FIX-SX8', type: 'ajuste', qty: -5, reason: '' })).toThrow(/motivo/);
    applyMovement(S, { sku: 'BF-FIX-SX8', type: 'ajuste', qty: -5, reason: 'Recuento' });
    expect(find(S, 'BF-FIX-SX8')!.stock).toBe(7);
  });
});

describe('almacén y vehículos (E-013)', () => {
  it('entregar a un equipo es un traspaso almacén → vehículo: el stock total no cambia', () => {
    const p = find(S, 'BF-FIX-SX8')!, antes = stockTotal(S, p);
    applyMovement(S, { sku: p.sku, type: 'traspaso', qty: 2, reason: 'Entrega a equipo', vehiculo: 'V-F02' });
    expect(p.stock).toBe(10);
    expect(unidadesABordo(S, 'V-F02', p.sku)).toBe(200);   // 2 cajas de 100
    expect(stockTotal(S, p)).toBe(antes);
    expect(ubicaciones(S, p)).toEqual([{ donde: 'Almacén', qty: 10 }, { donde: 'Búfala 2', vehiculo: 'V-F02', qty: 2 }]);
  });
  it('la devolución vuelve al almacén y no puede superar lo que lleva el vehículo', () => {
    expect(() => applyMovement(S, { sku: 'CAB-RZ1K-5G6', type: 'devolucion', qty: 151, reason: 'Devolución de obra', vehiculo: 'V-F01' })).toThrow(/solo lleva/);
    applyMovement(S, { sku: 'CAB-RZ1K-5G6', type: 'devolucion', qty: 50, reason: 'Devolución de obra', vehiculo: 'V-F01' });
    expect(vanStock(S, 'F01').find(x => x.sku === 'CAB-RZ1K-5G6')!.qty).toBe(100);
    expect(find(S, 'CAB-RZ1K-5G6')!.stock).toBe(850);
  });
  it('un consumo que deja el vehículo en negativo se registra igualmente (discrepancia)', () => {
    applyMovement(S, { sku: 'BF-FIX-SX8', type: 'consumo', qty: 0.05, reason: 'Consumo en obra', vehiculo: 'V-F03' });
    expect(unidadesABordo(S, 'V-F03', 'BF-FIX-SX8')).toBe(-5);
  });
  it('el material es del vehículo: cambiar de equipo un técnico no mueve nada; un vehículo que cambia de equipo se lleva su material', () => {
    const antes = JSON.stringify(S.aBordo);
    aplicarLocal(S, { op: 'asignarTecnico', args: { tecnico: 'T1', equipo: 'F02' } });
    expect(JSON.stringify(S.aBordo)).toBe(antes);
    aplicarLocal(S, { op: 'asignarVehiculo', args: { vehiculo: 'V-F01', equipo: 'F03' } });
    expect(vehiculoDeEquipo(S, 'F03')).toBe('V-F01');
    expect(vehiculoDeEquipo(S, 'F01')).toBeUndefined();
    expect(vanStock(S, 'F03').find(x => x.sku === 'CAB-RZ1K-5G6')!.qty).toBe(150);   // su material va con él
    expect(S.equipos.find(e => e.id === 'F03')!.vehiculo).toBe('V-F01');
    expect(S.vehiculos.find(v => v.id === 'V-F03')!.equipo).toBeUndefined();          // el anterior de F03 queda sin equipo
  });
  it('historial: el vehículo de un equipo en una fecha anterior al cambio es el de entonces', () => {
    const antes = Date.now() - 1000;
    aplicarLocal(S, { op: 'asignarVehiculo', args: { vehiculo: 'V-F02', equipo: 'F01' } });
    expect(vehiculoDeEquipo(S, 'F01', antes)).toBe('V-F01');
    expect(vehiculoDeEquipo(S, 'F01', Date.now() + 1)).toBe('V-F02');
    const h = S.asignaciones.filter(a => a.tipo === 'vehiculo' && a.equipo === 'F01');
    expect(h.map(a => [a.sujeto, a.hasta === undefined])).toEqual([['V-F01', false], ['V-F02', true]]);
  });
});

describe('buscador', () => {
  it('encuentra por varios términos, sin tildes y en plural', () => {
    expect(searchProducts(S, 'tacos sx 8').map(p => p.sku)).toContain('BF-FIX-SX8');
    expect(searchProducts(S, 'magnetotermico').length).toBeGreaterThan(0);
    expect(searchProducts(S, '4006209700985')[0].sku).toBe('BF-FIX-SX6');
  });
  it('filtra por categoría, estado y ubicación, y ordena lo crítico primero', () => {
    const r = searchProducts(S, '', { cat: 'fijaciones' });
    expect(r.every(p => p.cat === 'fijaciones')).toBe(true);
    expect(status(r[0])).toBe('red');
    expect(searchProducts(S, '', { est: 'red' }).every(p => status(p) === 'red')).toBe(true);
    expect(searchProducts(S, '', { ubi: 'V-F01' }).map(p => p.sku).sort()).toEqual(['CAB-RZ1K-5G6', 'WBX-PULSAR-22']);
  });
});

describe('emparejado de albaranes (cualquier proveedor)', () => {
  it('por código exacto, EAN, referencia del proveedor, prefijo o descripción; no inventa', () => {
    expect(matchLine(S, '7280040020', '')).toEqual({ sku: '7280040020', how: 'código' });
    expect(matchLine(S, '4006209701234', '').sku).toBe('BF-FIX-SX8');
    expect(matchLine(S, 'A9F74240', 'lo que sea').sku).toBe('SCH-IC60N-40');
    expect(matchLine(S, '6040615306724', '')).toEqual({ sku: '6040615306', how: 'código (prefijo)' });
    expect(matchLine(S, '', 'Caja 100 tacos nylon SX 8x40').sku).toBe('BF-FIX-SX8');
    expect(matchLine(S, 'XX-123', 'Bolsa de plástico')).toEqual({ sku: null, how: null });
  });
});

describe('códigos escaneados', () => {
  it('QR de estantería BUF:<SKU> (un "|SN:" antiguo se ignora), SKU, EAN y código del proveedor', () => {
    expect(qrContenido('WBX-PULSAR-22')).toBe('BUF:WBX-PULSAR-22');
    expect(resolveCode(S, 'BUF:WBX-PULSAR-22|SN:WBX-22-899281')!.p.sku).toBe('WBX-PULSAR-22');
    expect(resolveCode(S, 'bf-fix-sx8')!.p.sku).toBe('BF-FIX-SX8');
    expect(resolveCode(S, '4006209700985')!.p.sku).toBe('BF-FIX-SX6');
    expect(resolveCode(S, 'CP-VE-1F-40')!.p.sku).toBe('ESM-CPVE-MONO');
    expect(resolveCode(S, 'DESCONOCIDO')).toBeNull();
    expect(resolveCode(S, '   ')).toBeNull();
  });
});

describe('entregas y reposición', () => {
  it('la huella cambia si se altera la entrega', async () => {
    const e = S.entregas[0], h = await hashEntrega(e);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashEntrega({ ...e, lineas: [{ ...e.lineas[0], qty: 99 }] })).not.toBe(h);
  });
  it('el pedido sugerido llega a 2 × mínimo en formatos enteros', () => {
    expect(pedidoSugerido(find(S, 'BF-FIX-SX6')!)).toBe(1);        // 3 botes, mínimo 2 → objetivo 4
    expect(pedidoSugerido(find(S, 'BF-VE-WBX74')!)).toBe(3);
    expect(pedidoSugerido({ stock: 100, min: 80, unit: 'm' })).toBe(60);
  });
});

describe('sin precios (E-013)', () => {
  it('ni el catálogo ni el estado llevan importes', () => {
    expect(JSON.stringify(S.products)).not.toMatch(/price|precio|coste/i);
    expect(S.products.every(p => !('loc' in p) && !('serials' in p))).toBe(true);
  });
  it('custodia de Esmove: salida sin obra de destino rechazada; los cuadros y cargadores sin n.º de serie', () => {
    expect(() => applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'salida', qty: 1, reason: 'Instalado en obra', ref: ' ' })).toThrow(/obra o instalación de destino/);
    applyMovement(S, { sku: 'ESM-CPVE-MONO', type: 'salida', qty: 1, reason: 'Instalado en obra', ref: 'Garaje C/ Recogidas 12' });
    expect(find(S, 'ESM-CPVE-MONO')!.stock).toBe(2);
  });
});

describe('utilidades', () => {
  it('CSV con punto y coma, coma decimal y comillas; números con coma', () => {
    expect(csvTexto([['a;b', 1.5, 'x"y']])).toBe('﻿"a;b";1,5;"x""y"');
    expect(toNum('2,5')).toBe(2.5);
  });
  it('lectura de la pegatina de los cuadros: encuentra el código del modelo en el texto', async () => {
    const { candidatos, codigoConocido } = await import('../features/escaner/texto');
    const texto = 'ESMOVE S.L.\nCUADRO PROTECCIONES VE\nMOD: CP-VE-3F-32  230/400V\nLote 2026';
    expect(candidatos(texto)).toContain('CP-VE-3F-32');
    expect(codigoConocido(S, texto)).toBe('CP-VE-3F-32');
    expect(codigoConocido(S, 'nada que ver 1234')).toBeNull();
  });
});
