/* E-024 · Socios de custodia (Esmove, Instant Box…) y páginas escaneadas guardadas con el albarán */
import { describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, uuid, valor } from './pg';

const PROD = (sku: string, extra = {}) => JSON.stringify({ sku, nombre: `Artículo ${sku}`, categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 1, nuevo: true, ...extra });
const SOCIO = (id: string, nombre: string, extra = {}) => JSON.stringify({ id, nombre, contacto: '', correos_reposicion: [], correos_informes: [], ...extra });

describe('socios de custodia', () => {
  it('Instant Box existe tras la migración, junto a Esmove', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    expect(await valor(db, "select string_agg(nombre, ', ' order by nombre) from propietarios where activo")).toBe('Esmove, Instant Box');
  });

  it('dos socios con stock: cada artículo es de su socio y no se mezclan', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('ESM-1', { propiedad: 'custodia', propietario_id: 'ESMOVE', stock_inicial: 5 })]);
    await db.query('select guardar_producto($1::jsonb)', [PROD('IB-1', { propiedad: 'custodia', propietario_id: 'INSTANTBOX', stock_inicial: 3 })]);
    const porSocio = await db.query<{ p: string; n: number }>("select propietario_id p, sum(stock)::float n from productos where propiedad = 'custodia' and sku in ('ESM-1', 'IB-1') group by 1 order by 1");
    expect(porSocio.rows).toEqual([{ p: 'ESMOVE', n: 5 }, { p: 'INSTANTBOX', n: 3 }]);
  });

  it('crear un socio, editarlo y desactivarlo solo si no tiene artículos', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_propietario($1::jsonb)', [SOCIO('NUEVO', 'Socio Nuevo', { color: 'verde', correos_informes: ['informes@ejemplo.com'] })]);
    expect(await valor(db, "select color from propietarios where id = 'NUEVO'")).toBe('verde');
    await db.query('select guardar_producto($1::jsonb)', [PROD('SN-1', { propiedad: 'custodia', propietario_id: 'NUEVO' })]);
    expect(await falla(db, 'select guardar_propietario($1::jsonb)', [SOCIO('NUEVO', 'Socio Nuevo', { activo: false })])).toMatch(/Tiene 1 artículo en custodia/);
    await db.query("select cambiar_propiedad('SN-1', 'propia', null)");
    await db.query('select guardar_propietario($1::jsonb)', [SOCIO('NUEVO', 'Socio Nuevo', { activo: false })]);
    expect(await valor(db, "select activo from propietarios where id = 'NUEVO'")).toBe(false);
    // desactivado: no admite material nuevo
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [PROD('SN-2', { propiedad: 'custodia', propietario_id: 'NUEVO' })])).toMatch(/está desactivado/);
    expect(await valor(db, "select count(*)::int from auditoria where accion in ('alta_socio', 'editar_socio') and detalle->>'id' = 'NUEVO'")).toBe(2);   // alta y desactivación (el intento fallido no queda)
  });

  it('valida el nombre, que no se repita y los correos; solo el administrador', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_propietario($1::jsonb)', [SOCIO('OTRO', '  ')])).toMatch(/Pon el nombre/);
    expect(await falla(db, 'select guardar_propietario($1::jsonb)', [SOCIO('OTRO', 'instant box')])).toMatch(/Ya hay un socio llamado/);
    expect(await falla(db, 'select guardar_propietario($1::jsonb)', [SOCIO('OTRO', 'Otro', { correos_reposicion: ['mal'] })])).toMatch(/Correo no válido: mal/);
    await como(db, ALMACEN);
    expect(await falla(db, 'select guardar_propietario($1::jsonb)', [SOCIO('OTRO', 'Otro')])).toMatch(/administrador/i);
  });

  it('la foto puede ser "de" un socio (por su id), y el antiguo "Esmove" sigue valiendo', async () => {
    const db = await nuevaBD();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('IB-FOTO', { propiedad: 'custodia', propietario_id: 'INSTANTBOX' })]);
    const r = (o: string) => ['IB-FOTO', `productos/IB-FOTO/${o}.webp`, `productos/IB-FOTO/${o}-mini.webp`, o];
    await db.query('select poner_foto($1, $2, $3, $4)', r('INSTANTBOX'));
    expect(await valor(db, "select foto_origen from productos where sku = 'IB-FOTO'")).toBe('INSTANTBOX');
    await db.query('select poner_foto($1, $2, $3, $4)', r('Esmove'));
    expect(await falla(db, 'select poner_foto($1, $2, $3, $4)', r('Cualquiera'))).toMatch(/Origen de la foto no válido/);
  });
});

describe('páginas escaneadas del albarán', () => {
  const albaran = async (paginas: unknown) => {
    const db = await nuevaBD(), id = uuid();
    await como(db, ADMIN);
    await db.query('select guardar_producto($1::jsonb)', [PROD('ART-1')]);
    await db.query('select aprobar_albaran($1, $2::jsonb, $3::jsonb)', [id, JSON.stringify({ numero: 'A-1', proveedor: 'Saltoki', modo: 'ia', paginas }), JSON.stringify([{ sku: 'ART-1', cantidad: 2 }])]);
    return { db, id };
  };

  it('el albarán guarda sus páginas en orden (y descarta nombres raros)', async () => {
    const { db, id } = await albaran(['1.jpg', '2.jpg', '../x.jpg', '3.pdf']);
    expect(await valor(db, 'select paginas from albaranes where id = $1', [id])).toEqual(['1.jpg', '2.jpg', '3.pdf']);
  });

  it('solo se puede subir una página que el albarán declara', async () => {
    const { db, id } = await albaran(['1.jpg', '2.jpg']);
    await como(db, ALMACEN);
    expect(await valor(db, 'select puede_subir_pagina($1)', [`${id}/2.jpg`])).toBe(true);
    expect(await valor(db, 'select puede_subir_pagina($1)', [`${id}/3.jpg`])).toBe(false);
    expect(await valor(db, 'select puede_subir_pagina($1)', [`${uuid()}/1.jpg`])).toBe(false);
    expect(await valor(db, 'select puede_subir_pagina($1)', [`${id}/1.png`])).toBe(false);
  });

  it('sin páginas, el albarán queda como antes', async () => {
    const { db, id } = await albaran(undefined);
    expect(await valor(db, 'select paginas from albaranes where id = $1', [id])).toEqual([]);
  });
});
