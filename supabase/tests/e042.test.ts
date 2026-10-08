/* E-042 · En el servidor: la prefactura de Holded no trae pvc32 y el tubo PVC sale de los metros de línea (44 − 1 − 3 = 40 m →
   14 barras = 42 m) con sus fijaciones; y recalcular_cierre_admin (el "Aplicar" del recálculo global) deja auditoría y respeta lo
   fijado a mano. */
import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIVALENCIAS_PROPUESTA, normalizarCierre, traducirCierre } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const PVC = '6201000032', CORR = '6200020032', ACERO = '6203000032';
const CANAL = EQUIVALENCIAS_PROPUESTA.filter(r => ['pvc32', 'corr32', 'acero32'].includes(r.campo) && r.formula === 'directa');
const FIJ = EQUIVALENCIAS_PROPUESTA.filter(r => r.formula === 'fijaciones');
const KITS = { A: [{ sku: 'T-GRAPA', factor: 1 }] };
let db: BD, hash: string;
const fecha = () => new Date(Date.now() - 3 * 3600e3).toISOString();
const PREFACTURA = { origen: 'holded', numInst: 'E2640001', documento: 'PF-0001', fechaAprobacion: fecha(), equipo: 'Búfala 1', fecha: fecha(),
  atributos: { tipoLinea: 'Línea bajo tubo PVC', fase: 'Monofásica', seccion: '10 mm' }, lineas: { metrosLinea: 44, corr32: 1, acero32: 3 } };
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };
const guardar = (p: Record<string, unknown>) => db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ categoria: 'tubos', contenido: 1, minimo: 0, ...p })]);

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await guardar({ sku: PVC, nombre: 'TUBO PVC M-32 RÍGIDO', unidad: 'barra', contenido: 3, unidad_contenido: 'm' });
  await guardar({ sku: CORR, nombre: 'TUBO CORRUGADO M-32', unidad: 'rollo', contenido: 100, unidad_contenido: 'm' });
  await guardar({ sku: ACERO, nombre: 'TUBO ACERO M-32', unidad: 'barra', contenido: 3, unidad_contenido: 'm', pieza_entera: false });
  await guardar({ sku: 'T-GRAPA', nombre: 'GRAPA M-32', categoria: 'fijaciones', unidad: 'ud' });
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
});

describe('PVC deducido en un cierre que nace de la prefactura de Holded', () => {
  it('44 m de línea con 1 m de corrugado y 3 m de acero: 42 m de PVC (14 barras), 1 m de corrugado, 3 m de acero y 86 grapas', async () => {
    const r = await enviarCierre(db, hash, PREFACTURA, { reglas: [...CANAL, ...FIJ], kits: KITS, origen: 'holded' });
    expect(r.estado).not.toBe('error');
    expect([await aBordo(PVC), await aBordo(CORR), await aBordo(ACERO), await aBordo('T-GRAPA')]).toEqual([-42, -1, -3, -86]);
    await superusuario(db);
    expect(await valor<string>(db, 'select nota from cierre_lineas where cierre_id = $1 and sku = $2', [r.cierre, PVC])).toMatch(/^PVC deducido de los metros de línea \(44 − 1 − 3 = 40 m\)/);
    expect(await valor<string>(db, `select (datos->>'pvc32') from cierres where id = $1`, [r.cierre])).toBe('0');     // los datos guardados no cambian: se deduce al traducir
  });
});

describe('Aplicar el recálculo global (recalcular_cierre_admin)', () => {
  it('cierre aplicado sin PVC → con el PVC deducido: diferencia, versión "Recalculado" y auditoría; solo el administrador', async () => {
    const r = await enviarCierre(db, hash, PREFACTURA, { reglas: CANAL.filter(x => x.campo !== 'pvc32'), kits: KITS, origen: 'holded' });
    expect(await aBordo(PVC)).toBe(0);
    const lineas = traducirCierre(normalizarCierre({ ...PREFACTURA.lineas, ...{ tipoLinea: 'tubo', fase: 'mono', seccion: '10' } }), [...CANAL, ...FIJ], KITS);
    await como(db, ALMACEN);
    expect(await falla(db, 'select recalcular_cierre_admin($1, $2::jsonb)', [r.cierre, JSON.stringify(lineas)])).toMatch(/administrador/i);
    await como(db, ADMIN);
    const res = await valor<{ diferencia: { sku: string; unidades: number }[] }>(db, 'select recalcular_cierre_admin($1, $2::jsonb) as r', [r.cierre, JSON.stringify(lineas)]);
    expect(res.diferencia).toEqual([{ sku: PVC, unidades: 42 }, { sku: 'T-GRAPA', unidades: 86 }]);
    expect([await aBordo(PVC), await aBordo('T-GRAPA')]).toEqual([-42, -86]);
    await superusuario(db);
    expect((await db.query(`select accion, detalle->>'num_inst' n, jsonb_array_length(detalle->'diferencia') d from auditoria where accion = 'recalcular_cierre'`)).rows).toEqual([{ accion: 'recalcular_cierre', n: 'E2640001', d: 2 }]);
    expect(await valor<string>(db, 'select documento from cierre_versiones where cierre_id = $1 order by n desc limit 1', [r.cierre])).toMatch(/^Recalculado por/);
    // otra vez lo mismo: sin diferencia, sin versión ni auditoría nuevas
    await como(db, ADMIN);
    await db.query('select recalcular_cierre_admin($1, $2::jsonb)', [r.cierre, JSON.stringify(lineas)]);
    await superusuario(db);
    expect(await valor<number>(db, `select count(*)::int from auditoria where accion = 'recalcular_cierre'`)).toBe(1);
  });
});
