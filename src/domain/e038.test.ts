/* E-038 · Retirada de material en custodia por el socio (en la app, = registrar_retirada / anular_retirada): solo artículos de
   ese socio, sin pasar del stock, el stock y el extracto bajan, número RET-, el socio la ve sin datos internos y la anulación
   devuelve el stock. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fresh } from '../data/semilla';
import type { Producto } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { comprobarRetirada, type DatosRetirada } from './retiradas';
import { extractoLocal } from './extracto';
import { filtrarParaSocio } from './socio';
import { datosInformeCustodia } from './custodia';
import { construirInforme } from '../../supabase/functions/_compartido/informe';
import { unidadesABordo } from './reglas';

const CARG = 'T-ESM-CARG';
const BASE: Omit<DatosRetirada, 'lineas'> = { socio: 'ESMOVE', recoge: 'Persona inventada', recogeDoc: 'Transportes Ejemplo SL', enNombre: 'tercero', tercero: 'Instalador inventado',
  terceroEmpresa: 'Instalaciones Ficticias SL', motivo: 'traslado', referencia: 'PED-123', firma: 'data:image/png;base64,AA' };
function estado() {
  const S = fresh(); S.rol = 'admin';
  S.products.push({ sku: CARG, name: 'Cargador de Esmove', cat: 'cargadores', unit: 'ud', contenido: 1, stock: 5, min: 0, supplier: '', propiedad: 'custodia', propietario: 'ESMOVE' } as Producto);
  return S;
}
const retirar = (S: ReturnType<typeof fresh>, d: Partial<DatosRetirada> & { lineas: DatosRetirada['lineas'] }, id = 'R1') => aplicarLocal(S, { op: 'retirada', args: { id, datos: { ...BASE, ...d } } });

// Chat (08/10): la semilla fija entregas a una hora del día (p. ej. hoy 08:30). Sin reloj fijo, antes de esa hora los
// movimientos de la prueba quedaban por delante de la entrega y el orden del extracto cambiaba (fallaba por la mañana).
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); const d = new Date(); d.setHours(20, 0, 0, 0); vi.setSystemTime(d); });
afterEach(() => { vi.useRealTimers(); });

describe('retirada por el socio en la app', () => {
  it('del almacén: número RET-, stock y movimiento; idempotente', () => {
    const S = estado();
    retirar(S, { lineas: [{ sku: CARG, cantidad: 2 }] });
    const r = S.retiradas![0];
    expect(r).toMatchObject({ numero: expect.stringMatching(/^RET-\d{4}-0001$/), estado: 'firmada', lineas: [{ sku: CARG, nombre: 'Cargador de Esmove', cantidad: 2, unidades: 2 }] });
    expect(S.products.find(p => p.sku === CARG)!.stock).toBe(3);
    expect(S.movements[0]).toMatchObject({ type: 'salida', reason: 'Retirada por el socio', ref: r.numero, retirada: 'R1' });
    retirar(S, { lineas: [{ sku: CARG, cantidad: 2 }] });
    expect(S.products.find(p => p.sku === CARG)!.stock).toBe(3);
  });

  it('solo lo de ese socio y sin pasar del stock', () => {
    const S = estado();
    const wbx = S.products.find(p => p.sku === 'WBX-PULSAR-22')!;
    expect(comprobarRetirada(S, { socio: 'INSTANTBOX', lineas: [{ sku: CARG, cantidad: 1 }] })[0]).toMatch(/no es material en custodia de/);
    expect(comprobarRetirada(S, { socio: 'ESMOVE', lineas: [{ sku: 'CAB-RZ1K-5G6', cantidad: 1 }] })[0]).toMatch(/no es material en custodia/);
    expect(comprobarRetirada(S, { socio: 'ESMOVE', lineas: [{ sku: CARG, cantidad: 6 }] })[0]).toMatch(/Solo hay 5 ud/);
    expect(() => retirar(S, { firma: '', lineas: [{ sku: CARG, cantidad: 1 }] })).toThrow(/Falta la firma/);
    expect(() => retirar(S, { tercero: '', lineas: [{ sku: CARG, cantidad: 1 }] })).toThrow(/tercero autorizado/);
    expect(wbx.propietario).toBe('ESMOVE');
  });

  it('desde un vehículo: baja lo de a bordo y el extracto lo muestra como retirada', () => {
    const S = estado();
    expect(comprobarRetirada(S, { socio: 'ESMOVE', vehiculo: 'V-F01', lineas: [{ sku: 'WBX-PULSAR-22', cantidad: 3 }] })[0]).toMatch(/Solo hay 2 ud/);
    retirar(S, { vehiculo: 'V-F01', lineas: [{ sku: 'WBX-PULSAR-22', cantidad: 1 }] });
    expect(unidadesABordo(S, 'V-F01', 'WBX-PULSAR-22')).toBe(1);
    const e = extractoLocal(S, 'V-F01', 'WBX-PULSAR-22');
    expect(e.filas.at(-1)).toMatchObject({ tipo: 'retirada', unidades: -1, referencia: S.retiradas![0].numero });
    expect([e.saldoCalculado, e.stock]).toEqual([1, 1]);
  });

  it('el socio ve su retirada (con firma) y el informe la lleva en su sección; la anulación devuelve el stock', () => {
    const S = estado();
    retirar(S, { lineas: [{ sku: CARG, cantidad: 2 }] });
    const V = filtrarParaSocio(S, 'ESMOVE');
    expect(V.retiradas).toHaveLength(1);
    expect(V.retiradas![0]).toMatchObject({ firma: BASE.firma, recoge: 'Persona inventada', operator: 'Búfala' });
    expect(filtrarParaSocio(S, 'INSTANTBOX').retiradas).toEqual([]);
    const inf = construirInforme(datosInformeCustodia(S, 'ESMOVE', Date.now() - 864e5, Date.now() + 864e5));
    const sec = inf.secciones.find(s => s.titulo === 'Retirado por el socio')!;
    expect(sec.filas).toEqual([[expect.any(String), CARG, 'Cargador de Esmove', '−2', S.retiradas![0].numero, 'almacén']]);
    expect(inf.secciones.find(s => s.titulo === 'Instalado en obra')!.filas.some(f => f[1] === CARG)).toBe(false);
    // anular: solo administrador, con motivo, y el stock vuelve
    S.rol = 'almacen';
    expect(() => aplicarLocal(S, { op: 'anularRetirada', args: { id: 'R1', motivo: 'Error' } })).toThrow(/administrador/);
    S.rol = 'admin';
    aplicarLocal(S, { op: 'anularRetirada', args: { id: 'R1', motivo: 'Se registró dos veces' } });
    expect(S.products.find(p => p.sku === CARG)!.stock).toBe(5);
    expect(S.retiradas![0]).toMatchObject({ estado: 'anulada', anulacionMotivo: 'Se registró dos veces' });
    expect(S.movements[0]).toMatchObject({ type: 'entrada', corrige: expect.any(String), retirada: 'R1' });
  });
});
