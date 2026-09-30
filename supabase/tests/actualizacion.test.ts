/* E-013 sobre una base YA EN USO: datos de antes de E-013 (con precios, n.º de serie y furgonetas con matrícula) y algo de actividad
   hecha con las funciones antiguas; después se aplica la migración de E-013. Es lo que pasa en producción con "supabase db push". */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, leer, nuevaBD, uuid, valor, type BD } from './pg';

const VIEJO = '00000000-0000-4000-8000-0000000000aa';
const ENT = '11111111-1111-4111-8111-111111111111';
const ACTIVIDAD_ANTIGUA = `
  insert into auth.users (id, email) values ('${VIEJO}', 'antes@x.es');
  insert into public.perfiles (id, nombre, rol, activo) values ('${VIEJO}', 'Usuario anterior', 'admin', true);
  select set_config('request.jwt.claim.sub', '${VIEJO}', false);
  select registrar_movimiento('${uuid()}', 'WBX-PULSAR-22', 'salida', 1, 'Instalado en obra', 'Garaje', array['WBX-22-899281'], null, null);
  select registrar_movimiento('${uuid()}', 'BF-FIX-SX8', 'salida', 100, 'Obra', 'C/ Eros 10', '{}', null, null);
  select preparar_entrega('${ENT}', 'F01', 'T1', 'C/ Eros 10', null, '[{"tipo": "stock", "sku": "CAB-RZ1K-5G6", "cantidad": 25}, {"tipo": "stock", "sku": "WBX-PULSAR-22", "cantidad": 1, "series": ["WBX-22-899282"]}]'::jsonb);
  select confirmar_entrega('${ENT}', 'data:image/png;base64,AA');
  select set_config('request.jwt.claim.sub', '', false);
`;

describe('migración E-013 sobre datos anteriores', () => {
  let db: BD;
  beforeAll(async () => {
    db = await nuevaBD({ seed: false, intercalar: { antesDe: '20261004', sql: leer('tests/fixtures/seed-e011.sql') + ACTIVIDAD_ANTIGUA } });
  });

  it('se aplica sin errores y deja la base en modo demostración (hay datos que borrar)', async () => {
    await como(db, ADMIN);
    expect(await valor(db, 'select modo_demo from config_app')).toBe(true);
  });
  it('las matrículas pasan a ser vehículos asignados a su equipo, con historial; los técnicos también', async () => {
    await como(db, ADMIN);
    expect((await db.query<{ id: string; equipo_id: string }>('select id, equipo_id from vehiculos order by id')).rows)
      .toEqual([{ id: 'V-F01', equipo_id: 'F01' }, { id: 'V-F02', equipo_id: 'F02' }, { id: 'V-F03', equipo_id: 'F03' }]);
    expect(await valor(db, "select vehiculo_de_equipo('F01')")).toBe('V-F01');
    expect(await valor(db, "select count(*)::int from asignaciones_tecnico where hasta is null")).toBeGreaterThan(0);
  });
  it('sin n.º de serie ni precios; el historial antiguo se conserva', async () => {
    await como(db, ADMIN);
    expect(await valor(db, 'select count(*)::int from productos where con_serie')).toBe(0);
    expect(await valor(db, "select count(*)::int from movimientos where sku = 'WBX-PULSAR-22'")).toBe(2);
    expect(await valor(db, 'select estado from entregas where id = $1', [ENT])).toBe('firmada');
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.every(r => r.ok)).toBe(true);   // la huella sigue cuadrando
  });
  it('la app sigue funcionando con el modelo nuevo encima de lo que había', async () => {
    await como(db, ALMACEN);
    await db.query('select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [uuid(), 'CAB-RZ1K-5G6', 'traspaso', 10, 'Carga del vehículo', '', [], null, null, 'V-F02']);
    expect(await valor(db, "select unidades::int from stock_vehiculo where vehiculo_id = 'V-F02' and sku = 'CAB-RZ1K-5G6'")).toBe(10);
  });
  it('y el borrado de la demostración funciona sobre esos datos', async () => {
    await como(db, ADMIN);
    const r = await valor<{ estado: string }>(db, 'select limpiar_demostracion() as r');
    expect(r.estado).toBe('aplicado');
    expect(await valor(db, 'select count(*)::int from productos')).toBe(0);
    expect(await valor(db, 'select count(*)::int from series')).toBe(0);
  });
});
