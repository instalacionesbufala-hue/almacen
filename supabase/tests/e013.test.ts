/* E-013 · Datos reales: sin importes, almacén + vehículos, historial de asignaciones, formatos enteros, borrado de la demo e importación */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r';
const mover = (db: BD, sku: string, tipo: string, cantidad: number, vehiculo: string | null = null, motivo = 'Prueba') =>
  db.query(MOV, [uuid(), sku, tipo, cantidad, motivo, '', [], null, null, vehiculo]);
const stock = (db: BD, sku: string) => valor<string>(db, 'select stock::text from productos where sku = $1', [sku]).then(Number);
const abordo = (db: BD, veh: string, sku: string) =>
  valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]).then(v => Number(v ?? 0));
/** Stock total en unidades de contenido: almacén (formatos × contenido) + todos los vehículos */
const total = (db: BD, sku: string) => valor<string>(db,
  'select (p.stock * p.contenido + coalesce((select sum(unidades) from stock_vehiculo s where s.sku = p.sku), 0))::text from productos p where p.sku = $1', [sku]).then(Number);

describe('sin importes', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ADMIN); });

  it('ninguna tabla de costes tiene datos y dar de alta con precio no lo guarda', async () => {
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'X-1', nuevo: true, nombre: 'Sobre 10 conectores', categoria: 'aparamenta', unidad: 'sobre', contenido: 10, precio: 3.5, stock_inicial: 2 })]);
    await superusuario(db);
    for (const t of ['costes_producto', 'costes_dotacion', 'costes_incidencia'])
      expect(await valor(db, `select count(*)::int from ${t}`)).toBe(0);
  });
  it('una merma no calcula valor: se aplica y avisa (sin "€" en el aviso)', async () => {
    await como(db, ALMACEN);
    await mover(db, 'X-1', 'merma', 1, null, 'Rotura o daño');
    await superusuario(db);
    const cuerpos = (await db.query<{ cuerpo: string }>("select cuerpo from envios_aviso where tipo = 'merma'")).rows.map(r => r.cuerpo).join(' ');
    expect(cuerpos).toMatch(/merma/);
    expect(cuerpos).not.toMatch(/€/);
  });
});

describe('almacén y vehículos', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('un traspaso al vehículo no cambia el stock total; la devolución tampoco', async () => {
    const antes = await total(db, 'BF-FIX-SX8');
    await mover(db, 'BF-FIX-SX8', 'traspaso', 2, 'V-F02', 'Carga del vehículo');
    expect(await stock(db, 'BF-FIX-SX8')).toBe(10);
    expect(await abordo(db, 'V-F02', 'BF-FIX-SX8')).toBe(200);          // 2 cajas de 100
    expect(await total(db, 'BF-FIX-SX8')).toBe(antes);
    await mover(db, 'BF-FIX-SX8', 'devolucion', 1, 'V-F02', 'Devolución al almacén');
    expect(await stock(db, 'BF-FIX-SX8')).toBe(11);
    expect(await abordo(db, 'V-F02', 'BF-FIX-SX8')).toBe(100);
    expect(await total(db, 'BF-FIX-SX8')).toBe(antes);
  });
  it('el almacén mueve formatos enteros; los metros admiten decimales', async () => {
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX6', 'traspaso', 0.5, 'Carga', '', [], null, null, 'V-F01'])).toMatch(/bote entero/);
    expect(await falla(db, MOV, [uuid(), '7280040020', 'salida', 1.5, 'Obra', '', [], null, null, null])).toMatch(/entero/);
    await mover(db, 'CAB-RZ1K-5G6', 'traspaso', 12.5, 'V-F01');
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(162.5);
  });
  it('no se devuelve más de lo que lleva el vehículo', async () => {
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'devolucion', 5, 'Devolución', '', [], null, null, 'V-F02'])).toMatch(/solo lleva 1 caja/);
  });
  it('un traspaso exige vehículo', async () => {
    expect(await falla(db, MOV, [uuid(), 'BF-FIX-SX8', 'traspaso', 1, 'Carga', '', [], null, null, null])).toMatch(/Indica el vehículo/);
  });
  it('un cargador se mueve por cantidad, sin n.º de serie', async () => {
    await mover(db, 'WBX-PULSAR-22', 'traspaso', 1, 'V-F02');
    expect(await abordo(db, 'V-F02', 'WBX-PULSAR-22')).toBe(1);
    expect(await valor(db, "select count(*)::int from movimientos where sku = 'WBX-PULSAR-22' and cardinality(series) > 0")).toBe(0);
  });
});

describe('historial de asignaciones', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ADMIN); });

  it('un técnico cambia de equipo: queda el historial y no se mueve material', async () => {
    const antes = await abordo(db, 'V-F01', 'CAB-RZ1K-5G6');
    await db.query('select asignar_tecnico($1, $2)', ['T2', 'F03']);
    const h = (await db.query<{ equipo_id: string; abierta: boolean }>("select equipo_id, hasta is null as abierta from asignaciones_tecnico where tecnico_id = 'T2' order by desde")).rows;
    expect(h).toEqual([{ equipo_id: 'F01', abierta: false }, { equipo_id: 'F03', abierta: true }]);
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(antes);
    expect(await valor(db, "select equipo_id from tecnicos where id = 'T2'")).toBe('F03');
  });
  it('un vehículo cambia de equipo con su stock; un cierre con fecha anterior usa el vehículo de entonces', async () => {
    const antes = await valor<string>(db, "select (now() - interval '1 day')::text");
    await db.query('select asignar_vehiculo($1, $2)', ['V-F01', 'F02']);        // F02 tenía V-F02: queda sin equipo
    expect(await valor(db, "select equipo_id from vehiculos where id = 'V-F02'")).toBeNull();
    expect(await valor(db, "select vehiculo_de_equipo('F02')")).toBe('V-F01');
    expect(await valor(db, "select vehiculo_de_equipo('F01')")).toBeNull();
    expect(await valor(db, 'select vehiculo_de_equipo($1, $2::timestamptz)', ['F01', antes])).toBe('V-F01');
    expect(await valor(db, 'select vehiculo_de_equipo($1, $2::timestamptz)', ['F02', antes])).toBe('V-F02');
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(150);              // el material va con el vehículo
  });
  it('una entrega a un equipo sin vehículo no se puede preparar', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb)', [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: 5 }])]))
      .toMatch(/vehículo/);
  });
  it('dar de baja un vehículo con material no se puede; el historial no se borra', async () => {
    await como(db, ADMIN);
    expect(await falla(db, 'select baja_vehiculo($1)', ['V-F01'])).toMatch(/aún lleva material/);
    await db.query('select baja_tecnico($1)', ['T4']);
    expect(await valor(db, "select count(*)::int from asignaciones_tecnico where tecnico_id = 'T4'")).toBe(1);
    expect(await valor(db, "select count(*)::int from asignaciones_tecnico where tecnico_id = 'T4' and hasta is null")).toBe(0);
  });
  it('solo el administrador asigna', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select asignar_vehiculo($1, $2)', ['V-F03', 'F01'])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select asignar_tecnico($1, $2)', ['T1', 'F03'])).toMatch(/Solo el administrador/);
  });
});

describe('borrado de la demostración e importación del catálogo', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  const filas = [
    { sku: 'real-1', ref_proveedor: '1000', nombre: 'Bote 500 tacos', categoria: 'fijaciones', propiedad: 'propia', propietario: '', proveedor: 'Saltoki', unidad: 'bote', contenido: 500, stock_inicial: 4, minimo: 2, albaranes: 'A-1' },
    { sku: 'REAL-2', ref_proveedor: '', nombre: 'Cable 3G2,5', categoria: 'cables', propiedad: 'propia', propietario: '', proveedor: 'Saltoki', unidad: 'm', contenido: 1, stock_inicial: 100, minimo: null, albaranes: 'A-2' },
    { sku: 'REAL-3', ref_proveedor: 'CP-1', nombre: 'Cuadro VE', categoria: 'cuadros', propiedad: 'custodia', propietario: 'Esmove', proveedor: 'Esmove', unidad: 'ud', contenido: 1, stock_inicial: 3, minimo: 1, albaranes: 'E-7' },
  ];

  it('solo el administrador borra la demo', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select limpiar_demostracion()')).toMatch(/Solo el administrador/);
  });
  it('borra los datos de ejemplo una sola vez (y devuelve las fotos para limpiar el almacenamiento)', async () => {
    await como(db, ADMIN);
    await db.query("select poner_foto('BF-FIX-SX8', 'productos/BF-FIX-SX8/a.webp', 'productos/BF-FIX-SX8/a-mini.webp', 'propia')");
    const r = await valor<{ estado: string; borrado: { productos: number }; fotos: string[] }>(db, 'select limpiar_demostracion() as r');
    expect(r.estado).toBe('aplicado');
    expect(r.borrado.productos).toBeGreaterThan(20);
    expect(r.fotos.sort()).toEqual(['productos/BF-FIX-SX8/a-mini.webp', 'productos/BF-FIX-SX8/a.webp']);
    for (const t of ['productos', 'movimientos', 'entregas', 'equipos', 'tecnicos', 'vehiculos', 'dotacion', 'stock_vehiculo', 'asignaciones_vehiculo'])
      expect(await valor(db, `select count(*)::int from ${t}`)).toBe(0);
    expect(await valor(db, 'select count(*)::int from perfiles')).toBeGreaterThan(0);          // los usuarios se quedan
    expect(await valor(db, 'select count(*)::int from propietarios')).toBe(1);                  // Esmove se queda
    expect(await valor(db, 'select modo_demo from config_app')).toBe(false);
    expect(await falla(db, 'select limpiar_demostracion()')).toMatch(/ya se borraron/);
  });
  it('fuera de la limpieza, el historial sigue siendo inalterable', async () => {
    await superusuario(db);
    expect(await falla(db, 'truncate table entrega_lineas')).toMatch(/no se puede modificar/);
  });
  it('importa el catálogo con su inventario de apertura; repetir no duplica nada', async () => {
    await como(db, ADMIN);
    const r = await valor<{ nuevos: number; existentes: number; aperturas: number }>(db, 'select importar_catalogo($1::jsonb) as r', [JSON.stringify(filas)]);
    expect(r).toMatchObject({ nuevos: 3, existentes: 0, aperturas: 3 });
    expect(await stock(db, 'REAL-1')).toBe(4);
    expect(await valor(db, "select contenido::int from productos where sku = 'REAL-1'")).toBe(500);
    expect(await valor(db, "select minimo_definido from productos where sku = 'REAL-2'")).toBe(false);   // mínimo por completar
    expect(await valor(db, "select propietario_id from productos where sku = 'REAL-3'")).toBe('ESMOVE');
    expect(await valor(db, "select referencia from movimientos where sku = 'REAL-3'")).toBe('Albaranes E-7');
    const r2 = await valor<{ nuevos: number; existentes: number; aperturas: number }>(db, 'select importar_catalogo($1::jsonb) as r', [JSON.stringify(filas)]);
    expect(r2).toMatchObject({ nuevos: 0, existentes: 3, aperturas: 0 });
    expect(await stock(db, 'REAL-1')).toBe(4);
    expect(await valor(db, 'select count(*)::int from movimientos')).toBe(3);
  });
  it('rechaza unidades o propietarios desconocidos sin importar nada a medias', async () => {
    const malas = [{ ...filas[0], sku: 'REAL-9' }, { ...filas[0], sku: 'REAL-10', unidad: 'saco' }];
    expect(await falla(db, 'select importar_catalogo($1::jsonb)', [JSON.stringify(malas)])).toMatch(/Unidad desconocida en REAL-10: saco/);
    expect(await valor(db, "select count(*)::int from productos where sku = 'REAL-9'")).toBe(0);
    expect(await falla(db, 'select importar_catalogo($1::jsonb)', [JSON.stringify([{ ...filas[2], sku: 'REAL-11', propietario: 'Otro' }])])).toMatch(/Propietario desconocido/);
    await como(db, ALMACEN);
    expect(await falla(db, 'select importar_catalogo($1::jsonb)', [JSON.stringify(filas)])).toMatch(/Solo el administrador/);
  });
});
