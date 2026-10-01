/* E-022 · Borrar (solo sin rastro), archivar, restaurar, deshacer fusión y códigos de archivados reutilizables */
import { describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const PROD = (sku: string, extra = {}) => JSON.stringify({ sku, nombre: `Artículo ${sku}`, categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, ...extra });
const stock = (db: BD, sku: string) => valor<number>(db, 'select stock::float from productos where sku = $1', [sku]);
const fila = async (db: BD, sku: string) => (await db.query<{ archivado: boolean; fusionado_en: string | null }>('select archivado, fusionado_en from productos where sku = $1', [sku])).rows[0];

describe('borrar y archivar', () => {
  it('sin rastro se borra; con rastro no, y el motivo dice qué la retiene', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('NUEVO-1')]);
    expect((await valor<{ borrable: boolean }>(db, 'select rastro_producto($1)', ['NUEVO-1'])).borrable).toBe(true);
    await db.query('select borrar_producto($1)', ['NUEVO-1']);
    expect(await valor(db, "select count(*)::int from productos where sku = 'NUEVO-1'")).toBe(0);
    // con 1 movimiento y 1 pendiente (lo que le pasó al usuario: el servidor la rechazaba y reaparecía)
    await db.query('select guardar_producto($1::jsonb)', [PROD('NUEVO-2', { stock_inicial: 1 })]);
    await como(db, ALMACEN);
    await db.query('select proponer_ajuste($1, $2, $3, $4)', [uuid(), 'NUEVO-2', -1, 'Contado dos veces']);
    await como(db, ADMIN);
    expect((await valor<{ texto: string }>(db, 'select rastro_producto($1)', ['NUEVO-2'])).texto).toBe('Tiene 1 movimiento y 1 pendiente en tu bandeja');
    expect(await falla(db, 'select borrar_producto($1)', ['NUEVO-2'])).toMatch(/No se puede borrar definitivamente: Tiene 1 movimiento y 1 pendiente en tu bandeja\. Archívala/);
  });
  it('archivar exige stock 0; el archivado deja de estar activo y queda quién y cuándo', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    expect(await falla(db, 'select archivar_producto($1)', ['6000650605'])).toMatch(/en el almacén: haz antes un ajuste/);
    await db.query('select ajustar_inventario($1, $2, $3, $4)', [uuid(), '6000650605', -420, 'Ya no se usa']);
    await db.query('select archivar_producto($1, $2)', ['6000650605', 'Ya no se usa']);
    expect((await db.query('select archivado, archivado_por, archivado_ts is not null as cuando from productos where sku = $1', ['6000650605'])).rows[0]).toEqual({ archivado: true, archivado_por: 'Admin Pruebas', cuando: true });
    // restaurar: vuelve con su código
    await db.query('select restaurar_producto($1)', ['6000650605']);
    expect(await fila(db, '6000650605')).toEqual({ archivado: false, fusionado_en: null });
  });
});

describe('los archivados no bloquean su código', () => {
  it('el caso del Trydan: código fusionado (archivado) → cambiar el código del activo a ese código', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('TRY32-1-L10-P', { stock_inicial: 6 })]);
    await db.query('select guardar_producto($1::jsonb)', [PROD('8900500020')]);
    await db.query('select fusionar_productos($1, $2, $3)', ['8900500020', 'TRY32-1-L10-P', 'Era el mismo']);
    expect(await fila(db, '8900500020')).toEqual({ archivado: true, fusionado_en: 'TRY32-1-L10-P' });
    await db.query('select cambiar_codigo_producto($1, $2)', ['TRY32-1-L10-P', '8900500020']);
    expect(await fila(db, '8900500020')).toEqual({ archivado: false, fusionado_en: null });
    expect(await fila(db, 'TRY32-1-L10-P')).toEqual({ archivado: true, fusionado_en: '8900500020' });
    expect(await stock(db, '8900500020')).toBe(6);
    expect(await valor(db, "select nombre from productos where sku = '8900500020'")).toBe('Artículo TRY32-1-L10-P');
  });
  it('alta e importación con el código de un archivado lo reactivan; con un activo el mensaje dice cuál es', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select fusionar_productos($1, $2, $3)', ['6000650604', '6000650601', '']);
    await db.query('select guardar_producto($1::jsonb)', [PROD('6000650604', { nombre: 'Cable azul nuevo', stock_inicial: 3 })]);
    expect(await fila(db, '6000650604')).toEqual({ archivado: false, fusionado_en: null });
    expect(await stock(db, '6000650604')).toBe(3);
    await db.query('select fusionar_productos($1, $2, $3)', ['6000650604', '6000650601', '']);
    await db.query('select importar_catalogo($1::jsonb)', [JSON.stringify([{ sku: '6000650604', nombre: 'Otra vez', categoria: 'cables', unidad: 'm' }])]);
    expect(await valor(db, "select nombre from productos where sku = '6000650604' and not archivado")).toBe('Otra vez');
    expect(await falla(db, 'select cambiar_codigo_producto($1, $2)', ['6000650605', '6000650601'])).toMatch(/Ya existe un artículo activo con el código 6000650601: Cable H07Z1-K/);
  });
});

describe('deshacer una fusión', () => {
  it('revierte los ajustes enlazados si el destino aún tiene lo recibido; si no, lo explica', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select fusionar_productos($1, $2, $3)', ['6000650604', '6000650601', 'Error']);            // 180 m pasan a 6000650601 (350 → 530)
    expect(await stock(db, '6000650601')).toBe(530);
    await db.query('select deshacer_fusion($1)', ['6000650604']);
    expect(await fila(db, '6000650604')).toEqual({ archivado: false, fusionado_en: null });
    expect([await stock(db, '6000650604'), await stock(db, '6000650601')]).toEqual([180, 350]);
    // otra vez, pero el destino ya ha gastado lo recibido
    await db.query('select fusionar_productos($1, $2, $3)', ['6000650604', '6000650601', 'Error']);
    await db.query('select ajustar_inventario($1, $2, $3, $4)', [uuid(), '6000650601', -500, 'Consumido']);
    expect(await falla(db, 'select deshacer_fusion($1)', ['6000650604'])).toMatch(/ya no tiene las 180 m que recibió/);
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'deshacer_fusion'")).toBe(1);
  });
});
