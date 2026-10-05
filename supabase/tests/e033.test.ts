/* E-033 · El cable de datos lo decide el cargador (V2C → U/UTP, Policharger → F/UTP). La migración pone las reglas por cableDatos
   (P-UTP-F, P-UTP-U) detrás de las del cargador en una base con las reglas como en producción, guardando la versión anterior;
   y una prefactura de Holded con cableDatos (Apps Script antiguo) no lo aplica. */
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizarCierre, prepararVersion, traducirCierre, type Regla } from '../functions/_compartido/cierres';
import { nuevaBD, superusuario, type BD } from './pg';

// las reglas de metrosUtp tal como estaban en producción tras E-032
const COMO_PRODUCCION = `
  insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, orden, nota, confirmada) values
    ('P05', 'metrosUtp', 'directa', '{"hardware~": ["v2c", "trydan"]}', '[{"sku": "7270020010", "factor": 1}]', 50, 'Cat6 U/UTP con V2C', true),
    ('P06', 'metrosUtp', 'directa', '{"hardware~": "policharger"}', '[{"sku": "7270021010", "factor": 1}]', 60, 'Cat6 F/UTP con Policharger', true),
    ('P-UTP-F', 'metrosUtp', 'directa', '{"cableDatos~": ["f/utp", "ftp"]}', '[{"sku": "7270021010", "factor": 1}]', 48, '', true),
    ('P-UTP-U', 'metrosUtp', 'directa', '{"cableDatos~": "utp"}', '[{"sku": "7270020010", "factor": 1}]', 49, '', true);`;

let db: BD, reglas: Regla[];
beforeAll(async () => {
  db = await nuevaBD({ intercalar: { antesDe: '20261023000100', sql: COMO_PRODUCCION } });
  await superusuario(db);
  // como las carga registrar-cierre
  reglas = (await db.query<Record<string, never>>("select * from equivalencias_cierre where confirmada and activa and campo = 'metrosUtp'")).rows
    .map((r: Record<string, never>) => ({ id: r.id, campo: r.campo, formula: r.formula, condiciones: r.condiciones || {}, articulos: r.articulos || [], kit: r.kit, estimada: r.estimada, activa: r.activa, orden: r.orden, nota: r.nota, sinDescuento: r.sin_descuento ?? null }));
});
const utp = (c: Record<string, unknown>) => traducirCierre(normalizarCierre({ metrosUtp: 10, ...c }), reglas, {}).find(l => l.campo === 'metrosUtp')!.sku;

describe('migración sobre las reglas reales', () => {
  it('las reglas por cable de datos pasan detrás de las del cargador, con la versión anterior en el historial', async () => {
    expect((await db.query("select id, orden from equivalencias_cierre where campo = 'metrosUtp' order by orden")).rows)
      .toEqual([{ id: 'P05', orden: 50 }, { id: 'P06', orden: 60 }, { id: 'P-UTP-F', orden: 65 }, { id: 'P-UTP-U', orden: 66 }]);
    expect((await db.query("select regla_id, (version->>'orden')::int as orden from equivalencias_historial where regla_id like 'P-UTP-%' order by regla_id")).rows)
      .toEqual([{ regla_id: 'P-UTP-F', orden: 48 }, { regla_id: 'P-UTP-U', orden: 49 }]);
  });
});

describe('el cable de datos lo decide el cargador', () => {
  it('Policharger con cableDatos U/UTP → F/UTP', () => expect(utp({ hardware: 'POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5', cableDatos: 'U/UTP' })).toBe('7270021010'));
  it('V2C → U/UTP (aunque diga F/UTP)', () => {
    expect(utp({ hardware: 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5' })).toBe('7270020010');
    expect(utp({ hardware: 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5', cableDatos: 'F/UTP' })).toBe('7270020010');
  });
  it('sin cargador, el cable de datos del wizard', () => {
    expect(utp({ cableDatos: 'F/UTP' })).toBe('7270021010');
    expect(utp({ cableDatos: 'U/UTP' })).toBe('7270020010');
  });
  it('una prefactura de Holded con cableDatos (Apps Script antiguo) no lo aplica: ni sobre el wizard ni sin él', () => {
    const pf = { origen: 'holded', numInst: 'E1', documento: 'E1', fechaAprobacion: new Date().toISOString(), lineas: { metrosUtp: 10 }, atributos: { cableDatos: 'U/UTP', hardware: 'POLICHARGER NW' } };
    const sola = prepararVersion(null, 'holded', pf);
    expect([sola.holded!.atributos?.cableDatos, sola.efectivo.cableDatos ?? '']).toEqual([undefined, '']);
    expect(traducirCierre(sola.efectivo, reglas, {}).find(l => l.campo === 'metrosUtp')!.sku).toBe('7270021010');
    const wizard = normalizarCierre({ numInst: 'E1', hardware: '', cableDatos: 'F/UTP', metrosUtp: 10 });
    const encima = prepararVersion({ version: 1, wizard, holded: { documento: 'E1', fechaAprobacion: '', lineas: {}, atributos: { cableDatos: 'U/UTP' } }, origenes: ['wizard'] }, 'holded', pf);
    expect(encima.efectivo.cableDatos).toBe('F/UTP');                                   // ni el que trae ni uno guardado antes pisan el del wizard
  });
});
