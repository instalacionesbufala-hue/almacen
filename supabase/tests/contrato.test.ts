/* Contrato app ↔ servidor: cada operación de la app (src/store/ops.ts) se traduce a su función SQL con los
   parámetros correctos, y lo que devuelve la base de datos se convierte bien en el estado de la app (mapeo.ts). */
import { beforeAll, describe, expect, it } from 'vitest';
import { rpcDe, nuevoId, type Op } from '../../src/store/ops';
import { aEstado, TABLAS, type Tablas } from '../../src/store/nube/mapeo';
import { ADMIN, ALMACEN, como, nuevaBD, type BD } from './pg';

/** Ejecuta una operación como lo haría supabase.rpc(fn, args): parámetros con nombre */
async function rpc(db: BD, op: Op) {
  const [fn, args] = rpcDe(op);
  const nombres = Object.keys(args);
  const valores = nombres.map(k => { const v = args[k]; return v !== null && typeof v === 'object' && !Array.isArray(v) || (Array.isArray(v) && v.some(x => typeof x === 'object')) ? JSON.stringify(v) : v; });
  const lista = nombres.map((k, i) => `${k} => $${i + 1}`).join(', ');
  return (await db.query<{ r: unknown }>(`select ${fn}(${lista}) as r`, valores)).rows[0].r;
}
async function estado(db: BD) {
  const t = {} as Record<string, unknown[]>;
  for (const n of TABLAS) t[n] = (await db.query(`select * from ${n}`)).rows;
  return aEstado(t as unknown as Tablas, { cesta: { equipo: '', receptor: null, lineas: [] }, seq: { ent: 0 } }, 'Prueba');
}

describe('contrato de operaciones', () => {
  let db: BD;
  beforeAll(async () => { db = await nuevaBD(); });

  it('movimiento, entrega, albarán, pedido e incidencia llegan al servidor con los parámetros correctos', async () => {
    await como(db, ALMACEN);
    await rpc(db, { op: 'movimiento', args: { id: nuevoId(), sku: 'BF-FIX-SX8', tipo: 'salida', qty: 100, motivo: 'Obra / instalación', ref: 'C/ Eros 10', series: [] } });
    const ent = await rpc(db, { op: 'entrega', args: { id: nuevoId(), ts: Date.now(), equipo: 'F01', receptor: 'T1', dni: '', firma: 'data:image/png;base64,AA',
      lineas: [{ sku: 'WBX-PULSAR-22', qty: 1, serials: ['WBX-22-899281'] }, { sku: 'CAB-RZ1K-5G6', qty: 25, serials: [] }] } }) as { numero: string };
    expect(ent.numero).toMatch(/^ENT-/);
    await rpc(db, { op: 'albaran', args: { id: nuevoId(), cabecera: { numero: 'A-1', proveedor: 'Esmove', cif: '', fecha: '', confianza: .9, modo: 'sim' },
      lineas: [{ sku: 'ESM-CPVE-TRI', cantidad: 2, series: [] }] } });
    await rpc(db, { op: 'pedido', args: { sku: 'BF-FIX-SX6', qty: 200 } });
    await rpc(db, { op: 'incidencia', args: { id: nuevoId(), dotacion: 'H001', tipo: 'deterioro', nota: 'Pantalla rayada' } });

    const E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX8')!.stock).toBe(1100);
    expect(E.products.find(p => p.sku === 'ESM-CPVE-TRI')!.stock).toBe(3);
    expect(E.products.find(p => p.sku === 'WBX-PULSAR-22')!.serials).not.toContain('WBX-22-899281');
    const e = E.entregas[0];
    expect(e).toMatchObject({ numero: ent.numero, equipo: 'F01', receptor: 'T1' });
    expect(e.lineas).toEqual([{ sku: 'WBX-PULSAR-22', qty: 1, serials: ['WBX-22-899281'] }, { sku: 'CAB-RZ1K-5G6', qty: 25, serials: [] }]);
    expect(E.pedidos['BF-FIX-SX6'].qty).toBe(200);
    expect(E.herramientas.find(h => h.id === 'H001')!.estado).toBe('deteriorada');
    expect(E.movements[0].operator).toBe('Operario Pruebas');
  });

  it('el almacén recibe el estado sin precios ni costes; el administrador con ellos', async () => {
    await como(db, ALMACEN);
    let E = await estado(db);
    expect(E.products.every(p => p.price === 0)).toBe(true);
    expect(E.herramientas.every(h => h.valor === 0)).toBe(true);
    await como(db, ADMIN);
    E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX8')!.price).toBeCloseTo(0.052);
    expect(E.products.find(p => p.sku === 'WBX-PULSAR-22')).toMatchObject({ propiedad: 'custodia', propietario: 'ESMOVE', price: 0 });
    expect(E.propietarios.map(o => o.nombre)).toEqual(['Esmove']);
  });

  it('equipos, técnicos, alta de referencia y dotación (administrador)', async () => {
    await como(db, ADMIN);
    await rpc(db, { op: 'equipo', args: { id: 'F09', nombre: 'Equipo Delta', flota: 'Furgoneta 09', matricula: '1111-ABC', estado: 'depot' } });
    await rpc(db, { op: 'tecnico', args: { id: 'T9', nombre: 'Nuevo Técnico', rol: 'Técnico', dni: '***1234-Z' } });
    await rpc(db, { op: 'asignarTecnico', args: { tecnico: 'T9', equipo: 'F09' } });
    await rpc(db, { op: 'estadoEquipo', args: { id: 'F09', estado: 'ruta' } });
    await rpc(db, { op: 'producto', args: { nuevo: true, stockInicial: 50, producto: { sku: 'NUEVA-REF', name: 'Regleta 6 tomas', cat: 'aparamenta', unit: 'ud', pack: 1, packLabel: 'unidad', stock: 0, min: 5, loc: 'P04-E03-N1', supplier: 'Saltoki Móstoles', price: 4.2 } } });
    await rpc(db, { op: 'altaDotacion', args: { id: 'H099', clase: 'herramienta', nombre: 'Detector de tensión', marca: 'Fluke', serie: 'FL-1', cantidad: 1, valor: 60, estado: 'operativa', historial: [] } });
    await rpc(db, { op: 'asignarDotacion', args: { id: nuevoId(), dotacion: 'H099', tecnico: 'T9' } });
    const E = await estado(db);
    expect(E.equipos.find(e => e.id === 'F09')).toMatchObject({ estado: 'ruta', tecnicos: ['T9'] });
    expect(E.products.find(p => p.sku === 'NUEVA-REF')).toMatchObject({ stock: 50, price: 4.2 });
    expect(E.herramientas.find(h => h.id === 'H099')).toMatchObject({ equipo: 'F09', tecnico: 'T9', valor: 60 });
  });
});
