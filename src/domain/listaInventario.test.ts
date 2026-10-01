/* E-019 · Inventario completo: sin páginas, filtros y orden sobre toda la lista, CSV de la lista filtrada y vista de impresión */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { searchProducts, status } from './reglas';
import { agruparPorCategoria, filasCsvInventario, htmlImprimirInventario, ordenarInventario, siguienteOrden } from './listaInventario';

let S: Estado;
beforeEach(() => {
  S = fresh();
  // hasta 45 referencias (más que las 40 del catálogo real): antes se veían de 8 en 8
  for (let i = S.products.length; i < 45; i++) S.products.push({ sku: `PRUEBA-${String(i).padStart(3, '0')}`, name: `Artículo de prueba ${i}`, cat: i % 2 ? 'fijaciones' : 'consumibles', unit: 'ud', contenido: 1, stock: i, min: 10, minimoDefinido: true, supplier: 'Saltoki' });
});

describe('una sola lista', () => {
  it('todas las referencias que cumplen los filtros, sin paginar', () => {
    expect(ordenarInventario(searchProducts(S, '', {}))).toHaveLength(45);
    const fij = searchProducts(S, '', { cat: 'fijaciones' });
    expect(fij.length).toBeGreaterThan(8);
    expect(ordenarInventario(fij)).toHaveLength(fij.length);
  });
  it('orden por columna sobre la lista completa (código, descripción, stock y estado), y otro toque invierte', () => {
    const l = searchProducts(S, '', {});
    const porStock = ordenarInventario(l, { col: 'stock', dir: 1 }).map(p => p.stock);
    expect(porStock).toEqual([...porStock].sort((a, b) => a - b));
    expect(ordenarInventario(l, { col: 'stock', dir: -1 })[0].stock).toBe(Math.max(...l.map(p => p.stock)));
    const porSku = ordenarInventario(l, { col: 'sku', dir: 1 }).map(p => p.sku);
    expect(porSku).toEqual([...porSku].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })));
    const porEstado = ordenarInventario(l, { col: 'estado', dir: 1 }).map(status);
    expect(porEstado.indexOf('green')).toBeGreaterThan(porEstado.lastIndexOf('red'));
    expect(siguienteOrden({ col: 'stock', dir: 1 }, 'stock')).toEqual({ col: 'stock', dir: -1 });
    expect(siguienteOrden({ col: 'stock', dir: -1 }, 'nombre')).toEqual({ col: 'nombre', dir: 1 });
  });
  it('agrupada por categoría, con el número de referencias de cada una', () => {
    const g = agruparPorCategoria(ordenarInventario(searchProducts(S, '', {})));
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(45);
    expect(g.find(x => x.cat === 'fijaciones')!.items.every(p => p.cat === 'fijaciones')).toBe(true);
  });
});

describe('exportar e imprimir', () => {
  it('el CSV lleva la lista filtrada completa (no la página) y una columna por vehículo', () => {
    const fij = ordenarInventario(searchProducts(S, '', { cat: 'fijaciones' }));
    const f = filasCsvInventario(S, fij);
    expect(f).toHaveLength(fij.length + 1);
    expect(f[0]).toEqual(expect.arrayContaining(['SKU', 'Almacén', 'Mínimo almacén', ...S.vehiculos.map(() => expect.stringMatching(/^Vehículo /))]));
    expect(f.slice(1).map(r => r[0])).toEqual(fij.map(p => p.sku));
  });
  it('la vista de impresión: código, descripción, categoría, almacén, vehículos y mínimo, sin fotos', () => {
    const l = ordenarInventario(searchProducts(S, '', {}));
    const h = htmlImprimirInventario(S, l, 'Inventario', 'Todas las categorías');
    expect(h).toMatch(/<th>Código<\/th><th>Descripción<\/th><th>Categoría<\/th><th class="n">Almacén<\/th>/);
    expect(h).toMatch(/45 referencias · Todas las categorías/);
    expect((h.match(/<tr>/g) || []).length).toBe(46);
    expect(h).not.toMatch(/<img/i);
  });
});
