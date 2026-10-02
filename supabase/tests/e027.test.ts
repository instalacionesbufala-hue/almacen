/* E-027 · Roles y permisos: el SERVIDOR rechaza lo que el rol no permite (aunque se llame a la API directamente),
   las lecturas respetan "Ver", los roles de sistema no se tocan, no se borra un rol en uso y siempre queda un administrador. */
import { describe, expect, it } from 'vitest';
import { PERMISOS_ALMACEN, PERMISOS_LECTURA } from '../functions/_compartido/permisos';
import { ADMIN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const DIRECCION = '00000000-0000-4000-8000-000000000027';
const JEFE = '00000000-0000-4000-8000-000000000028';
async function base() {
  const db = await nuevaBD();
  await superusuario(db);
  await db.exec(`insert into auth.users (id, email) values ('${DIRECCION}', 'direccion@x.es'), ('${JEFE}', 'jefe@x.es');
    insert into perfiles (id, nombre, rol, activo) values ('${DIRECCION}', 'Dirección Pruebas', 'lectura', true), ('${JEFE}', 'Jefe Pruebas', 'almacen', true);`);
  return db;
}
const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8) as r';
const rechaza = /no permite hacer esto|Solo el administrador/;

describe('rol Solo lectura (dirección)', () => {
  it('el servidor rechaza movimientos, entregas, ajustes, recuentos, artículos, fotos, actas e incidencias', async () => {
    const db = await base();
    await como(db, DIRECCION);
    expect(await falla(db, MOV, [uuid(), 'CAB-RZ1K-5G6', 'salida', 1, 'Obra', 'Prueba', [], null])).toMatch(/Tu rol \(Solo lectura\) no permite hacer esto \(movimientos\.modificar\)/);
    expect(await falla(db, 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb)', [uuid(), 'F01', 'T1', '', null, '[{"tipo": "stock", "sku": "CAB-RZ1K-5G6", "cantidad": 1}]'])).toMatch(rechaza);
    expect(await falla(db, 'select proponer_ajuste($1, $2, $3, $4)', [uuid(), 'CAB-RZ1K-5G6', -1, 'Recuento'])).toMatch(rechaza);
    expect(await falla(db, 'select ajustar_inventario($1, $2, $3, $4, $5)', [uuid(), 'CAB-RZ1K-5G6', -1, 'Recuento', null])).toMatch(rechaza);
    expect(await falla(db, 'select registrar_recuento_vehiculo($1, $2, $3::jsonb)', [uuid(), 'V-F01', '[{"sku": "CAB-RZ1K-5G6", "contado": 1}]'])).toMatch(rechaza);
    expect(await falla(db, 'select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'NUEVO-1', nombre: 'X', categoria: 'cables', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true })])).toMatch(rechaza);
    expect(await falla(db, 'select crear_borrador_articulo($1::jsonb)', [JSON.stringify({ sku: 'NUEVO-2', nombre: 'X', categoria: 'cables', unidad: 'ud', contenido: 1, stock_inicial: 0 })])).toMatch(rechaza);
    expect(await falla(db, 'select poner_foto($1, $2, $3, $4)', ['BF-FIX-SX8', 'productos/BF-FIX-SX8/a.webp', 'productos/BF-FIX-SX8/a-mini.webp', 'propia'])).toMatch(rechaza);
    expect(await falla(db, 'select registrar_acta_custodia($1, $2, $3, $4, $5::jsonb)', [uuid(), 'ESMOVE', 'Rep', 'f', '[]'])).toMatch(rechaza);
    expect(await falla(db, 'select cambiar_estado_equipo($1, $2)', ['F01', 'taller'])).toMatch(rechaza);
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from movimientos where operario = 'Dirección Pruebas'")).toBe(0);
  });

  it('ve inventario, movimientos, entregas y cierres, pero no la configuración interna, los usuarios ni la bandeja', async () => {
    const db = await base();
    await como(db, ADMIN);
    await db.query(MOV, [uuid(), 'CAB-RZ1K-5G6', 'salida', 1, 'Obra', 'Prueba', [], null]);
    await como(db, DIRECCION);
    for (const t of ['productos', 'movimientos', 'entregas', 'albaranes', 'stock_vehiculo'])
      expect(await valor<number>(db, `select count(*)::int from ${t}`), t).toBeGreaterThanOrEqual(0);
    expect(await valor<number>(db, 'select count(*)::int from productos')).toBeGreaterThan(0);
    expect(await valor<number>(db, 'select count(*)::int from movimientos')).toBeGreaterThan(0);
    expect(await valor(db, 'select count(*)::int from integraciones')).toBe(0);
    expect(await valor(db, 'select count(*)::int from perfiles')).toBe(1);                       // solo el suyo
    expect(await valor(db, 'select count(*)::int from auditoria')).toBe(0);
    expect(await valor(db, "select tiene_permiso('exportar.ver')")).toBe(true);
    expect(await valor(db, "select tiene_permiso('configuracion.ver')")).toBe(false);
    expect(await valor(db, "select tiene_permiso('bandeja.modificar')")).toBe(false);
  });

  it('los roles de sistema tienen los mismos permisos en la base y en la app', async () => {
    const db = await base();
    await como(db, ADMIN);
    expect(await valor(db, "select permisos from roles where id = 'almacen'")).toEqual(PERMISOS_ALMACEN);
    expect(await valor(db, "select permisos from roles where id = 'lectura'")).toEqual(PERMISOS_LECTURA);
  });
});

describe('roles propios', () => {
  const guardar = (db: BD, p: Record<string, unknown>) => db.query('select guardar_rol($1::jsonb)', [JSON.stringify(p)]);

  it('"Ver custodia" sin "Modificar": lee las actas y el stock, no registra un acta; sin "Ver movimientos" no los lee', async () => {
    const db = await base();
    await como(db, ADMIN);
    await db.query('select registrar_acta_custodia($1, $2, $3, $4, $5::jsonb)', [uuid(), 'ESMOVE', 'Representante', 'f', '[{"sku": "ESM-CPVE-MONO", "contado": 3}]']);
    await guardar(db, { id: 'socios', nombre: 'Consulta de socios', permisos: { 'custodia.ver': true, 'inventario.ver': true } });
    await db.query('select actualizar_perfil($1, $2, $3, $4)', [JEFE, 'Jefe Pruebas', 'socios', true]);
    await como(db, JEFE);
    expect(await valor(db, 'select count(*)::int from actas_custodia')).toBe(1);
    expect(await valor(db, 'select count(*)::int from movimientos')).toBe(0);                   // quitar "Ver" oculta y bloquea la lectura
    expect(await valor(db, 'select count(*)::int from cierres')).toBe(0);
    expect(await falla(db, 'select registrar_acta_custodia($1, $2, $3, $4, $5::jsonb)', [uuid(), 'ESMOVE', 'Rep', 'f', '[]'])).toMatch(/Tu rol \(Consulta de socios\) no permite hacer esto \(custodia\.modificar\)/);
    expect(await falla(db, MOV, [uuid(), 'CAB-RZ1K-5G6', 'salida', 1, 'Obra', 'Prueba', [], null])).toMatch(rechaza);
  });

  it('un rol propio con "Modificar inventario" crea y edita artículos (lo del administrador en ese apartado), pero nunca usuarios ni roles', async () => {
    const db = await base();
    await como(db, ADMIN);
    await guardar(db, { id: 'catalogo', nombre: 'Catálogo', permisos: { 'inventario.modificar': true } });
    expect(await valor(db, "select permisos->>'inventario.ver' from roles where id = 'catalogo'")).toBe('true');   // modificar implica ver
    await db.query('select actualizar_perfil($1, $2, $3, $4)', [JEFE, 'Jefe Pruebas', 'catalogo', true]);
    await como(db, JEFE);
    await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: 'CAT-1', nombre: 'Del rol catálogo', categoria: 'cables', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true })]);
    expect(await valor(db, "select nombre from productos where sku = 'CAT-1'")).toBe('Del rol catálogo');
    expect(await falla(db, 'select actualizar_perfil($1, $2, $3, $4)', [JEFE, 'Jefe', 'admin', true])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select guardar_rol($1::jsonb)', [JSON.stringify({ id: 'x1', nombre: 'X', permisos: {} })])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select crear_integracion($1)', ['x'])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select guardar_categoria($1::jsonb)', [JSON.stringify({ id: 'nueva', nombre: 'Nueva' })])).toMatch(rechaza);
  });

  it('usuarios.* no se puede dar a un rol propio aunque venga en la matriz', async () => {
    const db = await base();
    await como(db, ADMIN);
    await guardar(db, { id: 'listo', nombre: 'Listillo', permisos: { 'usuarios.modificar': true, 'usuarios.ver': true, 'cosa.rara': true } });
    expect(await valor(db, "select permisos from roles where id = 'listo'")).toEqual({});
  });

  it('no se borra un rol en uso; los de sistema no se editan ni se borran; siempre queda un administrador', async () => {
    const db = await base();
    await como(db, ADMIN);
    await guardar(db, { id: 'temporal', nombre: 'Temporal', permisos: { 'inventario.ver': true } });
    await db.query('select actualizar_perfil($1, $2, $3, $4)', [JEFE, 'Jefe Pruebas', 'temporal', true]);
    expect(await falla(db, "select borrar_rol('temporal')")).toMatch(/lo usa 1 usuario/);
    await db.query('select actualizar_perfil($1, $2, $3, $4)', [JEFE, 'Jefe Pruebas', 'almacen', true]);
    await db.query("select borrar_rol('temporal')");
    expect(await valor(db, "select count(*)::int from roles where id = 'temporal'")).toBe(0);
    expect(await falla(db, "select borrar_rol('lectura')")).toMatch(/no se borran/);
    expect(await falla(db, 'select guardar_rol($1::jsonb)', [JSON.stringify({ id: 'almacen', nombre: 'Almacén', permisos: {} })])).toMatch(/no se modifican/);
    expect(await falla(db, 'select actualizar_perfil($1, $2, $3, $4)', [ADMIN, 'Admin Pruebas', 'lectura', true])).toMatch(/No puedes quitarte/);
    expect(await falla(db, 'select actualizar_perfil($1, $2, $3, $4)', [JEFE, 'Jefe Pruebas', 'inexistente', true])).toMatch(/Rol no válido/);
  });
});

describe('cobertura del servidor', () => {
  it('toda función que comprueba al usuario tiene su permiso asignado (si no, Solo lectura podría escribir con ella)', async () => {
    const db = await nuevaBD();
    await superusuario(db);
    const r = await db.query<{ proname: string }>(`select distinct proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where nspname = 'public'
      and (prosrc like '%perfil_actual()%' or prosrc like '%exigir_admin()%') and proname not in (select funcion from permisos_funcion) order by 1`);
    // las de exigir_admin sin permiso siguen siendo solo del administrador; perfil_actual y exigir_admin son la propia comprobación
    expect(r.rows.map(x => x.proname)).toEqual(['encolar_envio', 'exigir_admin', 'limpiar_demostracion', 'perfil_actual']);
  });
});
