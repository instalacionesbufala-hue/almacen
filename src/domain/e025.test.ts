/* E-025 · Un artículo recién creado sale (con 0 ud) en el catálogo de todas las furgonetas y se asigna con una entrega firmada */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { aLineas, asignarAEquipo } from './entregas';
import { unidadesABordo } from './reglas';
import { articulosParaSelector } from './selector';

const nuevo = (sku: string, o: Partial<Producto> = {}): Producto => ({ sku, name: `Artículo nuevo ${sku}`, cat: 'fijaciones', unit: 'ud', contenido: 1, stock: 0, min: 0, minimoDefinido: true, supplier: '', ...o });

describe('artículos nuevos en las furgonetas', () => {
  it('recién creado: aparece con 0 ud en las 3 furgonetas; asignado a Búfala 2 y firmado, consta a bordo', () => {
    const S = fresh(); S.rol = 'admin';
    aplicarLocal(S, { op: 'producto', args: { producto: nuevo('NUEVO-1'), nuevo: true, stockInicial: 10 } });
    for (const v of ['V-F01', 'V-F02', 'V-F03']) {
      expect(articulosParaSelector(S, '').some(p => p.sku === 'NUEVO-1')).toBe(true);      // la lista de "Mostrar todo el catálogo"
      expect(unidadesABordo(S, v, 'NUEVO-1')).toBe(0);
    }
    const r = asignarAEquipo(S, S.cesta, 'F02', ['NUEVO-1']);
    expect(r).toEqual({ anadidos: ['NUEVO-1'], avisos: [] });
    expect(S.cesta).toMatchObject({ equipo: 'F02', receptor: null, paso: 2 });
    aplicarLocal(S, { op: 'prepararEntrega', args: { id: 'E-25', equipo: 'F02', obra: '', lineas: aLineas(S.cesta) } });
    aplicarLocal(S, { op: 'confirmarEntrega', args: { id: 'E-25', firma: 'f', recoge: 'T3' } });
    expect(unidadesABordo(S, 'V-F02', 'NUEVO-1')).toBe(1);
    expect(unidadesABordo(S, 'V-F01', 'NUEVO-1')).toBe(0);
  });

  it('los borradores no salen y no se pueden asignar; varios a la vez; la cesta de otro equipo se sustituye', () => {
    const S = fresh(); S.rol = 'admin';
    S.products.push(nuevo('BORRADOR-1', { borrador: true, stock: 5 }));
    expect(articulosParaSelector(S, 'BORRADOR-1')).toEqual([]);
    expect(asignarAEquipo(S, S.cesta, 'F01', ['BORRADOR-1']).avisos[0]).toMatch(/no se puede entregar/);
    asignarAEquipo(S, S.cesta, 'F01', ['CAB-RZ1K-5G6']);
    const r = asignarAEquipo(S, S.cesta, 'F03', ['CAB-RZ1K-5G6', 'BF-FIX-SX6']);
    expect(r.anadidos).toHaveLength(2);
    expect(S.cesta.equipo).toBe('F03');
    expect(S.cesta.lineas.map(l => l.sku).sort()).toEqual(['BF-FIX-SX6', 'CAB-RZ1K-5G6']);
    // volver a asignar lo que ya está no lo duplica
    asignarAEquipo(S, S.cesta, 'F03', ['BF-FIX-SX6']);
    expect(S.cesta.lineas.filter(l => l.sku === 'BF-FIX-SX6')).toHaveLength(1);
  });

  it('sin stock en el almacén avisa en vez de añadir', () => {
    const S = fresh(); S.rol = 'admin';
    aplicarLocal(S, { op: 'producto', args: { producto: nuevo('SIN-STOCK'), nuevo: true, stockInicial: 0 } });
    const r = asignarAEquipo(S, S.cesta, 'F02', ['SIN-STOCK']);
    expect(r.anadidos).toEqual([]);
    expect(r.avisos[0]).toMatch(/Artículo nuevo SIN-STOCK/);
  });
});
