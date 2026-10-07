/* E-036 · El material se ve en la unidad en que se gasta, consumo por pieza entera y comprobación de formatos.
   Captura del usuario: "−3,19 cajas" de H07Z1-K, "−20,67 barras" de PVC y "0,8 m" de RZ1-K 3G10 (eran 80 m). */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia, Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { EQUIVALENCIAS_PROPUESTA } from '../../supabase/functions/_compartido/cierres';
import { consumoPorArticulo, registrarCierreLocal } from './cierres';
import { cambiarFormatoLocal, cantTxt } from './formatos';
import { incoherenciasFormato } from './coherencia';
import { enVista, lineaCierreTxt, qtyTxt, unidadesABordo, vista, vistaUnidades } from './reglas';
import { lineasContadas } from '../ui/contado';
import { filasCsvInventario } from './listaInventario';

const PVC = '6201000032', CORR = '6200020032', H07 = '6000650655', CLAVOS = '057553', RZ = '6040615310';
const prod = (o: Partial<Producto>) => ({ name: o.sku, cat: 'cables', unit: 'm', contenido: 1, stock: 0, min: 0, supplier: '', ...o }) as Producto;

function estado(piezaEntera = true) {
  const S = fresh(); S.rol = 'admin'; S.configApp.demoBorrada = undefined; S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
  S.products.push(
    prod({ sku: PVC, name: 'TUBO PVC M-32 RÍGIDO', cat: 'tubos', unit: 'barra', contenido: 3, unidadContenido: 'm', piezaEntera, stock: 40 }),
    prod({ sku: CORR, name: 'TUBO CORRUGADO M-32', cat: 'tubos', unit: 'rollo', contenido: 100, unidadContenido: 'm', stock: 2 }),
    prod({ sku: H07, name: 'CABLE H07Z1-K 10 MM', unit: 'caja', contenido: 100, unidadContenido: 'm', stock: 3 }),
    prod({ sku: CLAVOS, name: 'Clavos HC6-27 (500 uds)', cat: 'fijaciones', unit: 'caja', contenido: 500, unidadContenido: 'ud', stock: 6 }),
    prod({ sku: RZ, name: 'RZ1-K 3G10', stock: 200 }));
  S.equivalencias = EQUIVALENCIAS_PROPUESTA.filter(r => ['pvc32', 'corr32'].includes(r.campo)).map(r => ({ ...r, confirmada: true }) as Equivalencia);
  return S;
}
/** Cierre del wizard (el PVC rígido llega del wizard; la prefactura no lo factura) */
const WZ = (lineas: Record<string, number>, n = 'E2639001') => ({ numInst: n, equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString(), ...lineas });

describe('el material se ve en metros (o unidades) y el formato en pequeño', () => {
  it('la captura del usuario', () => {
    const S = estado(), p = (sku: string) => S.products.find(x => x.sku === sku)!;
    expect(vistaUnidades(p(H07), -319)).toEqual({ principal: '-319 m', secundario: '≈ -3,19 cajas de 100 m' });
    expect(qtyTxt(p(H07), 3)).toBe('300 m · 3 cajas de 100 m');
    expect(vistaUnidades(p(CLAVOS), -250).principal).toBe('-250 ud');
    expect(vistaUnidades(p(PVC), -62)).toEqual({ principal: '-62 m', secundario: '≈ -20,67 barras de 3 m' });
    expect(qtyTxt(p(RZ), 0.8)).toBe('0,8 m');                                   // en metros, sin formato: sin dudas
    // "Mostrar en formato": al revés
    p(CLAVOS).mostrarFormato = true;
    expect(vistaUnidades(p(CLAVOS), -250)).toEqual({ principal: '-0,5 cajas', secundario: '-250 ud' });
    // en las entregas se sigue entregando por formato entero, con su equivalencia
    expect(cantTxt(p(H07), 2)).toBe('2 cajas (200 m)');
  });
  it('el CSV del inventario va en la unidad base, con el formato aparte', () => {
    const S = estado(), h = filasCsvInventario(S, [S.products.find(x => x.sku === H07)!]);
    const fila = Object.fromEntries(h[0].map((k, i) => [k, h[1][i]]));
    expect([fila['Almacén'], fila['Unidad'], fila['Formato'], fila['Total en formatos']]).toEqual([300, 'm', 'caja de 100 m', 3]);
    expect(enVista(S.products.find(x => x.sku === RZ)!, 15)).toEqual({ n: 15, u: 'm' });
  });
});

describe('consumo por pieza entera', () => {
  it('62 m de PVC en barras de 3 m descuentan 21 barras (63 m); el corrugado, sin la opción, 62 m justos', () => {
    const S = estado(), id = registrarCierreLocal(S, WZ({ pvc32: 62, corr32: 62 }), 'wizard').id;
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(-63);
    expect(unidadesABordo(S, 'V-F01', CORR)).toBe(-62);
    const l = S.lineasCierre.find(x => x.cierre === id && x.sku === PVC)!;
    expect(lineaCierreTxt(S.products.find(x => x.sku === PVC)!, l.cantidad)).toBe('62 m → 21 barras (63 m)');
    // el consumo del periodo cuenta lo que de verdad se descontó
    expect(consumoPorArticulo(S, S.cierres).find(x => x.sku === PVC)).toMatchObject({ unidades: 63, formatos: 21 });
    // la línea exacta (63 m) no redondea de más
    registrarCierreLocal(S, WZ({ pvc32: 63 }, 'E2639002'), 'wizard');
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(-126);
  });
  it('los cierres ya aplicados no cambian solos: "Recalcular cierres desde…" con versión', () => {
    const S = estado(false), id = registrarCierreLocal(S, WZ({ pvc32: 62 }), 'wizard').id;
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(-62);
    S.products.find(x => x.sku === PVC)!.piezaEntera = true;
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(-62);
    aplicarLocal(S, { op: 'recalcularConsumoPiezas', args: { sku: PVC, desde: Date.now() - 864e5 } });
    expect(unidadesABordo(S, 'V-F01', PVC)).toBe(-63);
    const c = S.cierres.find(x => x.id === id)!;
    expect(c.versiones!.at(-1)).toMatchObject({ origen: 'admin', diferencia: [{ sku: PVC, unidades: 1 }] });
    expect(c.versiones!.at(-1)!.documento).toMatch(/recalculado .*por pieza entera/);
    // otra vez: no cambia nada ni deja versión
    const n = c.versiones!.length;
    aplicarLocal(S, { op: 'recalcularConsumoPiezas', args: { sku: PVC, desde: Date.now() - 864e5 } });
    expect(c.versiones!.length).toBe(n);
  });
});

describe('comprobación de formatos', () => {
  it('el caso del RZ1-K 3G10: de rollo de 100 m a metros "sin convertir" deja 80 m en 0,8 m; se propone y se aplica el arreglo', () => {
    const S = estado();
    S.aBordo.push({ vehiculo: 'V-F02', sku: RZ, unidades: 80 });
    expect(incoherenciasFormato(S)).toEqual([]);
    cambiarFormatoLocal(S, RZ, { unit: 'rollo', contenido: 100, unidadContenido: 'm' }, 'contenido', 'Admin');
    cambiarFormatoLocal(S, RZ, { unit: 'm', contenido: 1, unidadContenido: 'm' }, 'formato', 'Admin');
    expect(unidadesABordo(S, 'V-F02', RZ)).toBe(0.8);
    const [i, ...resto] = incoherenciasFormato(S);
    expect(resto).toEqual([]);                                                 // el "0,8 m" no se avisa dos veces
    expect(i).toMatchObject({ sku: RZ, tipo: 'conversion', arreglo: { vehiculo: 'V-F02', unidades: 79.2 } });
    expect(i.texto).toMatch(/dejó 80 m en 0,8 m/);
    aplicarLocal(S, { op: 'ajuste', args: { id: 'A1', sku: RZ, qty: i.arreglo!.unidades, motivo: i.arreglo!.motivo, vehiculo: 'V-F02' } });
    expect(unidadesABordo(S, 'V-F02', RZ)).toBe(80);
    expect(incoherenciasFormato(S)).toEqual([]);
  });
  it('unidad, contenido y stock que no cuadran', () => {
    const S = estado();
    S.products.push(prod({ sku: 'X1', unit: 'm', contenido: 100 }), prod({ sku: 'X2', unit: 'caja', contenido: 1 }), prod({ sku: 'X3', unit: 'bote', contenido: 1000, stock: 2.5 }));
    S.aBordo.push({ vehiculo: 'V-F01', sku: H07, unidades: 0.4 });
    expect(incoherenciasFormato(S).map(i => [i.sku, i.tipo])).toEqual([[H07, 'diminuto_a_bordo'], ['X1', 'contenido_en_base'], ['X2', 'formato_sin_contenido'], ['X3', 'fraccion_almacen']]);
  });
});

describe('recuentos en metros o en formato', () => {
  it('"3 cajas y 40 m" o "340 m": lo mismo, y se ven las dos cifras', () => {
    const S = estado(), p = S.products.find(x => x.sku === H07)!;
    const f = (v: Record<string, string>) => lineasContadas(v, () => p)[0].contado;
    expect(f({ [H07]: '3', [`${H07}|m`]: '40' })).toBe(3.4);
    expect(f({ [H07]: '', [`${H07}|m`]: '340' })).toBe(3.4);
    expect(qtyTxt(p, 3.4)).toBe('340 m · ≈ 3,4 cajas de 100 m');
    // en unidades: "1 caja y 250 ud"
    const c = S.products.find(x => x.sku === CLAVOS)!;
    expect(lineasContadas({ [CLAVOS]: '1', [`${CLAVOS}|m`]: '250' }, () => c)[0].contado).toBe(1.5);
    expect(vista(c, 1.5).principal).toBe('750 ud');
  });
});
