/* E-042 · El tubo PVC que no viene en el cierre (la prefactura de Holded no lo lleva) se deduce de los metros de línea; las fijaciones
   se calculan con ese PVC; el PVC deducido va por barras enteras (E-036); y el recálculo de todos los cierres, con vista previa, que
   respeta las correcciones manuales (E-035). Caso real: 44 m de 10 mm² bajo tubo con 1 m de corrugado y 3 m de acero → 40 m de PVC y
   86 fijaciones. Reloj fijo (ver la revisión del chat del 08/10). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { deducirPvc, EQUIVALENCIAS_PROPUESTA, normalizarCierre } from '../../supabase/functions/_compartido/cierres';
import { lineasRecalculo, registrarCierreLocal, traducirEnApp, vistaPreviaRecalculo } from './cierres';
import { corregirCierreLocal } from './corregir';
import { unidadesABordo } from './reglas';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); const d = new Date(); d.setHours(20, 0, 0, 0); vi.setSystemTime(d); });
afterEach(() => { vi.useRealTimers(); });

const PVC = '6201000032', CORR = '6200020032', ACERO = '6203000032', MANG = '6201025023', CLIP = '5102012032', CLAVO = 'T-CLAVO', RZ6 = '6040610306';
const H07 = ['6000650653', '6000650654', '6000650655'];
const prod = (o: Partial<Producto>) => ({ name: o.sku, cat: 'tubos', unit: 'm', contenido: 1, stock: 0, min: 0, supplier: '', ...o }) as Producto;

function estado() {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  S.products.push(
    prod({ sku: PVC, name: 'TUBO PVC M-32 RÍGIDO', unit: 'barra', contenido: 3, unidadContenido: 'm', piezaEntera: true, stock: 40 }),
    prod({ sku: CORR, name: 'TUBO CORRUGADO M-32', unit: 'rollo', contenido: 100, unidadContenido: 'm', stock: 2 }),
    prod({ sku: ACERO, name: 'TUBO ACERO M-32', unit: 'barra', contenido: 3, unidadContenido: 'm', stock: 20 }),
    prod({ sku: MANG, name: 'MANGUITO M-32', unit: 'ud', stock: 100 }),
    prod({ sku: CLIP, name: 'GRAPA M-32', cat: 'fijaciones', unit: 'ud', stock: 500 }),
    prod({ sku: CLAVO, name: 'CLAVO', cat: 'fijaciones', unit: 'ud', stock: 500 }),
    prod({ sku: RZ6, name: 'RZ1-K 3G6', cat: 'cables', stock: 300 }),
    ...H07.map(sku => prod({ sku, name: `H07Z1-K 10 ${sku}`, cat: 'cables', unit: 'caja', contenido: 100, unidadContenido: 'm', stock: 5 })));
  S.kits = { A: [{ sku: CLIP, factor: 1 }, { sku: CLAVO, factor: 1 }] };
  S.configApp.kitFijacion = 'A';
  S.equivalencias = EQUIVALENCIAS_PROPUESTA.filter(r => r.campo !== 'hardware' && !r.campo.startsWith('metrosUtp')).map(r => ({ ...r, confirmada: true }) as Equivalencia);
  return S;
}
/** Lo que llega de la prefactura de Holded: metros de línea y canalizaciones facturables, sin pvc32 */
const CAPTURA = { numInst: 'E2640001', equipo: 'Búfala 1', tipoLinea: 'tubo', fase: 'mono', seccion: '10', metrosLinea: 44, corr32: 1, acero32: 3 };
const conFecha = (o: Record<string, unknown>) => ({ fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString(), ...o });
const de = (S: ReturnType<typeof estado>, sku: string, campo?: string) => traducirEnApp(S, normalizarCierre(CAPTURA)).filter(l => l.sku === sku && (!campo || l.campo === campo));

describe('tubo PVC deducido de los metros de línea', () => {
  it('la captura: 44 − 1 − 3 = 40 m de PVC, marcado como deducido; 86 fijaciones', () => {
    expect(deducirPvc(normalizarCierre(CAPTURA))).toMatchObject({ pvc32: 40, pvcDeducido: 'PVC deducido de los metros de línea (44 − 1 − 3 = 40 m)' });
    const S = estado();
    expect(de(S, PVC)).toEqual([expect.objectContaining({ campo: 'pvc32', cantidad: 40, nota: expect.stringMatching(/^PVC deducido de los metros de línea \(44 − 1 − 3 = 40 m\)/) })]);
    expect(de(S, CLIP)[0]).toMatchObject({ campo: 'pvc32+acero32+acero40', cantidad: 86, nota: expect.stringContaining('deducido') });
    expect(de(S, CLAVO)[0].cantidad).toBe(86);
    // la regla de fijaciones que hay hoy en producción (pvc32+acero32) da lo mismo: no hay acero40
    S.equivalencias = S.equivalencias.map(r => r.formula === 'fijaciones' ? { ...r, campo: 'pvc32+acero32' } : r);
    expect(de(S, CLIP)[0].cantidad).toBe(86);
    expect(de(S, MANG)[0].cantidad).toBe(14);                                    // manguitos floor(40/3)+1
    expect(de(S, H07[0])[0].cantidad).toBe(44);                                  // y los 3 conductores, como antes
  });

  it('si el cierre trae pvc32 se respeta; nunca negativo; sin metros de línea no hay nada que deducir', () => {
    expect(deducirPvc(normalizarCierre({ ...CAPTURA, pvc32: 20 }))).toMatchObject({ pvc32: 20 });
    expect(deducirPvc(normalizarCierre({ ...CAPTURA, pvc32: 20 })).pvcDeducido).toBeUndefined();
    expect(deducirPvc(normalizarCierre({ ...CAPTURA, corr32: 30, acero32: 20 })).pvc32).toBe(0);
    expect(deducirPvc(normalizarCierre({ ...CAPTURA, metrosLinea: 0 })).pvc32).toBe(0);
    expect(deducirPvc(normalizarCierre({ ...CAPTURA, corr32: 0, acero32: 0, metrosLinea: 49 })).pvcDeducido).toBe('PVC deducido de los metros de línea (49 m)');
    const S = estado();
    expect(traducirEnApp(S, normalizarCierre({ ...CAPTURA, pvc32: 20 })).find(l => l.sku === PVC)).toMatchObject({ cantidad: 20, nota: '' });
  });

  it('manguera: se descuentan la manguera y el tubo PVC que venga; sin pvc32 no se deduce', () => {
    const S = estado(), M = { ...CAPTURA, tipoLinea: 'manguera', seccion: '6', metrosLinea: 15, corr32: 0, acero32: 0 };
    const con = traducirEnApp(S, normalizarCierre({ ...M, pvc32: 15 }));
    expect(con.filter(l => [RZ6, PVC].includes(l.sku!)).map(l => [l.sku, l.cantidad])).toEqual([[RZ6, 15], [PVC, 15]]);
    expect(traducirEnApp(S, normalizarCierre(M)).some(l => l.sku === PVC)).toBe(false);
  });

  it('el PVC deducido se descuenta por barras enteras: 40 m → 14 barras (42 m)', () => {
    const S = estado();
    registrarCierreLocal(S, conFecha(CAPTURA), 'wizard');
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(-42);
    expect(unidadesABordo(S, 'V-F01', CLIP)).toBe(-86);
  });
});

describe('recalcular todos los cierres desde una fecha, con vista previa', () => {
  /** Dos cierres aplicados cuando el PVC aún no se deducía (aquí: reglas del PVC y de fijaciones desactivadas); el segundo, corregido a mano */
  function conCierresViejos() {
    const S = estado();
    const off = (r: Equivalencia) => r.campo.includes('pvc32') ? { ...r, activa: false } : r;
    const reglas = S.equivalencias; S.equivalencias = reglas.map(off);
    const a = registrarCierreLocal(S, conFecha(CAPTURA), 'wizard').id;
    const b = registrarCierreLocal(S, conFecha({ ...CAPTURA, numInst: 'E2640002', metrosLinea: 20, corr32: 0, acero32: 0 }), 'wizard').id;
    corregirCierreLocal(S, b, { fijar: { pvc32: [{ sku: PVC, cantidad: 6 }] } }, 'Admin');     // E-035: el administrador fijó 6 m de PVC
    S.equivalencias = reglas;
    return { S, a, b };
  }
  const datos = (S: ReturnType<typeof estado>) => (id: string) => S.cierres.find(c => c.id === id)?.datos;

  it('la vista previa no toca nada y dice qué cambia por artículo y furgoneta', () => {
    const { S, a, b } = conCierresViejos();
    const antes = JSON.stringify(S);
    const v = vistaPreviaRecalculo(S, Date.now() - 864e5, datos(S));
    expect(JSON.stringify(S)).toBe(antes);
    expect(v.revisados).toBe(2);
    expect(v.cambios.map(c => c.id).sort()).toEqual([a, b].sort());
    const fila = (sku: string) => v.porArticulo.find(x => x.sku === sku && x.vehiculo === 'V-F01');
    // a: +42 m de PVC (14 barras) y 86 fijaciones; b: su PVC fijado a mano se respeta (solo cambian sus 40 fijaciones)
    expect(fila(PVC)).toMatchObject({ unidades: 42, cierres: 1 });
    expect(fila(CLIP)).toMatchObject({ unidades: 86 + 40, cierres: 2 });
    expect(v.cambios.find(c => c.id === a)!.lineas.find(l => l.sku === PVC)!.nota).toMatch(/deducido/);
  });

  it('Aplicar: ajustes enlazados a cada cierre, una versión "Recalculado" y la corrección manual intacta; después, nada que cambiar', () => {
    const { S, a, b } = conCierresViejos();
    const pvcAntes = unidadesABordo(S, 'V-F01', PVC);
    const v = vistaPreviaRecalculo(S, Date.now() - 864e5, datos(S));
    for (const c of v.cambios) aplicarLocal(S, { op: 'recalcularCierre', args: { id: c.id, lineas: c.lineas } });
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(pvcAntes - 42);
    expect(S.movements.filter(m => m.cierre === a && m.sku === PVC).reduce((x, m) => x + (m.unidades || 0), 0)).toBe(-42);
    expect(S.cierres.find(c => c.id === a)!.versiones!.at(-1)).toMatchObject({ origen: 'admin', documento: expect.stringMatching(/^Recalculado por/) });
    expect(S.lineasCierre.filter(l => l.cierre === b && l.campo === 'pvc32')).toEqual([expect.objectContaining({ manual: true, cantidad: 6 })]);
    expect(vistaPreviaRecalculo(S, Date.now() - 864e5, datos(S)).cambios).toEqual([]);
    // la traducción que se envía al servidor es la misma que la de la vista previa
    expect(lineasRecalculo(S, S.cierres.find(c => c.id === a)!, S.cierres.find(c => c.id === a)!.datos!).find(l => l.sku === PVC)!.cantidad).toBe(40);
  });
});
