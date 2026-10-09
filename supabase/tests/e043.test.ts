/* E-043 · Grupo de WhatsApp del equipo y del socio (validado y normalizado; si no se envía, se conserva) y la "copia enviada al
   grupo" (canal grupo_whatsapp) en el historial de entregas, devoluciones y retiradas. Datos inventados. */
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MANG = 'T-MANG-RZ1K', CARG = 'T-ESM-CARG', ENLACE = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOp';
let db: BD, entrega: string;
const equipo = (p: Record<string, unknown>) => db.query('select guardar_equipo($1::jsonb)', [JSON.stringify({ id: 'F02', nombre: 'Búfala 2', estado: 'ruta', ...p })]);
const grupoEq = async () => { await superusuario(db); const r = (await db.query<{ n: string | null; e: string | null }>("select grupo_whatsapp_nombre n, grupo_whatsapp_enlace e from equipos where id = 'F02'")).rows[0]; await como(db, ADMIN); return r; };
const socio = (p: Record<string, unknown>) => db.query('select guardar_propietario($1::jsonb)', [JSON.stringify({ id: 'ESMOVE', nombre: 'Esmove', contacto: '', correos_reposicion: [], correos_informes: [], activo: true, color: 'naranja', ...p })]);

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: MANG, nombre: 'Manguera de prueba', categoria: 'cables', unidad: 'rollo', contenido: 100, unidad_contenido: 'm', minimo: 0, nuevo: true, stock_inicial: 2 })]);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: CARG, nombre: 'Cargador de Esmove', categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 5, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
  entrega = uuid();
  await db.query('select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb)', [entrega, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: MANG, cantidad: 1 }])]);
  await db.query('select confirmar_entrega($1, $2)', [entrega, 'data:image/png;base64,AA']);
});

describe('grupo de WhatsApp del equipo y del socio', () => {
  it('se guarda normalizado (sin https, con "?…" detrás); sin nombre, el del equipo; si no viene, se conserva; null lo quita', async () => {
    await equipo({ grupo_whatsapp: { nombre: '', enlace: 'chat.whatsapp.com/AbCdEfGhIjKlMnOp?mode=r_c' } });
    expect(await grupoEq()).toEqual({ n: 'Búfala 2', e: ENLACE });
    await equipo({ estado: 'depot' });
    expect(await grupoEq()).toEqual({ n: 'Búfala 2', e: ENLACE });
    await equipo({ grupo_whatsapp: { nombre: 'Búfala 2 · material', enlace: ENLACE } });
    expect((await grupoEq()).n).toBe('Búfala 2 · material');
    expect(await falla(db, 'select guardar_equipo($1::jsonb)', [JSON.stringify({ id: 'F02', nombre: 'Búfala 2', estado: 'ruta', grupo_whatsapp: { nombre: 'x', enlace: 'https://wa.me/34600000000' } })])).toMatch(/invitación de WhatsApp/);
    await equipo({ grupo_whatsapp: null });
    expect(await grupoEq()).toEqual({ n: null, e: null });
  });

  it('el socio también (para sus retiradas)', async () => {
    await socio({ grupo_whatsapp: { nombre: 'Esmove · almacén', enlace: ENLACE } });
    await superusuario(db);
    expect((await db.query("select grupo_whatsapp_nombre n, grupo_whatsapp_enlace e from propietarios where id = 'ESMOVE'")).rows).toEqual([{ n: 'Esmove · almacén', e: ENLACE }]);
  });
});

describe('copia enviada al grupo', () => {
  it('de una entrega, una devolución y una retirada; idempotente; solo firmadas y por canales sin portal', async () => {
    const c1 = uuid();
    expect(await valor(db, 'select registrar_copia_justificante($1, $2, $3, $4, $5) as r', [c1, 'entrega', entrega, 'grupo_whatsapp', 'Búfala 1'])).toEqual({ estado: 'aplicado' });
    expect(await valor(db, 'select registrar_copia_justificante($1, $2, $3, $4, $5) as r', [c1, 'entrega', entrega, 'grupo_whatsapp', 'Búfala 1'])).toEqual({ estado: 'duplicado' });
    const dev = uuid();
    await db.query('select registrar_devolucion($1, $2::jsonb)', [dev, JSON.stringify({ vehiculo: 'V-F01', tecnico: 'T1', motivo: 'sobrante', firma: 'data:image/png;base64,AA', lineas: [{ sku: MANG, unidades: 30, estado: 'bien' }] })]);
    await db.query('select registrar_copia_justificante($1, $2, $3, $4, $5)', [uuid(), 'devolucion', dev, 'grupo_whatsapp', 'Búfala 1']);
    const ret = uuid();
    await db.query('select registrar_retirada($1, $2::jsonb)', [ret, JSON.stringify({ socio: 'ESMOVE', recoge: 'Persona inventada', enNombre: 'socio', motivo: 'traslado', firma: 'data:image/png;base64,AA', lineas: [{ sku: CARG, cantidad: 1 }] })]);
    await db.query('select registrar_copia_retirada($1, $2, $3, $4)', [uuid(), ret, 'grupo_whatsapp', 'Esmove']);
    await superusuario(db);
    expect((await db.query(`select canal, destino, (entrega_id is not null) e, (devolucion_id is not null) d, (retirada_id is not null) r from copias_entrega order by ts, destino`)).rows).toEqual([
      { canal: 'grupo_whatsapp', destino: 'Búfala 1', e: true, d: false, r: false },
      { canal: 'grupo_whatsapp', destino: 'Búfala 1', e: false, d: true, r: false },
      { canal: 'grupo_whatsapp', destino: 'Esmove', e: false, d: false, r: true }]);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_copia_justificante($1, $2, $3, $4, $5)', [uuid(), 'entrega', entrega, 'whatsapp', ''])).toMatch(/Canal no válido/);
    expect(await falla(db, 'select registrar_copia_justificante($1, $2, $3, $4, $5)', [uuid(), 'devolucion', uuid(), 'grupo_whatsapp', ''])).toMatch(/devoluciones firmadas/);
    await db.query('select anular_retirada($1, $2)', [ret, 'Prueba']);
    expect(await falla(db, 'select registrar_copia_retirada($1, $2, $3, $4)', [uuid(), ret, 'grupo_whatsapp', ''])).toMatch(/retiradas firmadas/);
    // la copia por WhatsApp al técnico (E-014) sigue como siempre
    await db.query('select registrar_copia_entrega($1, $2, $3, $4)', [uuid(), entrega, 'whatsapp', '+34600000000']);
  });
});
