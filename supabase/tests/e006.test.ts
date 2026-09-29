/* E-006 · Avisos de reposición en el servidor (+ E-008: custodia de Esmove) */
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const MOV = 'select registrar_movimiento($1, $2, $3, $4, $5, $6, $7, $8) as r';
const abiertos = (db: BD, sku: string) => valor<number>(db, "select count(*)::int from avisos_reposicion where sku = $1 and estado <> 'cerrado'", [sku]);

describe('trigger de avisos', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); await como(db, ALMACEN); });

  it('lo que ya estaba bajo mínimo al cargar tiene su aviso', async () => {
    expect(await abiertos(db, 'BF-FIX-SX6')).toBe(1);   // 80 tacos, mínimo 100
    expect(await abiertos(db, 'BF-FIX-SX8')).toBe(0);
  });
  it('crea el aviso solo al cruzar el mínimo hacia abajo y no lo duplica', async () => {
    // tacos SX 8: 1200, mínimo 100
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'salida', 1000, 'Obra', 'C/ Eros 10', [], null]);   // 200: por encima
    expect(await abiertos(db, 'BF-FIX-SX8')).toBe(0);
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'salida', 150, 'Obra', 'C/ Eros 10', [], null]);    // 50: cruza
    expect(await abiertos(db, 'BF-FIX-SX8')).toBe(1);
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'salida', 20, 'Obra', 'C/ Eros 10', [], null]);     // 30: sigue abajo
    expect(await abiertos(db, 'BF-FIX-SX8')).toBe(1);
    const a = (await db.query<{ destino: string; grupo: string }>("select destino, grupo from avisos_reposicion where sku = 'BF-FIX-SX8'")).rows[0];
    expect(a).toEqual({ destino: 'proveedor', grupo: 'Saltoki Alcobendas' });
  });
  it('se cierra solo cuando una entrada devuelve el stock al mínimo; si vuelve a bajar, nace otro', async () => {
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'entrada', 50, 'Compra a proveedor', 'Alb. 1', [], null]);   // 80
    expect(await abiertos(db, 'BF-FIX-SX8')).toBe(1);
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'entrada', 20, 'Compra a proveedor', 'Alb. 2', [], null]);   // 100 = mínimo
    expect(await abiertos(db, 'BF-FIX-SX8')).toBe(0);
    expect(await valor(db, "select estado from avisos_reposicion where sku = 'BF-FIX-SX8'")).toBe('cerrado');
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'salida', 1, 'Obra', 'C/ Eros 10', [], null]);
    expect(await valor(db, "select count(*)::int from avisos_reposicion where sku = 'BF-FIX-SX8'")).toBe(2);
  });
  it('subir el mínimo por encima del stock también avisa (y solo el administrador puede)', async () => {
    const cambio = JSON.stringify([{ sku: '7501013532', minimo: 10, objetivo: 20 }]);   // magnetotérmico Hager: 6
    expect(await falla(db, 'select fijar_minimos($1::jsonb)', [cambio])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select fijar_minimos($1::jsonb)', [cambio]);
    expect(await abiertos(db, '7501013532')).toBe(1);
    await como(db, ALMACEN);
  });
  it('el aviso de custodia va a Esmove (propietario), no a proveedores', async () => {
    await db.query(MOV, [uuid(), 'ESM-CPVE-MONO', 'salida', 2, 'Instalado en obra', 'Garaje C/ Recogidas 12', [], null]);  // 3 → 1, mínimo 2
    const a = (await db.query<{ destino: string; grupo: string }>("select destino, grupo from avisos_reposicion where sku = 'ESM-CPVE-MONO' and estado <> 'cerrado'")).rows[0];
    expect(a).toEqual({ destino: 'propietario', grupo: 'ESMOVE' });
  });
});

describe('cantidad sugerida, pedidos y herramientas de repuesto', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('objetivo − stock redondeado al formato de compra (por defecto 2 × mínimo)', async () => {
    await como(db, ADMIN);
    expect(await valor(db, 'select cantidad_sugerida(80, 100, null, 100)::int')).toBe(200);   // hasta 200, cajas de 100
    expect(await valor(db, 'select cantidad_sugerida(80, 100, 250, 100)::int')).toBe(200);    // faltan 170 → 2 cajas
    expect(await valor(db, 'select cantidad_sugerida(1, 2, 5, 1)::int')).toBe(4);
    expect(await valor(db, 'select cantidad_sugerida(300, 100, 250, 100)::int')).toBe(0);
    expect(await valor(db, 'select cantidad_sugerida(29, 40, null, 2)::int')).toBe(52);      // tramos de 2 m
  });
  it('el administrador marca el pedido; el almacén no', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select marcar_pedido($1, $2, $3)', ['BF-FIX-SX6', 200, null])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select marcar_pedido($1, $2, $3)', ['BF-FIX-SX6', 200, 'Saltoki Alcobendas']);
    const a = (await db.query<{ estado: string; cantidad_pedida: string }>("select estado, cantidad_pedida::int as cantidad_pedida from avisos_reposicion where sku = 'BF-FIX-SX6' and estado <> 'cerrado'")).rows[0];
    expect(a).toEqual({ estado: 'pedido', cantidad_pedida: 200 });
  });
  it('herramientas: aviso cuando faltan unidades de repuesto operativas y sin asignar', async () => {
    await como(db, ADMIN);
    // Makita DDF484 (mínimo 1): la única está asignada y rota → 0 libres
    expect(await valor(db, "select count(*)::int from avisos_reposicion where modelo_herramienta = 'Makita DDF484' and estado <> 'cerrado'")).toBe(1);
    await db.query('select alta_dotacion($1::jsonb)', [JSON.stringify({ id: 'H200', clase: 'herramienta', nombre: 'Taladro atornillador', marca: 'Makita DDF484', valor: 210 })]);
    await superusuario(db);
    await db.exec("update dotacion set modelo = 'Makita DDF484' where id = 'H200'");
    expect(await valor(db, "select count(*)::int from avisos_reposicion where modelo_herramienta = 'Makita DDF484' and estado <> 'cerrado'")).toBe(0);
  });
});

describe('cola de envíos, resúmenes y recordatorios', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('por defecto: push inmediato al cruzar el mínimo; el correo espera al resumen', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_config_avisos($1::jsonb)', [JSON.stringify({ correo_activo: true, correo_destinatarios: ['admin@x.es'] })]);
    await como(db, ALMACEN);
    await db.query(MOV, [uuid(), 'BF-FIX-SX8', 'salida', 1150, 'Obra', 'C/ Eros 10', [], null]);
    await como(db, ADMIN);
    const e = (await db.query<{ canal: string; tipo: string }>("select canal, tipo from envios_aviso where asunto like '%Taco nylon SX 8%'")).rows;
    expect(e).toEqual([{ canal: 'push', tipo: 'critico' }]);
  });
  it('el resumen diario sale una vez al día a partir de la hora configurada', async () => {
    await superusuario(db);
    const antes = await valor<number>(db, "select encolar_programados('2026-10-01 05:30:00+00')");   // 7:30 en Madrid
    expect(antes).toBe(0);
    expect(await valor<number>(db, "select encolar_programados('2026-10-01 06:05:00+00')")).toBe(1);   // 8:05 en Madrid
    expect(await valor<number>(db, "select encolar_programados('2026-10-01 09:00:00+00')")).toBe(0);   // ya enviado hoy
    const cuerpo = await valor<string>(db, "select cuerpo from envios_aviso where tipo = 'resumen'");
    expect(cuerpo).toMatch(/Taco nylon SX 8/);
  });
  it('un pedido sin recibir en X días se vuelve a avisar', async () => {
    await como(db, ADMIN);
    await db.query('select marcar_pedido($1, $2, $3)', ['BF-FIX-SX6', 200, null]);
    await superusuario(db);
    await db.exec("alter table avisos_reposicion disable trigger all; update avisos_reposicion set pedido_ts = now() - interval '8 days' where sku = 'BF-FIX-SX6'; alter table avisos_reposicion enable trigger all;");
    expect(await valor<number>(db, "select encolar_programados(now())")).toBeGreaterThan(0);
    expect(await valor(db, "select count(*)::int from envios_aviso where tipo = 'recordatorio'")).toBeGreaterThan(0);
    const otra = await valor<number>(db, "select count(*)::int from envios_aviso where tipo = 'recordatorio'");
    await valor(db, 'select encolar_programados(now())');
    expect(await valor(db, "select count(*)::int from envios_aviso where tipo = 'recordatorio'")).toBe(otra);   // no se repite cada minuto
  });
  it('los envíos y la configuración solo los ve el administrador', async () => {
    await como(db, ALMACEN);
    expect((await db.query('select * from envios_aviso')).rows).toHaveLength(0);
    expect((await db.query('select * from config_avisos')).rows).toHaveLength(0);
    expect(await falla(db, 'select guardar_config_avisos($1::jsonb)', ['{}'])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select encolar_envio($1, $2, $3, $4)', ['push', 'prueba', 'x', 'y'])).toMatch(/Solo el administrador/);
  });
});

describe('custodia de Esmove (E-008)', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('una merma de custodia aprobada avisa al administrador y, en modo automático, a Esmove', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_propietario($1::jsonb)', [JSON.stringify({ id: 'ESMOVE', nombre: 'Esmove', correos_reposicion: ['almacen@esmove.es'] })]);
    await db.query('select guardar_config_avisos($1::jsonb)', [JSON.stringify({ correo_activo: true, correo_modo: 'inmediato', correo_destinatarios: ['admin@x.es'], custodia_envio: 'automatico' })]);
    await db.query(MOV, [uuid(), 'ESM-CPVE-TRI', 'merma', 1, 'Rotura o daño', 'Caída en la carga', [], null]);
    const e = (await db.query<{ canal: string; destinatarios: string[] }>("select canal, destinatarios from envios_aviso where tipo = 'incidencia_custodia' order by canal, destinatarios")).rows;
    expect(e).toEqual(expect.arrayContaining([{ canal: 'correo', destinatarios: ['almacen@esmove.es'] }, { canal: 'correo', destinatarios: ['admin@x.es'] }]));
  });
  it('el acta de recuento toma el stock del sistema en el servidor y queda con huella', async () => {
    await como(db, ALMACEN);
    const lineas = JSON.stringify([{ sku: 'WBX-PULSAR-22', contado: 6 }, { sku: 'ESM-CPVE-MONO', contado: 2 }, { sku: 'BF-FIX-SX8', contado: 1 }]);
    expect(await falla(db, 'select registrar_acta_custodia($1, $2, $3, $4, $5::jsonb)', [uuid(), 'ESMOVE', ' ', 'firma', lineas])).toMatch(/representante/);
    const r = await valor<{ numero: string }>(db, 'select registrar_acta_custodia($1, $2, $3, $4, $5::jsonb) as r', [uuid(), 'ESMOVE', 'Ana (Esmove)', 'data:image/png;base64,AA', lineas]);
    expect(r.numero).toMatch(/^ACTA-\d{4}-001$/);
    const acta = (await db.query<{ lineas: { sku: string; sistema: number; contado: number }[]; hash: string }>('select lineas, hash from actas_custodia')).rows[0];
    expect(acta.lineas.map(l => l.sku)).toEqual(['ESM-CPVE-MONO', 'WBX-PULSAR-22']);     // lo propio (tacos) no entra en el acta
    expect(acta.lineas.find(l => l.sku === 'ESM-CPVE-MONO')).toMatchObject({ sistema: 3, contado: 2 });
    expect(acta.hash).toMatch(/^[0-9a-f]{64}$/);
    await superusuario(db);
    expect(await falla(db, "update actas_custodia set representante = 'otro'")).toMatch(/no se puede modificar/);
  });
  it('solo el administrador cambia la propiedad de un artículo; al pasar a custodia pierde el precio', async () => {
    await como(db, ALMACEN);
    expect(await falla(db, 'select cambiar_propiedad($1, $2, $3)', ['7501013532', 'custodia', 'ESMOVE'])).toMatch(/Solo el administrador/);
    await como(db, ADMIN);
    await db.query('select cambiar_propiedad($1, $2, $3)', ['7501013532', 'custodia', 'ESMOVE']);
    expect(await valor(db, "select precio from costes_producto where sku = '7501013532'")).toBeNull();
  });
});
