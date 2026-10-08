/* E-032 · En la app (mismo módulo que el servidor): atributos de la prefactura, precedencia, UTP por cable de datos, partidas
   sin descuento, la regla que sustituye una resolución manual y el resumen de material no gestionado. */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { cierreEfectivo, EQUIVALENCIAS_PROPUESTA, normalizarAtributos, prepararVersion, traducirCierre, normalizarCierre, type Regla } from '../../supabase/functions/_compartido/cierres';
import { noGestionadoPorPartida, registrarCierreLocal } from './cierres';
import { unidadesABordo } from './reglas';

const H = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const AT = { tipoLinea: 'BAJO TUBO', fase: 'MONOFÁSICA', seccion: '3x6mm', cableDatos: 'U/UTP', equipo: 'Búfala 2', hardware: 'POLICHARGER NW', fechaCierreIso: H(-5) };
const PF = { origen: 'holded', numInst: 'E2632263', documento: 'E2632263', fechaAprobacion: H(0), lineas: { metrosLinea: 28, metrosUtp: 28, preinst: 1, rj45: 2 }, atributos: AT };
const UTP = EQUIVALENCIAS_PROPUESTA.filter(r => r.campo === 'metrosUtp');

describe('atributos de la prefactura', () => {
  it('se normalizan: "3x6mm" → 6, "5G10mm" → 10, tubo, mono, trif', () => {
    expect(normalizarAtributos(AT)).toEqual({ tipoLinea: 'tubo', fase: 'mono', seccion: '6', equipo: 'Búfala 2', hardware: 'POLICHARGER NW', fechaCierreIso: AT.fechaCierreIso });
    expect(normalizarAtributos({ seccion: '5G10mm', fase: 'trifásica', tipoLinea: 'manguera' })).toEqual({ seccion: '10', fase: 'trif', tipoLinea: 'manguera' });
  });
  it('precedencia: la prefactura en tipo, fase y sección; el wizard en equipo, fecha, cargador y cable de datos (E-033)', () => {
    const wizard = normalizarCierre({ numInst: 'E1', equipo: 'Búfala 1', fechaCierreIso: H(-6), hardware: 'V2C TRYDAN', tipoLinea: 'manguera', seccion: '10', fase: 'mono', cableDatos: 'F/UTP' });
    const e = cierreEfectivo(wizard, { documento: 'D', fechaAprobacion: H(0), lineas: { metrosLinea: 20 }, atributos: normalizarAtributos(AT) });
    expect([e.tipoLinea, e.seccion, e.cableDatos, e.equipo, e.fechaCierreIso, e.hardware, e.metrosLinea]).toEqual(['tubo', '6', 'F/UTP', 'Búfala 1', wizard.fechaCierreIso, 'V2C TRYDAN', 20]);
    // sin wizard: lo del calendario
    const v = prepararVersion(null, 'holded', PF);
    expect([v.efectivo.equipo, v.efectivo.fechaCierreIso, v.efectivo.hardware]).toEqual(['Búfala 2', AT.fechaCierreIso, 'POLICHARGER NW']);
  });
  it('la misma prefactura es duplicado; con otros atributos, versión nueva; una prefactura sola se rehace con el calendario nuevo', () => {
    const v1 = prepararVersion(null, 'holded', PF);
    const previo = { version: 1, wizard: v1.wizard, holded: v1.holded, origenes: ['holded'] };
    expect(prepararVersion(previo, 'holded', PF).accion).toBe('duplicado');
    const v2 = prepararVersion(previo, 'holded', { ...PF, atributos: { ...AT, equipo: 'Búfala 3' } });
    expect([v2.accion, v2.efectivo.equipo]).toEqual(['nueva', 'Búfala 3']);
  });
});

describe('traducción', () => {
  it('E-033: UTP por el cargador (aunque el cable de datos diga otra cosa); sin cargador reconocido, por el cable de datos', () => {
    const t = (c: Record<string, unknown>) => traducirCierre(normalizarCierre({ metrosUtp: 10, ...c }), UTP, {}).find(l => l.campo === 'metrosUtp')!.sku;
    expect(t({ cableDatos: 'U/UTP', hardware: 'POLICHARGER' })).toBe('7270021010');
    expect(t({ cableDatos: 'F/UTP', hardware: 'V2C TRYDAN' })).toBe('7270020010');
    expect(t({ cableDatos: 'U/UTP' })).toBe('7270020010');
    expect(t({ cableDatos: 'FTP' })).toBe('7270021010');
    expect(t({ hardware: 'POLICHARGER' })).toBe('7270021010');
    expect(t({ hardware: 'V2C TRYDAN' })).toBe('7270020010');
  });
  it('partidas sin descuento: servicio no deja línea; material no gestionado deja la cantidad sin artículo ni pendiente', () => {
    const reglas: Regla[] = [{ id: 'S', campo: 'perfTab', formula: 'directa', condiciones: {}, articulos: [], estimada: false, activa: true, orden: 1, sinDescuento: 'servicio' },
      { id: 'N', campo: 'preinst', formula: 'directa', condiciones: {}, articulos: [], estimada: false, activa: true, orden: 2, sinDescuento: 'no_gestionado' }];
    const l = traducirCierre(normalizarCierre({ perfTab: 2, preinst: 1 }), reglas, {});
    expect(l.map(x => [x.campo, x.sku, x.cantidad, x.estado])).toEqual([['preinst', null, 1, 'no_gestionado']]);
  });
});

describe('en el estado local', () => {
  const ARTS = ['6000650603', '6000650604', '6000650605', '6000650653', '6000650654', '6000650655', '7270020010', '7270021010', '7280040060'];
  function estado() {
    const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined;
    for (const sku of ARTS) if (!S.products.some(p => p.sku === sku)) S.products.push({ sku, name: `Artículo ${sku}`, cat: 'cables', unit: 'm', contenido: 1, stock: 100, min: 0, supplier: '' } as Producto);
    S.equivalencias = [...EQUIVALENCIAS_PROPUESTA.filter(r => ['metrosLinea', 'metrosUtp', 'rj45'].includes(r.campo)).map(r => ({ ...r, confirmada: true }) as Equivalencia),
      { id: 'N', campo: 'preinst', formula: 'directa', condiciones: {}, articulos: [], estimada: false, activa: true, orden: 500, confirmada: true, sinDescuento: 'no_gestionado' }];
    return S;
  }
  it('prefactura sin cierre: descuenta de la furgoneta del equipo del calendario, preinst no gestionado y en el resumen', () => {
    const S = estado(), r = registrarCierreLocal(S, PF, 'holded');
    const c = S.cierres.find(x => x.id === r.id)!;
    expect(c.vehiculo).toBe('V-F02');
    expect(S.lineasCierre.filter(l => l.cierre === c.id && l.campo !== 'hardware').map(l => [l.campo, l.sku, l.estado]))
      .toEqual([['metrosLinea', '6000650603', 'discrepancia'], ['metrosLinea', '6000650604', 'discrepancia'], ['metrosLinea', '6000650605', 'discrepancia'],
        ['metrosUtp', '7270021010', 'discrepancia'], ['rj45', '7280040060', 'discrepancia'], ['preinst', undefined, 'no_gestionado'],
        ['pvc32', undefined, 'sin_equivalencia']]);                     // E-042: el tubo PVC deducido de la línea (aquí no hay regla de pvc32)
    expect(unidadesABordo(S, 'V-F02', '6000650603')).toBe(-28);
    expect(noGestionadoPorPartida(S, S.cierres)).toEqual([{ campo: 'preinst', cantidad: 1, cierres: 1 }]);
  });
  it('resuelta a mano y luego llega con atributos: la regla sustituye la resolución (no se suman)', () => {
    const S = estado();
    const r = registrarCierreLocal(S, { ...PF, atributos: { equipo: 'Búfala 2', fechaCierreIso: AT.fechaCierreIso }, lineas: { metrosLinea: 28 } }, 'holded');
    const l = S.lineasCierre.find(x => x.cierre === r.id && x.campo === 'metrosLinea')!;
    expect(l.estado).toBe('sin_equivalencia');
    aplicarLocal(S, { op: 'resolverLineaVarios', args: { linea: l.id, grupo: 'g1', articulos: ['6000650653', '6000650654', '6000650655'].map((sku, i) => ({ id: `x${i}`, sku, cantidad: 28 })) } });
    expect(unidadesABordo(S, 'V-F02', '6000650653')).toBe(-28);
    registrarCierreLocal(S, { ...PF, lineas: { metrosLinea: 28 } }, 'holded');
    expect(S.lineasCierre.filter(x => x.cierre === r.id && x.campo === 'metrosLinea').map(x => [x.sku, x.cantidad])).toEqual([['6000650603', 28], ['6000650604', 28], ['6000650605', 28]]);
    expect(unidadesABordo(S, 'V-F02', '6000650653')).toBe(0);
    expect(unidadesABordo(S, 'V-F02', '6000650603')).toBe(-28);
  });
});
