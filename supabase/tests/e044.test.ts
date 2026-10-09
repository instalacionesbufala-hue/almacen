/* E-044 · En el servidor: medidor bidireccional en las instalaciones SOLAR (cierre del wizard, prefactura y "completar datos" del
   calendario, sin duplicar), y la regla de E-026 (antes de la fecha, solo si consta a bordo: está en custodia). Datos inventados. */
import { beforeEach, describe, expect, it } from 'vitest';
import { MEDIDORES_SOLAR, MEDIDOR_MONO, MEDIDOR_TRIF } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, nuevaBD, superusuario, valor, type BD } from './pg';

const DESC = 'INSTALACIÓN TIER 1 UNIFAM. Y EMPRESA MONOFÁSICO SOLAR';
let db: BD, hash: string;
const hace = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const enviar = (raw: Record<string, unknown>, origen: 'wizard' | 'holded' | 'calendario' = 'wizard') => enviarCierre(db, hash, raw, { reglas: MEDIDORES_SOLAR, kits: {}, origen });
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const [sku, nombre] of [[MEDIDOR_MONO, 'MEDIDOR BIDIRECCIONAL MONOFÁSICO'], [MEDIDOR_TRIF, 'MEDIDOR BIDIRECCIONAL TRIFÁSICO']])
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku, nombre, categoria: 'aparamenta', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 5, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
});

describe('medidor bidireccional en las instalaciones SOLAR', () => {
  it('wizard SOLAR mono: 1 medidor monofásico; sin SOLAR, ninguno', async () => {
    await enviar({ numInst: 'E2641001', equipo: 'Búfala 1', fechaCierreIso: hace(3), fase: 'mono', descInstalacion: DESC });
    await enviar({ numInst: 'E2641002', equipo: 'Búfala 1', fechaCierreIso: hace(3), fase: 'mono', descInstalacion: 'INSTALACIÓN TIER 1 MONOFÁSICO' });
    expect([await aBordo(MEDIDOR_MONO), await aBordo(MEDIDOR_TRIF)]).toEqual([-1, 0]);
    await superusuario(db);
    expect(await valor(db, 'select nota from cierre_lineas where sku = $1', [MEDIDOR_MONO])).toBe('Instalación SOLAR: medidor bidireccional monofásico');
  });

  it('prefactura trifásica con descInstalacion en los atributos: el trifásico', async () => {
    await enviar({ origen: 'holded', numInst: 'E2641003', documento: 'PF-1', fechaAprobacion: hace(2), equipo: 'Búfala 1',
      atributos: { fase: 'Trifásica', descInstalacion: 'TIER 2 TRIFÁSICO SOLAR', fechaCierreIso: hace(3) }, lineas: { metrosLinea: 10 } }, 'holded');
    expect(await aBordo(MEDIDOR_TRIF)).toBe(-1);
  });

  it('calendario sobre un cierre existente: versión "calendario" que añade el medidor; repetido, no duplica', async () => {
    const r = await enviar({ numInst: 'E2641004', equipo: 'Búfala 1', fechaCierreIso: hace(3), fase: 'mono' });
    expect(await aBordo(MEDIDOR_MONO)).toBe(0);
    const cal = { origen: 'calendario', numInst: 'E2641004', atributos: { descInstalacion: DESC } };
    const v = await enviar(cal, 'calendario');
    expect(v.diferencia).toEqual([{ sku: MEDIDOR_MONO, unidades: 1 }]);
    expect((await enviar(cal, 'calendario')).estado).toBe('duplicado');
    expect(await aBordo(MEDIDOR_MONO)).toBe(-1);
    await superusuario(db);
    expect((await db.query('select origen, documento from cierre_versiones where cierre_id = $1 order by n', [r.cierre])).rows)
      .toEqual([{ origen: 'wizard', documento: '' }, { origen: 'calendario', documento: 'Datos del calendario' }]);
  });

  it('E-026: un cierre anterior a la fecha de "solo lo entregado" no descuenta el medidor si no consta a bordo', async () => {
    await como(db, ADMIN);
    await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 10 * 864e5).toISOString()]);
    await superusuario(db);
    await db.query("update config_app set cargadores_a_bordo_hasta = $1 where id = 1", [new Date().toISOString()]);
    const r = await enviar({ numInst: 'E2641005', equipo: 'Búfala 1', fechaCierreIso: hace(48), fase: 'mono', descInstalacion: DESC });
    expect(await aBordo(MEDIDOR_MONO)).toBe(0);
    await superusuario(db);
    expect(await valor(db, 'select estado from cierre_lineas where cierre_id = $1 and sku = $2', [r.cierre, MEDIDOR_MONO])).toBe('no_entregado');
  });
});
