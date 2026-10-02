/* E-024 · Recuadros que filtran de verdad, socios de custodia y selectores de artículos ordenados (en local) */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado, Producto } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { searchProducts } from './reglas';
import { chipsFiltros, filtroDeRecuadro, propDeSocio, SIN_FILTROS } from './filtrosInventario';
import { desgloseCustodia, idSocio, motivoNoDesactivar, socioInicial } from './socios';
import { datosInformeCustodia } from './custodia';
import { construirInforme } from '../../supabase/functions/_compartido/informe';
import { articulosParaSelector, ordenarArticulos } from './selector';
import { origenesFoto, origenInicial } from './fotos';

let S: Estado;
beforeEach(() => { S = fresh(); S.rol = 'admin'; });
const prod = (sku: string, o: Partial<Producto> = {}): Producto => ({ sku, name: `Artículo ${sku}`, cat: 'cargadores', unit: 'ud', contenido: 1, stock: 0, min: 1, minimoDefinido: true, supplier: '', ...o });
const alta = (p: Producto, stockInicial = 0) => aplicarLocal(S, { op: 'producto', args: { producto: p, nuevo: true, stockInicial } });

describe('recuadros del inventario', () => {
  it('con "Cargadores VE" pinchado, "N por completar" muestra exactamente las N referencias sin mínimo de TODAS las categorías', () => {
    alta(prod('SIN-MIN-1', { cat: 'fijaciones', minimoDefinido: false, min: 0 }));
    alta(prod('SIN-MIN-2', { cat: 'cables', unit: 'm', minimoDefinido: false, min: 0 }));
    const sinMinimo = S.products.filter(p => p.minimoDefinido === false).map(p => p.sku).sort();
    expect(sinMinimo.length).toBeGreaterThanOrEqual(2);
    // el usuario tenía una categoría, un texto y una ubicación puestos
    const antes = { ...SIN_FILTROS, cat: 'cargadores', q: 'wallbox', ubi: 'almacen' };
    expect(searchProducts(S, antes.q, antes).some(p => p.minimoDefinido === false && p.cat !== 'cargadores')).toBe(false);
    const f = filtroDeRecuadro({ k: 'sinmin' });
    expect(f).toEqual({ ...SIN_FILTROS, est: 'sinmin' });                 // limpia todo lo demás
    expect(searchProducts(S, f.q, f).map(p => p.sku).sort()).toEqual(sinMinimo);
    expect(chipsFiltros(S, f).map(c => c.texto)).toEqual(['Sin mínimo']);
  });

  it('bajo mínimo y custodia (total y por socio) también limpian los demás filtros', () => {
    alta(prod('IB-CARG', { propiedad: 'custodia', propietario: 'INSTANTBOX' }), 4);
    expect(filtroDeRecuadro({ k: 'bajo' })).toEqual({ ...SIN_FILTROS, est: 'red' });
    const todos = filtroDeRecuadro({ k: 'custodia' }), ib = filtroDeRecuadro({ k: 'custodia', socio: 'INSTANTBOX' });
    expect(searchProducts(S, '', ib).map(p => p.sku)).toEqual(['IB-CARG']);
    const enCustodia = searchProducts(S, '', todos);
    expect(enCustodia.length).toBeGreaterThan(1);
    expect(enCustodia.every(p => p.propiedad === 'custodia')).toBe(true);
    expect(chipsFiltros(S, ib)[0].texto).toBe('Custodia Instant Box');
  });

  it('cada chip quita solo su filtro', () => {
    const f = { ...SIN_FILTROS, q: 'taco', cat: 'fijaciones', est: 'sinmin', prop: propDeSocio('ESMOVE'), ubi: 'almacen' };
    const chips = chipsFiltros(S, f);
    expect(chips.map(c => c.clave)).toEqual(['q', 'est', 'prop', 'cat', 'ubi']);
    expect({ ...f, ...chips[1].quitar }).toEqual({ ...f, est: 'all' });
  });
});

describe('socios de custodia', () => {
  it('desglose por socio para el recuadro "En custodia"', () => {
    alta(prod('IB-1', { propiedad: 'custodia', propietario: 'INSTANTBOX' }), 4);
    const d = desgloseCustodia(S), ib = d.socios.find(s => s.id === 'INSTANTBOX')!, esm = d.socios.find(s => s.id === 'ESMOVE')!;
    expect(ib).toMatchObject({ nombre: 'Instant Box', unidades: 4, refs: 1 });
    expect(esm.unidades).toBeGreaterThan(0);
    expect(d.total).toBe(Math.round((ib.unidades + esm.unidades) * 1000) / 1000);
  });

  it('dos socios con stock: el informe de cada uno no lleva lo del otro', () => {
    alta(prod('IB-1', { propiedad: 'custodia', propietario: 'INSTANTBOX' }), 4);
    const ib = construirInforme(datosInformeCustodia(S, 'INSTANTBOX', 0, Date.now() + 1e6)), esm = construirInforme(datosInformeCustodia(S, 'ESMOVE', 0, Date.now() + 1e6));
    const skus = (i: typeof ib) => JSON.stringify(i);
    expect(skus(ib)).toMatch(/IB-1/);
    expect(skus(esm)).not.toMatch(/IB-1/);
    expect(skus(ib)).not.toMatch(/ESM-CPVE-MONO/);
    expect(skus(ib)).toMatch(/Instant Box/);
  });

  it('desactivar: solo un socio sin artículos; desactivado no admite material nuevo', () => {
    aplicarLocal(S, { op: 'propietario', args: { id: 'NUEVO', nombre: 'Socio Nuevo', contacto: '', correosReposicion: [], correosInformes: [], activo: true, color: 'verde' } });
    alta(prod('SN-1', { propiedad: 'custodia', propietario: 'NUEVO' }));
    expect(motivoNoDesactivar(S, 'NUEVO')).toMatch(/Tiene 1 artículo/);
    expect(() => aplicarLocal(S, { op: 'propietario', args: { ...S.propietarios.find(o => o.id === 'NUEVO')!, activo: false } })).toThrow(/Tiene 1 artículo/);
    aplicarLocal(S, { op: 'cambiarPropiedad', args: { sku: 'SN-1', propiedad: 'propia' } });
    aplicarLocal(S, { op: 'propietario', args: { ...S.propietarios.find(o => o.id === 'NUEVO')!, activo: false } });
    expect(S.propietarios.find(o => o.id === 'NUEVO')!.activo).toBe(false);
    expect(() => alta(prod('SN-2', { propiedad: 'custodia', propietario: 'NUEVO' }))).toThrow(/está desactivado/);
    // y devolverle material a un socio desactivado, tampoco
    expect(() => aplicarLocal(S, { op: 'cambiarPropiedad', args: { sku: 'SN-1', propiedad: 'custodia', propietario: 'NUEVO' } })).toThrow(/está desactivado/);
  });

  it('el socio se elige: sin valor oculto por defecto si hay varios, preseleccionado si hay uno', () => {
    expect(socioInicial(S)).toBe('');
    expect(() => alta(prod('SIN-SOCIO', { propiedad: 'custodia' }))).toThrow(/Elige de qué socio/);
    S.propietarios = S.propietarios.filter(o => o.id === 'ESMOVE');
    expect(socioInicial(S)).toBe('ESMOVE');
    expect(socioInicial(S, 'ESMOVE')).toBe('ESMOVE');
  });

  it('nombres y validaciones', () => {
    expect(idSocio('Instant Box', ['ESMOVE'])).toBe('INSTANTBOX');
    expect(idSocio('Instant Box', ['INSTANTBOX'])).toBe('INSTANTBOX2');
    expect(() => aplicarLocal(S, { op: 'propietario', args: { id: 'X', nombre: 'instant box', contacto: '', correosReposicion: [], correosInformes: [] } })).toThrow(/Ya hay un socio/);
    expect(() => aplicarLocal(S, { op: 'propietario', args: { id: 'X', nombre: 'X', contacto: '', correosReposicion: ['mal'], correosInformes: [] } })).toThrow(/Correo no válido/);
  });

  it('el origen de la foto lista los socios activos y propone el del artículo', () => {
    expect(origenesFoto(S).map(o => o.t)).toEqual(['Foto propia', 'Saltoki', 'Esmove', 'Instant Box', 'Fabricante']);
    expect(origenInicial({ propiedad: 'custodia', propietario: 'INSTANTBOX' })).toBe('INSTANTBOX');
    expect(origenInicial({ propiedad: 'propia' })).toBe('propia');
  });
});

describe('selectores de artículos ordenados', () => {
  it('A-Z por nombre por defecto y "por referencia" por SKU (con números en orden natural)', () => {
    const l = [prod('B-10', { name: 'zócalo' }), prod('B-9', { name: 'Ábaco' }), prod('A-2', { name: 'manguera' })];
    expect(ordenarArticulos(l).map(p => p.name)).toEqual(['Ábaco', 'manguera', 'zócalo']);
    expect(ordenarArticulos(l, 'sku').map(p => p.sku)).toEqual(['A-2', 'B-9', 'B-10']);
  });

  it('el buscador encuentra también por EAN y por código alternativo, y deja fuera los borradores', () => {
    alta(prod('CON-EAN', { name: 'Con EAN', ean: '8436000000999' }));
    aplicarLocal(S, { op: 'asociarCodigo', args: { codigo: 'ALT-777', sku: 'CON-EAN', tipo: 'EAN' } });
    expect(articulosParaSelector(S, '8436000000999').map(p => p.sku)).toEqual(['CON-EAN']);
    expect(articulosParaSelector(S, 'ALT-777').map(p => p.sku)).toEqual(['CON-EAN']);
    S.products.find(p => p.sku === 'CON-EAN')!.borrador = true;
    expect(articulosParaSelector(S, 'ALT-777')).toEqual([]);
    expect(articulosParaSelector(S, 'ALT-777', { borradores: true })).toHaveLength(1);
    const todo = articulosParaSelector(S, '');
    expect(todo.map(p => p.name)).toEqual([...todo.map(p => p.name)].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })));
  });
});
