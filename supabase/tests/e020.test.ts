/* E-020 · Códigos alternativos (EAN del fabricante…): asociar, duplicados, quitar y paso al fusionar */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const AS = 'select asociar_codigo($1, $2, $3) as r';

describe('códigos alternativos', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('el almacén asocia un EAN a un artículo y queda en la auditoría', async () => {
    await como(db, ALMACEN);
    expect((await valor<{ estado: string }>(db, AS, ['8412345678905', '6000650605', 'EAN'])).estado).toBe('aplicado');
    expect((await valor<{ estado: string }>(db, AS, ['8412345678905', '6000650605', 'EAN'])).estado).toBe('duplicado');      // reintento
    expect((await db.query('select sku, tipo, operario from codigos_articulo where codigo = $1', ['8412345678905'])).rows[0]).toMatchObject({ sku: '6000650605', tipo: 'EAN' });
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'asociar_codigo' and detalle->>'codigo' = '8412345678905'")).toBe(1);
  });
  it('un código solo puede ser de un artículo (ni de otro alternativo ni del SKU de otro)', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, AS, ['8412345678905', '6000650604', 'EAN'])).toMatch(/ya está asociado a .*6000650605/);
    expect(await falla(db, AS, ['6000650601', '6000650604', 'otro'])).toMatch(/ya es de .*6000650601/);
    expect(await falla(db, AS, ['  ', '6000650604', 'otro'])).toMatch(/Indica el código/);
  });
  it('solo el administrador lo quita', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select quitar_codigo($1)', ['8412345678905'])).toMatch(/administrador/);
    await como(db, ADMIN);
    await db.query('select quitar_codigo($1)', ['8412345678905']);
    expect(await valor(db, 'select count(*)::int from codigos_articulo')).toBe(0);
  });
  it('al fusionar un artículo, sus códigos pasan al que lo sustituye', async () => {
    await como(db, ADMIN);
    await db.query(AS, ['3439510575536', '6000650604', 'EAN']);
    await db.query('select fusionar_productos($1, $2, $3)', ['6000650604', '6000650601', 'Era el mismo']);
    expect(await valor(db, 'select sku from codigos_articulo where codigo = $1', ['3439510575536'])).toBe('6000650601');
    expect(await falla(db, AS, ['111', '6000650604', 'otro'])).toMatch(/archivado/);
  });
});
