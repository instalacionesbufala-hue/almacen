/* E-007 · Entregas preparadas (desde E-011, cesta libre): reserva, caducidad, anulación y confirmación atómica */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8) as r';
const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
const stock = (db: BD, sku: string) => valor<string>(db, 'select stock::text from productos where sku = $1', [sku]).then(Number);

describe('reserva al preparar', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('lo preparado queda reservado: otra salida no puede llevárselo', async () => {
    // Magnetotérmico Hager: 6 ud
    const r = await valor<{ numero: string }>(db, PREP, [uuid(), 'F01', 'T1', 'C/ Eros 10', null, JSON.stringify([{ tipo: 'stock', sku: '7501013532', cantidad: 5 }])]);
    expect(r.numero).toMatch(/^ENT-/);
    expect(await stock(db, '7501013532')).toBe(6);                        // aún no sale del almacén
    expect(await valor(db, "select reservado('7501013532')::int")).toBe(5);
    expect(await falla(db, MOV, [uuid(), '7501013532', 'salida', 2, 'Obra', 'Otra obra', [], null])).toMatch(/reservadas para entregas preparadas/);
    await db.query(MOV, [uuid(), '7501013532', 'salida', 1, 'Obra', 'Otra obra', [], null]);   // la sexta sí está libre
    expect(await falla(db, PREP, [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: '7501013532', cantidad: 1 }])])).toMatch(/Solo hay 0 disponibles/);
  });
  it('E-013: los cargadores se reservan por cantidad; si llega un n.º de serie, se ignora', async () => {
    const id = uuid();
    await db.query(PREP, [id, 'F01', 'T1', 'Garaje C/ Recogidas 12', null, JSON.stringify([{ tipo: 'stock', sku: 'WBX-PULSAR-22', cantidad: 1, series: ['WBX-22-899283'] }])]);
    expect(await valor(db, "select reservado('WBX-PULSAR-22')::int")).toBe(1);
    expect(await valor(db, 'select count(*)::int from reservas where entrega_id = $1 and cardinality(series) > 0', [id])).toBe(0);
  });
  it('anular libera la reserva; una reserva caducada deja de contar y no se puede firmar', async () => {
    const id = uuid();
    await db.query(PREP, [id, 'F02', 'T3', '', null, JSON.stringify([{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 10 }])]);
    expect(await valor(db, "select reservado('BF-FIX-SX8')::int")).toBe(10);
    await db.query('select anular_entrega($1)', [id]);
    expect(await valor(db, "select reservado('BF-FIX-SX8')::int")).toBe(0);
    expect(await falla(db, 'select confirmar_entrega($1, $2)', [id, 'firma'])).toMatch(/anulada/);
    const id2 = uuid();
    await db.query(PREP, [id2, 'F02', 'T3', '', null, JSON.stringify([{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 10 }])]);
    await superusuario(db);
    await db.exec(`alter table reservas disable trigger all; alter table entregas disable trigger all;
      update reservas set caduca = now() - interval '1 minute' where entrega_id = '${id2}'; update entregas set caduca = now() - interval '1 minute' where id = '${id2}';
      alter table reservas enable trigger all; alter table entregas enable trigger all;`);
    await como(db, ALMACEN);
    expect(await valor(db, "select reservado('BF-FIX-SX8')::int")).toBe(0);
    expect(await falla(db, 'select confirmar_entrega($1, $2)', [id2, 'firma'])).toMatch(/caducado/);
  });
});

describe('confirmar la entrega', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('firma: descuenta stock, entrega la ropa a la dotación del técnico con su talla, asigna la herramienta y calcula la huella', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    await db.query(PREP, [id, 'F01', 'T1', 'C/ Eros 10', null, JSON.stringify([
      { tipo: 'stock', sku: 'ROPA-PANT-44', cantidad: 2 }, { tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: 25 }, { tipo: 'herramienta', dotacion_id: 'H099' },
    ])]).catch(() => undefined); // H099 no existe todavía: se prepara abajo
    await como(db, ADMIN);
    await db.query('select alta_dotacion($1::jsonb)', [JSON.stringify({ id: 'H099', clase: 'herramienta', nombre: 'Detector de tensión', marca: 'Fluke T6', valor: 90 })]);
    await como(db, ALMACEN);
    const id2 = uuid();
    await db.query(PREP, [id2, 'F01', 'T1', 'C/ Eros 10', null, JSON.stringify([
      { tipo: 'stock', sku: 'ROPA-PANT-44', cantidad: 2 }, { tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: 25 }, { tipo: 'herramienta', dotacion_id: 'H099' },
    ])]);
    const r = await valor<{ estado: string; hash: string }>(db, 'select confirmar_entrega($1, $2) as r', [id2, 'data:image/png;base64,AA']);
    expect(r.estado).toBe('aplicado');
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await stock(db, 'ROPA-PANT-44')).toBe(0);
    expect(await stock(db, 'CAB-RZ1K-5G6')).toBe(775);
    expect(await valor(db, 'select count(*)::int from reservas where entrega_id = $1', [id2])).toBe(0);
    const ropa = (await db.query<{ clase: string; talla: string; cantidad: number; tecnico_id: string }>("select clase, talla, cantidad, tecnico_id from dotacion where clase = 'ropa' and talla = '44'")).rows[0];
    expect(ropa).toEqual({ clase: 'ropa', talla: '44', cantidad: 2, tecnico_id: 'T1' });
    expect((await db.query<{ equipo_id: string; tecnico_id: string }>("select equipo_id, tecnico_id from dotacion where id = 'H099'")).rows[0]).toEqual({ equipo_id: 'F01', tecnico_id: 'T1' });
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.every(x => x.ok)).toBe(true);
    expect((await valor<{ estado: string }>(db, 'select confirmar_entrega($1, $2) as r', [id2, 'otra'])).estado).toBe('duplicado');
  });
  it('es atómica: si una línea ya no se puede entregar, no se aplica ninguna', async () => {
    await como(db, ADMIN);
    await db.query('select alta_dotacion($1::jsonb)', [JSON.stringify({ id: 'H100', clase: 'herramienta', nombre: 'Pinza', marca: 'Fluke 376', valor: 500 })]);
    await como(db, ALMACEN);
    const id = uuid();
    await db.query(PREP, [id, 'F02', 'T3', '', null, JSON.stringify([{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 5 }, { tipo: 'herramienta', dotacion_id: 'H100' }])]);
    // entretanto la pinza se rompe
    await db.query('select registrar_incidencia($1, $2, $3, $4, $5, $6, $7)', [uuid(), 'H100', 'rotura', 'Caída', null, null, null]);
    expect(await falla(db, 'select confirmar_entrega($1, $2)', [id, 'firma'])).toMatch(/ya no está disponible/);
    expect(await stock(db, 'BF-FIX-SX8')).toBe(12);
    expect(await valor(db, 'select estado from entregas where id = $1', [id])).toBe('preparada');
    expect(await valor(db, 'select count(*)::int from reservas where entrega_id = $1', [id])).toBe(2);
  });
  it('una entrega firmada no se puede anular ni tocar', async () => {
    await como(db, ALMACEN);
    const id = (await db.query<{ id: string }>("select id from entregas where estado = 'firmada' limit 1")).rows[0].id;
    expect(await falla(db, 'select anular_entrega($1)', [id])).toMatch(/devolución/);
    await superusuario(db);
    expect(await falla(db, 'update entregas set obra = $2 where id = $1', [id, 'otra'])).toMatch(/no se puede modificar/);
  });
  it('tallas: solo el administrador (las plantillas quedan sin uso desde E-011)', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select guardar_tallas($1, $2, $3, $4, $5)', ['T1', 'L', '44', '42', '9'])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select guardar_tallas($1, $2, $3, $4, $5)', ['T1', 'L', '44', '42', '9']);
    expect(await valor(db, "select pantalon from tallas_tecnico where tecnico_id = 'T1'")).toBe('44');
  });
});
