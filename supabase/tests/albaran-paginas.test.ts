/* E-024 · Albaranes de varias páginas: una sola revisión, sin cabeceras repetidas ni líneas de "suma y sigue" (datos inventados) */
import { describe, expect, it } from 'vitest';
import { esLineaDeArrastre, normalizarRespuesta, PROMPT_PAGINAS, unirAlbaranes, type ItemCatalogo } from '../functions/_compartido/albaran';

const cat: ItemCatalogo[] = [
  { sku: 'CAB-RZ1K-5G6', ref: 'RZ1K5G6', nombre: 'Manguera RZ1-K 5G6', unidad: 'm' },
  { sku: 'TUBO-32', ref: 'TC32', nombre: 'Tubo corrugado 32 mm', unidad: 'm' },
  { sku: 'BF-FIX-SX8', ref: 'SX8', nombre: 'Taco SX 8', unidad: 'caja de 100' },
];
const L = (codigo: string, descripcion: string, cantidad: number) => ({ codigo, descripcion, cantidad, sku: null, confianza: 0.9 });
// hoja 1 y hoja 2 de un albarán inventado de 2 hojas, como las devolvería la IA leyendo cada hoja por separado
const hoja1 = normalizarRespuesta({ proveedor: 'Saltoki Alcobendas', cif: 'B00000000', numero: '9.000.001', fecha: '01/10/2026', bultos: 2,
  lineas: [L('RZ1K5G6', 'MANGUERA RZ1-K 5G6', 50), L('TC32', 'TUBO CORRUGADO 32', 100), L('', 'SUMA Y SIGUE', 150)] }, cat);
const hoja2 = normalizarRespuesta({ proveedor: 'Saltoki Alcobendas', cif: 'B00000000', numero: '9.000.001', fecha: '01/10/2026',
  lineas: [L('', 'Suma anterior', 150), L('SX8', 'TACO SX 8 (CAJA 100)', 3), L('', 'TOTAL ALBARÁN', 153)] }, cat);

describe('E-024 · unir las páginas de un albarán', () => {
  it('una sola cabecera y todas las líneas de material, sin arrastres ni totales', () => {
    const a = unirAlbaranes([hoja1, hoja2]);
    expect(a).toMatchObject({ proveedor: 'Saltoki Alcobendas', numero: '9.000.001', fecha: '01/10/2026', bultos: 2, avisos: [] });
    expect(a.lineas.map(l => [l.sku, l.cantidad])).toEqual([['CAB-RZ1K-5G6', 50], ['TUBO-32', 100], ['BF-FIX-SX8', 3]]);
  });

  it('la misma hoja fotografiada dos veces (en dos lotes) no duplica sus líneas', () => {
    const a = unirAlbaranes([hoja1, hoja2, hoja2]);
    expect(a.lineas).toHaveLength(3);
    expect(a.lineas[2].nota).toMatch(/también en otra hoja/);
  });

  it('dos líneas iguales en la MISMA hoja se conservan (pueden ser dos entregas del mismo artículo)', () => {
    const h = normalizarRespuesta({ lineas: [L('SX8', 'TACO SX 8', 1), L('SX8', 'TACO SX 8', 1)] }, cat);
    expect(unirAlbaranes([h]).lineas).toHaveLength(2);
  });

  it('avisa si las hojas son de albaranes distintos y se queda con la primera cabecera completa', () => {
    const otra = { ...hoja2, numero: '9.000.777', cif: '' };
    const a = unirAlbaranes([{ ...hoja1, cif: '' }, otra]);
    expect(a.numero).toBe('9.000.001');
    expect(a.avisos[0]).toMatch(/números de albarán distintos/);
  });

  it('reconoce los arrastres típicos y deja pasar el material', () => {
    for (const d of ['SUMA Y SIGUE', 'Suma anterior ....', 'Sigue a la vuelta', 'Viene de la hoja 1']) expect(esLineaDeArrastre({ codigo: '', descripcion: d })).toBe(true);
    expect(esLineaDeArrastre({ codigo: '', descripcion: 'Subtotal' })).toBe(true);
    expect(esLineaDeArrastre({ codigo: 'TOT-1', descripcion: 'Totalizador de energía' })).toBe(false);
    expect(esLineaDeArrastre({ codigo: '', descripcion: 'Tubo corrugado 32' })).toBe(false);
  });

  it('el prompt de varias páginas pide una cabecera y cada línea una vez', () => {
    expect(PROMPT_PAGINAS(2)).toMatch(/UN SOLO albarán/);
    expect(PROMPT_PAGINAS(2)).toMatch(/suma y sigue/);
  });
});
