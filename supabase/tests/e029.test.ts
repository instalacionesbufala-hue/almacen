/* E-029 · Cierres "Equipo sin vehículo" (caso real del 30/09: las asignaciones se crearon esa noche, después de los cierres).
   Editar la fecha de inicio de una asignación (sin solapes, con auditoría) y reprocesar los afectados, y el atajo
   "usar el vehículo que el equipo tiene ahora". Fechas relativas: las pruebas no dependen del día. */
import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIVALENCIAS_PROPUESTA, type Regla } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, valor, type BD } from './pg';

const H = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const REGLAS: Regla[] = [
  { id: 'T-L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 10 },
  ...EQUIVALENCIAS_PROPUESTA.filter(r => r.campo === 'hardware'),
];
const PROD = (sku: string) => JSON.stringify({ sku, nombre: `Artículo ${sku}`, categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, propiedad: 'custodia', propietario_id: 'ESMOVE' });
const SCHUKO = 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5 + SCHUKO', TRYDAN = 'V2C TRYDAN MONOFÁSICO PROTECCIONES M5';

let db: BD, hash: string;
const enviar = (raw: Record<string, unknown>) => enviarCierre(db, hash, raw, { reglas: REGLAS, kits: {}, origen: 'historico' });
const aBordo = async (veh: string, sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]) ?? 0); };
const idCierre = async (n: string) => { await superusuario(db); return valor<string>(db, 'select id from cierres where num_inst = $1', [n]); };
const asig = async (veh: string) => { await superusuario(db); return valor<string>(db, 'select id from asignaciones_vehiculo where vehiculo_id = $1 and hasta is null', [veh]); };

/** Como en producción: las furgonetas se asignaron hace 1 h y los cierres son de hace 6-3 h → "Equipo sin vehículo" */
beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const sku of ['8900500015', '8900590300']) await db.query('select guardar_producto($1::jsonb)', [PROD(sku)]);
  await db.query('select config_cierres($1, $2, $3)', ['A', null, H(48)]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard de cierres'])).token);
  await superusuario(db);
  await db.exec(`update asignaciones_vehiculo set desde = now() - interval '1 hour';
    insert into stock_vehiculo (vehiculo_id, sku, unidades) values ('V-F01', '8900500015', 1) on conflict (vehiculo_id, sku) do update set unidades = 1;`);
  for (const c of [
    { numInst: 'E2632077', equipo: 'Búfala 2', fechaCierreIso: H(-6), hardware: '', tipoLinea: 'manguera', metrosLinea: 4 },
    { numInst: 'E2632246', equipo: 'Búfala 1', fechaCierreIso: H(-5), hardware: SCHUKO, tipoLinea: 'manguera', metrosLinea: 5 },
    { numInst: 'E2631828', equipo: 'Búfala 2', fechaCierreIso: H(-4), hardware: TRYDAN },
    { numInst: 'E2632105', equipo: 'Búfala 3', fechaCierreIso: H(-3), hardware: TRYDAN },
  ]) expect((await enviar(c)).estado).toBe('sin_vehiculo');
});

describe('editar la fecha de inicio de una asignación', () => {
  it('adelantar la de 2690NKC → Búfala 1 deja reprocesar su cierre: el Schuko a bordo queda en 0 y la versión lo cuenta', async () => {
    const id = await asig('V-F01'), b1 = await idCierre('E2632246');
    await como(db, ADMIN);
    const r = await valor<{ afectados: string[] }>(db, 'select editar_inicio_asignacion($1, $2, $3) as r', ['vehiculo', id, H(-8)]);
    expect(r.afectados).toEqual([b1]);                                   // solo el de Búfala 1
    await como(db, ADMIN);
    expect(await valor(db, 'select reprocesar_cierres($1::uuid[]) as r', [r.afectados])).toEqual({ estado: 'aplicado', procesados: 1, siguen: [] });
    expect(await aBordo('V-F01', '8900500015')).toBe(0);
    expect(await aBordo('V-F01', 'CAB-RZ1K-5G6')).toBe(150 - 5);
    expect(await valor(db, "select estado from cierres where num_inst = 'E2632246'")).toBe('aplicado');
    const v = (await db.query<{ n: number; origen: string; documento: string; diferencia: unknown }>("select n, v.origen, documento, diferencia from cierre_versiones v join cierres c on c.id = v.cierre_id where num_inst = 'E2632246' order by n")).rows;
    expect(v.map(x => [x.n, x.origen])).toEqual([[1, 'historico'], [2, 'admin']]);
    expect(v[1].documento).toMatch(/^Reprocesado por .+ con 0000-DEM \(historial de asignaciones\)$/);
    expect(v[1].diferencia).toEqual([{ sku: '8900500015', unidades: 1 }, { sku: 'CAB-RZ1K-5G6', unidades: 5 }]);
    // queda en la auditoría, con la fecha de antes y la de después
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'editar_inicio_asignacion' and detalle->>'equipo' = 'F01'")).toBe(1);
    // los demás siguen igual
    expect(await valor(db, "select count(*)::int from cierres where estado = 'sin_vehiculo'")).toBe(3);
  });

  it('no deja solapar con otra asignación del mismo vehículo o del mismo equipo, ni poner una fecha futura; técnicos también', async () => {
    await superusuario(db);
    // V-F01 estuvo antes en Búfala 3 hasta hace 7 h
    await db.exec(`insert into asignaciones_vehiculo (vehiculo_id, equipo_id, desde, hasta) values ('V-F01', 'F03', now() - interval '20 hours', now() - interval '7 hours');`);
    await como(db, ADMIN);
    const id = await asig('V-F01');
    await como(db, ADMIN);
    expect(await falla(db, 'select editar_inicio_asignacion($1, $2, $3)', ['vehiculo', id, H(-8)])).toMatch(/Se solapa con otra asignación \(0000-DEM en Búfala 3/);
    expect(await falla(db, 'select editar_inicio_asignacion($1, $2, $3)', ['vehiculo', id, H(1)])).toMatch(/no puede ser futura/);
    // justo donde acaba la otra sí (los tramos se tocan, no se solapan)
    await superusuario(db);
    const fin = await valor<string>(db, "select hasta::text from asignaciones_vehiculo where equipo_id = 'F03' and vehiculo_id = 'V-F01'");
    await como(db, ADMIN);
    expect((await valor<{ estado: string }>(db, 'select editar_inicio_asignacion($1, $2, $3) as r', ['vehiculo', id, fin])).estado).toBe('aplicado');
    // el mismo equipo con otro vehículo a la vez
    await superusuario(db);
    await db.exec(`insert into asignaciones_vehiculo (vehiculo_id, equipo_id, desde, hasta) values ('V-F03', 'F02', now() - interval '30 hours', now() - interval '10 hours');`);
    const id2 = await asig('V-F02');
    await como(db, ADMIN);
    expect(await falla(db, 'select editar_inicio_asignacion($1, $2, $3)', ['vehiculo', id2, H(-12)])).toMatch(/Se solapa con otra asignación \(0000-DEP en Búfala 2/);
    // técnico: solo choca con otra asignación del mismo técnico
    await superusuario(db);
    const t = await valor<string>(db, "select id from asignaciones_tecnico where tecnico_id = 'T1' and hasta is null");
    await como(db, ADMIN);
    expect((await valor<{ estado: string; afectados: string[] }>(db, 'select editar_inicio_asignacion($1, $2, $3) as r', ['tecnico', t, H(-100)]))).toEqual({ estado: 'aplicado', afectados: [] });
  });

  it('solo el administrador; Almacén se rechaza', async () => {
    await superusuario(db);
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000029', 'jefe@x.es');
      insert into perfiles (id, nombre, rol, activo) values ('00000000-0000-4000-8000-000000000029', 'Jefe Pruebas', 'almacen', true);`);
    const id = await asig('V-F01'), b1 = await idCierre('E2632246');
    await como(db, '00000000-0000-4000-8000-000000000029');
    expect(await falla(db, 'select editar_inicio_asignacion($1, $2, $3)', ['vehiculo', id, H(-8)])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select usar_vehiculo_actual($1::uuid[])', [[b1]])).toMatch(/Solo el administrador/);
  });
});

describe('atajo: usar el vehículo que el equipo tiene ahora', () => {
  it('procesa todos los "sin vehículo" con el vehículo actual, lo deja en la versión y no toca el historial', async () => {
    await superusuario(db);
    const antes = (await db.query('select vehiculo_id, equipo_id, desde from asignaciones_vehiculo order by vehiculo_id')).rows;
    const ids = (await db.query<{ id: string }>("select id from cierres where estado = 'sin_vehiculo'")).rows.map(x => x.id);
    await como(db, ADMIN);
    expect(await valor(db, 'select usar_vehiculo_actual($1::uuid[]) as r', [ids])).toEqual({ estado: 'aplicado', procesados: 4, siguen: [] });
    await superusuario(db);
    expect((await db.query('select vehiculo_id, equipo_id, desde from asignaciones_vehiculo order by vehiculo_id')).rows).toEqual(antes);
    expect(await valor(db, "select count(*)::int from cierres where estado = 'sin_vehiculo'")).toBe(0);
    expect(await aBordo('V-F01', '8900500015')).toBe(0);                                          // el Schuko de 2690NKC
    // los Trydan de Esmove no salieron del almacén: no se descuentan
    expect((await db.query("select estado from cierre_lineas where sku = '8900590300'")).rows).toEqual([{ estado: 'no_entregado' }, { estado: 'no_entregado' }]);
    expect(await aBordo('V-F02', '8900590300')).toBe(0);
    expect(await valor(db, "select documento from cierre_versiones v join cierres c on c.id = v.cierre_id where num_inst = 'E2632105' and n = 2"))
      .toMatch(/^Vehículo asignado a mano por .+: 0000-DEP \(el que el equipo tiene ahora\)$/);
    // ya procesados: repetir no hace nada
    await como(db, ADMIN);
    expect(await valor(db, 'select usar_vehiculo_actual($1::uuid[]) as r', [ids])).toEqual({ estado: 'aplicado', procesados: 0, siguen: [] });
  });

  it('un equipo que hoy no tiene vehículo sigue bloqueado y se dice cuál', async () => {
    await como(db, ADMIN);
    await db.query('select asignar_vehiculo($1, $2)', ['V-F03', null]);
    const ids = [await idCierre('E2632105'), await idCierre('E2632246')];
    await como(db, ADMIN);
    expect(await valor(db, 'select usar_vehiculo_actual($1::uuid[]) as r', [ids])).toEqual({ estado: 'aplicado', procesados: 1, siguen: ['E2632105'] });
  });
});
