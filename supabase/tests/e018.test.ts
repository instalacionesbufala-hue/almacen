/* E-018 · Ajuste de inventario: solo el administrador, con motivo; el almacén lo propone */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const AJ = 'select ajustar_inventario($1, $2, $3, $4, $5) as r';
const PROP = 'select proponer_ajuste($1, $2, $3, $4, $5) as r';
const stock = (db: BD, sku: string) => valor<number>(db, 'select stock::float from productos where sku = $1', [sku]);

describe('ajuste de inventario', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('el administrador ajusta en negativo y en positivo, con "de X a Y", y queda como Ajuste en el historial y la auditoría', async () => {
    await como(db, ADMIN);
    const a = uuid(), b = uuid();
    const r = await valor<{ estado: string; de: number; a: number }>(db, AJ, [a, '6000650605', -20, 'Duplicado de la corrección del albarán 3.322.577', null]);
    expect(r).toMatchObject({ estado: 'aplicado', de: 420, a: 400 });
    expect(await stock(db, '6000650605')).toBe(400);
    await db.query(AJ, [b, '6000650605', 5, 'Rollo encontrado en el altillo', null]);
    expect(await stock(db, '6000650605')).toBe(405);
    expect((await valor<{ estado: string }>(db, AJ, [a, '6000650605', -20, 'x', null])).estado).toBe('duplicado');     // reintento
    expect(await stock(db, '6000650605')).toBe(405);
    const m = (await db.query('select tipo, cantidad::float, motivo, referencia from movimientos where id = $1', [a])).rows[0];
    expect(m).toEqual({ tipo: 'ajuste', cantidad: -20, motivo: 'Duplicado de la corrección del albarán 3.322.577', referencia: 'Ajuste de inventario' });
    await superusuario(db);
    const au = await valor<Record<string, unknown>>(db, "select detalle from auditoria where accion = 'ajuste_inventario' and detalle->>'movimiento' = $1", [a]);
    expect(au).toMatchObject({ sku: '6000650605', cantidad: -20, de: 420, a: 400, ubicacion: 'almacén' });
  });
  it('motivo obligatorio, cantidad distinta de cero y sin dejar el stock en negativo', async () => {
    await como(db, ADMIN);
    expect(await falla(db, AJ, [uuid(), '6000650605', -1, '  ', null])).toMatch(/motivo/);
    expect(await falla(db, AJ, [uuid(), '6000650605', 0, 'x', null])).toMatch(/distinta de cero/);
    expect(await falla(db, AJ, [uuid(), '6000650605', -9999, 'x', null])).toMatch(/negativo/);
  });
  it('en un vehículo: cambia lo que lleva a bordo, no el almacén', async () => {
    await como(db, ADMIN);
    const antes = await stock(db, 'CAB-RZ1K-5G6');
    const r = await valor<{ de: number; a: number }>(db, AJ, [uuid(), 'CAB-RZ1K-5G6', -30, 'Recuento mal hecho al cargar', 'V-F01']);
    expect(r).toMatchObject({ de: 150, a: 120 });
    expect(await valor(db, "select unidades::float from stock_vehiculo where vehiculo_id = 'V-F01' and sku = 'CAB-RZ1K-5G6'")).toBe(120);
    expect(await stock(db, 'CAB-RZ1K-5G6')).toBe(antes);
  });
  it('el rol almacén no puede ajustar: lo propone y el administrador lo aplica desde la bandeja con su motivo', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, AJ, [uuid(), '6000650601', -10, 'x', null])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select registrar_movimiento($1, $2, $3, $4, $5) as r', [uuid(), '6000650601', 'ajuste', -10, 'x'])).toMatch(/Solo el administrador/);
    expect(await falla(db, PROP, [uuid(), '6000650601', -10, '', null])).toMatch(/motivo/);
    const pid = uuid();
    expect((await valor<{ estado: string }>(db, PROP, [pid, '6000650601', -10, 'Contado dos veces', null])).estado).toBe('pendiente');
    expect(await stock(db, '6000650601')).toBe(350);
    await como(db, ADMIN);
    await db.query('select validar_pendiente($1, true, $2)', [pid, '']);
    expect(await stock(db, '6000650601')).toBe(340);
    const m = (await db.query("select m.tipo, m.cantidad::float, m.motivo from pendientes p join movimientos m on m.id = p.movimiento_id where p.id = $1", [pid])).rows[0];
    expect(m).toEqual({ tipo: 'ajuste', cantidad: -10, motivo: 'Contado dos veces' });
  });
  it('no cuenta como merma, ni como salida a obra, ni como consumo', async () => {
    await superusuario(db);
    const n = async (tipo: string) => valor<number>(db, "select count(*)::int from movimientos where sku in ('6000650605', '6000650601', 'CAB-RZ1K-5G6') and tipo = $1 and motivo not in ('Compra a proveedor')", [tipo]);
    expect(await n('merma')).toBe(0);
    expect(await n('salida')).toBe(0);
    expect(await n('consumo')).toBe(0);
    expect(await n('ajuste')).toBe(4);
    expect(await valor(db, "select count(*)::int from pendientes where tipo = 'merma' and sku in ('6000650605', '6000650601')")).toBe(0);
  });
});

describe('albaranes: códigos impresos', () => {
  it('guarda los códigos de las líneas aunque se emparejaran con otro artículo', async () => {
    const db = await nuevaBD();
    await como(db, ALMACEN);
    const alb = uuid();
    await db.query('select aprobar_albaran($1, $2::jsonb, $3::jsonb)', [alb, JSON.stringify({ numero: '3.322.577', proveedor: 'Saltoki' }),
      JSON.stringify([{ sku: '6000650605', codigo: '6222 106082', cantidad: 20 }, { sku: '6000650604', codigo: '6000650604', cantidad: 1 }, { sku: '6000650601', cantidad: 1 }])]);
    expect((await valor<string[]>(db, 'select codigos from albaranes where id = $1', [alb])).sort()).toEqual(['6000650604', '6222106082']);
  });
});
