/* E-036 · Consumo por pieza entera (PVC rígido en barras de 3 m: 62 m → 21 barras = 63 m), activado por defecto en las barras,
   y "Recalcular cierres desde…" para los ya aplicados. */
import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIVALENCIAS_PROPUESTA } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const PVC = '6201000032', CORR = '6200020032';
const REGLAS = EQUIVALENCIAS_PROPUESTA.filter(r => ['pvc32', 'corr32'].includes(r.campo));
let db: BD, hash: string;
const WZ = (lineas: Record<string, number>, n = 'E2639001') => ({ numInst: n, equipo: 'Búfala 1', fechaCierreIso: new Date(Date.now() - 3 * 3600e3).toISOString(), ...lineas });
const enviar = (raw: Record<string, unknown>) => enviarCierre(db, hash, raw, { reglas: REGLAS, kits: {}, origen: 'wizard' });
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };
const guardar = (p: Record<string, unknown>) => db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ categoria: 'tubos', contenido: 1, minimo: 0, ...p })]);

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await guardar({ sku: PVC, nombre: 'TUBO PVC M-32 RÍGIDO', unidad: 'barra', contenido: 3, unidad_contenido: 'm' });     // sin decirlo: pieza entera
  await guardar({ sku: CORR, nombre: 'TUBO CORRUGADO M-32', unidad: 'rollo', contenido: 100, unidad_contenido: 'm' });
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
});

describe('consumo por pieza entera', () => {
  it('por defecto en las barras; las dos opciones se guardan y, si no vienen, se conservan', async () => {
    await superusuario(db);
    expect((await db.query(`select sku, pieza_entera, mostrar_formato from productos where sku in ('${PVC}', '${CORR}') order by sku`)).rows)
      .toEqual([{ sku: CORR, pieza_entera: false, mostrar_formato: false }, { sku: PVC, pieza_entera: true, mostrar_formato: false }]);
    await como(db, ADMIN);
    await guardar({ sku: CORR, nombre: 'TUBO CORRUGADO M-32', unidad: 'rollo', contenido: 100, unidad_contenido: 'm', mostrar_formato: true, pieza_entera: true });
    await guardar({ sku: CORR, nombre: 'TUBO CORRUGADO M-32 (gris)', unidad: 'rollo', contenido: 100, unidad_contenido: 'm' });
    await superusuario(db);
    expect((await db.query(`select pieza_entera, mostrar_formato from productos where sku = '${CORR}'`)).rows).toEqual([{ pieza_entera: true, mostrar_formato: true }]);
  });

  it('62 m de PVC descuentan 21 barras (63 m); el corrugado sin la opción, 62 m justos', async () => {
    await enviar(WZ({ pvc32: 62, corr32: 62 }));
    expect([await aBordo(PVC), await aBordo(CORR)]).toEqual([-63, -62]);
    await enviar(WZ({ pvc32: 63 }, 'E2639002'));
    expect(await aBordo(PVC)).toBe(-126);                                   // 63 m justos: 21 barras, sin redondear de más
  });

  it('los cierres ya aplicados no cambian solos: recalcular_consumo_piezas con versión y auditoría', async () => {
    await guardar({ sku: PVC, nombre: 'TUBO PVC M-32 RÍGIDO', unidad: 'barra', contenido: 3, unidad_contenido: 'm', pieza_entera: false });
    const { cierre } = await enviar(WZ({ pvc32: 62 }));
    expect(await aBordo(PVC)).toBe(-62);
    await como(db, ADMIN);
    await guardar({ sku: PVC, nombre: 'TUBO PVC M-32 RÍGIDO', unidad: 'barra', contenido: 3, unidad_contenido: 'm', pieza_entera: true });
    expect(await aBordo(PVC)).toBe(-62);
    await como(db, ADMIN);
    const r = await valor<{ cierres: number; unidades: number }>(db, 'select recalcular_consumo_piezas($1, $2) as r', [PVC, new Date(Date.now() - 864e5).toISOString()]);
    expect(r).toMatchObject({ cierres: 1, unidades: 1 });
    expect(await aBordo(PVC)).toBe(-63);
    await superusuario(db);
    expect(await valor(db, 'select documento from cierre_versiones where cierre_id = $1 order by n desc limit 1', [cierre])).toMatch(/recalculado .*por pieza entera/);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'recalcular_consumo_piezas'")).toBe(1);
    // otra vez: nada que cambiar
    await como(db, ADMIN);
    expect(await valor(db, 'select recalcular_consumo_piezas($1, $2) as r', [PVC, null])).toMatchObject({ cierres: 0 });
  });

  it('solo el administrador recalcula', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select recalcular_consumo_piezas($1, $2)', [PVC, null])).toMatch(/administrador|permiso/i);
  });
});
