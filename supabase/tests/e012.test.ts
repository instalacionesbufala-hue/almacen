/* E-012 · Cierres del wizard → consumos del vehículo: token, idempotencia, versión, formatos fraccionados, discrepancias, cargador, fallido */
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizarCierre, traducirCierre, type Kits, type Regla } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { ADMIN, ALMACEN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

// reglas de prueba con artículos de la demostración (las reales se cargan desde la propuesta)
const REGLAS: Regla[] = [
  { id: 'T1', campo: 'metrosLinea', formula: 'directa', condiciones: { tipoLinea: 'manguera' }, articulos: [{ sku: 'CAB-RZ1K-5G6', factor: 1 }], estimada: false, activa: true, orden: 10 },
  { id: 'T2', campo: 'rj45', formula: 'directa', condiciones: {}, articulos: [{ sku: '7280040020', factor: 1 }], estimada: false, activa: true, orden: 20 },
  { id: 'T3', campo: 'pvc32', formula: 'directa', condiciones: {}, articulos: [{ sku: 'BF-TUB-CM20', factor: 1 }], estimada: false, activa: true, orden: 30 },
  { id: 'T4', campo: 'pvc32+acero32', formula: 'fijaciones', condiciones: {}, articulos: [], estimada: true, activa: true, orden: 40 },
  { id: 'T5', campo: 'hardware', formula: 'unidad', condiciones: { 'hardware~': 'pulsar&22' }, articulos: [{ sku: 'WBX-PULSAR-22', factor: 1 }], estimada: false, activa: true, orden: 50 },
];
const KITS: Kits = { A: [{ sku: 'BF-FIX-SX6', factor: 1 }] };                 // 1 taco por fijación (bote de 1000)
const base = { numInst: 'INST-1', esbrainUuid: 'e-1', cliente: 'Cliente inventado', direccion: 'C/ Falsa 1', fechaCierreIso: new Date().toISOString(), equipo: 'Búfala 1', hardware: 'Wallbox Pulsar Plus 22 kW' };
const lineas = (c: ReturnType<typeof normalizarCierre>) => traducirCierre(c, REGLAS, KITS, 'A');
const abordo = async (db: BD, veh: string, sku: string) => (await superusuario(db), valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]).then(v => Number(v ?? 0)));

describe('cierres del wizard', () => {
  let db: BD, token = '', hash = '';
  const enviar = async (x: Record<string, unknown>, h = hash) => {
    const c = normalizarCierre({ ...base, ...x });
    await db.exec('reset role; set role service_role;');
    return valor<{ estado: string; cierre: string; version?: number; pendientes?: number }>(db, 'select aplicar_cierre($1, $2::jsonb, $3::jsonb) as r', [h, JSON.stringify(c), JSON.stringify(lineas(c))]);
  };
  beforeAll(async () => {
    db = await nuevaBD(); await como(db, ADMIN);
    token = (await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard de cierres'])).token;
    hash = await hashToken(token);
  });

  it('solo se guarda el hash del token; el almacén no puede crear integraciones', async () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await superusuario(db);
    expect(await valor(db, 'select token_hash from integraciones')).toBe(hash);
    await como(db, ALMACEN);
    expect(await falla(db, 'select crear_integracion($1)', ['x'])).toMatch(/Solo el administrador/);
    expect(await falla(db, 'select aplicar_cierre($1, $2::jsonb, $3::jsonb)', [hash, '{}', '[]'])).toMatch(/permission denied/);
  });
  it('consume del VEHÍCULO del equipo (nunca del almacén), con formatos fraccionados y el cargador sin serie', async () => {
    const almacenAntes = await valor<string>(db, "select stock::text from productos where sku = 'CAB-RZ1K-5G6'");
    const r = await enviar({ tipoLinea: 'manguera', metrosLinea: 20, rj45: 2, pvc32: 3 });
    expect(r.estado).toBe('discrepancia');                                        // el vehículo no llevaba RJ45, tacos ni tubo
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(130);                  // 150 − 20 m
    expect(await abordo(db, 'V-F01', '7280040020')).toBe(-2);                     // 2 RJ45 = 2 ud (0,08 sobres); el vehículo no llevaba: discrepancia
    expect(await abordo(db, 'V-F01', 'BF-FIX-SX6')).toBe(-6);                     // 6 fijaciones × 1 taco del bote de 1000
    expect(await abordo(db, 'V-F01', 'WBX-PULSAR-22')).toBe(1);                   // 2 − 1 cargador
    expect(await valor<string>(db, "select stock::text from productos where sku = 'CAB-RZ1K-5G6'")).toBe(almacenAntes);
    await superusuario(db);
    const m = (await db.query<{ tipo: string; cantidad: string; referencia: string; vehiculo_id: string; series: string[] }>(
      "select tipo, cantidad::text, referencia, vehiculo_id, series from movimientos where cierre_id = $1 and sku = '7280040020'", [r.cierre])).rows[0];
    expect(m).toEqual({ tipo: 'consumo', cantidad: '0.080', referencia: 'INST-1 · Cliente inventado · C/ Falsa 1', vehiculo_id: 'V-F01', series: [] });
  });
  it('lo que deja el vehículo en negativo se registra igual y se marca como discrepancia', async () => {
    await superusuario(db);
    expect(await valor(db, "select estado from cierres where clave = 'uuid:e-1'")).toBe('discrepancia');
    expect(await valor(db, "select count(*)::int from cierre_lineas l join cierres c on c.id = l.cierre_id where c.clave = 'uuid:e-1' and l.estado = 'discrepancia'")).toBe(3);
  });
  it('idempotente: reenviar el mismo cierre no descuenta dos veces', async () => {
    expect((await enviar({ tipoLinea: 'manguera', metrosLinea: 20, rj45: 2, pvc32: 3 })).estado).toBe('duplicado');
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(130);
    // sin esbrainUuid, la clave es numInst + fecha
    const f = '2030-01-01T10:00:00Z';
    await enviar({ esbrainUuid: '', numInst: 'INST-2', fechaCierreIso: f, tipoLinea: 'manguera', metrosLinea: 5, hardware: '' });
    expect((await enviar({ esbrainUuid: '', numInst: 'INST-2', fechaCierreIso: f, tipoLinea: 'manguera', metrosLinea: 5, hardware: '' })).estado).toBe('duplicado');
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(125);
  });
  it('una versión corregida aplica solo la diferencia', async () => {
    const r = await enviar({ version: 2, tipoLinea: 'manguera', metrosLinea: 12, rj45: 2, pvc32: 3 });   // 20 → 12 m
    expect(r.version).toBe(2);
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(133);                  // vuelven 8 m al vehículo
    expect(await abordo(db, 'V-F01', 'WBX-PULSAR-22')).toBe(1);                   // el cargador no se descuenta otra vez
    await superusuario(db);
    expect(await valor(db, "select count(*)::int from movimientos where motivo = 'Corrección de cierre' and sku = 'CAB-RZ1K-5G6'")).toBe(1);
    expect((await enviar({ version: 1, tipoLinea: 'manguera', metrosLinea: 99 })).estado).toBe('duplicado');   // una versión vieja no cambia nada
  });
  it('desplazamiento fallido: queda registrado, sin consumo', async () => {
    const r = await enviar({ esbrainUuid: 'e-fallido', despFallido: true, tipoLinea: 'manguera', metrosLinea: 50 });
    expect(r.estado).toBe('fallido');
    await superusuario(db);
    expect(await valor(db, 'select count(*)::int from movimientos where cierre_id = $1', [r.cierre])).toBe(0);
  });
  it('cargador no reconocido y partidas sin equivalencia: el cierre queda parcial y el administrador resuelve', async () => {
    const r = await enviar({ esbrainUuid: 'e-3', hardware: 'Marca desconocida', canaleta: 4 });
    expect(r).toMatchObject({ estado: 'parcial', pendientes: 2 });
    await como(db, ADMIN);
    const id = await valor<string>(db, "select id from cierre_lineas where cierre_id = $1 and campo = 'hardware'", [r.cierre]);
    await db.query('select resolver_linea_cierre($1, $2)', [id, 'ESM-CPVE-MONO']);
    expect(await abordo(db, 'V-F01', 'ESM-CPVE-MONO')).toBe(-1);
    expect(await valor(db, "select estado from cierre_lineas where id = $1", [id])).toBe('resuelta');
  });
  it('equipo sin vehículo: se guarda sin consumir; al asignarle vehículo se reprocesa', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_equipo($1::jsonb)', [JSON.stringify({ id: 'F09', nombre: 'Búfala 9' })]);
    const r = await enviar({ esbrainUuid: 'e-9', equipo: 'Búfala 9', tipoLinea: 'manguera', metrosLinea: 5, hardware: '' });
    expect(r.estado).toBe('sin_vehiculo');
    await como(db, ADMIN);
    await db.query('select asignar_vehiculo($1, $2)', ['V-F03', 'F09']);
    await superusuario(db);
    await db.exec("update asignaciones_vehiculo set desde = now() - interval '2 days' where vehiculo_id = 'V-F03' and equipo_id = 'F09'");   // el vehículo ya era suyo en la fecha del cierre
    await como(db, ADMIN);
    expect((await valor<{ estado: string }>(db, 'select reprocesar_cierre($1) as r', [r.cierre])).estado).toBe('discrepancia');   // V-F03 no llevaba ese cable
    expect(await abordo(db, 'V-F03', 'CAB-RZ1K-5G6')).toBe(-5);
  });
  it('los cierres anteriores a la apertura del inventario se ignoran', async () => {
    await como(db, ADMIN);
    await db.query('select config_cierres($1, $2)', ['A', new Date().toISOString()]);
    const r = await enviar({ esbrainUuid: 'e-viejo', fechaCierreIso: '2025-01-01T10:00:00Z', tipoLinea: 'manguera', metrosLinea: 5 });
    expect(r.estado).toBe('ignorado');
  });
  it('token revocado: rechazado', async () => {
    await como(db, ADMIN);
    const id = await valor<string>(db, 'select id from integraciones limit 1');
    await db.query('select revocar_integracion($1)', [id]);
    await db.exec('reset role; set role service_role;');
    expect(await falla(db, 'select aplicar_cierre($1, $2::jsonb, $3::jsonb)', [hash, JSON.stringify({ ...base, esbrainUuid: 'e-x' }), '[]'])).toMatch(/revocada/);
    expect(await falla(db, 'select aplicar_cierre($1, $2::jsonb, $3::jsonb)', ['0'.repeat(64), JSON.stringify(base), '[]'])).toMatch(/no válida/);
  });
});

describe('equivalencias, kits y recuento de vehículo', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('la propuesta llega como borrador y el administrador la confirma', async () => {
    await como(db, ADMIN);
    const { EQUIVALENCIAS_PROPUESTA, KITS_PROPUESTA } = await import('../functions/_compartido/cierres');
    expect((await valor<{ nuevas: number }>(db, 'select cargar_propuesta_equivalencias($1::jsonb, $2::jsonb) as r', [JSON.stringify(EQUIVALENCIAS_PROPUESTA), JSON.stringify(KITS_PROPUESTA)])).nuevas).toBe(EQUIVALENCIAS_PROPUESTA.length);
    expect(await valor(db, 'select count(*)::int from equivalencias_cierre where confirmada')).toBe(0);
    expect((await valor<{ nuevas: number }>(db, 'select cargar_propuesta_equivalencias($1::jsonb, $2::jsonb) as r', [JSON.stringify(EQUIVALENCIAS_PROPUESTA), '{}'])).nuevas).toBe(0);   // no duplica
    await db.query('select confirmar_equivalencias()');
    expect(await valor(db, 'select count(*)::int from equivalencias_cierre where not confirmada')).toBe(0);
    await db.query('select guardar_kit_fijacion($1, $2::jsonb)', ['B', JSON.stringify([{ sku: 'BF-FIX-SX6', factor: 1 }])]);
    expect(await valor(db, "select articulos->0->>'sku' from kits_fijacion where kit = 'B'")).toBe('BF-FIX-SX6');
    await como(db, ALMACEN);
    expect(await falla(db, 'select confirmar_equivalencias()')).toMatch(/Solo el administrador/);
  });
  it('recuento de vehículo: el almacén deja la diferencia pendiente y el administrador la valida', async () => {
    await como(db, ALMACEN);
    const r = await valor<{ estado: string; diferencias: number }>(db, 'select registrar_recuento_vehiculo($1, $2, $3::jsonb) as r', [uuid(), 'V-F01', JSON.stringify([{ sku: 'CAB-RZ1K-5G6', contado: 140 }, { sku: 'WBX-PULSAR-22', contado: 2 }])]);
    expect(r).toEqual({ estado: 'pendiente', diferencias: 1 });
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(150);
    await como(db, ADMIN);
    const id = await valor<string>(db, "select id from pendientes where vehiculo_id = 'V-F01' and estado = 'pendiente'");
    await db.query('select validar_pendiente($1, true, $2)', [id, '']);
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(140);
    // el administrador ajusta directamente
    await como(db, ADMIN);
    await db.query('select registrar_recuento_vehiculo($1, $2, $3::jsonb)', [uuid(), 'V-F01', JSON.stringify([{ sku: 'CAB-RZ1K-5G6', contado: 145.5 }])]);
    expect(await abordo(db, 'V-F01', 'CAB-RZ1K-5G6')).toBe(145.5);
  });
});
