/* E-038 · Retirada de material en custodia por el socio (o un tercero en su nombre): solo artículos de ese socio, sin pasar del
   stock, baja el stock (almacén o vehículo) y sale en el extracto, firma y número RET-, el socio la ve, y la anulación lo devuelve. */
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const CARG = 'T-ESM-CARG', AJENO = 'T-IBX-TAQ', ESM = '00000000-0000-4000-8000-000000000381';
let db: BD;
const stock = async (sku: string) => { await superusuario(db); return Number(await valor<string>(db, 'select stock::text from productos where sku = $1', [sku])); };
const aBordo = async (sku: string, veh = 'V-F01') => { await superusuario(db); return Number(await valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]) ?? 0); };
const BASE = { socio: 'ESMOVE', recoge: 'Persona inventada', recogeDoc: 'Transportes Ejemplo SL', enNombre: 'tercero', tercero: 'Instalador inventado', terceroEmpresa: 'Instalaciones Ficticias SL',
  motivo: 'traslado', referencia: 'PED-123', transporte: '0000-XXX', firma: 'data:image/png;base64,AA' };
const retirar = async (p: Record<string, unknown>, id = uuid(), uid = ADMIN) => { await como(db, uid); return valor<{ estado: string; numero: string; hash: string }>(db, 'select registrar_retirada($1, $2::jsonb) as r', [id, JSON.stringify({ ...BASE, ...p })]); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: CARG, nombre: 'Cargador de Esmove', categoria: 'cargadores', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 5, propiedad: 'custodia', propietario_id: 'ESMOVE' })]);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: AJENO, nombre: 'Taquilla de Instant Box', categoria: 'aparamenta', unidad: 'ud', contenido: 1, minimo: 0, nuevo: true, stock_inicial: 2, propiedad: 'custodia', propietario_id: 'INSTANTBOX' })]);
});

describe('retirada por el socio', () => {
  it('del almacén: número RET-, huella, stock y movimiento enlazado; idempotente', async () => {
    const id = uuid();
    const r = await retirar({ lineas: [{ sku: CARG, cantidad: 2 }] }, id);
    expect(r).toMatchObject({ estado: 'aplicado', numero: expect.stringMatching(/^RET-\d{4}-0001$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await stock(CARG)).toBe(3);
    expect(await valor(db, "select count(*)::int from movimientos where retirada_id = $1 and motivo = 'Retirada por el socio' and tipo = 'salida' and referencia = $2", [id, r.numero])).toBe(1);
    expect((await retirar({ lineas: [{ sku: CARG, cantidad: 2 }] }, id)).estado).toBe('duplicado');
    expect(await stock(CARG)).toBe(3);
    expect(await valor(db, "select count(*)::int from auditoria where accion = 'registrar_retirada'")).toBe(1);
  });

  it('solo artículos en custodia de ese socio, sin pasar del stock ni de lo reservado; con firma', async () => {
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, lineas: [{ sku: AJENO, cantidad: 1 }] })])).toMatch(/no es material en custodia de Esmove/i);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, lineas: [{ sku: 'CAB-RZ1K-5G6', cantidad: 1 }] })])).toMatch(/no es material en custodia/);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, lineas: [{ sku: CARG, cantidad: 6 }] })])).toMatch(/Solo hay 5/);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, firma: '', lineas: [{ sku: CARG, cantidad: 1 }] })])).toMatch(/Falta la firma/);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, tercero: '', lineas: [{ sku: CARG, cantidad: 1 }] })])).toMatch(/tercero autorizado/);
    // reservado para una entrega preparada
    await como(db, ADMIN);
    await db.query('select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb)', [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: CARG, cantidad: 4 }])]);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, lineas: [{ sku: CARG, cantidad: 2 }] })])).toMatch(/reservadas/);
    expect(await stock(CARG)).toBe(5);
  });

  it('desde un vehículo: baja lo de a bordo y sale en el extracto', async () => {
    await superusuario(db);
    await db.exec(`insert into stock_vehiculo (vehiculo_id, sku, unidades) values ('V-F01', '${CARG}', 2);
      insert into movimientos (id, sku, tipo, cantidad, motivo, referencia, vehiculo_id, unidades, operario) values (gen_random_uuid(), '${CARG}', 'traspaso', 2, 'Entrega a equipo', 'ENT-PRUEBA', 'V-F01', 2, 'Prueba');`);
    await como(db, ADMIN);
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, vehiculo: 'V-F01', lineas: [{ sku: CARG, cantidad: 3 }] })])).toMatch(/solo lleva 2/);
    const r = await retirar({ vehiculo: 'V-F01', lineas: [{ sku: CARG, cantidad: 1 }] });
    expect([await aBordo(CARG), await stock(CARG)]).toEqual([1, 5]);
    await como(db, ADMIN);
    const e = await valor<{ filas: { tipo: string; unidades: number; referencia: string }[]; saldoCalculado: number; stock: number }>(db, `select extracto_vehiculo('V-F01', '${CARG}') as r`);
    expect(e.filas.at(-1)).toMatchObject({ tipo: 'retirada', unidades: -1, referencia: r.numero });
    expect([e.saldoCalculado, e.stock]).toEqual([1, 1]);
  });

  it('el almacén (con permiso de movimientos) la registra; solo el administrador la anula, y la anulación devuelve el stock', async () => {
    const id = uuid();
    const r = await retirar({ lineas: [{ sku: CARG, cantidad: 2 }] }, id, ALMACEN);
    expect(r.estado).toBe('aplicado');
    await como(db, ALMACEN);
    expect(await falla(db, 'select anular_retirada($1, $2)', [id, 'Error'])).toMatch(/administrador/i);
    await como(db, ADMIN);
    expect(await falla(db, 'select anular_retirada($1, $2)', [id, ''])).toMatch(/motivo/);
    await como(db, ADMIN);
    expect(await valor(db, 'select anular_retirada($1, $2) as r', [id, 'Se registró dos veces'])).toMatchObject({ estado: 'aplicado' });
    expect(await stock(CARG)).toBe(5);
    expect(await valor(db, "select count(*)::int from movimientos where retirada_id = $1 and corrige is not null and motivo like 'Anulación de retirada RET-%'", [id])).toBe(1);
    await superusuario(db);
    expect(await valor(db, 'select estado from retiradas where id = $1', [id])).toBe('anulada');
    // inalterable: ni se modifica ni se borra
    await superusuario(db);
    expect(await falla(db, `update retiradas set recoge_nombre = 'Otro' where id = '${id}'`)).toMatch(/no se puede modificar/);
    await superusuario(db);
    expect(await falla(db, `delete from retiradas where id = '${id}'`)).toMatch(/no se puede modificar ni borrar/);
  });

  it('el socio ve su retirada (con firma, para el PDF) y no la de otro; no puede registrarla', async () => {
    const r = await retirar({ lineas: [{ sku: CARG, cantidad: 1 }] });
    await superusuario(db);
    await db.exec(`insert into auth.users (id, email) values ('${ESM}', 'esmove@x.es');
      insert into perfiles (id, nombre, rol, activo, propietario_id) values ('${ESM}', 'Persona de Esmove', 'socio', true, 'ESMOVE');`);
    await como(db, ESM);
    const d = await valor<{ retiradas: { numero: string; firma: string; recoge_nombre: string; tercero_nombre: string; usuario?: string }[] }>(db, 'select datos_socio() as r');
    expect(d.retiradas).toHaveLength(1);
    expect(d.retiradas[0]).toMatchObject({ numero: r.numero, firma: BASE.firma, recoge_nombre: 'Persona inventada', tercero_nombre: 'Instalador inventado' });
    expect(d.retiradas[0].usuario).toBeUndefined();
    expect(Number(await valor(db, 'select count(*) from retiradas'))).toBe(0);                       // directo, nada (RLS)
    expect(await falla(db, 'select registrar_retirada($1, $2::jsonb)', [uuid(), JSON.stringify({ ...BASE, lineas: [{ sku: CARG, cantidad: 1 }] })])).toMatch(/Acceso de socio/);
  });
});
