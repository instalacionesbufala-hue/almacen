/* E-011 · Entregas libres: correo del técnico, copia automática al firmar, reenvío, serie obligatoria y plantillas sin uso */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
const FIRMA = 'data:image/png;base64,AA';
const preparar = (db: BD, id: string, lineas: unknown[], receptor = 'T1', equipo = 'F01') => db.query(PREP, [id, equipo, receptor, 'C/ Eros 10', null, JSON.stringify(lineas)]);
const envios = (db: BD, id: string) => db.query<{ estado: string; destinatarios: string[]; asunto: string; tipo: string }>(
  'select estado, destinatarios, asunto, tipo from envios_aviso where entrega_id = $1 order by ts, id', [id]).then(r => r.rows);

describe('correo del técnico', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('el almacén solo puede escribir el correo (validado); la ficha completa es del administrador', async () => {
    await como(db, ALMACEN);
    await db.query('select guardar_email_tecnico($1, $2)', ['T1', '  Luis.Martin@Bufalatech.es ']);
    expect(await valor(db, "select email from tecnicos where id = 'T1'")).toBe('luis.martin@bufalatech.es');
    expect(await falla(db, 'select guardar_email_tecnico($1, $2)', ['T1', 'luis@'])).toMatch(/Correo no válido/);
    expect(await falla(db, 'select guardar_tecnico($1::jsonb)', [JSON.stringify({ id: 'T1', nombre: 'Otro', dni_mascara: '—' })])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    // la ficha sin campo email no borra el correo guardado
    await db.query('select guardar_tecnico($1::jsonb)', [JSON.stringify({ id: 'T1', nombre: 'Luis Martín', rol: 'Técnico', dni_mascara: '***4521-K' })]);
    expect(await valor(db, "select email from tecnicos where id = 'T1'")).toBe('luis.martin@bufalatech.es');
  });
});

describe('copia de la entrega por correo', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ADMIN); await db.query('select guardar_email_tecnico($1, $2)', ['T1', 'luis@bufalatech.es']); });

  it('al firmar se encola la copia al técnico, en la misma operación (con número y fecha en el asunto)', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    await preparar(db, id, [{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 100 }]);
    expect(await envios(db, id)).toHaveLength(0);                  // preparada: aún no hay copia
    await db.query('select confirmar_entrega($1, $2)', [id, FIRMA]);
    const [e] = await envios(db, id);
    expect(e).toMatchObject({ estado: 'pendiente', tipo: 'entrega', destinatarios: ['luis@bufalatech.es'] });
    expect(e.asunto).toMatch(/^Entrega de material n\.º ENT-\d{4}-\d{4} · \d{2}\/\d{2}\/\d{4}$/);
    // reintento de la cola: firmar dos veces no duplica la copia
    await db.query('select confirmar_entrega($1, $2)', [id, FIRMA]);
    expect(await envios(db, id)).toHaveLength(1);
  });

  it('copia al administrador si está configurada; sin correo del técnico no se encola nada', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_config_avisos($1::jsonb)', [JSON.stringify({ correo_destinatarios: ['admin@bufalatech.es'], copia_entregas_admin: true })]);
    await como(db, ALMACEN);
    const a = uuid(), b = uuid();
    await preparar(db, a, [{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 10 }]);
    await db.query('select confirmar_entrega($1, $2)', [a, FIRMA]);
    expect((await envios(db, a))[0].destinatarios.sort()).toEqual(['admin@bufalatech.es', 'luis@bufalatech.es']);
    await como(db, ADMIN);
    await db.query('select guardar_config_avisos($1::jsonb)', [JSON.stringify({ copia_entregas_admin: false })]);
    await como(db, ALMACEN);
    await preparar(db, b, [{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 10 }], 'T3', 'F02');   // Andrea: sin correo
    await db.query('select confirmar_entrega($1, $2)', [b, FIRMA]);
    expect(await envios(db, b)).toHaveLength(0);
    expect(await falla(db, 'select reenviar_copia_entrega($1)', [b])).toMatch(/no tiene correo/);
    // se escribe el correo al reenviar: queda en la ficha y se encola
    await db.query('select reenviar_copia_entrega($1, $2)', [b, 'andrea@bufalatech.es']);
    expect((await envios(db, b))[0].destinatarios).toEqual(['andrea@bufalatech.es']);
    expect(await valor(db, "select email from tecnicos where id = 'T3'")).toBe('andrea@bufalatech.es');
  });

  it('reenviar: el intento fallido deja de reintentarse y queda registrado; el nuevo sale pendiente', async () => {
    await como(db, ALMACEN);
    const id = uuid();
    await preparar(db, id, [{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 5 }]);
    await db.query('select confirmar_entrega($1, $2)', [id, FIRMA]);
    await superusuario(db);   // lo que hace la función "notificar" cuando Resend rechaza el envío
    await db.query("update envios_aviso set estado = 'error', error = 'Resend 403', reintentos = 5 where entrega_id = $1", [id]);
    await como(db, ALMACEN);
    await db.query('select reenviar_copia_entrega($1)', [id]);
    expect((await envios(db, id)).map(e => e.estado)).toEqual(['descartado', 'pendiente']);
    // una preparada no se reenvía
    const p = uuid();
    await preparar(db, p, [{ tipo: 'stock', sku: 'BF-FIX-SX8', cantidad: 1 }]);
    expect(await falla(db, 'select reenviar_copia_entrega($1)', [p])).toMatch(/firmada/);
  });

  it('el almacén ve el estado de las copias de entregas, pero no el resto del registro de envíos', async () => {
    await como(db, ADMIN);
    await db.query("select encolar_envio('correo', 'prueba', 'Prueba', 'x', array['admin@bufalatech.es'])");
    await como(db, ALMACEN);
    const tipos = (await db.query<{ tipo: string }>('select distinct tipo from envios_aviso')).rows.map(r => r.tipo);
    expect(tipos).toEqual(['entrega']);
  });
});

describe('cesta libre: reglas que siguen en el servidor', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('los cargadores exigen su n.º de serie; los cuadros no llevan', async () => {
    expect(await falla(db, PREP, [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: 'WBX-PULSAR-22', cantidad: 1 }])])).toMatch(/n\.º de serie/);
    await db.query(PREP, [uuid(), 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: 'WBX-PULSAR-22', cantidad: 1, series: ['WBX-22-899281'] }, { tipo: 'stock', sku: 'ESM-CPVE-MONO', cantidad: 1 }])]);
  });
  it('las plantillas quedan sin uso: nadie puede guardarlas', async () => {
    await como(db, ADMIN);
    expect(await falla(db, 'select guardar_plantilla($1::jsonb)', [JSON.stringify({ id: uuid(), nombre: 'x', lineas: [] })])).toMatch(/permission denied/);
  });
});
