/* E-003 · Lectura de albaranes: normalización y emparejado con fixtures anonimizados (sin llamar a la IA) */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { construirPrompt, emparejar, normalizarRespuesta, type ItemCatalogo } from '../functions/_compartido/albaran';
import { SEED_PRODUCTS } from '../../src/data/catalogo';

const cat: ItemCatalogo[] = SEED_PRODUCTS.map(p => ({ sku: p.sku, ref: p.supplierRef, ean: p.ean, nombre: p.name, unidad: p.unit === 'm' ? 'm' : 'ud', custodia: p.propiedad === 'custodia' }));
const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

describe('albarán de Saltoki (anonimizado)', () => {
  const a = normalizarRespuesta(fixture('saltoki-anonimizado'), cat);
  it('conserva la cabecera', () => expect(a).toMatchObject({ proveedor: 'Saltoki Alcobendas', numero: '2.824.560', fecha: '24/09/2026', bultos: 3 }));
  it('empareja por código exacto, por prefijo y por descripción', () => {
    expect(a.lineas[0]).toMatchObject({ sku: '8909080510', how: 'código', cantidad: 7 });
    expect(a.lineas[1]).toMatchObject({ sku: '7280040020', how: 'IA' });
    expect(a.lineas[2]).toMatchObject({ sku: '6040615306', how: 'código (prefijo)', cantidad: 40 });
    expect(a.lineas[4]).toMatchObject({ sku: 'BF-FIX-SX8', how: 'descripción', cantidad: 1000 });
  });
  it('no se fía de un SKU inventado por el modelo y baja la confianza de lo que no empareja', () => {
    expect(a.lineas[3]).toMatchObject({ sku: null, how: 'nuevo' });
    expect(a.lineas[3].confianza).toBeLessThanOrEqual(0.6);
  });
});

describe('albarán de Esmove (custodia, sin precios)', () => {
  const a = normalizarRespuesta(fixture('esmove-anonimizado'), cat);
  it('empareja cargadores con sus series y cuadros por el código de la pegatina', () => {
    expect(a.lineas[0]).toMatchObject({ sku: 'WBX-PULSAR-22', series: ['WBX-22-900101', 'WBX-22-900102'], cantidad: 2 });
    expect(a.lineas[1]).toMatchObject({ sku: 'ESM-CPVE-MONO', series: [], cantidad: 3 });
  });
  it('el prompt no pide precios y marca los artículos en custodia', () => {
    const p = construirPrompt(cat);
    expect(p).toMatch(/No extraigas precios ni importes/);
    expect(p).toMatch(/ESM-CPVE-MONO \/ CP-VE-1F-40 \| .* \| custodia/);
    expect(p).not.toMatch(/€/);
  });
});

describe('robustez', () => {
  it('acepta la respuesta como texto con bloque de código y números con formato español', () => {
    const a = normalizarRespuesta('```json\n{"lineas":[{"descripcion":"Manguera RZ1-K 5G6","cantidad":"1.500,5"}]}\n```', cat);
    expect(a.lineas[0]).toMatchObject({ cantidad: 1500.5, sku: 'CAB-RZ1K-5G6' });
  });
  it('sin código ni parecido suficiente no empareja', () => {
    expect(emparejar(cat, 'ZZZ', 'Bolsa de plástico')).toEqual({ sku: null, how: 'nuevo' });
  });
});

describe('E-016 · un código distinto nunca es el mismo artículo (albarán 3.322.577)', () => {
  // catálogo real de ese momento: existían la tapa final y el ángulo exterior, pero no la moldura ni el ángulo interior
  const real: ItemCatalogo[] = [
    { sku: '6222110056', ref: '6222110056', nombre: 'HAG TAPA FINAL ATEHA 30X12MM BLN ATA12306XXXX TEH', unidad: 'ud' },
    { sku: '6222110053', ref: '6222110053', nombre: 'HAG ANGULO EXTERIOR ATEHA 30X12MM BLN ATA12303XXXX TEH', unidad: 'ud' },
  ];
  it('moldura y ángulo interior salen como artículos nuevos aunque la descripción se parezca y la IA proponga otro', () => {
    const a = normalizarRespuesta({ proveedor: 'Saltoki Centro, S.A.', lineas: [
      { codigo: '6222106082', descripcion: 'HAG ML MOLDURA 30X12/2,1M 2C ATEHA PVC BLN ATA12301XXXX TEH', cantidad: 20, sku: '6222110056' },
      { codigo: '6222110054', descripcion: 'HAG ANGULO INTERIOR ATEHA 30X12MM BLN ATA12304XXXX TEH', cantidad: 10, sku: '6222110053' },
      { codigo: '6222110056', descripcion: 'HAG TAPA FINAL ATEHA 30X12MM', cantidad: 4 },
    ] }, real);
    expect(a.lineas.map(l => [l.codigo, l.sku, l.how])).toEqual([['6222106082', null, 'nuevo'], ['6222110054', null, 'nuevo'], ['6222110056', '6222110056', 'código']]);
  });
  it('la descripción solo empareja líneas sin código', () => {
    expect(emparejar(real, '', 'HAG ANGULO EXTERIOR ATEHA 30X12MM BLN')).toMatchObject({ sku: '6222110053', how: 'descripción' });
    expect(emparejar(real, '9999999999', 'HAG ANGULO EXTERIOR ATEHA 30X12MM BLN')).toEqual({ sku: null, how: 'nuevo' });
  });
  it('el prompt deja claro que el proveedor es el emisor, no el cliente', () => {
    expect(construirPrompt(real)).toMatch(/EMISOR del albarán/);
  });
});
