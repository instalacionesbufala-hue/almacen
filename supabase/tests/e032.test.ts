/* E-032 · La prefactura aprobada de Holded trae atributos: tipo de línea, fase, sección y cable de datos (de los nombres de las
   líneas) y, del calendario, equipo, cargador y fecha. Precedencia, UTP por cable de datos y partidas sin descuento.
   Caso real: E2632263 (3x6 bajo tubo, U/UTP, preinst) llegó antes que el cierre del wizard. */
import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIVALENCIAS_PROPUESTA, type Regla } from '../functions/_compartido/cierres';
import { hashToken } from '../functions/_compartido/portal';
import { enviarCierre } from './cierreEnvio';
import { ADMIN, como, nuevaBD, superusuario, valor, type BD } from './pg';

const H = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const REGLAS: Regla[] = [...EQUIVALENCIAS_PROPUESTA.filter(r => ['metrosLinea', 'metrosUtp', 'rj45', 'hardware'].includes(r.campo)),
  { id: 'PRE', campo: 'preinst', formula: 'directa', condiciones: {}, articulos: [], estimada: false, activa: true, orden: 500, sinDescuento: 'no_gestionado' },
  { id: 'SRV', campo: 'perfTab', formula: 'directa', condiciones: {}, articulos: [], estimada: false, activa: true, orden: 510, sinDescuento: 'servicio' }];
const ARTS: [string, string, string][] = [['6000650603', 'H07Z1-K 6 MARRON', 'm'], ['6000650604', 'H07Z1-K 6 AZUL', 'm'], ['6000650605', 'H07Z1-K 6 AM/VERDE', 'm'],
  ['6000650653', 'H07Z1-K 10 MARRON', 'm'], ['6000650654', 'H07Z1-K 10 AZUL', 'm'], ['6000650655', 'H07Z1-K 10 AM/VERDE', 'm'], ['6040610306', 'RZ1-K 3G6', 'm'],
  ['7270020010', 'Cat6 U/UTP', 'm'], ['7270021010', 'Cat6 F/UTP', 'm'], ['7280040060', 'RJ45 sobre 25', 'ud'], ['8906000665', 'Policharger NW T2', 'ud']];
const PREFACTURA = { origen: 'holded', numInst: 'E2632263', documento: 'E2632263', fechaAprobacion: H(0), lineas: { metrosLinea: 28, metrosUtp: 28, preinst: 1, rj45: 2, perfTab: 1 },
  atributos: { tipoLinea: 'tubo', fase: 'mono', seccion: '3x6mm', cableDatos: 'U/UTP', equipo: 'Búfala 2', hardware: 'POLICHARGER NW MONOFÁSICO PROTECCIÓN REARME M5', fechaCierreIso: H(-5) } };

let db: BD, hash: string;
const enviar = (raw: Record<string, unknown>, origen?: 'wizard' | 'historico' | 'holded') => enviarCierre(db, hash, raw, { reglas: REGLAS, kits: {}, origen });
const lineas = async (n: string) => { await superusuario(db); return (await db.query<{ campo: string; sku: string | null; cantidad: string; estado: string }>(
  "select l.campo, l.sku, l.cantidad::text, l.estado from cierre_lineas l join cierres c on c.id = l.cierre_id where num_inst = $1 order by l.campo, l.sku nulls first", [n])).rows; };
const cierre = async (n: string) => { await superusuario(db); return (await db.query<{ estado: string; vehiculo_id: string | null; equipo_wizard: string; fecha: string }>(
  'select estado, vehiculo_id, equipo_wizard, fecha_cierre::text fecha from cierres where num_inst = $1', [n])).rows[0]; };
const aBordo = async (veh: string, sku: string) => { await superusuario(db); return Number(await valor<string | null>(db, 'select unidades::text from stock_vehiculo where vehiculo_id = $1 and sku = $2', [veh, sku]) ?? 0); };

beforeEach(async () => {
  db = await nuevaBD();
  await como(db, ADMIN);
  for (const [sku, nombre, u] of ARTS) await db.query('select guardar_producto($1::jsonb)', [JSON.stringify({ sku, nombre, categoria: 'cables', unidad: u, contenido: 1, minimo: 0 })]);
  hash = await hashToken((await valor<{ token: string }>(db, 'select crear_integracion($1) as r', ['Wizard'])).token);
});

describe('prefactura con atributos', () => {
  it('sin cierre previo: con el equipo y la fecha del calendario descuenta de su furgoneta; 3 conductores de 6 mm²; U/UTP; preinst sin pendiente', async () => {
    const r = await enviar(PREFACTURA);
    expect(r.pendientes).toBe(0);
    const c = await cierre('E2632263');
    expect([c.vehiculo_id, c.equipo_wizard, c.estado]).toEqual(['V-F02', 'Búfala 2', 'discrepancia']);          // no había nada a bordo
    expect(Date.parse(c.fecha)).toBe(Date.parse(PREFACTURA.atributos.fechaCierreIso));                         // la de la instalación, no la de aprobación
    expect(await lineas('E2632263')).toEqual([
      { campo: 'hardware', sku: '8906000665', cantidad: '1.000', estado: 'discrepancia' },
      { campo: 'metrosLinea', sku: '6000650603', cantidad: '28.000', estado: 'discrepancia' }, { campo: 'metrosLinea', sku: '6000650604', cantidad: '28.000', estado: 'discrepancia' },
      { campo: 'metrosLinea', sku: '6000650605', cantidad: '28.000', estado: 'discrepancia' },
      { campo: 'metrosUtp', sku: '7270021010', cantidad: '28.000', estado: 'discrepancia' },        // E-033: Policharger → F/UTP (lo decide el cargador)
      { campo: 'preinst', sku: null, cantidad: '1.000', estado: 'no_gestionado' },                  // se cuenta, no descuenta ni queda pendiente
      { campo: 'rj45', sku: '7280040060', cantidad: '2.000', estado: 'discrepancia' }]);            // perfTab (servicio): ni línea
    for (const sku of ['6000650603', '6000650604', '6000650605', '7270021010']) expect(await aBordo('V-F02', sku)).toBe(-28);
  });

  it('precedencia: la prefactura manda en tipo y sección; el wizard, en equipo y fecha; el cable de datos lo decide el cargador (E-033)', async () => {
    await enviar({ numInst: 'E2639300', equipo: 'Búfala 1', fechaCierreIso: H(-6), tipoLinea: 'manguera', fase: 'mono', seccion: '10', cableDatos: 'U/UTP', hardware: 'V2C TRYDAN', metrosLinea: 20, metrosUtp: 10 }, 'wizard');
    await enviar({ ...PREFACTURA, numInst: 'E2639300', atributos: { ...PREFACTURA.atributos, cableDatos: 'F/UTP', fechaCierreIso: H(-2) }, lineas: { metrosLinea: 20, metrosUtp: 10 } });
    const c = await cierre('E2639300');
    expect([c.vehiculo_id, c.equipo_wizard]).toEqual(['V-F01', 'Búfala 1']);
    expect(new Date(c.fecha).getTime()).toBeLessThan(Date.parse(H(-5)));                                        // sigue la del wizard
    expect((await lineas('E2639300')).filter(l => l.campo !== 'hardware').map(l => [l.campo, l.sku])).toEqual([['metrosLinea', '6000650603'], ['metrosLinea', '6000650604'], ['metrosLinea', '6000650605'], ['metrosUtp', '7270020010']]);
    // otra versión del wizard (con su manguera de 10) no deshace lo que dice la prefactura
    await enviar({ numInst: 'E2639300', version: 2, equipo: 'Búfala 1', fechaCierreIso: H(-6), tipoLinea: 'manguera', fase: 'mono', seccion: '10', cableDatos: 'U/UTP', hardware: 'V2C TRYDAN', metrosLinea: 20, metrosUtp: 10 }, 'wizard');
    expect((await lineas('E2639300')).filter(l => l.campo !== 'hardware').map(l => l.sku)).toEqual(['6000650603', '6000650604', '6000650605', '7270020010']);
  });

  it('una prefactura sola y luego el wizard: manda la fecha y el equipo del wizard', async () => {
    await enviar({ ...PREFACTURA, lineas: { rj45: 2 } });
    await enviar({ numInst: 'E2632263', equipo: 'Búfala 3', fechaCierreIso: H(-8), hardware: 'V2C TRYDAN', rj45: 2 }, 'wizard');
    const c = await cierre('E2632263');
    expect(c.equipo_wizard).toBe('Búfala 3');
    expect(Math.abs(Date.parse(c.fecha) - (Date.now() - 8 * 3600e3))).toBeLessThan(60e3);
  });

  it('la misma prefactura otra vez es duplicado; si cambian los atributos, versión nueva; el cable de datos de Holded no cuenta', async () => {
    await enviar(PREFACTURA);
    expect((await enviar(PREFACTURA)).estado).toBe('duplicado');
    expect((await enviar({ ...PREFACTURA, atributos: { ...PREFACTURA.atributos, cableDatos: 'F/UTP' } })).estado).toBe('duplicado');      // E-033: se ignora
    expect((await enviar({ ...PREFACTURA, atributos: { ...PREFACTURA.atributos, seccion: '10' } })).version).toBe(2);
  });

  it('el caso real: resuelta a mano con 10 mm² y sin atributos; al llegar con atributos la regla sustituye la resolución (no se suman)', async () => {
    const sin = { ...PREFACTURA, atributos: undefined, lineas: { metrosLinea: 28 } };
    await enviar(sin);
    await superusuario(db);
    const l = await valor<string>(db, "select l.id from cierre_lineas l join cierres c on c.id = l.cierre_id where num_inst = 'E2632263' and campo = 'metrosLinea'");
    await como(db, ADMIN);
    await db.query('select resolver_linea_varios($1, gen_random_uuid(), $2::jsonb)', [l, JSON.stringify(['6000650653', '6000650654', '6000650655'].map(sku => ({ sku, cantidad: 28 })))]);
    await enviar({ ...PREFACTURA, lineas: { metrosLinea: 28 } });
    expect((await lineas('E2632263')).filter(x => x.campo !== 'hardware').map(x => [x.sku, x.cantidad, x.estado])).toEqual([['6000650603', '28.000', 'discrepancia'], ['6000650604', '28.000', 'discrepancia'], ['6000650605', '28.000', 'discrepancia']]);
    expect(await aBordo('V-F02', '6000650653')).toBe(0);
    expect(await aBordo('V-F02', '6000650603')).toBe(-28);
  });
});

describe('reglas sin descuento en la base', () => {
  it('guardar_equivalencia guarda "no descuenta" y "material no gestionado"', async () => {
    await como(db, ADMIN);
    await db.query('select guardar_equivalencia($1::jsonb)', [JSON.stringify({ id: 'X1', campo: 'preinst', formula: 'directa', condiciones: {}, articulos: [], orden: 1, confirmada: true, sin_descuento: 'no_gestionado' })]);
    await db.query('select guardar_equivalencia($1::jsonb)', [JSON.stringify({ id: 'X2', campo: 'perfTab', formula: 'directa', condiciones: {}, articulos: [], orden: 2, confirmada: true, sin_descuento: 'servicio' })]);
    await db.query('select guardar_equivalencia($1::jsonb)', [JSON.stringify({ id: 'X3', campo: 'pica', formula: 'directa', condiciones: {}, articulos: [], orden: 3, confirmada: true })]);
    expect((await db.query('select id, sin_descuento from equivalencias_cierre where id like $1 order by id', ['X%'])).rows)
      .toEqual([{ id: 'X1', sin_descuento: 'no_gestionado' }, { id: 'X2', sin_descuento: 'servicio' }, { id: 'X3', sin_descuento: null }]);
  });
});
