/* E-031 · En la app: formatos en metros (rollo de 50 m). Conversión del stock al cambiar el formato (almacén y vehículos),
   consumo de un cierre en metros, entrega por rollos y por metros sueltos, recuento mixto y textos con su equivalencia. */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { registrarCierreLocal } from './cierres';
import { anadir, cestaVacia, fijar, problemas } from './entregas';
import { cambiaFormato, cantTxt, cantVehiculoTxt, deMixto, enMetros, previsionConversion } from './formatos';
import { contenidoTxt, formatoEntero, unidadesABordo } from './reglas';
import { lineasContadas } from '../ui/contado';
import { filasCsvInventario } from './listaInventario';

const SKU = '6200020032';
const ROLLO = { unit: 'rollo' as const, contenido: 50, unidadContenido: 'm' as const };
/** Como en producción: en "ud", 150 en el almacén, −18 en V-F02 y 40 en V-F03, que eran metros */
function estado() {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined;
  S.products.push({ sku: SKU, name: 'Tubo corrugado 32 mm', cat: 'tubos', unit: 'ud', contenido: 1, stock: 150, min: 100, supplier: 'Saltoki' } as Producto);
  S.aBordo.push({ vehiculo: 'V-F02', sku: SKU, unidades: -18 }, { vehiculo: 'V-F03', sku: SKU, unidades: 40 });
  return S;
}
const prod = (S: ReturnType<typeof fresh>) => S.products.find(p => p.sku === SKU)!;

describe('cambiar el formato convirtiendo el stock', () => {
  it('"el stock está en metros": 3 rollos de 50 m; las furgonetas siguen en metros; mínimo 2; ajuste de conversión', () => {
    const S = estado();
    expect(previsionConversion(S, prod(S), ROLLO, 'contenido')).toEqual({ stock: 3, vehiculos: [
      { vehiculo: 'V-F02', antes: -18, despues: -18, formatos: -0.36 }, { vehiculo: 'V-F03', antes: 40, despues: 40, formatos: 0.8 }] });
    aplicarLocal(S, { op: 'cambiarFormato', args: { sku: SKU, formato: ROLLO, modo: 'contenido' } });
    const p = prod(S);
    expect([p.unit, p.contenido, p.unidadContenido, p.stock, p.min]).toEqual(['rollo', 50, 'm', 3, 2]);
    expect([unidadesABordo(S, 'V-F02', SKU), unidadesABordo(S, 'V-F03', SKU)]).toEqual([-18, 40]);
    expect(S.movements[0]).toMatchObject({ sku: SKU, type: 'ajuste', qty: -147, reason: 'Conversión de formato', ref: '150 unidades → 3 rollo de 50 m (sin cambio físico)' });
    expect(cantVehiculoTxt(p, -18)).toBe('-18 m · ≈ -0,36 rollos de 50 m');   // E-036: en metros, el formato en pequeño
    expect(contenidoTxt(p)).toBe('rollo de 50 m');
    expect(cambiaFormato(p, ROLLO)).toBe(false);
  });
  it('"ya está en rollos": el almacén no cambia y las furgonetas se reescalan a metros', () => {
    const S = estado();
    aplicarLocal(S, { op: 'cambiarFormato', args: { sku: SKU, formato: ROLLO, modo: 'formato' } });
    expect([prod(S).stock, unidadesABordo(S, 'V-F02', SKU), unidadesABordo(S, 'V-F03', SKU)]).toEqual([150, -900, 2000]);
    expect(S.movements.filter(m => m.reason === 'Conversión de formato').map(m => [m.vehiculo, m.unidades])).toEqual([['V-F03', 1960], ['V-F02', -882]]);
  });
});

describe('con el artículo en rollos de 50 m', () => {
  const conRollo = (sueltos = false) => { const S = estado(); aplicarLocal(S, { op: 'cambiarFormato', args: { sku: SKU, formato: ROLLO, modo: 'contenido' } }); if (sueltos) prod(S).metrosSueltos = true; return S; };

  it('un cierre de 12 m descuenta 12 m de la furgoneta (0,24 rollos)', () => {
    const S = conRollo();
    S.equivalencias = [{ id: 'C', campo: 'corr32', formula: 'directa', condiciones: {}, articulos: [{ sku: SKU, factor: 1 }], estimada: false, activa: true, orden: 1, confirmada: true } as Equivalencia];
    const r = registrarCierreLocal(S, { numInst: 'E2639100', equipo: 'Búfala 3', fechaCierreIso: new Date().toISOString(), corr32: 12 }, 'wizard');
    expect(r.diferencia).toEqual([{ sku: SKU, unidades: 12 }]);
    expect(unidadesABordo(S, 'V-F03', SKU)).toBe(28);
    expect(S.movements.find(m => m.type === 'consumo' && m.sku === SKU)!.qty).toBe(0.24);
  });

  it('entrega por rollos enteros; con "metros sueltos", metros (15 m = 0,3 rollos)', () => {
    const S = conRollo(), c = cestaVacia('F01');
    expect(formatoEntero(prod(S))).toBe(true);
    anadir(S, c, SKU); fijar(S, c, SKU, 1.3);
    expect(c.lineas[0].qty).toBe(1);                                                  // por rollo entero
    const S2 = conRollo(true), c2 = cestaVacia('F01');
    expect(formatoEntero(prod(S2))).toBe(false);
    anadir(S2, c2, SKU); fijar(S2, c2, SKU, 15 / 50);
    expect(c2.lineas[0].qty).toBe(0.3);
    expect(problemas(S2, c2).filter(x => /formato entero/.test(x))).toEqual([]);
    expect(cantTxt(prod(S2), 0.3)).toBe('0,3 rollos (15 m)');
  });

  it('recuento mixto: "2 rollos y 15 m" = 2,3 rollos; un formato en unidades, una sola cifra', () => {
    const S = conRollo(), p = prod(S);
    expect(enMetros(p)).toBe(true);
    expect(deMixto(p, 2, 15)).toBe(2.3);
    const find = (sku: string) => S.products.find(x => x.sku === sku);
    expect(lineasContadas({ [SKU]: '2', [`${SKU}|m`]: '15', 'BF-FIX-SX8': '7' }, find)).toEqual([{ sku: SKU, contado: 2.3 }, { sku: 'BF-FIX-SX8', contado: 7 }]);
    expect(lineasContadas({ [`${SKU}|m`]: '20' }, find)).toEqual([{ sku: SKU, contado: 0.4 }]);
    aplicarLocal(S, { op: 'recuentoVehiculo', args: { id: 'r1', vehiculo: 'V-F02', lineas: [{ sku: SKU, contado: 2.3 }] } });
    expect(unidadesABordo(S, 'V-F02', SKU)).toBe(115);
  });

  it('el CSV del inventario lleva la cantidad en metros (E-036) y su equivalente en formatos', () => {
    const S = conRollo(), filas = filasCsvInventario(S, [prod(S)]);
    const h = filas[0] as string[], f = filas[1];
    expect([f[h.indexOf('Almacén')], f[h.indexOf('Unidad')], f[h.indexOf('Formato')], f[h.indexOf('Total')], f[h.indexOf('Total en formatos')]]).toEqual([150, 'm', 'rollo de 50 m', 172, 3.44]);
  });
});
