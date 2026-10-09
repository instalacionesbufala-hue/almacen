/* E-045 · En el servidor: "Sí, monofásico" añade el medidor como corrección manual (corregir_cierre, sin traducción) y "No" lo marca
   como revisado (revisar_medidor_solar, solo administrador, con auditoría). Datos inventados. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MEDIDORES_SOLAR, MEDIDOR_MONO, MEDIDOR_TRIF } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

let db: BD, hash: string;
const hace = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const enviar = (raw: Record<string, unknown>) => enviarCierre(db, hash, raw, { reglas: MEDIDORES_SOLAR, kits: {}, origen: 'wizard' });
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };
const POLI = { equipo: 'Búfala 1', hardware: 'POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5', fase: 'mono', descInstalacion: 'INSTALACIÓN TIER 1 UNIFAM. Y EMPRESA MONOFÁSICO SOLAR' };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const [sku, nombre] of [[MEDIDOR_MONO, 'MEDIDOR BIDIRECCIONAL MONOFÁSICO'], [MEDIDOR_TRIF, 'MEDIDOR BIDIRECCIONAL TRIFÁSICO']])
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku, nombre, categoria: 'aparamenta', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 5, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
});

describe('SOLAR con un cargador que no es V2C', () => {
  it('sin medidor automático; "Sí, monofásico" lo añade como corrección manual con su versión', async () => {
    const r = await enviar({ numInst: 'E2642001', fechaCierreIso: hace(3), ...POLI });
    expect(await aBordo(MEDIDOR_MONO)).toBe(0);
    await como(db, ADMIN);
    await db.query('select corregir_cierre($1, $2::jsonb)', [r.cierre, JSON.stringify({ fijar: { descInstalacion: [{ sku: MEDIDOR_MONO, cantidad: 1 }] } })]);
    expect(await aBordo(MEDIDOR_MONO)).toBe(-1);
    await superusuario(db);
    expect((await db.query('select campo, sku, manual from cierre_lineas where cierre_id = $1 and campo = $2', [r.cierre, 'descInstalacion'])).rows).toEqual([{ campo: 'descInstalacion', sku: MEDIDOR_MONO, manual: true }]);
  });

  it('"No": revisado, con auditoría; solo el administrador', async () => {
    const r = await enviar({ numInst: 'E2642002', fechaCierreIso: hace(3), ...POLI });
    await como(db, ALMACEN);
    expect(await falla(db, 'select revisar_medidor_solar($1, $2)', [r.cierre, ''])).toMatch(/administrador/i);
    await como(db, ADMIN);
    await db.query('select revisar_medidor_solar($1, $2)', [r.cierre, '']);
    await superusuario(db);
    expect(await valor(db, 'select medidor_revisado from cierres where id = $1', [r.cierre])).toBe(true);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'revisar_medidor_solar'")).toBe(1);
    expect(await aBordo(MEDIDOR_MONO)).toBe(0);
  });
});
