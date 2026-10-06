/* E-026 · Una instalación = un cierre (directo, histórico y prefactura de Holded como versiones), cargadores que solo se
   descuentan si los entregó el almacén (hasta la fecha configurada), material especial y reglas de cargadores del calendario.
   Los casos de cargadores reproducen los reales del 30/09 y 01/10 con fechas relativas (las pruebas no dependen del día). */
import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIVALENCIAS_PROPUESTA, type Kits, type Regla } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const H = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const REGLAS: Regla[] = [
  { id: 'T-CR', campo: 'cajaReg', formula: 'directa', condiciones: {}, articulos: [{ sku: 'CAJA-REG', factor: 1 }], estimada: false, activa: true, orden: 5 },
  { id: 'T-L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 10 },
  ...EQUIVALENCIAS_PROPUESTA.filter(r => r.campo === 'hardware'),
];
const KITS: Kits = {};
const PROD = (sku: string, extra = {}) => JSON.stringify({ sku, nombre: `Artículo ${sku}`, categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, propiedad: 'custodia', propietario_id: 'ESMOVE', ...extra });

async function preparar() {
  const db = await nuevaBD();
  await como(db, ADMIN);
  for (const sku of ['8900500015', '8900500030', '8900500025', '8900500020', '8900590300', '8906000665']) await db.query('select guardar_producto($1::jsonb)', [PROD(sku)]);
  await db.query('select guardar_producto($1::jsonb)', [PROD('CAJA-REG', { categoria: 'aparamenta', propiedad: 'propia', propietario_id: null })]);
  // hasta pasado mañana, los cargadores solo se descuentan si constan a bordo
  await db.query('select config_cierres($1, $2, $3)', ['A', null, H(48)]);
  const token = (await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard de cierres'])).token;
  return { db, hash: await hashToken(token) };
}
const aBordo = async (db: BD, veh: string, sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]) ?? 0); };
const entregar = async (db: BD, veh: string, sku: string, n = 1) => { await superusuario(db); await db.query('insert into stock_vehiculo (vehiculo_id, sku, unidades) values ($1, $2, $3) on conflict (vehiculo_id, sku) do update set unidades = stock_vehiculo.unidades + excluded.unidades', [veh, sku, n]); };

describe('una instalación = un cierre', () => {
  let db: BD, hash: string;
  beforeEach(async () => ({ db, hash } = await preparar()));
  const enviar = (raw: Record<string, unknown>, origen?: 'wizard' | 'historico' | 'holded') => enviarCierre(db, hash, raw, { reglas: REGLAS, kits: KITS, origen });
  const cierre = { numInst: 'E2630001', cliente: 'Cliente inventado', equipo: 'Búfala 1', tipoLinea: 'manguera', metrosLinea: 10, cajaReg: 0, hardware: '' };

  it('directo + histórico + prefactura de Holded: un solo cierre con 3 versiones y el consumo neto correcto', async () => {
    const r1 = await enviar({ ...cierre, esbrainUuid: 'uuid-directo', fechaCierreIso: H(-5) });
    // el histórico de "Registro": sin UUID y con la hora en que se escribió la fila
    const r2 = await enviar({ ...cierre, fechaCierreIso: H(-4.9) }, 'historico');
    // el técnico no puso la caja de registro: la prefactura aprobada lleva 2 y 12 m de línea
    const r3 = await enviar({ origen: 'holded', numInst: 'E2630001', documento: 'PRE-0042', fechaAprobacion: H(-1), lineas: { cajaReg: 2, metrosLinea: 12, partidaRara: 3 } });
    expect([r1.version, r2.version, r3.version]).toEqual([1, 2, 3]);
    expect(new Set([r1.cierre, r2.cierre, r3.cierre]).size).toBe(1);
    expect(r2.diferencia).toEqual([]);                                                          // el histórico no cambia nada
    expect(r3.diferencia).toEqual([{ sku: 'CAB-RZ1K-5G6', unidades: 2 }, { sku: 'CAJA-REG', unidades: 2 }]);
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from cierres where num_inst = 'E2630001'")).toBe(1);
    expect((await db.query<{ n: number; origen: string; documento: string }>('select n, origen, documento from cierre_versiones order by n')).rows)
      .toEqual([{ n: 1, origen: 'wizard', documento: '' }, { n: 2, origen: 'historico', documento: '' }, { n: 3, origen: 'holded', documento: 'PRE-0042' }]);
    expect(await aBordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(150 - 12);
    expect(await aBordo(db, 'V-F01', 'CAJA-REG')).toBe(-2);
    // lo demás del cierre se conserva (tipo de línea, equipo, UUID del directo)
    expect(await valor(db, "select datos->>'tipoLinea' || ' ' || equipo_wizard || ' ' || esbrain_uuid from cierres")).toBe('manguera Búfala 1 uuid-directo');
  });

  it('reenviar lo mismo por el mismo camino no crea versiones; una versión vieja del wizard tampoco cambia nada', async () => {
    await enviar({ ...cierre, fechaCierreIso: H(-5) });
    expect((await enviar({ ...cierre, fechaCierreIso: H(-5) })).estado).toBe('duplicado');
    expect((await enviar({ ...cierre, version: 2, metrosLinea: 8, fechaCierreIso: H(-3) })).version).toBe(2);
    expect((await enviar({ ...cierre, version: 1, metrosLinea: 99, fechaCierreIso: H(-5) }, 'historico')).estado).toBe('obsoleto');
    expect(await aBordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(142);
    await enviar({ origen: 'holded', numInst: 'E2630001', documento: 'PRE-1', lineas: { cajaReg: 1 } });
    expect((await enviar({ origen: 'holded', numInst: 'E2630001', documento: 'PRE-1', lineas: { cajaReg: 1 } })).estado).toBe('duplicado');
    // un cierre del wizard que llega DESPUÉS de la prefactura no deshace lo que corrigió Holded
    await enviar({ ...cierre, version: 3, metrosLinea: 8, cajaReg: 0, fechaCierreIso: H(-3) });
    expect(await aBordo(db, 'V-F01', 'CAJA-REG')).toBe(-1);
  });

  it('una prefactura sin cierre previo se guarda como cierre de Holded; sin equipo queda pendiente de vehículo', async () => {
    const r = await enviar({ origen: 'holded', numInst: 'E2639999', documento: 'PRE-7', lineas: { cajaReg: 1 } });
    expect(r.estado).toBe('sin_vehiculo');
    await superusuario(db);
    expect(await valor(db, "select origen from cierres where num_inst = 'E2639999'")).toBe('holded');
    const r2 = await enviar({ origen: 'holded', numInst: 'E2639998', documento: 'PRE-8', equipo: 'Búfala 1', fechaCierreIso: H(-2), lineas: { cajaReg: 1 } });
    expect(r2.estado).toBe('discrepancia');                                                     // la caja no estaba a bordo
  });

  it('material especial: se guarda, queda por revisar en la bandeja y el administrador lo marca revisado', async () => {
    const r = await enviar({ ...cierre, fechaCierreIso: H(-2), materialEspecial: 'SÍ — 1× CUADRO PROTECCION VE MONOFÁSICO REARMABLE + SCHUKO' });
    await superusuario(db);
    expect(await valor(db, 'select material_especial || $2 || material_revisado::text from cierres where id = $1', [r.cierre, '|'])).toBe('SÍ — 1× CUADRO PROTECCION VE MONOFÁSICO REARMABLE + SCHUKO|false');
    await como(db, ADMIN);
    await db.query('select revisar_material_especial($1, $2)', [r.cierre, 'Añadido a mano']);
    await superusuario(db);
    expect(await valor(db, 'select material_revisado from cierres where id = $1', [r.cierre])).toBe(true);
    // "NO" no es material especial
    const r2 = await enviar({ ...cierre, numInst: 'E2630002', fechaCierreIso: H(-2), materialEspecial: 'NO' });
    await superusuario(db);
    expect(await valor(db, "select material_especial || '|' || material_revisado::text from cierres where id = $1", [r2.cierre])).toBe('|true');
  });
});

describe('cargadores: hasta la fecha, solo los que entregó el almacén', () => {
  let db: BD, hash: string;
  beforeEach(async () => ({ db, hash } = await preparar()));
  const enviar = (raw: Record<string, unknown>) => enviarCierre(db, hash, raw, { reglas: REGLAS, kits: KITS });

  it('casos reales: el Trydan + Schuko de Búfala 1 (entregado DESPUÉS de la hora del cierre) y el Policharger de Búfala 2 se descuentan', async () => {
    // E2632246: cierre a las 11:29; la entrega del Schuko quedó registrada a las 23:24 (antes de procesar el cierre)
    await entregar(db, 'V-F01', '8900500015');
    const a = await enviar({ numInst: 'E2632246', equipo: 'Búfala 1', fechaCierreIso: H(-12), hardware: 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5 + SCHUKO' });
    expect(a.estado).toBe('aplicado');
    expect(await aBordo(db, 'V-F01', '8900500015')).toBe(0);
    // E2632096: Policharger NW T2 entregado a Búfala 2
    await entregar(db, 'V-F02', '8906000665');
    const b = await enviar({ numInst: 'E2632096', equipo: 'Búfala 2', fechaCierreIso: H(-10), hardware: 'POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5' });
    expect(b.estado).toBe('aplicado');
    expect(await aBordo(db, 'V-F02', '8906000665')).toBe(0);
  });

  it('un Trydan M5 de otra furgoneta sin entrega queda "instalado, no entregado por el almacén": sin movimiento ni discrepancia', async () => {
    const r = await enviar({ numInst: 'E2630300', equipo: 'Búfala 3', fechaCierreIso: H(-6), hardware: 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5', tipoLinea: 'manguera', metrosLinea: 3 });
    expect(r.estado).toBe('discrepancia');                                                      // solo por la manguera, que no estaba a bordo
    await superusuario(db);
    expect(await valor(db, "select estado from cierre_lineas where cierre_id = $1 and campo = 'hardware'", [r.cierre])).toBe('no_entregado');
    expect(await valor(db, "select count(*)::int from movimientos where cierre_id = $1 and sku = '8900590300'", [r.cierre])).toBe(0);
    expect(await aBordo(db, 'V-F03', '8900590300')).toBe(0);
    // el resto del material se descuenta siempre
    expect(await aBordo(db, 'V-F03', 'CAB-RZ1K-5G6')).toBe(-3);
    // si después se le entrega y se reprocesa, se descuenta
    await entregar(db, 'V-F03', '8900590300');
    await como(db, ADMIN);
    await db.query('select reprocesar_cierre($1)', [r.cierre]);
    expect(await aBordo(db, 'V-F03', '8900590300')).toBe(0);
  });

  it('desde la fecha configurada, comportamiento normal: si no consta a bordo, discrepancia', async () => {
    await como(db, ADMIN);
    await db.query('select config_cierres($1, $2, $3)', ['A', null, H(-24)]);
    const r = await enviar({ numInst: 'E2630400', equipo: 'Búfala 3', fechaCierreIso: H(-1), hardware: 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5' });
    expect(r.estado).toBe('discrepancia');
    expect(await aBordo(db, 'V-F03', '8900590300')).toBe(-1);
  });
});

describe('reglas de cargadores del calendario', () => {
  it('la migración sustituye las reglas de cargadores de una base en uso y guarda la versión anterior', async () => {
    const db = await nuevaBD({ intercalar: { antesDe: '20261016000100', sql: `insert into equivalencias_cierre (id, campo, formula, condiciones, articulos, orden, confirmada) values
      ('P16', 'hardware', 'unidad', '{"hardware~": "trydan&schuko"}', '[{"sku": "8900500015", "factor": 1}]', 160, true),
      ('P18', 'hardware', 'unidad', '{"hardware~": ["trydan&7,4", "trydan&7.4"]}', '[{"sku": "8900590300", "factor": 1}]', 180, true);` } });
    await superusuario(db);
    expect(await valor(db, "select string_agg(id, ',' order by orden) from equivalencias_cierre where campo = 'hardware' and activa and confirmada")).toBe('H1,H2,H3,H4,H5,H7,H6');   // E-035: H7 (Policharger trifásico) antes de H6
    expect(await valor(db, "select count(*)::int from equivalencias_historial where operario = 'Migración E-026'")).toBe(2);
    expect(await valor(db, "select activa from equivalencias_cierre where id = 'P18'")).toBe(false);
  });
  it('en una base nueva no mete nada (llegan con la propuesta)', async () => {
    const db = await nuevaBD();
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from equivalencias_cierre where id like 'H_'")).toBe(0);
  });
  it('el almacén no puede marcar material especial ni cambiar la fecha de los cargadores', async () => {
    const { db } = await preparar();
    await como(db, '00000000-0000-4000-8000-000000000002');
    expect(await falla(db, 'select config_cierres($1, $2, $3)', ['A', null, null])).toMatch(/Solo el administrador/);
  });
});
