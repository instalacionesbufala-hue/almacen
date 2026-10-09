/* E-046 · En el servidor: la confirmación del técnico (medidorBidireccional) manda sobre S1-S5 y queda en la versión. Datos inventados. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MEDIDORES_SOLAR, MEDIDOR_MONO, MEDIDOR_TECNICO, MEDIDOR_TRIF } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, nuevaBD, superusuario, valor, type BD } from './pg';

let db: BD, hash: string;
const hace = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const enviar = (raw: Record<string, unknown>) => enviarCierre(db, hash, raw, { reglas: [...MEDIDOR_TECNICO, ...MEDIDORES_SOLAR], kits: {}, origen: 'wizard' });
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };
const BASE = { equipo: 'Búfala 1', fase: 'mono', descInstalacion: 'INSTALACIÓN TIER 1 UNIFAM. Y EMPRESA MONOFÁSICO SOLAR' };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const [sku, nombre] of [[MEDIDOR_MONO, 'MEDIDOR BIDIRECCIONAL MONOFÁSICO'], [MEDIDOR_TRIF, 'MEDIDOR BIDIRECCIONAL TRIFÁSICO']])
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku, nombre, categoria: 'aparamenta', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 5, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
});

describe('medidor confirmado por el técnico', () => {
  it('Policharger + "mono" → monofásico; V2C + "no" → nada; Policharger + "trif" → trifásico; queda en la versión', async () => {
    const r = await enviar({ numInst: 'E2643001', fechaCierreIso: hace(3), hardware: 'POLICHARGER NW MONOFÁSICO', medidorBidireccional: 'mono', ...BASE });
    await enviar({ numInst: 'E2643002', fechaCierreIso: hace(3), hardware: 'V2C TRYDAN M5', medidorBidireccional: 'no', ...BASE });
    await enviar({ numInst: 'E2643003', fechaCierreIso: hace(3), hardware: 'POLICHARGER NW', medidorBidireccional: 'trif', ...BASE });
    expect([await aBordo(MEDIDOR_MONO), await aBordo(MEDIDOR_TRIF)]).toEqual([-1, -1]);
    await superusuario(db);
    expect(await valor(db, `select datos_wizard->>'medidorBidireccional' from cierres where id = $1`, [r.cierre])).toBe('mono');
    expect(await valor(db, `select entrada->>'medidorBidireccional' from cierre_versiones where cierre_id = $1`, [r.cierre])).toBe('mono');
  });
});
