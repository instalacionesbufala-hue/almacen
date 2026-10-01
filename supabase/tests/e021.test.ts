/* E-021 · Formato de SKU en el servidor, rutas de foto con clave segura y reparación de un SKU antiguo no válido */
import { describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, leer, nuevaBD, superusuario, valor } from './pg';

const PROD = (sku: string, extra = {}) => JSON.stringify({ sku, nombre: 'Prueba', categoria: 'fijaciones', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, ...extra });
const PONER = 'select poner_foto($1, $2, $3, $4) as r';

describe('formato de SKU en el servidor', () => {
  it('rechaza un SKU con URL, espacios o demasiado corto en el alta, la importación y el cambio de código', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [PROD('http://tag.yt/zeSA7')])).toMatch(/no es válido.*letras, números/);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [PROD('CON ESPACIO')])).toMatch(/no es válido/);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [PROD('A')])).toMatch(/no es válido/);
    expect(await falla(db, 'select importar_catalogo($1::jsonb)', [JSON.stringify([{ sku: 'X/Y', nombre: 'a', categoria: 'fijaciones', unidad: 'ud' }])])).toMatch(/no es válido/);
    expect(await falla(db, 'select cambiar_codigo_producto($1, $2)', ['6000650605', 'NUEVO:1'])).toMatch(/no es válido/);
    await db.query('select guardar_producto($1::jsonb)', [PROD('A.B_C-1')]);
    // tampoco el código alternativo de otro artículo
    await db.query('select asociar_codigo($1, $2, $3)', ['8412345678905', '6000650605', 'EAN']);
    expect(await falla(db, 'select cambiar_codigo_producto($1, $2)', ['6000650604', '8412345678905'])).toMatch(/código alternativo/);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [PROD('8412345678905')])).toMatch(/código alternativo/);
    expect(await valor(db, "select count(*)::int from productos where sku = 'A.B_C-1'")).toBe(1);
  });
  it('foto de un SKU con punto y guion: la carpeta es el propio SKU', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('SAL.DIF-40')]);
    await superusuario(db); expect(await valor(db, "select _clave_sku('SAL.DIF-40')")).toBe('SAL.DIF-40');
    await como(db, ALMACEN);
    expect(await valor(db, 'select puede_subir_foto($1)', ['productos/SAL.DIF-40/m1.webp'])).toBe(true);
    expect((await valor<{ estado: string }>(db, PONER, ['SAL.DIF-40', 'productos/SAL.DIF-40/m1.webp', 'productos/SAL.DIF-40/m1-mini.webp', 'propia'])).estado).toBe('aplicado');
  });
});

describe('artículo antiguo con un SKU no válido (el QR del fabricante)', () => {
  const RARO = 'HTTP://TAG.YT/ZESA7', CLAVE = 'HTTP!3A!2F!2FTAG.YT!2FZESA7';
  const antiguo = `insert into public.productos (sku, nombre, categoria, unidad, contenido, stock, minimo, proveedor, propiedad) values ('${RARO}', 'Clavos HC6-27', 'fijaciones', 'ud', 1, 6, 0, '', 'propia');`;
  it('admite foto con la clave segura, sale en la lista de no válidos y se repara cambiando el código', async () => {
    const db = await nuevaBD({ seed: false, intercalar: { antesDe: '20261012', sql: leer('seed.sql') + antiguo } });
    await como(db, ADMIN);
    await superusuario(db); expect(await valor(db, 'select _clave_sku($1)', [RARO])).toBe(CLAVE); await como(db, ADMIN);
    expect((await db.query('select * from skus_no_validos()')).rows).toEqual([{ sku: RARO, nombre: 'Clavos HC6-27' }]);
    // la ruta antigua (con "/" y ":") sigue sin valer; la nueva, con la clave, sí
    expect(await falla(db, PONER, [RARO, `productos/${RARO}/a.webp`, `productos/${RARO}/a-mini.webp`, 'propia'])).toMatch(/Ruta de la foto no válida/);
    expect(await valor(db, 'select puede_subir_foto($1)', [`productos/${CLAVE}/a.webp`])).toBe(true);
    await db.query(PONER, [RARO, `productos/${CLAVE}/a.webp`, `productos/${CLAVE}/a-mini.webp`, 'propia']);
    // reparar: cambiar el código (Editar) mueve el stock; el código antiguo queda como alternativo
    await db.query('select cambiar_codigo_producto($1, $2)', [RARO, '3439510575536']);
    await db.query('select asociar_codigo($1, $2, $3)', [RARO, '3439510575536', 'QR']);
    expect(await valor(db, "select stock::int from productos where sku = '3439510575536'")).toBe(6);
    expect(await valor(db, 'select sku from codigos_articulo where codigo = $1', [RARO])).toBe('3439510575536');
    expect((await db.query('select * from skus_no_validos()')).rows).toEqual([]);
  });
});

describe('cambiar el SKU a un código alternativo del mismo artículo', () => {
  it('deja de ser alternativo y pasa a ser su SKU', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select asociar_codigo($1, $2, $3)', ['8412345678905', '6000650605', 'EAN']);
    await db.query('select cambiar_codigo_producto($1, $2)', ['6000650605', '8412345678905']);
    expect(await valor(db, "select stock::int from productos where sku = '8412345678905'")).toBe(420);
    expect(await valor(db, 'select count(*)::int from codigos_articulo')).toBe(0);
  });
});
