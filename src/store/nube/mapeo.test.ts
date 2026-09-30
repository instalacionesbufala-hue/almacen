import { describe, expect, it } from 'vitest';
import { aEstado, TABLAS, type Tablas } from './mapeo';
import { stockTotal, unidadesABordo } from '../../domain/reglas';

/* E-013 · la app no recibe precios; el stock está en el almacén o a bordo de un vehículo (en unidades de contenido) */
const tablas = (): Tablas => {
  const t = Object.fromEntries(TABLAS.map(k => [k, []])) as unknown as Tablas;
  t.productos = [
    { sku: 'RJ45', nombre: 'Sobre 25 conectores RJ45', categoria: 'fijaciones', unidad: 'sobre', contenido: 25, stock: 10, minimo: 4, minimo_definido: true, proveedor: 'Saltoki', propiedad: 'propia' },
    { sku: 'V2C', nombre: 'Trydan 7,4 kW', categoria: 'cargadores', unidad: 'ud', contenido: 1, stock: 15, minimo: 0, minimo_definido: false, proveedor: 'Saltoki', propiedad: 'custodia', propietario_id: 'ESMOVE' },
  ];
  t.equipos = [{ id: 'B1', nombre: 'Búfala 1', estado: 'ruta', activo: true }];
  t.vehiculos = [{ id: 'V1', matricula: '0000-AAA', modelo: 'Furgoneta', equipo_id: 'B1', activo: true }];
  t.stock_vehiculo = [{ vehiculo_id: 'V1', sku: 'RJ45', unidades: 23 }];
  t.config_app = [{ id: 1, modo_demo: true }];
  return t;
};

describe('E-013 · estado desde Supabase', () => {
  it('sin precios, con unidad y contenido; tarea de mínimo si se importó sin él', () => {
    const E = aEstado(tablas(), { cesta: { equipo: '', receptor: null, lineas: [] }, seq: { ent: 0 } }, 'Prueba', 'admin');
    const rj = E.products.find(p => p.sku === 'RJ45')!, v2c = E.products.find(p => p.sku === 'V2C')!;
    expect(rj).not.toHaveProperty('price');
    expect(rj).toMatchObject({ unit: 'sobre', contenido: 25, minimoDefinido: true });
    expect(v2c.minimoDefinido).toBe(false);
    expect(JSON.stringify(E)).not.toMatch(/precio|price|coste/i);
  });
  it('vehículo del equipo y stock a bordo en unidades (23 RJ45 = 0,92 sobres)', () => {
    const E = aEstado(tablas(), { cesta: { equipo: '', receptor: null, lineas: [] }, seq: { ent: 0 } }, 'Prueba', 'admin');
    expect(E.equipos[0].vehiculo).toBe('V1');
    expect(unidadesABordo(E, 'V1', 'RJ45')).toBe(23);
    expect(stockTotal(E, E.products[0])).toBe(10.92);
    expect(E.configApp.modoDemo).toBe(true);
  });
});
