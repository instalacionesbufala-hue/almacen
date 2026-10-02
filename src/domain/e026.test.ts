/* E-026 · En la app (demostración, mismas reglas que el servidor): versiones de un cierre, cargadores entregados y diferencia legible */
import { describe, expect, it } from 'vitest';
import { fresh } from '../data/semilla';
import type { Equivalencia } from '../data/tipos';
import { aplicarLocal } from '../store/ops';
import { prepararEnvio, registrarCierreLocal, textoDiferencia } from './cierres';
import { datosInformeCustodia } from './custodia';
import { construirInforme } from '../../supabase/functions/_compartido/informe';
import { unidadesABordo } from './reglas';

const REGLAS: Equivalencia[] = [
  { id: 'L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 1, confirmada: true },
  { id: 'R', campo: 'rj45', formula: 'directa', condiciones: {}, articulos: [{ sku: '7280040020', factor: 1 }], estimada: false, activa: true, orden: 2, confirmada: true },
  { id: 'H', campo: 'hardware', formula: 'unidad', condiciones: { 'hardware~': 'cuadro' }, articulos: [{ sku: 'ESM-CPVE-MONO', factor: 1 }], estimada: false, activa: true, orden: 3, confirmada: true },
];
const estado = () => { const S = fresh(); S.rol = 'admin'; S.equivalencias = REGLAS.map(r => ({ ...r })); S.configApp.demoBorrada = undefined; return S; };
const base = { numInst: 'E2630001', cliente: 'Cliente', fechaCierreIso: new Date(Date.now() - 3600e3).toISOString(), equipo: 'Búfala 1', metrosLinea: 10 };

describe('versiones de un cierre en la app', () => {
  it('directo + histórico + prefactura: un cierre, 3 versiones y la diferencia de cada una', () => {
    const S = estado();
    registrarCierreLocal(S, { ...base, esbrainUuid: 'u-1' }, 'wizard');
    expect(registrarCierreLocal(S, base, 'historico').diferencia).toEqual([]);
    const r = registrarCierreLocal(S, { numInst: 'E2630001', documento: 'PRE-9', lineas: { metrosLinea: 12, rj45: 25 } }, 'holded');
    expect(S.cierres.filter(c => c.numInst === 'E2630001')).toHaveLength(1);
    expect(S.cierres[0].versiones!.map(v => v.origen)).toEqual(['wizard', 'historico', 'holded']);
    expect(unidadesABordo(S, 'V-F01', 'CAB-RZ1K-5G6')).toBe(150 - 12);
    expect(textoDiferencia(S, r.diferencia!)).toMatch(/^\+1 Sobre .* · \+2 Manguera /);                     // 25 RJ45 = 1 sobre y 2 m más
  });
  it('el histórico de lo mismo por segunda vez no crea versión', () => {
    const S = estado();
    registrarCierreLocal(S, base, 'historico');
    expect(prepararEnvio(S, base, 'historico').meta.accion).toBe('duplicado');
  });
});

describe('cargadores entregados por el almacén', () => {
  it('sin entrega, antes de la fecha: instalado, no entregado (sin movimiento) y sale en el informe del socio', () => {
    const S = estado(); S.configApp.cargadoresABordoHasta = Date.now() + 864e5;
    const r = registrarCierreLocal(S, { ...base, numInst: 'E2630300', equipo: 'Búfala 3', hardware: 'Cuadro VE', metrosLinea: 0 }, 'wizard');
    expect(r.estado).toBe('aplicado');
    expect(S.lineasCierre.find(l => l.cierre === r.id)!.estado).toBe('no_entregado');
    expect(unidadesABordo(S, 'V-F03', 'ESM-CPVE-MONO')).toBe(0);
    const inf = construirInforme(datosInformeCustodia(S, 'ESMOVE', 0, Date.now() + 864e5));
    const sec = inf.secciones.find(x => x.titulo === 'Instalado (antes de la gestión del almacén)')!;
    expect(sec.filas.map(f => f[1])).toEqual(['ESM-CPVE-MONO']);
    expect(String(sec.filas[0][4])).toMatch(/E2630300/);
  });
  it('con entrega a bordo se descuenta; desde la fecha, sin entrega es discrepancia', () => {
    const S = estado(); S.configApp.cargadoresABordoHasta = Date.now() + 864e5;
    S.aBordo.push({ vehiculo: 'V-F01', sku: 'ESM-CPVE-MONO', unidades: 1 });
    registrarCierreLocal(S, { ...base, numInst: 'A', hardware: 'Cuadro VE', metrosLinea: 0 }, 'wizard');
    expect(unidadesABordo(S, 'V-F01', 'ESM-CPVE-MONO')).toBe(0);
    S.configApp.cargadoresABordoHasta = Date.now() - 864e5;
    expect(registrarCierreLocal(S, { ...base, numInst: 'B', equipo: 'Búfala 3', hardware: 'Cuadro VE', metrosLinea: 0 }, 'wizard').estado).toBe('discrepancia');
  });
  it('material especial: queda por revisar y el administrador lo marca', () => {
    const S = estado();
    const r = registrarCierreLocal(S, { ...base, materialEspecial: 'SÍ — 1× CUADRO PROTECCION VE MONOFÁSICO REARMABLE + SCHUKO' }, 'wizard');
    expect(S.cierres[0]).toMatchObject({ materialEspecial: expect.stringMatching(/CUADRO/), materialRevisado: false });
    aplicarLocal(S, { op: 'revisarMaterialEspecial', args: { id: r.id, nota: '' } });
    expect(S.cierres[0].materialRevisado).toBe(true);
  });
});
