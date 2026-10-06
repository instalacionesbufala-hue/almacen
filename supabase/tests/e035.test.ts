/* E-035 · Corregir un cierre a mano en todo y regla del Policharger trifásico. Caso real E2632405: prefactura de Búfala 1 con un
   "POLICHARGER NW TRIFÁSICO DOBLE PROTECCIÓN M10 M5" que la regla genérica descontó como NW T2 (Búfala 1 en −1), línea trifásica
   y caja de registro sin artículo. */
import { beforeEach, describe, expect, it } from 'vitest';
import { aplicarCorreccion, EQUIVALENCIAS_PROPUESTA, normalizarCierre, prepararVersion, traducirCierre, type PrevioCierre, type Regla } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const NWT2 = '8906000665', DBLT = '8437024504283';
const LINEA_Y_UTP = EQUIVALENCIAS_PROPUESTA.filter(r => ['metrosLinea', 'corr32'].includes(r.campo));
const SIN_REGLA_TRIF = [...LINEA_Y_UTP, ...EQUIVALENCIAS_PROPUESTA.filter(r => r.campo === 'hardware' && !JSON.stringify(r.condiciones).includes('trif'))];  // como estaba
const CON_REGLA_TRIF = [...LINEA_Y_UTP, ...EQUIVALENCIAS_PROPUESTA.filter(r => r.campo === 'hardware')];
const HW = 'POLICHARGER NW TRIFÁSICO DOBLE PROTECCIÓN M10 M5';
const PF = { origen: 'holded', numInst: 'E2632405', documento: 'E2632405', fechaAprobacion: new Date().toISOString(), lineas: { metrosLinea: 15, corr32: 1, cajaReg: 1 },
  atributos: { tipoLinea: 'manguera', fase: 'mono', seccion: '6', equipo: 'Búfala 1', hardware: HW, fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString() } };

let db: BD, hash: string, cierre: string;
const enviar = (raw: Record<string, unknown>, reglas: Regla[] = SIN_REGLA_TRIF) => enviarCierre(db, hash, raw, { reglas, kits: {}, origen: 'holded' });
const aBordo = async (sku: string, veh = 'V-F01') => { await superusuario(db); return Number(await valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]) ?? 0); };
const lineas = async () => { await superusuario(db); return (await db.query<{ campo: string; sku: string | null; cantidad: string; estado: string; manual: boolean }>(
  'select campo, sku, cantidad::text, estado, manual from cierre_lineas where cierre_id = $1 order by campo, sku nulls first', [cierre])).rows; };
/** Lo que hace la app: traduce con los datos efectivos y la corrección, y llama a corregir_cierre */
async function corregir(p: Record<string, unknown>, reglas: Regla[] = CON_REGLA_TRIF) {
  await superusuario(db);
  const previo = await valor<PrevioCierre>(db, 'select previo_cierre($1) as r', ['inst:E2632405']);
  const corr = 'datos' in p ? (p.datos as Record<string, string> | null) : previo.correccion;
  const efectivo = aplicarCorreccion(prepararVersion({ ...previo, correccion: null, origenes: ['holded'] }, 'holded', { ...PF, documento: '' }).efectivo, corr);
  const l = traducirCierre(efectivo, reglas, {});
  await como(db, ADMIN);
  return valor<{ estado: string; diferencia: { sku: string; unidades: number }[] }>(db, 'select corregir_cierre($1, $2::jsonb) as r', [cierre, JSON.stringify({ ...p, lineas: l })]);
}

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const [sku, nombre] of [[NWT2, 'POLICHARGER NW T2'], [DBLT, 'POLICHARGER NW-DBLT23F']])
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku, nombre, categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
  for (const sku of ['6000650603', '6000650601', '6000650602', '6000650604', '6000650605', '6040610306', '6200020032'])
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku, nombre: `Artículo ${sku}`, categoria: 'cables', unidad: 'm', contenido: 1, minimo: 0 })]);
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);   // ya no rige "solo si consta a bordo"
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
  await superusuario(db);
  await db.exec(`insert into stock_vehiculo (vehiculo_id, sku, unidades) values ('V-F01', '${DBLT}', 1) on conflict (vehiculo_id, sku) do update set unidades = 1;`);
  // como pasó: la regla genérica descontó el NW T2
  cierre = (await enviar(PF)).cierre;
  expect(await aBordo(NWT2)).toBe(-1);
});

describe('regla del Policharger trifásico', () => {
  it('trifásico → NW-DBLT23F; monofásico → NW T2', () => {
    const t = (hw: string) => traducirCierre(normalizarCierre({ hardware: hw }), CON_REGLA_TRIF, {}).find(l => l.campo === 'hardware')!.sku;
    expect(t(HW)).toBe(DBLT);
    expect(t('POLICHARGER NW-DBLT23F')).toBe(DBLT);
    expect(t('POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5')).toBe(NWT2);
  });
  it('la migración la pone antes de la genérica en una base con las reglas reales', async () => {
    const db2 = await nuevaBD({ intercalar: { antesDe: '20261025000100', sql: `insert into public.equivalencias_cierre (id, campo, formula, condiciones, articulos, orden, confirmada) values
      ('H6', 'hardware', 'unidad', '{"hardware~": "policharger"}', '[{"sku": "8906000665", "factor": 1}]', 1060, true);` } });
    await superusuario(db2);
    expect((await db2.query("select id, orden from equivalencias_cierre where campo = 'hardware' order by orden")).rows).toEqual([{ id: 'H7', orden: 1055 }, { id: 'H6', orden: 1060 }]);
  });
});

describe('corregir el cierre', () => {
  it('el caso real: trifásica en tubo 6 mm² (5 conductores × 15 m) y el cargador NW-DBLT23F; Búfala 1 queda en 0 y 0', async () => {
    const r = await corregir({ datos: { fase: 'trif', tipoLinea: 'tubo', seccion: '6' }, fijar: { hardware: [{ sku: DBLT, cantidad: 1 }] } }, SIN_REGLA_TRIF);
    expect([await aBordo(NWT2), await aBordo(DBLT)]).toEqual([0, 0]);
    expect(r.diferencia).toEqual(expect.arrayContaining([{ sku: NWT2, unidades: -1 }, { sku: DBLT, unidades: 1 }, { sku: '6000650601', unidades: 15 }]));
    const ls = await lineas();
    expect(ls.filter(l => l.campo === 'metrosLinea').map(l => l.sku)).toEqual(['6000650601', '6000650602', '6000650603', '6000650604', '6000650605']);
    expect(ls.find(l => l.campo === 'hardware')).toMatchObject({ sku: DBLT, estado: 'resuelta', manual: true });
    // ajustes enlazados al cierre, versión y auditoría
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from movimientos where cierre_id = $1 and sku = $2 and tipo = 'ajuste'", [cierre, NWT2])).toBe(1);
    expect(await valor(db, 'select documento from cierre_versiones where cierre_id = $1 order by n desc limit 1', [cierre])).toMatch(/^Corrección manual por .+: datos: .*fase = trif.* · hardware: 1 × POLICHARGER NW-DBLT23F/);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'corregir_cierre'")).toBe(1);
  });

  it('quitar una partida (no descuenta) y fijar otra con dos artículos', async () => {
    await corregir({ fijar: { cajaReg: [], corr32: [{ sku: '6200020032', cantidad: 2 }, { sku: '6040610306', cantidad: 1 }] } });
    const ls = await lineas();
    expect(ls.filter(l => l.campo === 'cajaReg')).toEqual([{ campo: 'cajaReg', sku: null, cantidad: '0.000', estado: 'quitada', manual: true }]);
    expect(ls.filter(l => l.campo === 'corr32').map(l => [l.sku, l.cantidad])).toEqual([['6040610306', '1.000'], ['6200020032', '2.000']]);
    expect(await aBordo('6200020032')).toBe(-2);
    await superusuario(db);
    expect(await valor(db, 'select estado from cierres where id = $1', [cierre])).not.toBe('parcial');   // la quitada no queda pendiente
  });

  it('lo corregido prevalece sobre una prefactura posterior; "volver a lo automático" lo deshace', async () => {
    await corregir({ datos: { fase: 'trif', tipoLinea: 'tubo', seccion: '6' }, fijar: { hardware: [{ sku: DBLT, cantidad: 1 }] } }, SIN_REGLA_TRIF);
    // llega otra prefactura (con fase mono y la regla genérica) que cambia los metros
    await enviar({ ...PF, documento: 'E2632405-b', lineas: { metrosLinea: 20, corr32: 1, cajaReg: 1 } });
    let ls = await lineas();
    expect(ls.filter(l => l.campo === 'metrosLinea').map(l => [l.sku, l.cantidad])).toEqual(['6000650601', '6000650602', '6000650603', '6000650604', '6000650605'].map(s => [s, '20.000']));
    expect(ls.find(l => l.campo === 'hardware')!.sku).toBe(DBLT);
    expect([await aBordo(NWT2), await aBordo(DBLT)]).toEqual([0, 0]);
    // volver a lo automático: en el cargador (con la regla nueva, el trifásico) y en los datos (manguera mono 6: RZ1-K)
    await corregir({ datos: null, soltar: ['hardware'] });
    ls = await lineas();
    expect(ls.find(l => l.campo === 'hardware')).toMatchObject({ sku: DBLT, manual: false });
    expect(ls.filter(l => l.campo === 'metrosLinea').map(l => l.sku)).toEqual(['6040610306']);
    expect(await aBordo('6000650601')).toBe(0);
  });

  it('cambiar el equipo: todo vuelve a la furgoneta anterior y se descuenta de la nueva', async () => {
    await corregir({ datos: { equipo: 'Búfala 2' }, fijar: { hardware: [{ sku: DBLT, cantidad: 1 }] } });
    expect([await aBordo(NWT2), await aBordo(DBLT), await aBordo('6200020032')]).toEqual([0, 1, 0]);          // Búfala 1 como antes del cierre
    expect([await aBordo(DBLT, 'V-F02'), await aBordo('6200020032', 'V-F02')]).toEqual([-1, -1]);
  });

  it('solo el administrador; un artículo que no existe no toca nada', async () => {
    await como(db, ADMIN);
    expect(await falla(db, 'select corregir_cierre($1, $2::jsonb)', [cierre, JSON.stringify({ fijar: { hardware: [{ sku: 'NO-EXISTE', cantidad: 1 }] } })])).toMatch(/Artículo no encontrado/);
    expect(await aBordo(NWT2)).toBe(-1);
  });
});
