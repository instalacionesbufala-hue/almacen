import { describe, expect, it } from 'vitest';
import { aEstado, TABLAS, type Tablas } from './mapeo';
import { eur } from '../../domain/formato';
import { valorProducto } from '../../domain/reglas';

/* E-010 · el material en custodia llega sin precio (null), aunque haya fila de coste, y nunca se pinta "0,00 €" */
const tablas = (): Tablas => {
  const t = Object.fromEntries(TABLAS.map(k => [k, []])) as unknown as Tablas;
  t.productos = [
    { sku: 'PROPIO', nombre: 'Cable', categoria: 'cable', unidad: 'm', formato: 100, stock: 10, minimo: 1, ubicacion: 'P01', proveedor: 'Saltoki', propiedad: 'propia' },
    { sku: 'CUADRO', nombre: 'Cuadro VE', categoria: 'cuadros', unidad: 'ud', formato: 1, stock: 3, minimo: 2, ubicacion: 'P06', proveedor: 'Esmove', propiedad: 'custodia', propietario_id: 'ESMOVE' },
  ];
  t.costes_producto = [{ sku: 'PROPIO', precio: 0.5 }, { sku: 'CUADRO', precio: 0 }];
  return t;
};

describe('E-010 · precio de custodia', () => {
  it('llega como null en la app y el propio conserva su precio', () => {
    const E = aEstado(tablas(), { cesta: { equipo: '', receptor: null, lineas: [] }, seq: { ent: 0 } }, 'Prueba', 'admin');
    const cuadro = E.products.find(p => p.sku === 'CUADRO')!, cable = E.products.find(p => p.sku === 'PROPIO')!;
    expect(cuadro.price).toBeNull();
    expect(cable.price).toBe(0.5);
    expect(valorProducto(cuadro)).toBe(0);
  });
  it('sin precio se muestra un guion, nunca "0,00 €"', () => {
    expect(eur(null)).toBe('—');
    expect(eur(undefined)).toBe('—');
    expect(eur(0)).toMatch(/0,00/);
  });
});
