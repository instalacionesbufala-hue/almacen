/* E-017 · Salidas de material al EQUIPO: firma uno de sus técnicos ("recogido por") */
import { beforeAll, describe, expect, it } from 'vitest';
import { generarToken, hashToken } from '../functions/_compartido/portal';
import { ADMIN, ALMACEN, como, falla, leer, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
const CONF = 'select confirmar_entrega($1, $2, $3, $4) as r';
const FIRMA = 'data:image/png;base64,AA';
const cable = (q = 5) => JSON.stringify([{ tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: q }]);

describe('entrega al equipo con firma de uno de sus técnicos', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('se prepara para el equipo sin técnico; al firmar se elige quién recoge y queda con su DNI', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    await db.query(PREP, [id, 'F01', null, 'C/ Eros 10', null, JSON.stringify([{ tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: 5 }, { tipo: 'stock', sku: 'ROPA-PANT-44', cantidad: 1 }])]);
    expect(await valor(db, 'select receptor_id from entregas where id = $1', [id])).toBeNull();
    expect(await falla(db, CONF, [id, FIRMA, null, false])).toMatch(/Elige qué técnico/);
    expect(await falla(db, CONF, [id, FIRMA, 'T3', false])).toMatch(/no pertenece al equipo/);            // T3 es de Búfala 2
    const r = await valor<{ estado: string; recoge: string }>(db, CONF, [id, FIRMA, 'T2', false]);
    expect(r).toMatchObject({ estado: 'aplicado', recoge: 'T2' });
    expect((await db.query('select receptor_id, dni, equipo_id from entregas where id = $1', [id])).rows[0]).toEqual({ receptor_id: 'T2', dni: '***7730-K', equipo_id: 'F01' });
    // la dotación personal es de quien firma; el material de instalación, del vehículo del equipo
    expect(await valor(db, "select count(*)::int from dotacion d join dotacion_historial h on h.dotacion_id = d.id where h.nota like 'Entregada en % a Jorge Ruiz' and d.tecnico_id = 'T2' and d.clase = 'ropa'")).toBe(1);
    expect(await valor(db, "select unidades::int from stock_vehiculo where vehiculo_id = 'V-F01' and sku = 'CAB-RZ1K-5G6'")).toBe(155);
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.every(x => x.ok)).toBe(true);
    expect((await valor<{ estado: string }>(db, CONF, [id, FIRMA, 'T1', false])).estado).toBe('duplicado');   // reintento: no cambia quién firmó
  });
  it('la pertenencia se mira en el historial en el momento de firmar', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    await db.query(PREP, [id, 'F01', null, '', null, cable(1)]);
    await como(db, ADMIN);
    await db.query('select asignar_tecnico($1, $2)', ['T2', 'F03']);          // T2 cambia de equipo antes de firmar
    await como(db, ALMACEN);
    expect(await falla(db, CONF, [id, FIRMA, 'T2', false])).toMatch(/no pertenece al equipo/);
    await db.query(CONF, [id, FIRMA, 'T1', false]);
  });
  it('un equipo sin vehículo no puede recibir material de instalación', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_equipo($1::jsonb)', [JSON.stringify({ id: 'F09', nombre: 'Búfala 9' })]);
    await como(db, ALMACEN);
    expect(await falla(db, PREP, [uuid(), 'F09', null, '', null, cable(1)])).toMatch(/no tiene vehículo/);
  });
  it('la copia por correo va a quien firma y, si se marca, al resto del equipo', async () => {
    await como(db, ADMIN);
    await db.query('select asignar_tecnico($1, $2)', ['T2', 'F01']);
    await db.query('select guardar_email_tecnico($1, $2)', ['T2', 'jorge@ejemplo.es']);
    await como(db, ALMACEN);
    const a = uuid(), b = uuid();
    await db.query(PREP, [a, 'F01', null, '', null, cable(1)]);
    await db.query(CONF, [a, FIRMA, 'T1', false]);
    await db.query(PREP, [b, 'F01', null, '', null, cable(1)]);
    await db.query(CONF, [b, FIRMA, 'T1', true]);
    await superusuario(db);
    const dest = async (id: string) => (await valor<string[]>(db, 'select destinatarios from envios_aviso where entrega_id = $1', [id])).sort();
    expect(await dest(a)).toEqual(['luis.martin@ejemplo.es']);
    expect(await dest(b)).toEqual(['jorge@ejemplo.es', 'luis.martin@ejemplo.es']);
  });
});

describe('portal: entregas del equipo mientras el técnico pertenece a él', () => {
  let db: BD;
  it('ve las del equipo en su periodo, no las de antes ni las de otro equipo después de irse', async () => {
    db = await nuevaBD();
    const tok = generarToken(), h = await hashToken(tok);
    await como(db, ALMACEN);
    await db.query('select crear_enlace_portal($1, $2)', ['T1', h]);
    const antes = uuid(), deOtro = uuid(), despues = uuid();
    await db.query(PREP, [antes, 'F01', null, '', null, cable(1)]);
    await db.query(CONF, [antes, FIRMA, 'T2', false]);                          // firmada por su compañero: T1 también la ve
    await db.query(PREP, [deOtro, 'F03', null, '', null, cable(1)]);
    await db.query(CONF, [deOtro, FIRMA, 'T5', false]);
    await como(db, ADMIN);
    await db.query('select asignar_tecnico($1, $2)', ['T1', 'F03']);           // T1 se va a Búfala 3
    await como(db, ALMACEN);
    await db.query(PREP, [despues, 'F01', null, '', null, cable(1)]);
    await db.query(CONF, [despues, FIRMA, 'T2', false]);
    await db.exec('reset role; set role service_role;');
    const d = await valor<{ entregas: { id: string; recoge: string }[] }>(db, 'select portal_datos($1) as r', [h]);
    expect(d.entregas.map(e => e.id)).toEqual([antes]);                          // ni la de Búfala 3 de antes de llegar, ni la de Búfala 1 de después de irse
    expect(d.entregas[0].recoge).toBe('Jorge Ruiz');
    expect(await valor(db, 'select portal_entrega_permitida($1, $2)', [h, despues])).toBe(false);
  });
});

describe('entregas anteriores a E-017', () => {
  it('conservan su equipo y su técnico ("recogido por") y la huella sigue cuadrando', async () => {
    const ENT = uuid();
    const vieja = `
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000bb', 'antes@x.es');
      insert into public.perfiles (id, nombre, rol, activo) values ('00000000-0000-4000-8000-0000000000bb', 'Usuario anterior', 'admin', true);
      select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000bb', false);
      select preparar_entrega('${ENT}', 'F01', 'T1', '', null, '[{"tipo": "stock", "sku": "CAB-RZ1K-5G6", "cantidad": 3}]'::jsonb);
      select confirmar_entrega('${ENT}', 'data:image/png;base64,AA');
      select set_config('request.jwt.claim.sub', '', false);`;
    const db = await nuevaBD({ seed: false, intercalar: { antesDe: '20261009', sql: leer('seed.sql') + vieja } });
    await como(db, ADMIN);
    expect((await db.query('select equipo_id, receptor_id from entregas where id = $1', [ENT])).rows[0]).toEqual({ equipo_id: 'F01', receptor_id: 'T1' });
    expect((await db.query<{ ok: boolean }>('select * from verificar_entregas()')).rows.every(x => x.ok)).toBe(true);
  });
});
