/* E-015 · Alta con la cámara: borrador del almacén con su stock contado y aprobación del administrador */
import { beforeAll, describe, expect, it } from 'vitest';
import { rpcDe } from '../../src/store/ops';
import { formularioInicial, opDeAlta } from '../../src/domain/altaCamara';
import { ADMIN, ALMACEN, como, falla, nuevaBD, uuid, valor, type BD } from './pg';

const BORR = 'select crear_borrador_articulo($1::jsonb) as r';
const stock = (db: BD, sku: string) => valor<string>(db, 'select stock::text from productos where sku = $1', [sku]).then(Number);
const art = (x: Record<string, unknown> = {}) => JSON.stringify({ sku: 'CAM-1', nombre: 'Bote 500 tacos nylon SX 10', categoria: 'fijaciones', unidad: 'bote', contenido: 500, stock_inicial: 3, ean: '4006381333931', ...x });

describe('borrador del almacén', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('el almacén crea el artículo completo como borrador; el stock queda propuesto, sin movimiento', async () => {
    await como(db, ALMACEN);
    expect(await valor(db, BORR, [art()])).toEqual({ estado: 'aplicado', sku: 'CAM-1' });
    const p = (await db.query<Record<string, unknown>>("select borrador, stock::int, stock_propuesto::int, propuesto_por, unidad, contenido::int, minimo_definido from productos where sku = 'CAM-1'")).rows[0];
    expect(p).toEqual({ borrador: true, stock: 0, stock_propuesto: 3, propuesto_por: 'Operario Pruebas', unidad: 'bote', contenido: 500, minimo_definido: false });
    expect(await valor(db, "select count(*)::int from movimientos where sku = 'CAM-1'")).toBe(0);
    expect(await falla(db, 'select registrar_movimiento($1, $2, $3, $4, $5)', [uuid(), 'CAM-1', 'salida', 1, 'Obra'])).toMatch(/borrador/);
  });
  it('reintento de la cola: no duplica; otro artículo con el mismo código se rechaza', async () => {
    await como(db, ALMACEN);
    expect(await valor(db, BORR, [art()])).toEqual({ estado: 'duplicado', sku: 'CAM-1' });
    expect(await falla(db, BORR, [art({ sku: 'CAM-2', nombre: 'Otro' })])).toMatch(/Ya existe una referencia con ese código: CAM-1/);   // mismo EAN
    expect(await falla(db, BORR, [art({ sku: 'CAM-3', ean: '', ref_proveedor: 'A9F74240', nombre: 'Otro' })])).toMatch(/SCH-IC60N-40/);   // código del proveedor
    expect(await falla(db, BORR, [art({ sku: 'CAM-4', ean: '', unidad: 'saco' })])).toMatch(/Unidad desconocida/);
    expect(await falla(db, BORR, [art({ sku: 'CAM-5', ean: '', stock_inicial: 1.5 })])).toMatch(/enteros/);
  });
  it('el administrador lo aprueba: entra el stock contado como "Alta de artículo", una sola vez', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'CAM-1', nombre: 'Bote 500 tacos nylon SX 10×50', categoria: 'fijaciones', unidad: 'bote', contenido: 500, minimo: 2 })]);
    expect(await stock(db, 'CAM-1')).toBe(3);
    expect(await valor(db, "select motivo || ' · ' || referencia from movimientos where sku = 'CAM-1'")).toBe('Alta de artículo · Borrador aprobado');
    expect(await valor(db, "select borrador from productos where sku = 'CAM-1'")).toBe(false);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'CAM-1', nombre: 'Bote 500 tacos', categoria: 'fijaciones', unidad: 'bote', contenido: 500, minimo: 2, stock_inicial: 9 })]);
    expect(await stock(db, 'CAM-1')).toBe(3);                                                     // ya no es borrador: no vuelve a entrar
  });
  it('si el administrador corrige el recuento al aprobar, manda el suyo', async () => {
    await como(db, ALMACEN);
    await db.query(BORR, [art({ sku: 'CAM-6', ean: '', nombre: 'Sobre 25 RJ45', unidad: 'sobre', contenido: 25, stock_inicial: 4 })]);
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'CAM-6', nombre: 'Sobre 25 RJ45', categoria: 'aparamenta', unidad: 'sobre', contenido: 25, stock_inicial: 2 })]);
    expect(await stock(db, 'CAM-6')).toBe(2);
  });
});

describe('contrato: lo que envía la app al guardar el alta', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  async function ejecutarRpc(fn: string, args: Record<string, unknown>) {
    const nombres = Object.keys(args);
    const vals = nombres.map(k => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    return (await db.query<{ r: unknown }>(`select ${fn}(${nombres.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals)).rows[0].r;
  }

  it('almacén → crear_borrador_articulo; administrador → guardar_producto con su "Alta de artículo"', async () => {
    await como(db, ALMACEN);
    const f = { ...formularioInicial({ codigo: 'CAM-A', propuesta: null }), name: 'Bolsa 100 bridas', cat: 'fijaciones' as const, unit: 'bolsa' as const, contenido: '100', stock: '5' };
    await ejecutarRpc(...rpcDe(opDeAlta('almacen', f, 'x')));
    expect((await db.query("select borrador, stock_propuesto::int as s from productos where sku = 'CAM-A'")).rows[0]).toEqual({ borrador: true, s: 5 });
    await como(db, ADMIN);
    await ejecutarRpc(...rpcDe(opDeAlta('admin', { ...f, sku: 'CAM-B', min: '2' }, 'y')));
    expect(await stock(db, 'CAM-B')).toBe(5);
    expect(await valor(db, "select minimo_definido from productos where sku = 'CAM-B'")).toBe(true);
    await ejecutarRpc(...rpcDe(opDeAlta('admin', { ...formularioInicial({ tipo: 'herramienta' }), name: 'Pinza amperimétrica', marca: 'Fluke', modelo: '376', serie: 'FL-9' }, 'H950')));
    expect(await valor(db, "select nombre from dotacion where id = 'H950'")).toBe('Pinza amperimétrica');
  });
});
