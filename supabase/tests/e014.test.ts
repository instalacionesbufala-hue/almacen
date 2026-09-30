/* E-014 · Portal del técnico (token por hash, revocación, cada técnico solo ve lo suyo), teléfono y registro de copias */
import { beforeAll, describe, expect, it } from 'vitest';
import { generarToken, hashToken } from '../functions/_compartido/portal';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
const servidor = (db: BD) => db.exec("reset role; set role service_role;");   // lo que hace la función portal-tecnico
type Portal = { tecnico: { id: string; nombre: string }; entregas: { id: string; numero: string; lineas: { nombre: string; cantidad: number }[] }[]; vehiculo: { matricula: string } | null; a_bordo: { sku: string; unidades: number }[] };

describe('portal del técnico', () => {
  let db: BD;
  const tokT1 = generarToken(), tokT1b = generarToken(), tokT3 = generarToken();
  let hT1 = '', hT1b = '', hT3 = '';
  const entT1 = uuid(), entT3 = uuid();
  beforeAll(async () => {
    db = await nuevaBD();
    [hT1, hT1b, hT3] = await Promise.all([hashToken(tokT1), hashToken(tokT1b), hashToken(tokT3)]);
    await como(db, ALMACEN);
    await db.query(PREP, [entT1, 'F01', 'T1', 'C/ Eros 10', null, JSON.stringify([{ tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: 20 }])]);
    await db.query('select confirmar_entrega($1, $2)', [entT1, 'data:image/png;base64,AA']);
    await db.query(PREP, [entT3, 'F02', 'T3', '', null, JSON.stringify([{ tipo: 'stock', sku: 'ESM-CPVE-MONO', cantidad: 1 }])]);
    await db.query('select confirmar_entrega($1, $2)', [entT3, 'data:image/png;base64,AA']);
  });
  const portal = async (h: string) => { await servidor(db); const r = await valor<Portal | null>(db, 'select portal_datos($1) as r', [h]); return r; };

  it('el almacén crea enlaces enviando solo el hash; no se guarda el token en ningún sitio', async () => {
    await como(db, ALMACEN);
    await db.query('select crear_enlace_portal($1, $2, $3)', ['T1', hT1, entT1]);
    await db.query('select crear_enlace_portal($1, $2, $3)', ['T1', hT1b, null]);
    await db.query('select crear_enlace_portal($1, $2, $3)', ['T3', hT3, entT3]);
    expect(await valor(db, 'select crear_enlace_portal($1, $2) as r', ['T1', hT1])).toEqual({ estado: 'duplicado' });      // reintento de la cola
    expect(await falla(db, 'select crear_enlace_portal($1, $2)', ['T3', hT1])).toMatch(/Enlace no válido/);                 // ese hash es de otro técnico
    expect(await falla(db, 'select crear_enlace_portal($1, $2)', ['T1', tokT1])).toMatch(/Enlace no válido/);               // un token en claro no se acepta
    await superusuario(db);
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'portal_enlaces'")).rows.map(r => r.column_name);
    expect(cols).not.toContain('token');
    const todo = JSON.stringify((await db.query('select * from portal_enlaces')).rows);
    expect(todo).not.toContain(tokT1);
    expect(todo).toContain(hT1);
  });
  it('con su enlace, cada técnico ve SOLO sus entregas firmadas y el material de su vehículo', async () => {
    const d1 = (await portal(hT1))!;
    expect(d1.tecnico).toMatchObject({ id: 'T1', nombre: 'Luis Martín' });
    expect(d1.entregas.map(e => e.id)).toEqual([entT1]);
    expect(d1.entregas[0].lineas[0]).toMatchObject({ nombre: expect.stringMatching(/RZ1-K/), cantidad: 20 });
    expect(d1.vehiculo?.matricula).toBe('0000-DEM');
    expect(d1.a_bordo.find(a => a.sku === 'CAB-RZ1K-5G6')?.unidades).toBe(170);        // 150 + 20
    const d3 = (await portal(hT3))!;
    expect(d3.entregas.map(e => e.id)).toEqual([entT3]);
    expect(JSON.stringify(d3)).not.toContain(entT1);
    expect(JSON.stringify(d1)).not.toMatch(/precio|€/);
    expect(await portal('0'.repeat(64))).toBeNull();
  });
  it('el PDF solo se da si la entrega es de ese enlace', async () => {
    await servidor(db);
    expect(await valor(db, 'select portal_entrega_permitida($1, $2)', [hT1, entT1])).toBe(true);
    expect(await valor(db, 'select portal_entrega_permitida($1, $2)', [hT1, entT3])).toBe(false);
  });
  it('ni el almacén ni el público pueden leer el portal directamente', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select portal_datos($1)', [hT1])).toMatch(/permission denied/);
    expect(await falla(db, 'select hash from portal_enlaces')).toMatch(/permission denied/);
    expect((await db.query('select tecnico_id from portal_enlaces')).rows.length).toBe(3);
    await db.exec('reset role; set role anon;');
    expect(await falla(db, 'select portal_datos($1)', [hT1])).toMatch(/permission denied/);
  });
  it('revocar: todos los enlaces del técnico dejan de funcionar; los de los demás siguen', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select revocar_enlaces_portal($1)', ['T1'])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    expect(await valor(db, 'select revocar_enlaces_portal($1) as r', ['T1'])).toMatchObject({ revocados: 2 });
    expect(await portal(hT1)).toBeNull();
    expect(await portal(hT1b)).toBeNull();
    expect((await portal(hT3))?.tecnico.id).toBe('T3');
    // un enlace nuevo vuelve a funcionar
    await como(db, ADMIN);
    const h = await hashToken(generarToken());
    await db.query('select crear_enlace_portal($1, $2)', ['T1', h]);
    expect((await portal(h))?.entregas.map(e => e.id)).toEqual([entT1]);
  });
  it('un técnico dado de baja no ve nada', async () => {
    await como(db, ADMIN);
    await db.query('select baja_tecnico($1)', ['T3']);
    expect(await portal(hT3)).toBeNull();
  });
});

describe('teléfono y registro de copias', () => {
  let db: BD;
  const ent = uuid();
  beforeAll(async () => {
    db = await nuevaBD(); await como(db, ALMACEN);
    await db.query(PREP, [ent, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: 'CAB-RZ1K-5G6', cantidad: 1 }])]);
  });

  it('el almacén guarda el teléfono (validado, con prefijo)', async () => {
    await como(db, ALMACEN);
    await db.query('select guardar_telefono_tecnico($1, $2)', ['T2', '+34 600 11 22 33']);
    expect(await valor(db, "select telefono from tecnicos where id = 'T2'")).toBe('+34600112233');
    expect(await falla(db, 'select guardar_telefono_tecnico($1, $2)', ['T2', '600112233'])).toMatch(/prefijo del país/);
    await db.query('select guardar_telefono_tecnico($1, $2)', ['T2', '']);
    expect(await valor(db, "select telefono from tecnicos where id = 'T2'")).toBeNull();
  });
  it('cada copia enviada queda en el historial de la entrega (solo firmadas, sin duplicar)', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    expect(await falla(db, 'select registrar_copia_entrega($1, $2, $3, $4)', [id, ent, 'whatsapp', '+34600112233'])).toMatch(/firmadas/);
    await db.query('select confirmar_entrega($1, $2)', [ent, 'data:image/png;base64,AA']);
    await db.query('select registrar_copia_entrega($1, $2, $3, $4)', [id, ent, 'whatsapp', '+34600112233']);
    expect(await valor(db, 'select registrar_copia_entrega($1, $2, $3, $4) as r', [id, ent, 'whatsapp', '+34600112233'])).toEqual({ estado: 'duplicado' });
    await db.query('select registrar_copia_entrega($1, $2, $3, $4)', [uuid(), ent, 'compartir', '']);
    const filas = (await db.query<{ canal: string; operario: string }>('select canal, operario from copias_entrega where entrega_id = $1 order by ts', [ent])).rows;
    expect(filas).toEqual([{ canal: 'whatsapp', operario: 'Operario Pruebas' }, { canal: 'compartir', operario: 'Operario Pruebas' }]);
    expect(await falla(db, 'select registrar_copia_entrega($1, $2, $3, $4)', [uuid(), ent, 'paloma', ''])).toMatch(/check constraint/);
  });
});
