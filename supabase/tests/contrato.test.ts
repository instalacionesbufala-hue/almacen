/* Contrato app ↔ servidor: cada operación de la app (src/store/ops.ts) se traduce a su función SQL con los
   parámetros correctos, y lo que devuelve la base de datos se convierte bien en el estado de la app (mapeo.ts). */
import { beforeAll, describe, expect, it } from 'vitest';
import { rpcDe, nuevoId, type Op } from '../../src/store/ops';
import { aEstado, COLUMNAS, TABLAS, type Tablas } from '../../src/store/nube/mapeo';
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
  for (const n of TABLAS) t[n] = (await db.query(`select ${COLUMNAS[n] || '*'} from ${n}`)).rows;
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
    await rpc(db, { op: 'incidencia', args: { id: nuevoId(), dotacion: 'H001', tipo: 'deterioro', nota: 'Pantalla rayada' } });

    const E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX8')!.stock).toBe(1100);
    expect(E.products.find(p => p.sku === 'ESM-CPVE-TRI')!.stock).toBe(3);
    expect(E.products.find(p => p.sku === 'WBX-PULSAR-22')!.serials).not.toContain('WBX-22-899281');
    const e = E.entregas[0];
    expect(e).toMatchObject({ numero: ent.numero, equipo: 'F01', receptor: 'T1' });
    expect(e.lineas).toEqual([{ sku: 'WBX-PULSAR-22', qty: 1, serials: ['WBX-22-899281'], tipo: 'stock' }, { sku: 'CAB-RZ1K-5G6', qty: 25, serials: [], tipo: 'stock' }]);
    expect(E.avisos.find(a => a.sku === 'BF-FIX-SX6' && a.estado === 'abierto')).toBeTruthy();
    expect(E.herramientas.find(h => h.id === 'H001')!.estado).toBe('deteriorada');
    expect(E.movements[0].operator).toBe('Operario Pruebas');
  });

  it('el almacén recibe el estado sin precios ni costes; el administrador con ellos', async () => {
    await como(db, ALMACEN);
    let E = await estado(db);
    expect(E.products.every(p => !p.price)).toBe(true);
    expect(E.herramientas.every(h => h.valor === 0)).toBe(true);
    await como(db, ADMIN);
    E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX8')!.price).toBeCloseTo(0.052);
    expect(E.products.find(p => p.sku === 'WBX-PULSAR-22')).toMatchObject({ propiedad: 'custodia', propietario: 'ESMOVE', price: null });
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

  it('operaciones de E-004: borrador, recuento, validación, perfil y borrado', async () => {
    await como(db, ALMACEN);
    await rpc(db, { op: 'borrador', args: { sku: '', ean: '8412345678905', nombre: 'Caja estanca', cat: 'aparamenta' } });
    await rpc(db, { op: 'recuento', args: { id: nuevoId(), pasillo: 'P03', lineas: [{ sku: 'BF-FIX-SX6', contado: 70 }] } });
    await rpc(db, { op: 'movimiento', args: { id: nuevoId(), sku: '6040615316', tipo: 'merma', qty: 10, motivo: 'Corte sobrante', ref: '', series: [] } });
    let E = await estado(db);
    expect(E.pendientes.filter(p => p.estado === 'pendiente')).toHaveLength(2);
    expect(E.products.find(p => p.sku === 'BORR-8412345678905')!.borrador).toBe(true);
    await como(db, ADMIN);
    E = await estado(db);
    for (const p of E.pendientes) await rpc(db, { op: 'validarPendiente', args: { id: p.id, aprobar: true, nota: 'ok' } });
    await rpc(db, { op: 'perfil', args: { id: ALMACEN, nombre: 'Operario Renombrado', rol: 'almacen', activo: true } });
    await rpc(db, { op: 'borrarProducto', args: { sku: 'BORR-8412345678905' } });
    E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX6')!.stock).toBe(70);
    expect(E.products.find(p => p.sku === '6040615316')!.stock).toBe(295);
    expect(E.products.find(p => p.sku === 'BORR-8412345678905')).toBeUndefined();
    expect(E.perfiles.find(p => p.id === ALMACEN)!.nombre).toBe('Operario Renombrado');
  });

  it('operaciones de E-006 y E-008: mínimos, pedido, configuración, propietario, propiedad, envío y acta', async () => {
    await como(db, ADMIN);
    await rpc(db, { op: 'minimos', args: { cambios: [{ sku: '7501013532', minimo: 10, objetivo: 20, proveedorHabitual: 'Saltoki Móstoles' }] } });
    await rpc(db, { op: 'pedido', args: { sku: '7501013532', qty: 14, proveedor: 'Saltoki Móstoles' } });
    await rpc(db, { op: 'minimoHerramienta', args: { modelo: 'Fluke 376 FC', minimo: 1, proveedor: 'Fluke' } });
    await rpc(db, { op: 'configAvisos', args: { correoActivo: true, correoModo: 'resumen', correoHora: '07:30', correoRemitente: '', correoDestinatarios: ['a@b.es'], pushActivo: true, pushModo: 'inmediato', pushHora: '08:00',
      telegramActivo: false, telegramModo: 'inmediato', telegramHora: '08:00', telegramChatId: '', diasRecordatorio: 5, custodiaEnvio: 'manual', informeCustodia: 'semanal' } });
    await rpc(db, { op: 'propietario', args: { id: 'ESMOVE', nombre: 'Esmove', contacto: 'Ana', correosReposicion: ['r@esmove.es'], correosInformes: ['i@esmove.es'] } });
    await rpc(db, { op: 'cambiarPropiedad', args: { sku: '8909080510', propiedad: 'custodia', propietario: 'ESMOVE' } });
    await rpc(db, { op: 'envio', args: { canal: 'push', tipo: 'prueba', asunto: 'Prueba', cuerpo: 'ok', destinatarios: [] } });
    await rpc(db, { op: 'acta', args: { id: nuevoId(), propietario: 'ESMOVE', representante: 'Ana', firma: 'data:image/png;base64,AA', lineas: [{ sku: 'ESM-CPVE-TRI', contado: 1 }] } });
    const E = await estado(db);
    expect(E.products.find(p => p.sku === '7501013532')).toMatchObject({ min: 10, objetivo: 20, proveedorHabitual: 'Saltoki Móstoles' });
    expect(E.avisos.find(a => a.sku === '7501013532')).toMatchObject({ estado: 'pedido', cantidadPedida: 14 });
    expect(E.avisos.find(a => a.modeloHerramienta === 'Fluke 376 FC')).toBeTruthy();   // la única está asignada: 0 de repuesto
    expect(E.configAvisos).toMatchObject({ correoHora: '07:30', diasRecordatorio: 5, informeCustodia: 'semanal' });
    expect(E.propietarios[0]).toMatchObject({ contacto: 'Ana', correosReposicion: ['r@esmove.es'] });
    expect(E.products.find(p => p.sku === '8909080510')).toMatchObject({ propiedad: 'custodia', price: null });
    expect(E.envios.some(e => e.tipo === 'prueba')).toBe(true);
    expect(E.actas[0]).toMatchObject({ representante: 'Ana', lineas: [{ sku: 'ESM-CPVE-TRI', sistema: E.products.find(p => p.sku === 'ESM-CPVE-TRI')!.stock, contado: 1 }] });
  });

  it('operaciones de E-007: plantilla, tallas, preparar, confirmar y anular', async () => {
    await como(db, ADMIN);
    const pid = nuevoId();
    await rpc(db, { op: 'plantilla', args: { id: pid, nombre: 'Dotación inicial', descripcion: '', modoKit: false, activa: true, lineas: [{ tipo: 'modelo', modelo: 'Polo alta visibilidad', tipoTalla: 'camiseta', cantidad: 2, editable: true }] } });
    await rpc(db, { op: 'tallas', args: { tecnico: 'T2', tallas: { camiseta: 'M', pantalon: '42' } } });
    await como(db, ALMACEN);
    const e1 = nuevoId(), e2 = nuevoId();
    await rpc(db, { op: 'prepararEntrega', args: { id: e1, equipo: 'F01', receptor: 'T2', obra: 'C/ Eros 10', plantilla: pid, lineas: [{ tipo: 'stock', sku: 'ROPA-POLO-M', qty: 2, serials: [] }] } });
    await rpc(db, { op: 'prepararEntrega', args: { id: e2, equipo: 'F01', receptor: 'T2', obra: '', lineas: [{ tipo: 'stock', sku: 'BF-FIX-SX8', qty: 50, serials: [] }] } });
    let E = await estado(db);
    expect(E.entregas.find(e => e.id === e1)).toMatchObject({ estado: 'preparada', plantilla: pid, obra: 'C/ Eros 10' });
    expect(E.plantillas.find(p => p.id === pid)!.lineas[0]).toMatchObject({ tipo: 'modelo', tipoTalla: 'camiseta' });
    expect(E.tecnicos.find(t => t.id === 'T2')!.tallas).toMatchObject({ camiseta: 'M', pantalon: '42' });
    await rpc(db, { op: 'confirmarEntrega', args: { id: e1, firma: 'data:image/png;base64,AA' } });
    await rpc(db, { op: 'anularEntrega', args: { id: e2 } });
    E = await estado(db);
    expect(E.entregas.find(e => e.id === e1)!.estado).toBe('firmada');
    expect(E.entregas.find(e => e.id === e2)!.estado).toBe('anulada');
    expect(E.herramientas.some(h => h.clase === 'ropa' && h.talla === 'M' && h.tecnico === 'T2')).toBe(true);
  });
});
