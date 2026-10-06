/* E-034 · Usuarios de socio: un usuario de Esmove solo ve el material en custodia de Esmove (ni lo propio de Búfala ni lo de
   Instant Box), sin técnicos, firmas ni operarios; ve las instalaciones de sus cargadores (solo esas líneas del cierre); no
   escribe nada; y dos socios distintos quedan aislados entre sí. Todo en el servidor (RLS y funciones), no solo en la interfaz. */
import { beforeAll, describe, expect, it } from 'vitest';
import { EQUIVALENCIAS_PROPUESTA } from '../functions/_compartido/cierres';
import { PERMISOS_SOCIO } from '../functions/_compartido/permisos';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const ESM = '00000000-0000-4000-8000-000000000341', IBX = '00000000-0000-4000-8000-000000000342', OTRO = '00000000-0000-4000-8000-000000000343';
type Datos = Record<string, Record<string, unknown>[]>;
let db: BD;
const datos = async (uid: string) => { await como(db, uid); return valor<Datos>(db, 'select datos_socio() as r'); };

beforeAll(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'IBX-TAQ-1', nombre: 'Taquilla Instant Box', categoria: 'aparamenta', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 4, propiedad: 'custodia', propietario_id: 'INSTANTBOX' })]);
  // una instalación de Búfala 1 con un cargador de Esmove (Wallbox) y cable propio
  const hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
  await enviarCierre(db, hash, { numInst: 'E2639340', cliente: 'Cliente inventado', direccion: 'Calle Falsa 1', equipo: 'Búfala 1', fechaCierreIso: new Date().toISOString(), hardware: 'Wallbox Pulsar Plus 22', metrosLinea: 10, tipoLinea: 'manguera', fase: 'mono', seccion: '6' },
    { reglas: [{ id: 'W', campo: 'hardware', formula: 'unidad', condiciones: { 'hardware~': 'wallbox' }, articulos: [{ sku: 'WBX-PULSAR-22', factor: 1 }], estimada: false, activa: true, orden: 1 },
      { id: 'L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 2 }, ...EQUIVALENCIAS_PROPUESTA.slice(0, 0)], kits: {}, origen: 'wizard' });
  await superusuario(db);
  await db.exec(`insert into auth.users (id, email) values ('${ESM}', 'esmove@x.es'), ('${IBX}', 'instantbox@x.es'), ('${OTRO}', 'otro@x.es');
    insert into perfiles (id, nombre, rol, activo, propietario_id) values ('${ESM}', 'Persona de Esmove', 'socio', true, 'ESMOVE'), ('${IBX}', 'Persona de Instant Box', 'socio', true, 'INSTANTBOX');`);
});

describe('un usuario de Esmove', () => {
  it('no lee ninguna tabla directamente (ni productos, ni técnicos, ni entregas con firmas, ni movimientos)', async () => {
    await como(db, ESM);
    for (const t of ['productos', 'tecnicos', 'entregas', 'movimientos', 'stock_vehiculo', 'cierres', 'cierre_lineas', 'equivalencias_cierre', 'actas_custodia', 'auditoria', 'dotacion'])
      expect([t, Number(await valor(db, `select count(*) from ${t}`))]).toEqual([t, 0]);
    // de perfiles, solo el suyo
    expect((await db.query('select id from perfiles')).rows).toEqual([{ id: ESM }]);
  });

  it('por datos_socio solo ve lo suyo en custodia, con las columnas permitidas', async () => {
    const d = await datos(ESM);
    const skus = d.productos.map(p => p.sku as string);
    expect(skus.length).toBeGreaterThan(0);
    expect(d.productos.every(p => p.propiedad === 'custodia' && p.propietario_id === 'ESMOVE')).toBe(true);
    expect(skus).not.toContain('CAB-RZ1K-5G6');                                   // material propio de Búfala
    expect(skus).not.toContain('IBX-TAQ-1');                                      // de otro socio
    expect(d.movimientos.every(m => skus.includes(m.sku as string) && m.operario === 'Búfala' && !('usuario' in m))).toBe(true);
    expect(d.stock_vehiculo.every(x => skus.includes(x.sku as string))).toBe(true);
    expect(d.propietarios.map(o => o.id)).toEqual(['ESMOVE']);
    expect(Object.keys(d.propietarios[0])).not.toContain('correos_informes');
    expect(Object.keys(d.equipos[0]).sort()).toEqual(['activo', 'estado', 'id', 'nombre']);
    expect(d).not.toHaveProperty('tecnicos');
    expect(d).not.toHaveProperty('entregas');
    expect(d.perfiles.map(p => p.id)).toEqual([ESM]);
    expect(d.roles.map(r => r.id)).toEqual(['socio']);
  });

  it('ve las instalaciones de sus cargadores: el cierre (n.º, cliente, dirección, fecha) y solo la línea de su artículo', async () => {
    const d = await datos(ESM);
    expect(d.cierres.map(c => [c.num_inst, c.cliente, c.direccion])).toEqual([['E2639340', 'Cliente inventado', 'Calle Falsa 1']]);
    for (const k of ['datos', 'datos_wizard', 'holded', 'material_especial']) expect(Object.keys(d.cierres[0])).not.toContain(k);
    expect(d.cierre_lineas.map(l => [l.campo, l.sku])).toEqual([['hardware', 'WBX-PULSAR-22']]);   // el cable del cierre, no
  });

  it('no puede escribir nada (ni por la API)', async () => {
    await como(db, ESM);
    const rechazo = /Acceso de socio/;
    expect(await falla(db, 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8)', [uuid(), 'BF-VE-WBX74', 'salida', 1, 'Obra', 'Prueba', [], null])).toMatch(rechazo);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'X-1', nombre: 'X', categoria: 'cables', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true })])).toMatch(rechazo);
    expect(await falla(db, 'select registrar_acta_custodia($1, $2, $3, $4, $5::jsonb)', [uuid(), 'ESMOVE', 'Rep', 'f', '[]'])).toMatch(rechazo);
    expect(await falla(db, 'select poner_foto($1, $2, $3, $4)', ['BF-VE-WBX74', 'productos/BF-VE-WBX74/a.webp', 'productos/BF-VE-WBX74/a-mini.webp', 'propia'])).toMatch(rechazo);
    expect(await falla(db, "insert into movimientos (id, sku, tipo, cantidad, motivo, operario) values (gen_random_uuid(), 'BF-VE-WBX74', 'entrada', 1, 'x', 'x')")).toMatch(/permission|row-level|denied/i);
    // las funciones sueltas tampoco le dan nada
    expect(Number(await valor(db, "select reservado('BF-VE-WBX74')"))).toBe(0);
    expect(await valor(db, "select vehiculo_de_equipo('F01')")).toBeNull();
    expect(await valor(db, 'select count(*)::int from skus_no_validos()')).toBe(0);
    // y sí su propio perfil (la app lo pide al entrar)
    expect(await valor(db, 'select (perfil_actual()).propietario_id')).toBe('ESMOVE');
  });
});

describe('rol de sistema', () => {
  it('«Socio (solo lectura)» tiene los mismos permisos en la base y en la app', async () => {
    await superusuario(db);
    expect(await valor(db, "select permisos from roles where id = 'socio'")).toEqual(PERMISOS_SOCIO);
  });
});

describe('dos socios aislados entre sí', () => {
  it('Instant Box solo ve lo suyo; un usuario interno no puede usar datos_socio', async () => {
    const d = await datos(IBX);
    expect(d.productos.map(p => p.sku)).toEqual(['IBX-TAQ-1']);
    expect(d.cierres).toEqual([]);
    expect(d.movimientos.every(m => m.sku === 'IBX-TAQ-1')).toBe(true);
    await como(db, ADMIN);
    expect(await falla(db, 'select datos_socio()')).toMatch(/Solo para usuarios de un socio/);
  });
});

describe('alta y edición de usuarios de socio', () => {
  it('rol y socio deben cuadrar; el administrador cambia un usuario a socio y de vuelta', async () => {
    await superusuario(db);
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000344', 'x@x.es');`);
    expect(await falla(db, `insert into perfiles (id, nombre, rol, activo, propietario_id) values ('00000000-0000-4000-8000-000000000344', 'X', 'almacen', true, 'ESMOVE')`)).toMatch(/solo puede tener el rol/);
    expect(await falla(db, `insert into perfiles (id, nombre, rol, activo) values ('00000000-0000-4000-8000-000000000344', 'X', 'socio', true)`)).toMatch(/es solo para usuarios de un socio/);
    await db.exec(`insert into perfiles (id, nombre, rol, activo) values ('${OTRO}', 'Otro', 'almacen', true);`);
    await como(db, ADMIN);
    await db.query('select actualizar_perfil($1, $2, $3, $4, $5)', [OTRO, 'Otro de Esmove', 'socio', true, 'ESMOVE']);
    expect((await datos(OTRO)).productos.length).toBeGreaterThan(0);
    await como(db, ADMIN);
    await db.query('select actualizar_perfil($1, $2, $3, $4, $5)', [OTRO, 'Otro', 'almacen', true, '']);
    await como(db, OTRO);
    expect(Number(await valor(db, 'select count(*) from productos'))).toBeGreaterThan(0);   // vuelve a ser interno
  });

  it('un rol propio con "Modificar" no vale para un socio; uno solo de ver su custodia, sí', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_rol($1::jsonb)', [JSON.stringify({ id: 'socio_informes', nombre: 'Socio informes', permisos: { 'custodia.ver': true, 'exportar.ver': true } })]);
    await db.query('select guardar_rol($1::jsonb)', [JSON.stringify({ id: 'socio_malo', nombre: 'Socio malo', permisos: { 'custodia.modificar': true } })]);
    await db.query('select actualizar_perfil($1, $2, $3, $4, $5)', [OTRO, 'Otro', 'socio_informes', true, 'ESMOVE']);
    expect(await falla(db, 'select actualizar_perfil($1, $2, $3, $4, $5)', [OTRO, 'Otro', 'socio_malo', true, 'ESMOVE'])).toMatch(/solo puede tener el rol/);
    expect(await falla(db, 'select guardar_rol($1::jsonb)', [JSON.stringify({ id: 'socio_informes', nombre: 'Socio informes', permisos: { 'custodia.modificar': true } })])).toMatch(/lo usa un socio/);
  });
});
