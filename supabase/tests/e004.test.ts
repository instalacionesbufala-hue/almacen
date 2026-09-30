/* E-004 · Permisos por rol aplicados en el servidor */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8) as r';
const stock = (db: BD, sku: string) => valor<string>(db, 'select stock::text from productos where sku = $1', [sku]).then(Number);

describe('el almacén no puede lo que es del administrador', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('no edita precios ni referencias, ni directamente ni con funciones', async () => {
    expect(await falla(db, "update costes_producto set precio = 0 where sku = 'BF-FIX-SX8'")).toMatch(/permission denied/);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'BF-FIX-SX8', nombre: 'x', categoria: 'fijaciones', unidad: 'caja', contenido: 100 })])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select borrar_producto($1)', ['BF-FIX-SX8'])).toMatch(/Solo el administrador/);
  });
  it('no borra movimientos ni con el panel: el historial es inalterable', async () => {
    const id = uuid();
    await db.query(MOV, [id, 'BF-FIX-SX8', 'salida', 1, 'Obra', 'C/ Eros 10', [], null]);
    expect(await falla(db, 'delete from movimientos where id = $1', [id])).toMatch(/permission denied/);
    await superusuario(db);
    expect(await falla(db, 'delete from movimientos where id = $1', [id])).toMatch(/no se puede modificar/);
    await como(db, ALMACEN);
  });
  it('no da de alta equipos, técnicos ni dotación, ni cambia usuarios', async () => {
    expect(await falla(db, 'select guardar_equipo($1::jsonb)', [JSON.stringify({ id: 'F9', nombre: 'x' })])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select guardar_tecnico($1::jsonb)', [JSON.stringify({ id: 'T9', nombre: 'x', dni_mascara: '—' })])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select alta_dotacion($1::jsonb)', [JSON.stringify({ id: 'H9', clase: 'herramienta', nombre: 'x' })])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select actualizar_perfil($1, $2, $3, $4)', [ALMACEN, 'Yo', 'admin', true])).toMatch(/Solo el administrador/);
  });
  it('solo ve su propio perfil', async () => {
    expect((await db.query('select * from perfiles')).rows).toHaveLength(1);
  });
});

describe('mermas (E-013: al momento, con aviso) y recuentos pendientes de validar', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('las mermas se aplican al momento, sin importes, y quedan en la bandeja del administrador como aviso', async () => {
    await como(db, ALMACEN);
    const r1 = await valor<{ estado: string }>(db, MOV, [uuid(), 'BF-FIX-SX8', 'merma', 1, 'Rotura o daño', '', [], null]);
    expect(r1.estado).toBe('aplicado');
    expect(await stock(db, 'BF-FIX-SX8')).toBe(11);
    const r2 = await valor<{ estado: string }>(db, MOV, [uuid(), '6040615316', 'merma', 10, 'Corte sobrante', '', [], null]);
    expect(r2.estado).toBe('aplicado');
    expect(await stock(db, '6040615316')).toBe(295);
    await como(db, ADMIN);
    expect(await valor(db, "select count(*)::int from pendientes where tipo = 'merma' and estado = 'aplicada'")).toBe(2);
    expect(await valor(db, "select count(*)::int from envios_aviso where tipo = 'merma'")).toBeGreaterThan(0);
  });
  it('las mermas de material en custodia también se aplican y generan la incidencia para Esmove', async () => {
    await como(db, ALMACEN);
    const r = await valor<{ estado: string }>(db, MOV, [uuid(), 'ESM-CPVE-MONO', 'merma', 1, 'Rotura o daño', 'Caída en carga', [], null]);
    expect(r.estado).toBe('aplicado');
    expect(await stock(db, 'ESM-CPVE-MONO')).toBe(2);
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from envios_aviso where tipo = 'incidencia_custodia'")).toBe(1);
  });
  it('el administrador marca las mermas como vistas', async () => {
    await como(db, ADMIN);
    const id = await valor<string>(db, "select id from pendientes where estado = 'aplicada' order by ts limit 1");
    await db.query('select marcar_merma_vista($1)', [id]);
    expect(await valor(db, 'select estado from pendientes where id = $1', [id])).toBe('vista');
    await como(db, ALMACEN);
    expect(await falla(db, 'select marcar_merma_vista($1)', [id])).toMatch(/Solo el administrador/);
  });
  it('el recuento del almacén deja las diferencias pendientes; el del administrador ajusta', async () => {
    await como(db, ALMACEN);
    const lineas = JSON.stringify([{ sku: 'BF-FIX-SX6', contado: 2 }, { sku: '5301012054', contado: 7 }]);
    const r = await valor<{ estado: string; diferencias: number }>(db, 'select registrar_recuento($1, $2, $3::jsonb) as r', [uuid(), 'fijaciones', lineas]);
    expect(r).toEqual({ estado: 'pendiente', diferencias: 1 });
    expect(await stock(db, 'BF-FIX-SX6')).toBe(3);
    await como(db, ADMIN);
    const r2 = await valor<{ estado: string }>(db, 'select registrar_recuento($1, $2, $3::jsonb) as r', [uuid(), 'fijaciones', JSON.stringify([{ sku: 'BF-FIX-SX8', contado: 10 }])]);
    expect(r2.estado).toBe('aplicado');
    expect(await stock(db, 'BF-FIX-SX8')).toBe(10);
  });
  it('el administrador aprueba o rechaza los recuentos desde la bandeja; lo resuelto ya no cambia', async () => {
    await como(db, ADMIN);
    const rec = await valor<string>(db, "select id from pendientes where estado = 'pendiente' and tipo = 'recuento'");
    await db.query('select validar_pendiente($1, true, $2)', [rec, '']);
    expect(await stock(db, 'BF-FIX-SX6')).toBe(2);
    expect((await valor<{ estado: string }>(db, 'select validar_pendiente($1, false, $2) as r', [rec, ''])).estado).toBe('duplicado');
    await superusuario(db);
    expect(await falla(db, "update pendientes set estado = 'pendiente' where id = $1", [rec])).toMatch(/no se puede modificar/);
  });
});

describe('referencias en borrador y usuarios', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('el almacén crea un borrador con el código escaneado; no se puede mover hasta que el administrador lo completa', async () => {
    await como(db, ALMACEN);
    const r = await valor<{ sku: string }>(db, 'select crear_borrador_producto($1, $2, $3, $4) as r', ['', '8412345678905', 'Caja estanca', 'aparamenta']);
    expect(r.sku).toBe('BORR-8412345678905');
    expect(await falla(db, MOV, [uuid(), r.sku, 'entrada', 5, 'Compra', '', [], null])).toMatch(/borrador/);
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: r.sku, nombre: 'Caja estanca IP65 100×100', categoria: 'aparamenta', unidad: 'ud', minimo: 5, ean: '8412345678905' })]);
    await como(db, ALMACEN);
    await db.query(MOV, [uuid(), r.sku, 'entrada', 5, 'Compra', '', [], null]);
    expect(await stock(db, r.sku)).toBe(5);
  });
  it('el administrador cambia rol y activación; no puede dejar la empresa sin administrador', async () => {
    await como(db, ADMIN);
    expect(await falla(db, 'select actualizar_perfil($1, $2, $3, $4)', [ADMIN, 'Admin', 'almacen', true])).toMatch(/a ti mismo/);
    await db.query('select actualizar_perfil($1, $2, $3, $4)', [ALMACEN, 'Operario', 'almacen', false]);
    await como(db, ALMACEN);
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'salida', 1, 'x', 'Obra', [], null])).toMatch(/desactivado/);
    await superusuario(db);
    expect(await falla(db, 'delete from perfiles where id = $1', [ALMACEN])).toMatch(/no se puede modificar/);
  });
});
