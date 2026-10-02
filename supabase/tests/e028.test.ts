/* E-028 · Denegar por defecto: una función que comprueba al usuario y no tiene permiso asignado en permisos_funcion
   se rechaza para Solo lectura y los roles propios; Almacén y el administrador siguen como siempre. */
import { describe, expect, it } from 'vitest';
import { ADMIN, como, falla, nuevaBD, superusuario, valor } from './pg';

const DIRECCION = '00000000-0000-4000-8000-000000000027';
const JEFE = '00000000-0000-4000-8000-000000000028';
const PROPIO = '00000000-0000-4000-8000-000000000029';
async function base() {
  const db = await nuevaBD();
  await superusuario(db);
  await db.exec(`insert into roles (id, nombre, descripcion, sistema, permisos) values ('encargado', 'Encargado', '', false, '{"inventario.ver": true, "inventario.modificar": true}');
    insert into auth.users (id, email) values ('${DIRECCION}', 'direccion@x.es'), ('${JEFE}', 'jefe@x.es'), ('${PROPIO}', 'propio@x.es');
    insert into perfiles (id, nombre, rol, activo) values ('${DIRECCION}', 'Dirección Pruebas', 'lectura', true), ('${JEFE}', 'Jefe Pruebas', 'almacen', true), ('${PROPIO}', 'Propio Pruebas', 'encargado', true);
    -- una función nueva que escribe y que alguien olvidó registrar en permisos_funcion
    create function public.prueba_sin_registrar() returns text language plpgsql security definer set search_path = public as $$
    declare p perfiles := perfil_actual(); begin return p.rol; end $$;
    grant execute on function public.prueba_sin_registrar() to authenticated;`);
  return db;
}
const SIN = /Esta acción no tiene permiso asignado: avisa al administrador \(prueba_sin_registrar\)/;

describe('función sin permiso asignado', () => {
  it('Solo lectura y un rol propio se rechazan; Almacén y el administrador pasan', async () => {
    const db = await base();
    await como(db, DIRECCION);
    expect(await falla(db, 'select prueba_sin_registrar()')).toMatch(SIN);
    await como(db, PROPIO);
    expect(await falla(db, 'select prueba_sin_registrar()')).toMatch(SIN);
    await como(db, JEFE);
    expect(await valor(db, 'select prueba_sin_registrar()')).toBe('almacen');
    await como(db, ADMIN);
    expect(await valor(db, 'select prueba_sin_registrar()')).toBe('admin');
  });

  it('perfil_actual() llamado directamente (la app al entrar) sigue funcionando para todos', async () => {
    const db = await base();
    for (const [id, rol] of [[DIRECCION, 'lectura'], [PROPIO, 'encargado'], [JEFE, 'almacen'], [ADMIN, 'admin']]) {
      await como(db, id);
      expect(await valor(db, 'select (perfil_actual()).rol')).toBe(rol);
    }
  });

  it('lo registrado sigue igual: el rol propio hace lo que su permiso deja y Solo lectura lee', async () => {
    const db = await base();
    await como(db, PROPIO);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'NUEVO-28', nombre: 'X', categoria: 'cables', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true })]);
    await como(db, DIRECCION);
    expect(await valor(db, "select count(*)::int from productos where sku = 'NUEVO-28'")).toBe(1);
  });
});
