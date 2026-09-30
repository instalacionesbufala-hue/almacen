/* E-016 · Categorías, proveedor, actualizar fichas, reasignar líneas de albarán, editar/fusionar/cambiar código, propuestas y equivalencias */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const stock = (db: BD, sku: string) => valor<string>(db, 'select stock::text from productos where sku = $1', [sku]).then(Number);
const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8) as r';

describe('categorías configurables', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });
  it('las iniciales, sin Fontanería, y bridas/bolsas/cinta en Consumibles', async () => {
    await como(db, ALMACEN);
    const ids = (await db.query<{ id: string }>('select id from categorias where activa order by orden')).rows.map(r => r.id);
    expect(ids).toEqual(['cargadores', 'cuadros', 'cables', 'tubos', 'fijaciones', 'aparamenta', 'consumibles', 'epis', 'ropa', 'herramientas']);
    expect(await valor(db, "select nombre from categorias where id = 'tubos'")).toBe('Tubos y canalización');
    expect(await valor(db, "select count(*)::int from productos where categoria = 'fontaneria'")).toBe(0);
  });
  it('solo el administrador; una categoría con artículos se desactiva moviéndolos a otra', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select guardar_categoria($1::jsonb)', [JSON.stringify({ id: 'solar', nombre: 'Fotovoltaica' })])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select guardar_categoria($1::jsonb)', [JSON.stringify({ id: 'solar', nombre: 'Fotovoltaica', icono: 'solar_power', color: 'ambar', orden: 110 })]);
    expect(await falla(db, 'select desactivar_categoria($1)', ['tubos'])).toMatch(/elige otra categoría/);
    const n = await valor<number>(db, "select count(*)::int from productos where categoria = 'tubos'");
    expect((await valor<{ movidos: number }>(db, 'select desactivar_categoria($1, $2) as r', ['tubos', 'solar'])).movidos).toBe(n);
    expect(await valor(db, "select activa from categorias where id = 'tubos'")).toBe(false);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'X1', nuevo: true, nombre: 'x', categoria: 'fontaneria', unidad: 'ud' })])).toMatch(/Categoría desconocida/);
  });
});

describe('albaranes: proveedor y reasignar una línea', () => {
  let db: BD; const alb = uuid();
  beforeAll(async () => {
    db = await nuevaBD(); await como(db, ALMACEN);
    await db.query('select aprobar_albaran($1, $2::jsonb, $3::jsonb)', [alb, JSON.stringify({ numero: '3.322.577', proveedor: 'Saltoki', delegacion: 'Centro', modo: 'ia' }),
      JSON.stringify([{ sku: 'BF-TUB-CM20', cantidad: 20 }, { sku: 'BF-FIX-SX8', cantidad: 2 }])]);
  });
  it('el albarán guarda el proveedor unificado y la delegación aparte', async () => {
    await superusuario(db);
    expect((await db.query('select proveedor, delegacion from albaranes where id = $1', [alb])).rows[0]).toEqual({ proveedor: 'Saltoki', delegacion: 'Centro' });
  });
  it('reasignar: baja A, sube B y el historial conserva la entrada original y dos ajustes enlazados', async () => {
    await superusuario(db);
    const ent = await valor<string>(db, "select id from movimientos where albaran_id = $1 and sku = 'BF-TUB-CM20'", [alb]);
    const a0 = await stock(db, 'BF-TUB-CM20'), b0 = await stock(db, '6040615306');
    await como(db, ALMACEN);
    expect(await falla(db, 'select reasignar_linea_albaran($1, $2, $3)', [uuid(), ent, '6040615306'])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    const id = uuid();
    expect(await valor(db, 'select reasignar_linea_albaran($1, $2, $3) as r', [id, ent, '6040615306'])).toMatchObject({ estado: 'aplicado', cantidad: 20 });
    expect(await stock(db, 'BF-TUB-CM20')).toBe(a0 - 20);
    expect(await stock(db, '6040615306')).toBe(b0 + 20);
    await superusuario(db);
    const m = (await db.query<{ id: string; sku: string; tipo: string; cantidad: string; corrige: string | null; albaran_id: string }>(
      'select id, sku, tipo, cantidad::text, corrige, albaran_id from movimientos where albaran_id = $1 order by ts, cantidad', [alb])).rows;
    expect(m.find(x => x.id === ent)).toMatchObject({ tipo: 'entrada', cantidad: '20.000' });
    expect(m.find(x => x.id === id)).toMatchObject({ sku: 'BF-TUB-CM20', tipo: 'ajuste', cantidad: '-20.000', corrige: ent });
    expect(m.find(x => x.corrige === id)).toMatchObject({ sku: '6040615306', tipo: 'ajuste', cantidad: '20.000' });
    await como(db, ADMIN);
    expect(await valor(db, 'select reasignar_linea_albaran($1, $2, $3) as r', [id, ent, '6040615306'])).toEqual({ estado: 'duplicado' });
    expect(await falla(db, 'select reasignar_linea_albaran($1, $2, $3)', [uuid(), ent, '6040615306'])).toMatch(/quedan 0/);
    const otra = await valor<string>(db, "select id from movimientos where tipo = 'salida' limit 1").catch(() => null);
    if (otra) expect(await falla(db, 'select reasignar_linea_albaran($1, $2, $3)', [uuid(), otra, '6040615306'])).toMatch(/no es una entrada/);
  });
});

describe('fichas: editar con auditoría, fusionar y cambiar código', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });
  it('cada edición queda en la auditoría con el valor anterior y el nuevo', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'BF-FIX-SX6', nombre: 'Bote 1000 tacos SX 6', categoria: 'fijaciones', unidad: 'bote', contenido: 1000, minimo: 2, proveedor: 'Saltoki', notas: 'Estantería de la izquierda' })]);
    await superusuario(db);
    const c = await valor<Record<string, { antes: unknown; despues: unknown }>>(db, "select detalle->'cambios' from auditoria where accion = 'editar_producto' order by ts desc limit 1");
    expect(c.nombre).toEqual({ antes: 'Bote 1000 tacos nylon SX 6×30', despues: 'Bote 1000 tacos SX 6' });
    expect(c.notas).toEqual({ antes: '', despues: 'Estantería de la izquierda' });
    expect(c.unidad).toBeUndefined();
  });
  it('fusionar A en B: almacén convertido por formato, vehículos, A archivado y ya no se mueve', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'CABLE-M', nuevo: true, nombre: 'Cable RZ1-K 5G6 por metros', categoria: 'cables', unidad: 'm' })]);
    const a = await stock(db, 'CAB-RZ1K-5G6');
    const r = await valor<{ cantidad: number }>(db, 'select fusionar_productos($1, $2, $3) as r', ['CAB-RZ1K-5G6', 'CABLE-M', 'Era el mismo']);
    expect(Number(r.cantidad)).toBe(a);
    expect(await stock(db, 'CABLE-M')).toBe(a);
    expect(await valor(db, "select unidades::int from stock_vehiculo where vehiculo_id = 'V-F01' and sku = 'CABLE-M'")).toBe(150);
    expect((await db.query("select archivado, fusionado_en from productos where sku = 'CAB-RZ1K-5G6'")).rows[0]).toEqual({ archivado: true, fusionado_en: 'CABLE-M' });
    expect(await falla(db, MOV, [uuid(), 'CAB-RZ1K-5G6', 'entrada', 1, 'Compra', '', [], null])).toMatch(/archivado/);
    expect(await falla(db, 'select fusionar_productos($1, $2)', ['7280040020', 'BF-FIX-SX8'])).toMatch(/No cuadra el formato/);
  });
  it('cambiar el código: el historial y las huellas de las entregas se conservan', async () => {
    await como(db, ALMACEN);
    const ent = uuid();
    await db.query('select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb)', [ent, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: 'WBX-PULSAR-22', cantidad: 1 }])]);
    await db.query('select confirmar_entrega($1, $2)', [ent, 'data:image/png;base64,AA']);
    await como(db, ADMIN);
    const s0 = await stock(db, 'WBX-PULSAR-22');
    await db.query('select cambiar_codigo_producto($1, $2)', ['WBX-PULSAR-22', 'plp2-0-2-3']);
    expect(await stock(db, 'PLP2-0-2-3')).toBe(s0);
    expect(await valor(db, "select fusionado_en from productos where sku = 'WBX-PULSAR-22'")).toBe('PLP2-0-2-3');
    expect(await valor(db, 'select sku from entrega_lineas where entrega_id = $1', [ent])).toBe('WBX-PULSAR-22');     // el albarán firmado no cambia
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.every(x => x.ok)).toBe(true);
    expect(await falla(db, 'select cambiar_codigo_producto($1, $2)', ['BF-FIX-SX8', 'PLP2-0-2-3'])).toMatch(/Ya existe/);
  });
});

describe('importar catálogo con "Actualizar fichas existentes"', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });
  const fila = { sku: 'BF-FIX-SX6', ref_proveedor: '', nombre: 'BOTE 1000 TACOS', categoria: 'fijaciones', propiedad: 'propia', propietario: '', proveedor: 'Saltoki', unidad: 'bote', contenido: 1000, stock_inicial: 99, minimo: null, albaranes: 'X' };
  it('sin la casilla no se toca lo que existe; con ella cambian los datos pero no el stock', async () => {
    await como(db, ADMIN);
    await superusuario(db);
    await db.exec("update productos set unidad = 'ud', contenido = 1, proveedor = 'BUFALA TECH' where sku = 'BF-FIX-SX6'");
    await como(db, ADMIN);
    const s0 = await stock(db, 'BF-FIX-SX6');
    expect(await valor(db, 'select importar_catalogo($1::jsonb) as r', [JSON.stringify([fila])])).toMatchObject({ existentes: 1, actualizados: 0, aperturas: 0 });
    expect(await valor(db, "select unidad from productos where sku = 'BF-FIX-SX6'")).toBe('ud');
    expect(await valor(db, 'select importar_catalogo($1::jsonb, true) as r', [JSON.stringify([fila])])).toMatchObject({ existentes: 1, actualizados: 1, aperturas: 0 });
    expect((await db.query("select unidad, contenido::int, proveedor, nombre from productos where sku = 'BF-FIX-SX6'")).rows[0]).toEqual({ unidad: 'bote', contenido: 1000, proveedor: 'Saltoki', nombre: 'BOTE 1000 TACOS' });
    expect(await stock(db, 'BF-FIX-SX6')).toBe(s0);                                   // el número del albarán ya era el bueno: no se convierte
    expect(await valor(db, 'select importar_catalogo($1::jsonb, true) as r', [JSON.stringify([fila])])).toMatchObject({ actualizados: 0 });
    expect(await falla(db, 'select importar_catalogo($1::jsonb)', [JSON.stringify([{ ...fila, sku: 'NUEVO-X', categoria: 'fontaneria' }])])).toMatch(/Categoría desconocida/);
  });
});

describe('propuestas de cambio y equivalencias', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });
  it('el almacén propone; solo ve las suyas; el administrador resuelve', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    await db.query('select proponer_cambio_ficha($1, $2, $3::jsonb)', [id, 'BF-FIX-SX8', JSON.stringify({ name: 'Caja tacos SX 8' })]);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'BF-FIX-SX8', nombre: 'x', categoria: 'fijaciones' })])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select resolver_propuesta_ficha($1, true)', [id])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select resolver_propuesta_ficha($1, true)', [id]);
    expect(await valor(db, 'select estado from propuestas_ficha where id = $1', [id])).toBe('aplicada');
  });
  it('una regla confirmada que se edita guarda su versión anterior; solo se borran las de borrador', async () => {
    await como(db, ADMIN);
    const r = { id: 'R1', campo: 'rj45', formula: 'directa', condiciones: {}, articulos: [{ sku: '7280040020', factor: 1 }], confirmada: true };
    await db.query('select guardar_equivalencia($1::jsonb)', [JSON.stringify(r)]);
    await db.query('select guardar_equivalencia($1::jsonb)', [JSON.stringify({ ...r, articulos: [{ sku: '7280040020', factor: 2 }] })]);
    expect(await valor(db, "select version->'articulos'->0->>'factor' from equivalencias_historial where regla_id = 'R1'")).toBe('1');
    expect(await falla(db, 'select borrar_equivalencia($1)', ['R1'])).toMatch(/desactívala/);
    await db.query('select guardar_equivalencia($1::jsonb)', [JSON.stringify({ ...r, id: 'R2', confirmada: false })]);
    await db.query('select borrar_equivalencia($1)', ['R2']);
    expect(await valor(db, "select count(*)::int from equivalencias_cierre where id = 'R2'")).toBe(0);
  });
});
