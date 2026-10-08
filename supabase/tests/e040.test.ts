/* E-040 · Barra inferior del móvil por usuario: cada uno guarda la suya (también un usuario de socio o de solo lectura), la lee en
   perfil_actual (en cualquier móvil), se valida y se restablece, y no toca la de otro usuario. */
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const ESM = '00000000-0000-4000-8000-000000000401', LECT = '00000000-0000-4000-8000-000000000402';
let db: BD;
const barraDe = async (uid: string) => { await como(db, uid); return (await valor<{ barra_movil: unknown }>(db, 'select to_jsonb(perfil_actual()) as r')).barra_movil; };
const guardar = async (uid: string, p: unknown) => { await como(db, uid); return valor(db, 'select guardar_barra_movil($1::jsonb) as r', [JSON.stringify(p)]); };

beforeEach(async () => {
  db = await nuevaBD();
  await superusuario(db);
  await db.exec(`insert into auth.users (id, email) values ('${ESM}', 'esmove@x.es'), ('${LECT}', 'dir@x.es');
    insert into perfiles (id, nombre, rol, activo, propietario_id) values ('${ESM}', 'Persona de Esmove', 'socio', true, 'ESMOVE'), ('${LECT}', 'Dirección', 'lectura', true, null);`);
});

describe('barra inferior del móvil por usuario', () => {
  it('se guarda y se lee en el perfil (perfil_actual), solo la propia', async () => {
    expect(await barraDe(ADMIN)).toBeNull();
    const mia = { accesos: ['inventario', 'retirada', 'escanear', 'movimientos', 'mas'], central: 'escanear' };
    expect(await guardar(ADMIN, mia)).toMatchObject({ estado: 'guardada', barra: mia });
    expect(await barraDe(ADMIN)).toEqual(mia);
    expect(await barraDe(ALMACEN)).toBeNull();                                   // la de otro usuario no cambia
    // solo lectura y un usuario de socio también guardan la suya (no cambia nada más)
    await guardar(LECT, { accesos: ['inventario', 'custodia'], central: null });
    expect(await barraDe(LECT)).toEqual({ accesos: ['inventario', 'custodia'], central: null });
    await guardar(ESM, { accesos: ['custodia', 'movimientos'], central: 'custodia' });
    expect(await barraDe(ESM)).toEqual({ accesos: ['custodia', 'movimientos'], central: 'custodia' });
  });

  it('se valida y se restablece', async () => {
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_barra_movil($1::jsonb)', [JSON.stringify({ accesos: ['inventario', 'escanear', 'entrega', 'equipos', 'custodia', 'mas'] })])).toMatch(/Como mucho 5/);
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_barra_movil($1::jsonb)', [JSON.stringify({ accesos: ['inventario', 'borrar_todo'] })])).toMatch(/no válido/);
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_barra_movil($1::jsonb)', [JSON.stringify({ accesos: ['inventario', 'inventario'] })])).toMatch(/repetido/);
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_barra_movil($1::jsonb)', [JSON.stringify({ accesos: ['inventario'], central: 'escanear' })])).toMatch(/botón central/);
    await guardar(ADMIN, { accesos: ['inventario', 'escanear'], central: 'escanear' });
    expect(await guardar(ADMIN, null)).toMatchObject({ estado: 'restablecida' });
    expect(await barraDe(ADMIN)).toBeNull();
  });

  it('un usuario desactivado no guarda nada', async () => {
    await superusuario(db);
    await db.exec(`update perfiles set activo = false where id = '${LECT}'`);
    await como(db, LECT);
    expect(await falla(db, 'select guardar_barra_movil($1::jsonb)', [JSON.stringify({ accesos: ['inventario'] })])).toMatch(/sin acceso/);
  });
});
