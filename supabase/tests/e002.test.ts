/* E-002 · Pruebas de la base de datos: funciones atómicas, idempotencia, RLS e historial inalterable */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, INACTIVO, anonimo, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8) as r';
const stock = (db: BD, sku: string) => valor<string>(db, 'select stock::text from productos where sku = $1', [sku]).then(Number);

describe('movimientos', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('una salida descuenta stock y queda a nombre del usuario con sesión', async () => {
    const id = uuid();
    const r = await valor<{ estado: string; stock: number }>(db, MOV, [id, 'BF-FIX-SX8', 'salida', 100, 'Obra / instalación', 'C/ Eros 10', [], null]);
    expect(r.estado).toBe('aplicado');
    expect(await stock(db, 'BF-FIX-SX8')).toBe(1100);
    expect(await valor(db, 'select operario from movimientos where id = $1', [id])).toBe('Operario Pruebas');
  });
  it('reenviar el mismo movimiento (sin cobertura) no lo duplica', async () => {
    const id = uuid();
    await db.query(MOV, [id, 'BF-FIX-SX8', 'salida', 10, 'Obra', '', [], null]);
    const r = await valor<{ estado: string }>(db, MOV, [id, 'BF-FIX-SX8', 'salida', 10, 'Obra', '', [], null]);
    expect(r.estado).toBe('duplicado');
    expect(await stock(db, 'BF-FIX-SX8')).toBe(1090);
  });
  it('rechaza una salida mayor que el stock con un motivo legible', async () => {
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX6', 'salida', 81, 'Obra', '', [], null])).toMatch(/Solo hay 80 ud de Taco nylon SX 6/);
    expect(await stock(db, 'BF-FIX-SX6')).toBe(80);
  });
  it('los cargadores exigen un n.º de serie por unidad, sin duplicados', async () => {
    expect(await falla(db, MOV, [uuid(), 'BF-VE-POL74', 'entrada', 2, 'Compra', '', ['X-1'], null])).toMatch(/n.º de serie/);
    expect(await falla(db, MOV, [uuid(), 'BF-VE-POL74', 'entrada', 1, 'Compra', '', ['PCH74-26-0412'], null])).toMatch(/ya está en stock/);
    expect(await falla(db, MOV, [uuid(), 'BF-VE-POL74', 'salida', 1, 'Obra', 'C/ Eros 10', ['NO-EXISTE'], null])).toMatch(/no está en stock/);
    await db.query(MOV, [uuid(), 'BF-VE-POL74', 'salida', 1, 'Obra', 'C/ Eros 10', ['PCH74-26-0412'], null]);
    expect(await stock(db, 'BF-VE-POL74')).toBe(1);
    expect(await valor(db, "select en_stock from series where serie = 'PCH74-26-0412'")).toBe(false);
  });
  it('el almacén no puede hacer ajustes; el administrador sí, con motivo', async () => {
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'ajuste', -5, 'Recuento', '', [], null])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'ajuste', -5, '  ', '', [], null])).toMatch(/motivo/);
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'ajuste', -5, 'Recuento pasillo P03', '', [], null]);
    expect(await stock(db, 'BF-FIX-SX8')).toBe(1085);
    await como(db, ALMACEN);
  });
  it('una entrada que recupera el mínimo cierra el pedido de reposición', async () => {
    await db.query('select marcar_pedido($1, $2)', ['BF-FIX-SX6', 200]);
    await db.query(MOV, [uuid(), 'BF-FIX-SX6', 'entrada', 10, 'Compra', '', [], null]);
    expect(await valor(db, "select count(*)::int from pedidos_reposicion where sku = 'BF-FIX-SX6'")).toBe(1);
    await db.query(MOV, [uuid(), 'BF-FIX-SX6', 'entrada', 20, 'Compra', '', [], null]);
    expect(await valor(db, "select count(*)::int from pedidos_reposicion where sku = 'BF-FIX-SX6'")).toBe(0);
  });
});

describe('seguridad', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('sin sesión no se ve ni se escribe nada', async () => {
    await anonimo(db);
    expect(await falla(db, 'select * from productos')).toMatch(/permission denied/);
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'salida', 1, 'x', '', [], null])).toMatch(/permission denied/);
  });
  it('con sesión no se puede escribir directamente en las tablas: solo mediante funciones', async () => {
    await como(db, ADMIN);
    expect(await falla(db, "update productos set stock = 9999 where sku = 'BF-FIX-SX8'")).toMatch(/permission denied/);
    expect(await falla(db, "insert into movimientos (id, sku, tipo, cantidad, motivo, operario) values (gen_random_uuid(), 'BF-FIX-SX8', 'entrada', 1, 'x', 'x')")).toMatch(/permission denied/);
    expect(await falla(db, "delete from productos where sku = 'BF-FIX-SX8'")).toMatch(/permission denied/);
    expect(await falla(db, 'select _aplicar_movimiento(null, gen_random_uuid(), $1, $2, 1, $3, $4, $5, null, null, null, null)', ['BF-FIX-SX8', 'entrada', 'x', '', []])).toMatch(/permission denied/);
  });
  it('un usuario desactivado no ve datos ni puede registrar', async () => {
    await como(db, INACTIVO);
    expect((await db.query('select * from productos')).rows).toHaveLength(0);
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'salida', 1, 'x', '', [], null])).toMatch(/sin acceso o desactivado/);
  });
  it('el almacén no ve precios ni costes; el administrador sí', async () => {
    await como(db, ALMACEN);
    expect((await db.query('select * from costes_producto')).rows).toHaveLength(0);
    expect((await db.query('select * from costes_dotacion')).rows).toHaveLength(0);
    expect((await db.query('select * from productos')).rows.length).toBeGreaterThan(20);
    await como(db, ADMIN);
    expect((await db.query('select * from costes_producto')).rows.length).toBeGreaterThan(20);
  });
  it('el historial no se puede editar ni borrar, tampoco el administrador del panel', async () => {
    await como(db, ADMIN);
    const id = uuid();
    await db.query(MOV, [id, 'BF-FIX-SX8', 'salida', 1, 'Obra', '', [], null]);
    await superusuario(db);
    expect(await falla(db, 'update movimientos set cantidad = 500 where id = $1', [id])).toMatch(/no se puede modificar/);
    expect(await falla(db, 'delete from movimientos where id = $1', [id])).toMatch(/no se puede modificar/);
    expect(await falla(db, 'truncate movimientos cascade')).toMatch(/no se puede modificar/);
  });
});

describe('entregas', () => {
  let db: BD;
  const ENT = 'select registrar_entrega($1, $2, $3, $4::jsonb, $5) as r';
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('registra la entrega, descuenta stock, mueve las series a la furgoneta y calcula la huella en el servidor', async () => {
    const id = uuid();
    const lineas = JSON.stringify([{ sku: 'WBX-PULSAR-22', cantidad: 1, series: ['WBX-22-899281'] }, { sku: 'CAB-RZ1K-5G6', cantidad: 50, series: [] }]);
    const r = await valor<{ estado: string; numero: string; hash: string }>(db, ENT, [id, 'F01', 'T1', lineas, 'data:image/png;base64,AAAA']);
    expect(r.estado).toBe('aplicado');
    expect(r.numero).toMatch(/^ENT-\d{4}-0414$/);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await stock(db, 'CAB-RZ1K-5G6')).toBe(750);
    expect(await valor(db, "select equipo_id from series where serie = 'WBX-22-899281'")).toBe('F01');
    expect(await valor(db, "select count(*)::int from movimientos where entrega_id = $1", [id])).toBe(2);
    const reenvio = await valor<{ estado: string; numero: string }>(db, ENT, [id, 'F01', 'T1', lineas, 'data:image/png;base64,AAAA']);
    expect(reenvio).toMatchObject({ estado: 'duplicado', numero: r.numero });
  });
  it('es todo o nada: si una línea falla no se aplica ninguna', async () => {
    const antes = await stock(db, 'CAB-RZ1K-5G6');
    const lineas = JSON.stringify([{ sku: 'CAB-RZ1K-5G6', cantidad: 10 }, { sku: 'BF-FIX-SX6', cantidad: 9999 }]);
    expect(await falla(db, ENT, [uuid(), 'F01', 'T1', lineas, 'firma'])).toMatch(/Solo hay/);
    expect(await stock(db, 'CAB-RZ1K-5G6')).toBe(antes);
  });
  it('exige firma y un receptor del propio equipo', async () => {
    const l = JSON.stringify([{ sku: 'CAB-RZ1K-5G6', cantidad: 1 }]);
    expect(await falla(db, ENT, [uuid(), 'F01', 'T1', l, ''])).toMatch(/firma/);
    expect(await falla(db, ENT, [uuid(), 'F01', 'T3', l, 'firma'])).toMatch(/no pertenece a ese equipo/);
  });
  it('detecta una entrega alterada a mano en la base de datos', async () => {
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.every(r => r.ok)).toBe(true);
    await superusuario(db);
    await db.exec("alter table entregas disable trigger entregas_inalterables; update entregas set dni = 'otro'; alter table entregas enable trigger entregas_inalterables;");
    await como(db, ADMIN);
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.some(r => !r.ok)).toBe(true);
  });
});

describe('albaranes y catálogo', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });
  const ALB = 'select aprobar_albaran($1, $2::jsonb, $3::jsonb) as r';

  it('aprueba el albarán: suma todas las líneas y guarda el resumen', async () => {
    const id = uuid();
    const r = await valor<{ lineas: number }>(db, ALB, [id, JSON.stringify({ numero: 'ALB-1', proveedor: 'Distribuciones Eléctricas S.L.' }),
      JSON.stringify([{ sku: 'SCH-IC60N-40', cantidad: 25 }, { sku: 'WBX-PULSAR-22', cantidad: 1, series: ['WBX-22-900001'] }])]);
    expect(r.lineas).toBe(2);
    expect(await stock(db, 'SCH-IC60N-40')).toBe(26);
    expect(await valor(db, 'select unidades::int from albaranes where id = $1', [id])).toBe(26);
  });
  it('si una línea no es válida no ingresa nada', async () => {
    expect(await falla(db, ALB, [uuid(), '{}', JSON.stringify([{ sku: 'SCH-IC60N-40', cantidad: 5 }, { sku: 'NO-EXISTE', cantidad: 1 }])])).toMatch(/no encontrado/);
    expect(await stock(db, 'SCH-IC60N-40')).toBe(26);
  });
  it('solo el administrador crea o edita referencias', async () => {
    const prod = JSON.stringify({ sku: 'nuevo-1', nuevo: true, nombre: 'Prueba', categoria: 'fijaciones', unidad: 'ud', ubicacion: 'P03-E01-N1', precio: 1.5, stock_inicial: 10 });
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [prod])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [prod]);
    expect(await stock(db, 'NUEVO-1')).toBe(10);
    expect(await valor(db, "select precio::float from costes_producto where sku = 'NUEVO-1'")).toBe(1.5);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [prod])).toMatch(/Ya existe/);
  });
});

describe('dotación', () => {
  let db: BD;
  const INC = 'select registrar_incidencia($1, $2, $3, $4, $5, $6, $7) as r';
  beforeAll(async () => { db = await nuevaBD(); });

  it('el almacén registra roturas; reparar o reponer es del administrador', async () => {
    await como(db, ALMACEN);
    await db.query(INC, [uuid(), 'H002', 'rotura', 'Se cayó del andamio', null, null, null]);
    expect(await valor(db, "select estado from dotacion where id = 'H002'")).toBe('rota');
    expect(await falla(db, INC, [uuid(), 'H002', 'reparacion', '', 85, null, null])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query(INC, [uuid(), 'H002', 'reparacion', 'Taller Hilti', 85, null, null]);
    expect(await valor(db, "select estado from dotacion where id = 'H002'")).toBe('operativa');
    expect(await valor(db, 'select sum(coste)::int from costes_incidencia')).toBe(85);
  });
  it('una pérdida solo se resuelve reponiendo, con otro n.º de serie y nueva caducidad', async () => {
    await como(db, ADMIN);
    await db.query(INC, [uuid(), 'E003', 'perdida', '', null, null, null]);
    expect(await falla(db, INC, [uuid(), 'E003', 'reparacion', '', null, null, null])).toMatch(/No se puede registrar/);
    expect(await falla(db, INC, [uuid(), 'E003', 'reposicion', '', null, 'IR-5000-2291', null])).toMatch(/otro n.º de serie/);
    await db.query(INC, [uuid(), 'E003', 'reposicion', 'Proveedor EPIs', 180, 'IR-5000-9001', '2031-01-01']);
    const d = (await db.query<{ estado: string; serie: string; caduca: string }>("select estado, serie, caduca::text from dotacion where id = 'E003'")).rows[0];
    expect(d).toEqual({ estado: 'operativa', serie: 'IR-5000-9001', caduca: '2031-01-01' });
    expect(await valor(db, "select serie_anterior from dotacion_historial where dotacion_id = 'E003' and tipo = 'reposicion'")).toBe('IR-5000-2291');
  });
  it('la baja libera la asignación', async () => {
    await como(db, ADMIN);
    await db.query(INC, [uuid(), 'H006', 'baja', 'Irreparable', null, null, null]);
    const d = (await db.query<{ equipo_id: string | null; tecnico_id: string | null }>("select equipo_id, tecnico_id from dotacion where id = 'H006'")).rows[0];
    expect(d).toEqual({ equipo_id: null, tecnico_id: null });
    expect(await falla(db, 'select asignar_dotacion($1, $2, $3, $4)', [uuid(), 'H006', 'F01', null])).toMatch(/baja/);
  });
  it('asignar a un técnico toma su equipo', async () => {
    await como(db, ADMIN);
    await db.query('select asignar_dotacion($1, $2, $3, $4)', [uuid(), 'H001', null, 'T3']);
    const d = (await db.query<{ equipo_id: string; tecnico_id: string }>("select equipo_id, tecnico_id from dotacion where id = 'H001'")).rows[0];
    expect(d).toEqual({ equipo_id: 'F02', tecnico_id: 'T3' });
  });
});

describe('custodia de Esmove (E-008)', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });
  it('los artículos en custodia no tienen precio (null, no 0)', async () => {
    await como(db, ADMIN);
    expect(await valor(db, "select count(*)::int from productos p join costes_producto c using (sku) where p.propiedad = 'custodia' and c.precio is not null")).toBe(0);
    expect(await valor(db, "select count(*)::int from productos where propiedad = 'custodia' and propietario_id = 'ESMOVE'")).toBeGreaterThan(4);
  });
  it('una salida de custodia sin obra de destino se rechaza en el servidor', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, MOV, [uuid(), 'ESM-CPVE-MONO', 'salida', 1, 'Instalado en obra', '', [], null])).toMatch(/obra o instalación de destino.*Esmove/);
    await db.query(MOV, [uuid(), 'ESM-CPVE-MONO', 'salida', 1, 'Instalado en obra', 'Garaje C/ Recogidas 12', [], null]);
    expect(await stock(db, 'ESM-CPVE-MONO')).toBe(2);
  });
  it('los cargadores no pueden quedar sin n.º de serie; los cuadros se mueven por cantidad', async () => {
    await superusuario(db);
    expect(await falla(db, "update productos set con_serie = false where sku = 'WBX-PULSAR-22'")).toMatch(/check constraint/);
    await como(db, ALMACEN);
    await db.query(MOV, [uuid(), 'ESM-CPVE-TRI', 'entrada', 3, 'Recepción en custodia', 'Alb. Esmove 7', [], null]);
    expect(await stock(db, 'ESM-CPVE-TRI')).toBe(4);
    expect(await falla(db, MOV, [uuid(), 'ESM-CPVE-TRI', 'salida', 1, 'Instalado en obra', 'Obra', ['X-1'], null])).toMatch(/no lleva control por n.º de serie/);
  });
  it('al guardar un artículo en custodia el precio se guarda vacío aunque se envíe', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'ESM-X', nuevo: true, nombre: 'Cuadro prueba', categoria: 'cuadros', unidad: 'ud', ubicacion: 'P06-E05-N1', precio: 120, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
    expect(await valor(db, "select precio from costes_producto where sku = 'ESM-X'")).toBeNull();
    expect(await valor(db, "select con_serie from productos where sku = 'ESM-X'")).toBe(false); // los cuadros no llevan n.º de serie
  });
});
