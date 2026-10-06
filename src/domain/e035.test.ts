/* E-035 · En la app: corregir un cierre en todo (= corregir_cierre del servidor). Caso real E2632405: Policharger trifásico
   descontado como NW T2 por la regla genérica, línea trifásica y caja de registro sin artículo. */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { EQUIVALENCIAS_PROPUESTA } from '../../supabase/functions/_compartido/cierres';
import { registrarCierreLocal } from './cierres';
import { lineasCorregidas, type Correccion } from './corregir';
import { filtrarParaSocio } from './socio';
import { unidadesABordo } from './reglas';

const NWT2 = '8906000665', DBLT = '8437024504283';
const HW = 'POLICHARGER NW TRIFÁSICO DOBLE PROTECCIÓN M10 M5';
const PF = { origen: 'holded', numInst: 'E2632405', documento: 'E2632405', fechaAprobacion: new Date().toISOString(), lineas: { metrosLinea: 15, corr32: 1, cajaReg: 1 },
  atributos: { tipoLinea: 'manguera', fase: 'mono', seccion: '6', equipo: 'Búfala 1', hardware: HW, fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString() } };
const sinTrif = (r: Equivalencia) => !(r.campo === 'hardware' && JSON.stringify(r.condiciones).includes('trif'));

function estado(reglas: (r: Equivalencia) => boolean = sinTrif) {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  const p = (sku: string, name: string, extra: Partial<Producto> = {}) => S.products.push({ sku, name, cat: 'cables', unit: 'm', contenido: 1, stock: 0, min: 0, supplier: '', ...extra } as Producto);
  p(NWT2, 'POLICHARGER NW T2', { cat: 'cargadores', unit: 'ud', propiedad: 'custodia', propietario: 'ESMOVE' });
  p(DBLT, 'POLICHARGER NW-DBLT23F', { cat: 'cargadores', unit: 'ud', propiedad: 'custodia', propietario: 'ESMOVE' });
  for (const sku of ['6000650603', '6000650601', '6000650602', '6000650604', '6000650605', '6040610306', '6200020032']) p(sku, `Artículo ${sku}`);
  S.equivalencias = EQUIVALENCIAS_PROPUESTA.filter(r => ['metrosLinea', 'corr32', 'hardware'].includes(r.campo)).map(r => ({ ...r, confirmada: true }) as Equivalencia).filter(reglas);
  S.aBordo.push({ vehiculo: 'V-F01', sku: DBLT, unidades: 1 });
  const id = registrarCierreLocal(S, PF, 'holded').id;
  return { S, id };
}
const corregir = (S: ReturnType<typeof fresh>, id: string, p: Correccion) => {
  const c = S.cierres.find(x => x.id === id)!;
  aplicarLocal(S, { op: 'corregirCierre', args: { id, correccion: { ...p, lineas: lineasCorregidas(S, c, 'datos' in p ? p.datos : c.correccion) } } });
};
const lineas = (S: ReturnType<typeof fresh>, id: string, campo: string) => S.lineasCierre.filter(l => l.cierre === id && l.campo === campo);

describe('corregir un cierre en la app', () => {
  it('el caso real: trifásica bajo tubo (de 3 a 5 conductores) y el NW-DBLT23F en lugar del NW T2; Búfala 1 en 0 y 0', () => {
    const { S, id } = estado();
    expect(unidadesABordo(S, 'V-F01', NWT2)).toBe(-1);
    corregir(S, id, { datos: { fase: 'trif', tipoLinea: 'tubo', seccion: '6' }, fijar: { hardware: [{ sku: DBLT, cantidad: 1 }] } });
    expect([unidadesABordo(S, 'V-F01', NWT2), unidadesABordo(S, 'V-F01', DBLT)]).toEqual([0, 0]);
    expect(lineas(S, id, 'metrosLinea').map(l => l.sku).sort()).toEqual(['6000650601', '6000650602', '6000650603', '6000650604', '6000650605']);
    const c = S.cierres.find(x => x.id === id)!;
    expect(c.correccion).toEqual({ fase: 'trif', tipoLinea: 'tubo', seccion: '6' });
    expect(c.versiones!.at(-1)!.documento).toMatch(/^Corrección manual por .+: datos: .* · hardware: 1 × POLICHARGER NW-DBLT23F/);
    // el informe del socio (Esmove) ve el artículo corregido
    const V = filtrarParaSocio(S, 'ESMOVE');
    expect(V.lineasCierre.filter(l => l.campo === 'hardware').map(l => l.sku)).toEqual([DBLT]);
  });

  it('de 3 a 5 conductores solo cambiando la fase', () => {
    const { S, id } = estado();
    corregir(S, id, { datos: { tipoLinea: 'tubo', fase: 'mono' } });
    expect(lineas(S, id, 'metrosLinea')).toHaveLength(3);
    corregir(S, id, { datos: { tipoLinea: 'tubo', fase: 'trif' } });
    expect(lineas(S, id, 'metrosLinea')).toHaveLength(5);
    expect(unidadesABordo(S, 'V-F01', '6000650601')).toBe(-15);
  });

  it('quitar y añadir líneas; lo corregido prevalece sobre una prefactura posterior; volver a lo automático', () => {
    const { S, id } = estado();
    corregir(S, id, { datos: { fase: 'trif', tipoLinea: 'tubo', seccion: '6' }, fijar: { cajaReg: [], corr32: [{ sku: '6200020032', cantidad: 2 }, { sku: '6040610306', cantidad: 1 }], hardware: [{ sku: DBLT, cantidad: 1 }] } });
    expect(lineas(S, id, 'cajaReg').map(l => [l.estado, l.manual])).toEqual([['quitada', true]]);
    expect(lineas(S, id, 'corr32').map(l => [l.sku, l.cantidad])).toEqual([['6200020032', 2], ['6040610306', 1]]);
    expect(S.cierres.find(x => x.id === id)!.estado).not.toBe('parcial');
    // otra prefactura (fase mono y 20 m): la corrección manda
    registrarCierreLocal(S, { ...PF, documento: 'E2632405-b', lineas: { metrosLinea: 20, corr32: 1, cajaReg: 1 } }, 'holded');
    expect(lineas(S, id, 'metrosLinea').map(l => l.cantidad)).toEqual([20, 20, 20, 20, 20]);
    expect(lineas(S, id, 'hardware').map(l => l.sku)).toEqual([DBLT]);
    expect(lineas(S, id, 'corr32').map(l => l.cantidad)).toEqual([2, 1]);
    // volver a lo automático: datos y corrugado
    corregir(S, id, { datos: null, soltar: ['corr32'] });
    expect(lineas(S, id, 'metrosLinea').map(l => l.sku)).toEqual(['6040610306']);
    expect(lineas(S, id, 'corr32').map(l => [l.sku, l.cantidad, !!l.manual])).toEqual([['6200020032', 1, false]]);
    expect(S.cierres.find(x => x.id === id)!.correccion).toBeUndefined();
  });

  it('cambiar el equipo: lo descontado vuelve a la furgoneta anterior', () => {
    const { S, id } = estado();
    corregir(S, id, { datos: { equipo: 'Búfala 2' } });
    expect(unidadesABordo(S, 'V-F01', NWT2)).toBe(0);
    expect(unidadesABordo(S, 'V-F02', NWT2)).toBe(-1);
  });

  it('con la regla nueva, el Policharger trifásico ya sale bien sin corregir', () => {
    const { S, id } = estado(() => true);
    expect(lineas(S, id, 'hardware').map(l => l.sku)).toEqual([DBLT]);
    expect(unidadesABordo(S, 'V-F01', DBLT)).toBe(0);
  });
});
