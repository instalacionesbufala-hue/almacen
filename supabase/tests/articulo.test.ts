/* E-015 · Propuesta de la IA para dar de alta un artículo (sin llamar a la IA) y reintentos de Gemini (fetch simulado) */
import { describe, expect, it } from 'vitest';
import { construirPromptArticulo, eanValido, normalizarArticulo, unidadDeTexto } from '../functions/_compartido/articulo';
import { llamarGemini } from '../functions/_compartido/gemini';

describe('propuesta de la IA', () => {
  it('detecta la unidad y el contenido del envase', () => {
    expect(unidadDeTexto('Bote 1000 ud tacos nylon')).toEqual({ unidad: 'bote', contenido: 1000 });
    expect(unidadDeTexto('Bolsa 100 bridas negras')).toEqual({ unidad: 'bolsa', contenido: 100 });
    expect(unidadDeTexto('Sobre de 25 conectores RJ45')).toEqual({ unidad: 'sobre', contenido: 25 });
    expect(unidadDeTexto('Caja 1.000 tornillos')).toEqual({ unidad: 'caja', contenido: 1000 });
    expect(unidadDeTexto('Cable RZ1-K 3G6 rollo 100 m')).toEqual({ unidad: 'm', contenido: 1 });
    expect(unidadDeTexto('Magnetotérmico 2P 40 A')).toBeNull();
  });
  it('limpia la propuesta: categoría y unidad válidas, contenido y EAN con dígito de control', () => {
    const a = normalizarArticulo({ tipo: 'material', nombre: 'Bote 1000 tacos nylon SX 6×30', marca: 'Fischer', categoria: 'fijaciones', unidad: 'bote', contenido: 1000, ean: '4006381333931', confianza: 0.9 });
    expect(a).toMatchObject({ nombre: 'Bote 1000 tacos nylon SX 6×30', marca: 'Fischer', categoria: 'fijaciones', unidad: 'bote', contenido: 1000, ean: '4006381333931' });
    const b = normalizarArticulo(JSON.stringify({ tipo: 'material', nombre: 'Bolsa 100 bridas', categoria: 'inventada', unidad: 'ud', ean: '1234567890123' }));
    expect(b).toMatchObject({ categoria: null, unidad: 'bolsa', contenido: 100, ean: '' });   // "ud" con un envase evidente → bolsa de 100; EAN mal → vacío
    const c = normalizarArticulo({ tipo: 'material', nombre: 'Cable H07Z1-K 6 mm²', categoria: 'cables' });
    expect(c).toMatchObject({ unidad: 'm', contenido: 1 });
  });
  it('herramientas, EPIs y ropa: categoría por tipo y talla solo donde toca', () => {
    expect(normalizarArticulo({ tipo: 'ropa', nombre: 'Pantalón multibolsillos', talla: '44' })).toMatchObject({ categoria: 'ropa', talla: '44', unidad: 'ud' });
    expect(normalizarArticulo({ tipo: 'epi', nombre: 'Guantes dieléctricos clase 0', talla: '9' })).toMatchObject({ categoria: 'epis', talla: '9' });
    expect(normalizarArticulo({ tipo: 'herramienta', nombre: 'Taladro atornillador', marca: 'Makita', modelo: 'DDF484', talla: 'XL' })).toMatchObject({ tipo: 'herramienta', modelo: 'DDF484', talla: '' });
  });
  it('EAN-8, EAN-13 y UPC-A', () => {
    expect(eanValido('4006381333931')).toBe(true);
    expect(eanValido('96385074')).toBe(true);
    expect(eanValido('036000291452')).toBe(true);
    expect(eanValido('4006381333932')).toBe(false);
  });
  it('el prompt no pide precios ni series y lleva el código escaneado', () => {
    const p = construirPromptArticulo('6000650655');
    expect(p).toMatch(/No extraigas precios ni números de serie/);
    expect(p).toMatch(/6000650655/);
  });
});

describe('llamada a Gemini', () => {
  const resp = (status: number, cuerpo: unknown = {}) => new Response(JSON.stringify(cuerpo), { status });
  const ok = (texto: string) => resp(200, { candidates: [{ content: { parts: [{ text: texto }] } }] });
  const base = { clave: 'k', modelo: 'principal', reserva: 'reserva', partes: [{ text: 'x' }], esquema: {}, funcion: 'leer-articulo', esperar: async () => undefined };

  it('reintenta si está saturado y pasa al modelo de reserva', async () => {
    const llamadas: string[] = [];
    const cola = [resp(503), resp(503), ok('{"nombre":"x"}')];
    const r = await llamarGemini({ ...base, fetch: (async (url: string) => { llamadas.push(url); return cola.shift()!; }) as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, texto: '{"nombre":"x"}', modelo: 'reserva' });
    expect(llamadas.map(u => /models\/(\w+)/.exec(u)![1])).toEqual(['principal', 'principal', 'reserva']);
  });
  it('no reintenta una clave mala y explica el error', async () => {
    let n = 0;
    const r = await llamarGemini({ ...base, fetch: (async () => { n++; return resp(403); }) as unknown as typeof fetch });
    expect(n).toBe(1);
    expect(r).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/GEMINI_API_KEY/) });
  });
  it('cupo agotado en todos los intentos → 429', async () => {
    const r = await llamarGemini({ ...base, fetch: (async () => resp(429)) as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: false, status: 429 });
  });
});
