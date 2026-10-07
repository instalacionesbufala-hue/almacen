/* E-037 · Extracto de un artículo en una furgoneta con el saldo acumulado: entregas, consumos de cierre (y pieza entera), ajuste,
   recuento y conversión de formato; el saldo final coincide con el stock a bordo, se detecta un descuadre provocado, y el socio
   ve solo lo suyo y sin nombres. */
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../functions/_compartido/portal';
import type { Regla } from '../functions/_compartido/cierres';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, falla, nuevaBD, superusuario, uuid, valor, type BD } from './pg';

const H07 = 'T-H07Z1K-10', PVC = 'T-PVC-32', ESM = '00000000-0000-4000-8000-000000000371', LECT = '00000000-0000-4000-8000-000000000372';
const PREP = 'select preparar_entrega($1, $2, $3, $4, $5, $6::jsonb) as r';
const REGLAS: Regla[] = [
  { id: 'L', campo: 'metrosLinea', formula: 'directa', condiciones: {}, articulos: [{ sku: H07, factor: 1 }], estimada: false, activa: true, orden: 1 },
  { id: 'P', campo: 'pvc32', formula: 'directa', condiciones: {}, articulos: [{ sku: PVC, factor: 1 }], estimada: false, activa: true, orden: 2 }];
type Fila = { tipo: string; unidades: number; saldo: number; quien: string; entrega?: { numero: string; firmo: string }; cierre?: { numInst: string; version: number; origen: string }; pieza?: { real: number; consumo: number }; recuento?: { constaba: number; contado: number } };
type Ext = { saldoInicial: number; total: number; saldoFinal: number; stock: number; saldoCalculado: number; resumen: Record<string, number>; filas: Fila[] };
let db: BD;
const extracto = async (sku: string, extra: unknown[] = [], uid = ADMIN) => { await como(db, uid); return valor<Ext>(db, `select extracto_vehiculo('V-F01', $1${extra.map((_, i) => `, $${i + 2}`).join('')}) as r`, [sku, ...extra]); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: H07, nombre: 'Cable H07Z1-K 10 mm²', categoria: 'cables', unidad: 'caja', contenido: 100, unidad_contenido: 'm', minimo: 0, nuevo: true, stock_inicial: 5 })]);
  await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku: PVC, nombre: 'Tubo PVC M-32', categoria: 'tubos', unidad: 'barra', contenido: 3, unidad_contenido: 'm', minimo: 0, nuevo: true, stock_inicial: 30 })]);
  await db.query('select config_cierres($1, $2, $3)', ['A', null, new Date(Date.now() - 864e5).toISOString()]);
  const id = uuid();
  await db.query(PREP, [id, 'F01', 'T1', '', null, JSON.stringify([{ tipo: 'stock', sku: H07, cantidad: 2 }, { tipo: 'stock', sku: PVC, cantidad: 25 }])]);
  await db.query('select confirmar_entrega($1, $2)', [id, 'data:image/png;base64,AA']);
  const hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
  await enviarCierre(db, hash, { numInst: 'E2639370', cliente: 'Cliente inventado', equipo: 'Búfala 1', fechaCierreIso: new Date().toISOString(), metrosLinea: 150, tipoLinea: 'manguera', pvc32: 62 }, { reglas: REGLAS, kits: {}, origen: 'wizard' });
  await como(db, ADMIN);
  await db.query('select ajustar_inventario($1, $2, $3, $4, $5)', [uuid(), H07, -0.1, 'Rotura en obra', 'V-F01']);       // −10 m
  await como(db, ADMIN);
  await db.query('select registrar_recuento_vehiculo($1, $2, $3::jsonb)', [uuid(), 'V-F01', JSON.stringify([{ sku: H07, contado: 0.3 }])]);   // 40 → 30 m
  await como(db, ADMIN);
  await db.query('select cambiar_formato($1, $2, $3, $4, $5)', [H07, 'rollo', 50, 'm', 'formato']);                     // 0,3 cajas → 0,3 rollos = 15 m
});

describe('extracto de un artículo en una furgoneta', () => {
  it('entrega, cierre, ajuste, recuento y conversión: el saldo acumulado llega al stock a bordo', async () => {
    const e = await extracto(H07);
    expect(e.filas.map(f => [f.tipo, f.unidades, f.saldo])).toEqual([['entrega', 200, 200], ['cierre', -150, 50], ['ajuste', -10, 40], ['recuento', -10, 30], ['conversion', -15, 15]]);
    expect([e.saldoFinal, e.saldoCalculado, e.stock]).toEqual([15, 15, 15]);
    expect(e.resumen).toEqual({ entregado: 200, consumido: -150, ajustes: -35, otros: 0 });
    // enlaces: la entrega (ENT-… y quién firmó) y el cierre (n.º, versión y origen)
    expect(e.filas[0].entrega).toMatchObject({ numero: expect.stringMatching(/^ENT-/), firmo: expect.any(String) });
    expect(e.filas[0].quien).toBe(e.filas[0].entrega!.firmo);
    expect(e.filas[1].cierre).toMatchObject({ numInst: 'E2639370', version: 1, origen: 'wizard' });
    expect(e.filas[3].recuento).toEqual({ constaba: 40, contado: 30 });
  });

  it('pieza entera: "62 m → 63 m"', async () => {
    const e = await extracto(PVC);
    expect(e.filas.map(f => [f.tipo, f.unidades])).toEqual([['entrega', 75], ['cierre', -63]]);
    expect(e.filas[1].pieza).toEqual({ real: 62, consumo: 63 });
    expect(e.saldoFinal).toBe(12);
  });

  it('filtros por fecha y tipo, y paginado', async () => {
    const t = await extracto(H07, [null, null, 'ajustes']);
    expect(t.filas.map(f => f.tipo)).toEqual(['ajuste', 'recuento', 'conversion']);
    expect(t.total).toBe(3);
    const p = await extracto(H07, [null, null, null, 2, 1]);
    expect(p.filas.map(f => f.saldo)).toEqual([50, 40]);
    expect(p.total).toBe(5);
    const futuro = await extracto(H07, [new Date(Date.now() + 864e5).toISOString()]);
    expect([futuro.saldoInicial, futuro.filas.length, futuro.saldoFinal]).toEqual([15, 0, 15]);
  });

  it('un descuadre provocado se detecta (en el extracto y en descuadres_a_bordo)', async () => {
    await superusuario(db);
    await db.exec(`update stock_vehiculo set unidades = unidades + 5 where vehiculo_id = 'V-F01' and sku = '${H07}'`);
    const e = await extracto(H07);
    expect([e.saldoCalculado, e.stock]).toEqual([15, 20]);
    await como(db, ADMIN);
    expect((await db.query(`select vehiculo_id, sku, stock::float8, calculado::float8 from descuadres_a_bordo() where sku = '${H07}'`)).rows).toEqual([{ vehiculo_id: 'V-F01', sku: H07, stock: 20, calculado: 15 }]);
  });

  it('solo lectura lo ve; el socio solo lo suyo en custodia y sin nombres', async () => {
    await superusuario(db);
    await db.exec(`insert into auth.users (id, email) values ('${ESM}', 'esmove@x.es'), ('${LECT}', 'dir@x.es');
      insert into perfiles (id, nombre, rol, activo, propietario_id) values ('${ESM}', 'Persona de Esmove', 'socio', true, 'ESMOVE'), ('${LECT}', 'Dirección', 'lectura', true, null);
      update productos set propiedad = 'custodia', propietario_id = 'ESMOVE' where sku = '${H07}';`);
    expect((await extracto(H07, [], LECT)).filas).toHaveLength(5);
    const s = await extracto(H07, [], ESM);
    expect(s.filas[0]).toMatchObject({ quien: 'Técnico del equipo', entrega: { firmo: 'Técnico del equipo' } });
    expect(s.filas.slice(1).every(f => f.quien === 'Búfala')).toBe(true);
    await como(db, ESM);
    expect(await falla(db, `select extracto_vehiculo('V-F01', '${PVC}')`)).toMatch(/custodia de tu empresa/);
    expect(await falla(db, 'select descuadres_a_bordo()')).toMatch(/Acceso de socio/);
  });
});
