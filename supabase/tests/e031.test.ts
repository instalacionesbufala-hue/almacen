/* E-031 · Formatos en metros: rollo de 50 m. Conversión del stock al cambiar el formato (almacén y vehículos), consumo de un
   cierre en metros sobre un artículo en rollos, entrega por rollos y por metros sueltos, y recuento mixto (rollos + metros).
   Caso real: el corrugado 6200020032 estaba en "ud" (150 en el almacén, −18 en una furgoneta y 40 en otra), que eran metros. */
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../functions/_compartido/portal';
import type { Regla } from '../functions/_compartido/cierres';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const SKU = '6200020032';
const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
let db: BD;
const stock = async () => { await superusuario(db); return Number(await valor<string>(db, 'select stock::text from productos where sku = $1', [SKU])); };
const aBordo = async (veh: string) => { await superusuario(db); return Number(await valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, SKU]) ?? 0); };
const cambiar = async (unidad: string, contenido: number, uc: string, modo: string) => { await como(db, ADMIN); return valor<{ estado: string; stock: number }>(db, 'select cambiar_formato($1, $2, $3, $4, $5) as r', [SKU, unidad, contenido, uc, modo]); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: SKU, nombre: 'Tubo corrugado 32 mm', categoria: 'tubos', unidad: 'ud', contenido: 1, minimo: 100, nuevo: true, stock_inicial: 150 })]);
  await superusuario(db);
  await db.exec(`insert into stock_vehiculo (vehiculo_id, sku, unidades) values ('V-F02', '${SKU}', -18), ('V-F03', '${SKU}', 40);`);
});

describe('cambiar el formato convirtiendo el stock', () => {
  it('el caso real: "¿el stock está en metros?" → 3 rollos de 50 m; las furgonetas siguen en metros (−18 m = −0,36 rollos)', async () => {
    expect(await cambiar('rollo', 50, 'm', 'contenido')).toEqual({ estado: 'aplicado', stock: 3, vehiculos: expect.any(Array) });
    expect(await stock()).toBe(3);
    expect([await aBordo('V-F02'), await aBordo('V-F03')]).toEqual([-18, 40]);
    const p = (await db.query<{ unidad: string; contenido: string; unidad_contenido: string; minimo: string }>('select unidad, contenido::text, unidad_contenido, minimo::text from productos where sku = $1', [SKU])).rows[0];
    expect(p).toEqual({ unidad: 'rollo', contenido: '50.000', unidad_contenido: 'm', minimo: '2.000' });             // el mínimo de 100 m = 2 rollos
    // ajuste de conversión enlazado (sin cambio físico) y auditoría
    expect((await db.query("select cantidad::text, referencia from movimientos where sku = $1 and motivo = 'Conversión de formato'", [SKU])).rows)
      .toEqual([{ cantidad: '-147.000', referencia: '150 unidades → 3 rollo de 50 m (sin cambio físico)' }]);
    expect(await valor(db, "select detalle->'despues'->>'formato' from auditoria where accion = 'cambiar_formato'")).toBe('rollo de 50 m');
  });

  it('"ya está en rollos" (no convertir): el almacén no cambia y lo de las furgonetas se reescala a metros', async () => {
    await cambiar('rollo', 50, 'm', 'formato');
    expect(await stock()).toBe(150);
    expect([await aBordo('V-F02'), await aBordo('V-F03')]).toEqual([-900, 2000]);
    expect(await valor(db, "select count(*)::int from movimientos where sku = $1 and motivo = 'Conversión de formato' and vehiculo_id is not null", [SKU])).toBe(2);
  });

  it('cambiar el contenido (rollo de 50 → bobina de 500): 3 rollos = 0,3 bobinas; repetir no hace nada; con reservas, no', async () => {
    await cambiar('rollo', 50, 'm', 'contenido');
    await cambiar('bobina', 500, 'm', 'contenido');
    expect(await stock()).toBe(0.3);
    expect((await cambiar('bobina', 500, 'm', 'contenido')).estado).toBe('duplicado');
    await cambiar('rollo', 50, 'm', 'contenido');
    await como(db, ADMIN);
    await db.query(PREP, [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: SKU, cantidad: 1 }])]);
    await como(db, ADMIN);
    expect(await falla(db, 'select cambiar_formato($1, $2, $3, $4, $5)', [SKU, 'rollo', 100, 'm', 'contenido'])).toMatch(/entregas preparadas/);
  });
});

describe('con el artículo en rollos de 50 m', () => {
  beforeEach(async () => { await cambiar('rollo', 50, 'm', 'contenido'); });

  it('un cierre de 12 m descuenta 12 m de la furgoneta (0,24 rollos)', async () => {
    await como(db, ADMIN);
    const hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
    const reglas: Regla[] = [{ id: 'C', campo: 'corr32', formula: 'directa', condiciones: {}, articulos: [{ sku: SKU, factor: 1 }], estimada: false, activa: true, orden: 1 }];
    const r = await enviarCierre(db, hash, { numInst: 'E2639100', equipo: 'Búfala 3', fechaCierreIso: new Date().toISOString(), corr32: 12 }, { reglas, kits: {}, origen: 'wizard' });
    expect(r.diferencia).toEqual([{ sku: SKU, unidades: 12 }]);
    expect(await aBordo('V-F03')).toBe(28);
    expect(await valor(db, "select cantidad::text from movimientos where sku = $1 and tipo = 'consumo'", [SKU])).toBe('0.240');
  });

  it('entrega por rollos enteros; con "metros sueltos" se entregan metros (fracción de rollo)', async () => {
    await como(db, ADMIN);
    expect(await falla(db, PREP, [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: SKU, cantidad: 0.5 }])])).toMatch(/entero/);
    const id = uuid();
    await db.query(PREP, [id, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: SKU, cantidad: 2 }])]);
    await db.query('select confirmar_entrega($1, $2)', [id, 'data:image/png;base64,AA']);
    expect([await stock(), await aBordo('V-F01')]).toEqual([1, 100]);
    // metros sueltos: 15 m = 0,3 rollos
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: SKU, nombre: 'Tubo corrugado 32 mm', categoria: 'tubos', unidad: 'rollo', contenido: 50, unidad_contenido: 'm', metros_sueltos: true, minimo: 2 })]);
    const id2 = uuid();
    await db.query(PREP, [id2, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: SKU, cantidad: 0.3 }])]);
    await db.query('select confirmar_entrega($1, $2)', [id2, 'data:image/png;base64,AA']);
    expect([await stock(), await aBordo('V-F01')]).toEqual([0.7, 115]);
    // guardar la ficha sin esos campos (otra versión de la app) no los borra
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: SKU, nombre: 'Tubo corrugado 32 mm', categoria: 'tubos', unidad: 'rollo', contenido: 50, minimo: 2 })]);
    expect(await valor(db, "select unidad_contenido || ' ' || metros_sueltos from productos where sku = $1", [SKU])).toBe('m true');
  });

  it('recuento mixto: "2 rollos y 15 m" = 2,3 rollos, en el almacén y en la furgoneta', async () => {
    await como(db, ADMIN);
    await db.query('select registrar_recuento($1, $2, $3::jsonb)', [uuid(), 'tubos', JSON.stringify([{ sku: SKU, contado: 2.3 }])]);
    expect(await stock()).toBe(2.3);
    await como(db, ADMIN);
    await db.query('select registrar_recuento_vehiculo($1, $2, $3::jsonb)', [uuid(), 'V-F02', JSON.stringify([{ sku: SKU, contado: 2.3 }])]);
    expect(await aBordo('V-F02')).toBe(115);
    // un formato en unidades sigue exigiendo enteros en el almacén
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_recuento($1, $2, $3::jsonb)', [uuid(), 'fijaciones', JSON.stringify([{ sku: 'BF-FIX-SX8', contado: 2.5 }])])).toMatch(/entero/);
  });
});
