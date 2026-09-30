/* E-013 · Importación del catálogo real (CSV) */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import { aplicarLocal } from '../store/ops';
import { cifraCsv, parsearCatalogo } from './catalogoCsv';

const CAB = 'sku;ref_proveedor;nombre;categoria;propiedad;propietario;proveedor;unidad;contenido_unidad;stock_inicial;minimo;albaranes';

describe('CSV del catálogo', () => {
  it('"1000 ud" es 1000, "10 bolsas" es 10 y la coma decimal vale', () => {
    expect(cifraCsv('1000 ud')).toBe(1000);
    expect(cifraCsv('10 bolsas')).toBe(10);
    expect(cifraCsv('2,5')).toBe(2.5);
    expect(cifraCsv('')).toBeNull();
  });
  it('el catálogo real de datos/ se lee entero, sin errores y con los mínimos por completar', () => {
    const S = fresh(); S.products = [];
    const v = parsearCatalogo(readFileSync('datos/catalogo-stock-real.csv', 'utf8'), S);
    expect(v.errorGeneral).toBeUndefined();
    expect(v.conError).toBe(0);
    expect(v.nuevos).toBe(39); // 39: la cinta blanca 9900101044 no se recibió (decisión del usuario)
    expect(v.filas.every(f => f.fila.minimo === null)).toBe(true);
    const bote = v.filas.find(f => f.fila.unidad === 'bote')!;
    expect(bote.fila.contenido).toBe(1000);
    expect(v.filas.filter(f => f.fila.propiedad === 'custodia').every(f => f.fila.propietario === 'Esmove')).toBe(true);
  });
  it('separa nuevos y existentes y marca unidades, categorías y propietarios desconocidos', () => {
    const S = fresh();
    const v = parsearCatalogo(`﻿${CAB}\nbf-fix-sx8;;Caja tacos;fijaciones;propia;;Saltoki;caja;100 ud;2;;A-1\nN-1;;"Saco; grande";fijaciones;propia;;Saltoki;saco;;1;;\nN-2;;Algo;varios;custodia;Otro;X;ud;;1;;\nN-3;;Bote;fijaciones;propia;;X;bote;500;1,5;;\n`, S);
    expect(v.filas.map(f => [f.fila.sku, f.estado, f.errores])).toEqual([
      ['BF-FIX-SX8', 'existe', []],
      ['N-1', 'nuevo', ['Unidad desconocida: saco']],
      ['N-2', 'nuevo', ['Categoría desconocida: varios', 'Propietario desconocido: Otro']],
      ['N-3', 'nuevo', ['El stock inicial va en bote enteros']],
    ]);
    expect(v.filas[1].fila.nombre).toBe('Saco; grande');
    expect(v).toMatchObject({ nuevos: 0, existentes: 1, conError: 3 });
  });
  it('sin la cabecera esperada no importa nada', () => {
    expect(parsearCatalogo('sku;nombre\nA;B', fresh()).errorGeneral).toMatch(/Faltan columnas/);
  });
  it('importar dos veces no duplica artículos ni el inventario de apertura', () => {
    const S = fresh();
    const { filas, nuevos } = parsearCatalogo(readFileSync('datos/catalogo-stock-real.csv', 'utf8'), S);   // algunas referencias de la demo ya existen
    const n = S.products.length;
    aplicarLocal(S, { op: 'importarCatalogo', args: { filas: filas.map(f => f.fila) } });
    const movs = S.movements.length;
    aplicarLocal(S, { op: 'importarCatalogo', args: { filas: filas.map(f => f.fila) } });
    expect(S.products.length).toBe(n + nuevos);
    expect(S.movements.length).toBe(movs);
    expect(S.products.filter(p => p.minimoDefinido === false)).toHaveLength(nuevos);
  });
});
