/* E-030 · Resolver una línea "sin equivalencia" con varios artículos (3 o 5 conductores H07Z1-K) y deshacer una resolución.
   Caso real: E2632246 (manguera 10 mm² mono, 49 m) resuelta con un solo cable amarillo/verde. */
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const H = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const CABLES: [string, string][] = [['6000650653', 'MARRON'], ['6000650654', 'AZUL'], ['6000650655', 'AM/VERDE'], ['6000650651', 'NEGRO'], ['6000650652', 'GRIS']];
const PROD = (sku: string, color: string) => JSON.stringify({ sku, nombre: `CABLE LHA H07Z1-K(AS) 10MM ${color} FLEX`, categoria: 'cables', unidad: 'm', contenido: 1, minimo: 0, nuevo: true });

let db: BD, linea: string, cierre: string;
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };
const lineas = async () => { await superusuario(db); return (await db.query<{ sku: string | null; cantidad: string; estado: string }>("select sku, cantidad::text, estado from cierre_lineas where cierre_id = $1 and campo = 'metrosLinea' order by sku nulls first", [cierre])).rows; };
const resolver = async (arts: { sku: string; cantidad: number }[]) => { await como(db, ADMIN); return valor<{ estado: string; diferencia: { sku: string; unidades: number }[] }>(db, 'select resolver_linea_varios($1, $2, $3::jsonb) as r', [linea, uuid(), JSON.stringify(arts.map(a => ({ ...a, id: uuid() })))]); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const [sku, c] of CABLES) await db.query('select guardar_producto($1::jsonb)', [PROD(sku, c)]);
  const hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard de cierres'])).token);
  // sin regla para manguera 10 mono: la línea queda "sin equivalencia"
  const r = await enviarCierre(db, hash, { numInst: 'E2632246', equipo: 'Búfala 1', fechaCierreIso: H(-3), tipoLinea: 'manguera', seccion: '10', fase: 'mono', metrosLinea: 49, hardware: '' }, { reglas: [], kits: {}, origen: 'historico' });
  cierre = r.cierre;
  await superusuario(db);
  linea = await valor<string>(db, "select id from cierre_lineas where cierre_id = $1 and campo = 'metrosLinea'", [cierre]);
  await db.exec(`insert into stock_vehiculo (vehiculo_id, sku, unidades) select 'V-F01', sku, 100 from productos where nombre like 'CABLE LHA H07Z1-K%'
    on conflict (vehiculo_id, sku) do update set unidades = 100;`);
  expect((await lineas())[0].estado).toBe('sin_equivalencia');
});

describe('resolver con varios artículos', () => {
  it('monofásica: 3 conductores de 49 m (marrón, azul, amarillo/verde), con versión y auditoría', async () => {
    const r = await resolver([{ sku: '6000650653', cantidad: 49 }, { sku: '6000650654', cantidad: 49 }, { sku: '6000650655', cantidad: 49 }]);
    expect(r.diferencia).toEqual([{ sku: '6000650653', unidades: 49 }, { sku: '6000650654', unidades: 49 }, { sku: '6000650655', unidades: 49 }]);
    expect((await lineas()).map(l => [l.sku, l.estado])).toEqual([['6000650653', 'resuelta'], ['6000650654', 'resuelta'], ['6000650655', 'resuelta']]);
    for (const [sku] of CABLES.slice(0, 3)) expect(await aBordo(sku)).toBe(51);
    expect(await valor(db, "select documento from cierre_versiones where cierre_id = $1 order by n desc limit 1", [cierre])).toMatch(/^Línea metrosLinea resuelta por .+: CABLE .*MARRON.* \+ CABLE .*AZUL.* \+ CABLE .*AM\/VERDE/);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'resolver_linea_cierre'")).toBe(1);
  });

  it('trifásica: 5 conductores', async () => {
    await resolver(CABLES.map(([sku]) => ({ sku, cantidad: 20 })));
    expect((await lineas()).length).toBe(5);
    for (const [sku] of CABLES) expect(await aBordo(sku)).toBe(80);
  });

  it('valida todo antes de tocar nada; no se resuelve dos veces', async () => {
    await como(db, ADMIN);
    expect(await falla(db, 'select resolver_linea_varios($1, $2, $3::jsonb)', [linea, uuid(), JSON.stringify([{ sku: '6000650653', cantidad: 49 }, { sku: 'NO-EXISTE', cantidad: 49 }])])).toMatch(/Artículo no encontrado: NO-EXISTE/);
    expect(await falla(db, 'select resolver_linea_varios($1, $2, $3::jsonb)', [linea, uuid(), JSON.stringify([{ sku: '6000650653', cantidad: 0 }])])).toMatch(/mayor que 0/);
    expect(await falla(db, 'select resolver_linea_varios($1, $2, $3::jsonb)', [linea, uuid(), '[]'])).toMatch(/al menos un artículo/);
    expect((await lineas())[0].estado).toBe('sin_equivalencia');
    await resolver([{ sku: '6000650653', cantidad: 49 }]);
    expect((await resolver([{ sku: '6000650654', cantidad: 49 }])).estado).toBe('duplicado');
  });
});

describe('deshacer una resolución', () => {
  it('el caso real: 49 m de AM/VERDE vuelven a bordo, la línea queda "sin equivalencia" y se resuelve bien con los 3', async () => {
    // como se resolvió en producción (antes de E-030): un solo artículo, sin guardar cómo estaba
    await superusuario(db);
    await db.query("update cierre_lineas set sku = '6000650655', estado = 'resuelta', nota = nota || ' · resuelta por César' where id = $1", [linea]);
    await db.query('select _sincronizar_cierre($1)', [cierre]);
    expect(await aBordo('6000650655')).toBe(51);
    await como(db, ADMIN);
    const r = await valor<{ diferencia: unknown }>(db, 'select deshacer_resolucion($1) as r', [linea]);
    expect(r.diferencia).toEqual([{ sku: '6000650655', unidades: -49 }]);
    expect(await aBordo('6000650655')).toBe(100);
    expect(await lineas()).toEqual([{ sku: null, cantidad: '49.000', estado: 'sin_equivalencia' }]);
    expect(await valor(db, 'select nota from cierre_lineas where id = $1', [linea])).not.toMatch(/resuelta por/);
    // el ajuste enlazado al cierre, la versión y la auditoría
    expect(await valor(db, "select count(*)::int from movimientos where cierre_id = $1 and tipo = 'ajuste' and sku = '6000650655'", [cierre])).toBe(1);
    expect(await valor(db, 'select documento from cierre_versiones where cierre_id = $1 order by n desc limit 1', [cierre])).toMatch(/^Resolución de metrosLinea deshecha por /);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'deshacer_resolucion'")).toBe(1);
    // y ahora bien: los 3 conductores
    await resolver([{ sku: '6000650653', cantidad: 49 }, { sku: '6000650654', cantidad: 49 }, { sku: '6000650655', cantidad: 49 }]);
    for (const [sku] of CABLES.slice(0, 3)) expect(await aBordo(sku)).toBe(51);
  });

  it('una resolución de varios se deshace entera desde cualquiera de sus líneas', async () => {
    await resolver(CABLES.map(([sku]) => ({ sku, cantidad: 20 })));
    await superusuario(db);
    const otra = await valor<string>(db, "select id from cierre_lineas where cierre_id = $1 and sku = '6000650652'", [cierre]);
    await como(db, ADMIN);
    await db.query('select deshacer_resolucion($1)', [otra]);
    expect(await lineas()).toEqual([{ sku: null, cantidad: '49.000', estado: 'sin_equivalencia' }]);
    for (const [sku] of CABLES) expect(await aBordo(sku)).toBe(100);
    await como(db, ADMIN);
    expect(await falla(db, 'select deshacer_resolucion($1)', [linea])).toMatch(/no está resuelta a mano/);
  });

});
