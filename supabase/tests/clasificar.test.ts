/* E-016 · Unidad, formato, categoría y proveedor a partir de la descripción del proveedor */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { categoriaSugerida, detectarUnidad, normalizarProveedor } from '../functions/_compartido/clasificar';

// catálogo real revisado por el usuario: la referencia de lo que tiene que salir
const filas = readFileSync(new URL('../../datos/catalogo-stock-real.csv', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean)
  .map(l => { const c = l.split(';'); return { sku: c[0], nombre: c[2], categoria: c[3], unidad: c[7], contenido: Number(String(c[8]).replace(/\D/g, '')) || 1 }; });

describe('clasificar desde la descripción del albarán', () => {
  it('unidad y contenido de las 39 líneas reales (ML y cables en metros; bote, bolsa, sobre y pack con su contenido)', () => {
    expect(filas).toHaveLength(39);
    const mal = filas.filter(f => { const d = detectarUnidad(f.nombre); return d.unidad !== f.unidad || d.contenido !== f.contenido; });
    expect(mal.map(f => [f.sku, f.nombre, detectarUnidad(f.nombre)])).toEqual([]);
  });
  it('casos que fallaron en la primera carga', () => {
    expect(detectarUnidad('KOMMDATA ML CABLE CAT6 U/UTP LSZH')).toEqual({ unidad: 'm', contenido: 1 });
    expect(detectarUnidad('KOMMDATA BOLSA 25 UDS CONECTOR PASANTE RJ45')).toEqual({ unidad: 'sobre', contenido: 25 });
    expect(detectarUnidad('BOTE 1000 TACOS NYLON BSX 6X30')).toEqual({ unidad: 'bote', contenido: 1000 });
    expect(detectarUnidad('PACK 10 BOLSAS DE BASURA 85X105')).toEqual({ unidad: 'pack', contenido: 10 });
    expect(detectarUnidad('V2C PUNTO CARGA TRYDAN 22KW CABLE T2 5M')).toEqual({ unidad: 'ud', contenido: 1 });    // un cargador con cable no es un cable
  });
  it('categoría sugerida de las 39 líneas reales', () => {
    const mal = filas.filter(f => categoriaSugerida(f.nombre) !== f.categoria);
    expect(mal.map(f => [f.sku, f.nombre, categoriaSugerida(f.nombre), f.categoria])).toEqual([]);
    expect(categoriaSugerida('BOLSAS DE BASURA 85X105')).toBe('consumibles');
    expect(categoriaSugerida('KOMMDATA BOLSA 25 UDS CONECTOR PASANTE RJ45')).not.toBe('cables');
    expect(categoriaSugerida('HAG ANGULO PLANO ATEHA 30X12MM')).toBe('tubos');
    expect(categoriaSugerida('BOLSAS DE BASURA', ['cables', 'fijaciones'])).toBe('fijaciones');     // consumibles desactivada
  });
  it('el proveedor es el emisor, con Saltoki unificado y la delegación aparte', () => {
    expect(normalizarProveedor('Saltoki Centro, S.A.')).toEqual({ proveedor: 'Saltoki', delegacion: 'Centro' });
    expect(normalizarProveedor('SALTOKI ALCOBENDAS')).toEqual({ proveedor: 'Saltoki', delegacion: 'Alcobendas' });
    expect(normalizarProveedor('BUFALA TECH')).toEqual({ proveedor: '', delegacion: '' });
    expect(normalizarProveedor('Schneider Electric España, S.A.')).toEqual({ proveedor: 'Schneider Electric España', delegacion: '' });
  });
});
