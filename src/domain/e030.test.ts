/* E-030 · En la app: resolver una línea con varios artículos (atajo de conductores sueltos 3/5 y manguera RZ1-K), un color
   que falta, la regla que se propone y deshacer una resolución (también las de antes de E-030). */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { registrarCierreLocal } from './cierres';
import { colorDe, conductoresSueltos, datosLinea, mangueraRZ1K, reglaDeResolucion, seccionDe } from './resolucion';
import { unidadesABordo } from './reglas';

const cable = (sku: string, name: string): Producto => ({ sku, name, cat: 'cables', unit: 'm', stock: 0, min: 0, supplier: 'Saltoki' } as Producto);
const CABLES = [cable('6000650653', 'CABLE LHA H07Z1-K(AS) 10MM MARRON FLEX'), cable('6000650654', 'CABLE LHA H07Z1-K(AS) 10MM AZUL FLEX'),
  cable('6000650655', 'CABLE LHA H07Z1-K(AS) 10MM AM/VERDE FLEX'), cable('6000650601', 'CABLE LHA H07Z1-K(AS) 6MM NEGRO FLEX'),
  cable('6000650602', 'CABLE LHA H07Z1-K(AS) 6MM GRIS FLEX'), cable('6040615310', 'Cable LHA RZ1-K(AS) 3G10mm 0,6/1kV clase 5 flexible verde')];
function estado(fase = 'mono') {
  const S = fresh(); S.rol = 'admin'; S.equivalencias = []; S.configApp.demoBorrada = undefined;
  S.products.push(...CABLES.map(p => ({ ...p })));
  for (const p of CABLES) S.aBordo.push({ vehiculo: 'V-F01', sku: p.sku, unidades: 100 });
  const r = registrarCierreLocal(S, { numInst: 'E2632246', equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3600e3).toISOString(), tipoLinea: 'manguera', seccion: '10', fase, metrosLinea: 49 }, 'historico');
  const c = S.cierres.find(x => x.id === r.id)!, l = S.lineasCierre.find(x => x.cierre === c.id && x.campo === 'metrosLinea')!;
  expect(l.estado).toBe('sin_equivalencia');
  return { S, c, l };
}
let n = 0; const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('leer los cables del catálogo', () => {
  it('color y sección de un conductor y de una manguera', () => {
    expect(['AM/VERDE', 'MARRON', 'AZUL', 'NEGRO', 'GRIS'].map(c => colorDe(`CABLE H07Z1-K 10MM ${c}`))).toEqual(['AMVERDE', 'MARRON', 'AZUL', 'NEGRO', 'GRIS']);
    expect(colorDe('Cable H07Z1-K 6 mm² amarillo/verde')).toBe('AMVERDE');
    expect(colorDe('Cable H07Z1-K 6 mm² marrón')).toBe('MARRON');
    expect(seccionDe('CABLE LHA H07Z1-K(AS) 10MM AZUL')).toBe(10);
    expect(seccionDe('RZ1-K(AS) 3G2,5mm')).toBe(2.5);
    expect(seccionDe('Cable LHA RZ1-K(AS) 3G10mm 0,6/1kV')).toBe(10);
  });
});

describe('atajo: conductores sueltos y manguera', () => {
  it('monofásica 10 mm²: marrón, azul y amarillo/verde de 10 mm², 49 m cada uno', () => {
    const { S, c } = estado();
    const { fase, seccion } = datosLinea(c);
    expect([fase, seccion]).toEqual(['mono', 10]);
    expect(conductoresSueltos(S, seccion, fase, 49)).toEqual([
      { etiqueta: 'Fase (marrón)', sku: '6000650653', cantidad: 49 }, { etiqueta: 'Neutro (azul)', sku: '6000650654', cantidad: 49 },
      { etiqueta: 'Tierra (amarillo/verde)', sku: '6000650655', cantidad: 49 }]);
  });
  it('trifásica 10 mm²: 5 conductores; faltan negro y gris de 10 (hay de 6, pero no valen) y lo dice', () => {
    const { S, c } = estado('trif');
    const p = conductoresSueltos(S, datosLinea(c).seccion, 'trif', 49);
    expect(p.map(x => x.sku ?? x.falta)).toEqual(['6000650653', 'No hay H07Z1-K 10 mm² NEGRO en el catálogo', 'No hay H07Z1-K 10 mm² GRIS en el catálogo', '6000650654', '6000650655']);
  });
  it('manguera RZ1-K de la sección (3G para mono); si no la hay, lo dice', () => {
    const { S } = estado();
    expect(mangueraRZ1K(S, 10, 'mono', 49)).toEqual({ etiqueta: 'Manguera RZ1-K 3G10', sku: '6040615310', cantidad: 49 });
    expect(mangueraRZ1K(S, 10, 'trif', 49).falta).toBe('No hay Manguera RZ1-K 5G10 en el catálogo');
  });
  it('la regla que se propone: manguera 10 mono → los 3 conductores (factor 1)', () => {
    const { S, c, l } = estado();
    const r = reglaDeResolucion(S, c, l, [{ sku: '6000650653', cantidad: 49 }, { sku: '6000650654', cantidad: 49 }, { sku: '6000650655', cantidad: 49 }]);
    expect([r.campo, r.condiciones, r.articulos]).toEqual(['metrosLinea', { tipoLinea: 'manguera', fase: 'mono', seccion: '10' },
      [{ sku: '6000650653', factor: 1 }, { sku: '6000650654', factor: 1 }, { sku: '6000650655', factor: 1 }]]);
  });
});

describe('resolver con varios artículos y deshacer', () => {
  it('3 conductores: 49 m de cada uno, versión con los tres; deshacer devuelve todo y deja la línea sin resolver', () => {
    const { S, c, l } = estado();
    const arts = conductoresSueltos(S, 10, 'mono', 49).map(p => ({ id: id(), sku: p.sku!, cantidad: p.cantidad }));
    aplicarLocal(S, { op: 'resolverLineaVarios', args: { linea: l.id, grupo: id(), articulos: arts } });
    expect(S.lineasCierre.filter(x => x.cierre === c.id && x.campo === 'metrosLinea').map(x => [x.sku, x.estado])).toEqual(arts.map(a => [a.sku, 'resuelta']));
    for (const a of arts) expect(unidadesABordo(S, 'V-F01', a.sku)).toBe(51);
    expect(c.versiones!.at(-1)!.documento).toMatch(/^Línea metrosLinea resuelta por .+: .*MARRON.* \+ .*AZUL.* \+ .*AM\/VERDE/);
    // deshacer desde cualquiera de las tres
    const otra = S.lineasCierre.find(x => x.cierre === c.id && x.sku === '6000650654')!;
    aplicarLocal(S, { op: 'deshacerResolucion', args: { linea: otra.id } });
    const ls = S.lineasCierre.filter(x => x.cierre === c.id && x.campo === 'metrosLinea');
    expect(ls.map(x => [x.id, x.sku, x.estado, x.cantidad])).toEqual([[l.id, undefined, 'sin_equivalencia', 49]]);
    for (const a of arts) expect(unidadesABordo(S, 'V-F01', a.sku)).toBe(100);
    expect(c.versiones!.at(-1)!.documento).toMatch(/^Resolución de metrosLinea deshecha por /);
    expect(c.versiones!.at(-1)!.diferencia).toEqual(arts.map(a => ({ sku: a.sku, unidades: -49 })));
  });

  it('5 artículos (trifásica)', () => {
    const { S, l } = estado('trif');
    const skus = ['6000650653', '6000650601', '6000650602', '6000650654', '6000650655'];
    aplicarLocal(S, { op: 'resolverLineaVarios', args: { linea: l.id, grupo: id(), articulos: skus.map(sku => ({ id: id(), sku, cantidad: 49 })) } });
    for (const sku of skus) expect(unidadesABordo(S, 'V-F01', sku)).toBe(51);
  });

  it('una resolución de antes de E-030 (un artículo, sin guardar cómo estaba) también se deshace', () => {
    const { S, l } = estado();
    Object.assign(l, { sku: '6000650655', estado: 'resuelta', nota: `${l.nota} · resuelta por César` });
    aplicarLocal(S, { op: 'reprocesarCierre', args: { id: l.cierre } });
    expect(unidadesABordo(S, 'V-F01', '6000650655')).toBe(51);
    aplicarLocal(S, { op: 'deshacerResolucion', args: { linea: l.id } });
    expect([l.sku, l.estado, l.cantidad]).toEqual([undefined, 'sin_equivalencia', 49]);
    expect(l.nota).not.toMatch(/resuelta por/);
    expect(unidadesABordo(S, 'V-F01', '6000650655')).toBe(100);
  });

  it('valida antes de tocar nada', () => {
    const { S, l } = estado();
    expect(() => aplicarLocal(S, { op: 'resolverLineaVarios', args: { linea: l.id, grupo: id(), articulos: [{ id: id(), sku: '6000650653', cantidad: 49 }, { id: id(), sku: 'NO-EXISTE', cantidad: 1 }] } })).toThrow(/NO-EXISTE/);
    expect(() => aplicarLocal(S, { op: 'resolverLineaVarios', args: { linea: l.id, grupo: id(), articulos: [] } })).toThrow(/al menos un artículo/);
    expect(l.estado).toBe('sin_equivalencia');
  });
});
