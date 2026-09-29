/* E-009 · Fotos de los artículos: rutas, permisos y foto compartida por modelo */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, INACTIVO, como, falla, nuevaBD, valor, type BD } from './pg';

const PONER = 'select poner_foto($1, $2, $3, $4) as r';
const ruta = (sku: string, marca: string, mini = false) => `productos/${sku}/${marca}${mini ? '-mini' : ''}.webp`;
const foto = (db: BD, sku: string) => valor<string | null>(db, 'select foto from productos where sku = $1', [sku]);

describe('fotos de los artículos', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('el almacén pone foto a un artículo que no tiene (un cuadro de Esmove, sin n.º de serie)', async () => {
    await como(db, ALMACEN);
    expect(await valor<boolean>(db, 'select puede_subir_foto($1)', [ruta('ESM-CPVE-MONO', 'a1')])).toBe(true);
    const r = await valor<{ estado: string }>(db, PONER, ['ESM-CPVE-MONO', ruta('ESM-CPVE-MONO', 'a1'), ruta('ESM-CPVE-MONO', 'a1', true), 'Esmove']);
    expect(r.estado).toBe('aplicado');
    expect(await foto(db, 'ESM-CPVE-MONO')).toBe(ruta('ESM-CPVE-MONO', 'a1'));
    expect(await valor(db, "select foto_origen from productos where sku = 'ESM-CPVE-MONO'")).toBe('Esmove');
  });

  it('el almacén NO puede sustituir una foto existente, ni subir otra al bucket; reenviar la misma sí (reintento)', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, PONER, ['ESM-CPVE-MONO', ruta('ESM-CPVE-MONO', 'b2'), ruta('ESM-CPVE-MONO', 'b2', true), 'propia'])).toMatch(/solo el administrador/);
    expect(await valor<boolean>(db, 'select puede_subir_foto($1)', [ruta('ESM-CPVE-MONO', 'b2')])).toBe(false);
    // los archivos de la foto actual sí (la operación pudo llegar antes que el archivo)
    expect(await valor<boolean>(db, 'select puede_subir_foto($1)', [ruta('ESM-CPVE-MONO', 'a1', true)])).toBe(true);
    expect((await valor<{ estado: string }>(db, PONER, ['ESM-CPVE-MONO', ruta('ESM-CPVE-MONO', 'a1'), ruta('ESM-CPVE-MONO', 'a1', true), 'Esmove'])).estado).toBe('aplicado');
    expect(await falla(db, 'select quitar_foto($1)', ['ESM-CPVE-MONO'])).toMatch(/Solo el administrador/);
  });

  it('el administrador sustituye y quita, y recibe las rutas para borrar los archivos', async () => {
    await como(db, ADMIN);
    expect(await valor<boolean>(db, 'select puede_subir_foto($1)', [ruta('ESM-CPVE-MONO', 'b2')])).toBe(true);
    await db.query(PONER, ['ESM-CPVE-MONO', ruta('ESM-CPVE-MONO', 'b2'), ruta('ESM-CPVE-MONO', 'b2', true), 'propia']);
    expect(await foto(db, 'ESM-CPVE-MONO')).toBe(ruta('ESM-CPVE-MONO', 'b2'));
    const r = await valor<{ rutas: string[] }>(db, 'select quitar_foto($1) as r', ['ESM-CPVE-MONO']);
    expect(r.rutas.sort()).toEqual([ruta('ESM-CPVE-MONO', 'b2'), ruta('ESM-CPVE-MONO', 'b2', true)].sort());
    expect(await foto(db, 'ESM-CPVE-MONO')).toBeNull();
  });

  it('las tallas de un mismo modelo comparten la foto', async () => {
    await como(db, ALMACEN);
    await db.query(PONER, ['ROPA-PANT-42', ruta('ROPA-PANT-42', 'c3'), ruta('ROPA-PANT-42', 'c3', true), 'fabricante']);
    expect(await foto(db, 'ROPA-PANT-44')).toBe(ruta('ROPA-PANT-42', 'c3'));
    // la otra talla ya tiene foto (la del modelo): el almacén no la cambia
    expect(await falla(db, PONER, ['ROPA-PANT-44', ruta('ROPA-PANT-44', 'd4'), ruta('ROPA-PANT-44', 'd4', true), 'propia'])).toMatch(/solo el administrador/);
  });

  it('rechaza rutas que no son del artículo, orígenes desconocidos y usuarios sin acceso', async () => {
    await como(db, ADMIN);
    expect(await falla(db, PONER, ['BF-FIX-SX8', ruta('OTRO', 'e5'), ruta('OTRO', 'e5', true), 'propia'])).toMatch(/Ruta/);
    expect(await falla(db, PONER, ['BF-FIX-SX8', '../secreto.webp', 'x.webp', 'propia'])).toMatch(/Ruta/);
    expect(await falla(db, PONER, ['BF-FIX-SX8', ruta('BF-FIX-SX8', 'e5'), ruta('BF-FIX-SX8', 'e5', true), 'Amazon'])).toMatch(/Origen/);
    expect(await valor<boolean>(db, 'select puede_subir_foto($1)', ['otra-carpeta/BF-FIX-SX8/x.webp'])).toBe(false);
    await como(db, INACTIVO);
    expect(await valor<boolean>(db, 'select puede_subir_foto($1)', [ruta('BF-FIX-SX8', 'f6')])).toBe(false);
    expect(await falla(db, PONER, ['BF-FIX-SX8', ruta('BF-FIX-SX8', 'f6'), ruta('BF-FIX-SX8', 'f6', true), 'propia'])).toMatch(/sin acceso/);
  });
});
