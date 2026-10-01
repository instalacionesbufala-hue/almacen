/* E-023 · Cambiar el código de un artículo CON EAN (fallo real del usuario: "productos_ean_key") y mensaje claro de EAN repetido */
import { describe, expect, it } from 'vitest';
import { ADMIN, como, falla, nuevaBD, valor } from './pg';

const PROD = (sku: string, extra = {}) => JSON.stringify({ sku, nombre: `Artículo ${sku}`, categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, ...extra });
const ean = (db: Awaited<ReturnType<typeof nuevaBD>>, sku: string) => valor<string | null>(db, 'select ean from productos where sku = $1', [sku]);

describe('cambiar el código de un artículo que tiene EAN', () => {
  it('el caso del Trydan con EAN: al código de un archivado (reactivación)', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('TRY32-1-L10-P', { stock_inicial: 6, ean: '8436000000017' })]);
    await db.query('select guardar_producto($1::jsonb)', [PROD('8900500020')]);
    await db.query('select fusionar_productos($1, $2, $3)', ['8900500020', 'TRY32-1-L10-P', 'Era el mismo']);
    await db.query('select cambiar_codigo_producto($1, $2)', ['TRY32-1-L10-P', '8900500020']);
    expect(await ean(db, '8900500020')).toBe('8436000000017');
    expect(await ean(db, 'TRY32-1-L10-P')).toBeNull();
    expect(await valor(db, "select stock::float from productos where sku = '8900500020'")).toBe(6);
  });
  it('a un código nuevo que no existe (inserción)', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('VIEJO-1', { stock_inicial: 2, ean: '8436000000024' })]);
    await db.query('select cambiar_codigo_producto($1, $2)', ['VIEJO-1', 'NUEVO-1']);
    expect(await ean(db, 'NUEVO-1')).toBe('8436000000024');
    expect(await ean(db, 'VIEJO-1')).toBeNull();
  });
  it('un EAN que ya tiene otro artículo da un mensaje en español que dice cuál', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('A-1', { ean: '8436000000031' })]);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [PROD('B-1', { ean: '8436000000031' })])).toMatch(/El EAN 8436000000031 ya lo tiene el artículo A-1/);
  });
});
