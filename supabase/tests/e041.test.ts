/* E-041 · Devolución de material de una furgoneta al almacén: metros sueltos de un artículo por rollos (100 m entregados, 30 m
   devueltos → almacén +0,3 rollos, furgoneta −30 m), línea defectuosa como merma, custodia que vuelve a su socio, anulación, el
   saldo del extracto que cuadra y lo que ve el socio (sin nombres). */
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MANG = 'T-MANG-RZ1K', CARG = 'WBX-PULSAR-22', ESM = '00000000-0000-4000-8000-000000000411';
const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
let db: BD;
const stock = async (sku: string) => { await superusuario(db); return Number(await valor<string>(db, 'select stock::text from productos where sku = $1', [sku])); };
const aBordo = async (sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, "select unidades::text from stock_vehiculo where vehiculo_id = 'V-F01' and sku = $1", [sku]) ?? 0); };
const BASE = { vehiculo: 'V-F01', tecnico: 'T1', motivo: 'sobrante', obra: 'E2639410', firma: 'data:image/png;base64,AA' };
const devolver = async (lineas: unknown[], id = uuid(), extra: Record<string, unknown> = {}, uid = ADMIN) => {
  await como(db, uid); return valor<{ estado: string; numero: string; hash: string }>(db, 'select registrar_devolucion($1, $2::jsonb) as r', [id, JSON.stringify({ ...BASE, ...extra, lineas })]); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: MANG, nombre: 'Manguera RZ1-K de prueba', categoria: 'cables', unidad: 'rollo', contenido: 100, unidad_contenido: 'm', minimo: 0, nuevo: true, stock_inicial: 2 })]);
  const id = uuid();
  await db.query(PREP, [id, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: MANG, cantidad: 1 }])]);
  await db.query('select confirmar_entrega($1, $2)', [id, 'data:image/png;base64,AA']);
});

describe('devolución de material de una furgoneta', () => {
  it('30 m de un rollo de 100 m: almacén +0,3 rollos, furgoneta −30 m; DEV-, huella, idempotente; el extracto cuadra', async () => {
    expect([await stock(MANG), await aBordo(MANG)]).toEqual([1, 100]);
    const id = uuid();
    const r = await devolver([{ sku: MANG, unidades: 30, estado: 'bien' }], id);
    expect(r).toMatchObject({ estado: 'aplicado', numero: expect.stringMatching(/^DEV-\d{4}-0001$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect([await stock(MANG), await aBordo(MANG)]).toEqual([1.3, 70]);
    expect((await devolver([{ sku: MANG, unidades: 30, estado: 'bien' }], id)).estado).toBe('duplicado');
    expect(await aBordo(MANG)).toBe(70);
    await como(db, ADMIN);
    const e = await valor<{ filas: { tipo: string; unidades: number; referencia: string }[]; saldoCalculado: number; stock: number }>(db, `select extracto_vehiculo('V-F01', '${MANG}') as r`);
    expect(e.filas.map(f => [f.tipo, f.unidades])).toEqual([['entrega', 100], ['devolucion', -30]]);
    expect(e.filas[1].referencia).toBe(`${r.numero} · E2639410`);
    expect([e.saldoCalculado, e.stock]).toEqual([70, 70]);
  });

  it('defectuoso: sale de la furgoneta como merma, sin sumar al almacén, y avisa', async () => {
    await devolver([{ sku: MANG, unidades: 20, estado: 'bien' }, { sku: MANG, unidades: 10, estado: 'defectuoso', motivoDefecto: 'Cubierta dañada' }]);
    expect([await stock(MANG), await aBordo(MANG)]).toEqual([1.2, 70]);
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from movimientos where tipo = 'merma' and motivo = 'Devuelto defectuoso: Cubierta dañada' and vehiculo_id = 'V-F01'")).toBe(1);
    expect(await valor(db, "select count(*)::int from pendientes where tipo = 'merma'")).toBe(1);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_devolucion($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, lineas: [{ sku: MANG, unidades: 1, estado: 'defectuoso' }] })])).toMatch(/qué le pasa/);
  });

  it('custodia: vuelve al almacén en custodia de su socio; defectuoso = incidencia del socio', async () => {
    await superusuario(db);
    expect(await aBordo(CARG)).toBe(2);                                     // la semilla: 2 Wallbox de Esmove en Búfala 1
    const antes = await stock(CARG);
    await devolver([{ sku: CARG, unidades: 1, estado: 'bien' }, { sku: CARG, unidades: 1, estado: 'defectuoso', motivoDefecto: 'No enciende' }]);
    expect([await stock(CARG), await aBordo(CARG)]).toEqual([antes + 1, 0]);
    await superusuario(db);
    expect(await valor(db, "select propiedad || ' ' || propietario_id from productos where sku = $1", [CARG])).toBe('custodia ESMOVE');
    expect(Number(await valor(db, "select count(*) from envios_aviso where tipo like '%custodia%' or asunto ilike '%incidencia%'"))).toBeGreaterThan(0);
  });

  it('artículo que no consta a bordo (queda en negativo); quien devuelve tiene que ser del equipo; firma', async () => {
    await devolver([{ sku: 'BF-FIX-SX8', unidades: 5, estado: 'bien' }]);
    expect(await aBordo('BF-FIX-SX8')).toBe(-5);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_devolucion($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, tecnico: 'T5', lineas: [{ sku: MANG, unidades: 1, estado: 'bien' }] })])).toMatch(/técnico del equipo/);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_devolucion($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, firma: '', lineas: [{ sku: MANG, unidades: 1, estado: 'bien' }] })])).toMatch(/firma/);
  });

  it('el almacén la registra; solo el administrador la anula y todo vuelve; inalterable', async () => {
    const id = uuid();
    await devolver([{ sku: MANG, unidades: 30, estado: 'bien' }, { sku: MANG, unidades: 10, estado: 'defectuoso', motivoDefecto: 'Cortada' }], id, {}, ALMACEN);
    expect([await stock(MANG), await aBordo(MANG)]).toEqual([1.3, 60]);
    await como(db, ALMACEN);
    expect(await falla(db, 'select anular_devolucion($1, $2)', [id, 'Error'])).toMatch(/administrador/i);
    await como(db, ADMIN);
    expect(await valor(db, 'select anular_devolucion($1, $2) as r', [id, 'Se contó mal'])).toMatchObject({ estado: 'aplicado' });
    expect([await stock(MANG), await aBordo(MANG)]).toEqual([1, 100]);
    await superusuario(db);
    expect(await valor(db, 'select estado from devoluciones where id = $1', [id])).toBe('anulada');
    expect(await falla(db, `update devoluciones set obra = 'x' where id = '${id}'`)).toMatch(/no se puede modificar/);
    await como(db, ADMIN);
    const e = await valor<{ saldoCalculado: number; stock: number }>(db, `select extracto_vehiculo('V-F01', '${MANG}') as r`);
    expect([e.saldoCalculado, e.stock]).toEqual([100, 100]);
  });

  it('el socio ve las devoluciones de su material, sin técnico ni firma', async () => {
    await devolver([{ sku: CARG, unidades: 1, estado: 'bien' }, { sku: MANG, unidades: 10, estado: 'bien' }]);
    await superusuario(db);
    await db.exec(`insert into auth.users (id, email) values ('${ESM}', 'esmove@x.es');
      insert into perfiles (id, nombre, rol, activo, propietario_id) values ('${ESM}', 'Persona de Esmove', 'socio', true, 'ESMOVE');`);
    await como(db, ESM);
    const d = await valor<{ devoluciones: { numero: string; firma: string; operario: string; tecnico_id?: string; lineas: { sku: string }[] }[] }>(db, 'select datos_socio() as r');
    expect(d.devoluciones).toHaveLength(1);
    expect(d.devoluciones[0]).toMatchObject({ firma: '', operario: 'Búfala', lineas: [{ sku: CARG }] });
    expect(d.devoluciones[0].tecnico_id).toBeUndefined();
  });
});
