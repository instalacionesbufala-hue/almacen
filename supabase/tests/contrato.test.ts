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

  it('movimiento (almacén y vehículo), albarán e incidencia llegan al servidor con los parámetros correctos', async () => {
    await como(db, ALMACEN);
    await rpc(db, { op: 'movimiento', args: { id: nuevoId(), sku: 'BF-FIX-SX8', tipo: 'salida', qty: 2, motivo: 'Obra / instalación', ref: 'C/ Eros 10', series: [] } });
    await rpc(db, { op: 'movimiento', args: { id: nuevoId(), sku: 'BF-FIX-SX8', tipo: 'traspaso', qty: 1, motivo: 'Carga del vehículo', ref: '', series: [], vehiculo: 'V-F02' } });
    await rpc(db, { op: 'albaran', args: { id: nuevoId(), cabecera: { numero: 'A-1', proveedor: 'Esmove', cif: '', fecha: '', confianza: .9, modo: 'sim' },
      lineas: [{ sku: 'ESM-CPVE-TRI', cantidad: 2, series: [] }] } });
    await rpc(db, { op: 'incidencia', args: { id: nuevoId(), dotacion: 'H001', tipo: 'deterioro', nota: 'Pantalla rayada' } });

    const E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX8')!.stock).toBe(9);
    expect(E.aBordo.find(b => b.vehiculo === 'V-F02' && b.sku === 'BF-FIX-SX8')!.unidades).toBe(100);   // en unidades de contenido
    expect(E.movements.find(m => m.type === 'traspaso')).toMatchObject({ vehiculo: 'V-F02', qty: 1 });
    expect(E.products.find(p => p.sku === 'ESM-CPVE-TRI')!.stock).toBe(3);
    expect(E.avisos.find(a => a.sku === 'SCH-IC60N-40' && a.estado === 'abierto')).toBeTruthy();
    expect(E.herramientas.find(h => h.id === 'H001')!.estado).toBe('deteriorada');
    expect(E.movements[0].operator).toBe('Operario Pruebas');
  });

  it('E-013: el estado no trae precios; sí vehículos, asignaciones, stock a bordo y modo demo', async () => {
    for (const quien of [ALMACEN, ADMIN]) {
      await como(db, quien);
      const E = await estado(db);
      expect(JSON.stringify(E.products)).not.toMatch(/"price"/);
      expect(E.herramientas.every(h => !h.valor)).toBe(true);
      expect(E.vehiculos.map(v => v.id).sort()).toEqual(['V-F01', 'V-F02', 'V-F03']);
      expect(E.equipos.find(e => e.id === 'F01')!.vehiculo).toBe('V-F01');
      expect(E.asignaciones.some(a => a.tipo === 'vehiculo' && a.sujeto === 'V-F01' && a.equipo === 'F01' && !a.hasta)).toBe(true);
      expect(E.configApp.modoDemo).toBe(true);
    }
    const E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX6')).toMatchObject({ unit: 'bote', contenido: 1000 });
    expect(E.products.find(p => p.sku === 'WBX-PULSAR-22')).toMatchObject({ propiedad: 'custodia', propietario: 'ESMOVE' });
    expect(E.propietarios.map(o => o.nombre)).toEqual(['Esmove']);
  });

  it('equipos, vehículos, técnicos, alta de referencia y dotación (administrador)', async () => {
    await como(db, ADMIN);
    await rpc(db, { op: 'equipo', args: { id: 'F09', nombre: 'Búfala 9', estado: 'depot' } });
    await rpc(db, { op: 'vehiculo', args: { id: 'V-09', matricula: '0000-XYZ', modelo: 'Furgoneta de pruebas' } });
    await rpc(db, { op: 'asignarVehiculo', args: { vehiculo: 'V-09', equipo: 'F09' } });
    await rpc(db, { op: 'tecnico', args: { id: 'T9', nombre: 'Nuevo Técnico', rol: 'Técnico', dni: '***1234-Z', codigo: 'X-9', telefono: '600000000' } });
    await rpc(db, { op: 'asignarTecnico', args: { tecnico: 'T9', equipo: 'F09' } });
    await rpc(db, { op: 'estadoEquipo', args: { id: 'F09', estado: 'ruta' } });
    await rpc(db, { op: 'producto', args: { nuevo: true, stockInicial: 5, producto: { sku: 'NUEVA-REF', name: 'Bolsa 50 bridas', cat: 'fijaciones', unit: 'bolsa', contenido: 50, stock: 0, min: 2, supplier: 'Saltoki Móstoles' } } });
    await rpc(db, { op: 'altaDotacion', args: { id: 'H099', clase: 'herramienta', nombre: 'Detector de tensión', marca: 'Fluke', serie: 'FL-1', cantidad: 1, valor: 0, estado: 'operativa', historial: [] } });
    await rpc(db, { op: 'asignarDotacion', args: { id: nuevoId(), dotacion: 'H099', tecnico: 'T9' } });
    const E = await estado(db);
    expect(E.equipos.find(e => e.id === 'F09')).toMatchObject({ nombre: 'Búfala 9', estado: 'ruta', tecnicos: ['T9'], vehiculo: 'V-09' });
    expect(E.tecnicos.find(t => t.id === 'T9')).toMatchObject({ codigo: 'X-9', telefono: '600000000' });
    expect(E.products.find(p => p.sku === 'NUEVA-REF')).toMatchObject({ stock: 5, unit: 'bolsa', contenido: 50 });
    expect(E.herramientas.find(h => h.id === 'H099')).toMatchObject({ equipo: 'F09', tecnico: 'T9' });
  });

  it('operaciones de E-004/E-013: borrador, recuento, merma con aviso, validación, perfil y borrado', async () => {
    await como(db, ALMACEN);
    await rpc(db, { op: 'borrador', args: { sku: '', ean: '8412345678905', nombre: 'Caja estanca', cat: 'aparamenta' } });
    await rpc(db, { op: 'recuento', args: { id: nuevoId(), pasillo: 'fijaciones', lineas: [{ sku: 'BF-FIX-SX6', contado: 2 }] } });
    await rpc(db, { op: 'movimiento', args: { id: nuevoId(), sku: '6040615316', tipo: 'merma', qty: 10, motivo: 'Corte sobrante', ref: '', series: [] } });
    let E = await estado(db);
    expect(E.pendientes.filter(p => p.estado === 'pendiente')).toHaveLength(1);
    expect(E.products.find(p => p.sku === '6040615316')!.stock).toBe(295);   // la merma ya está aplicada
    expect(E.products.find(p => p.sku === 'BORR-8412345678905')!.borrador).toBe(true);
    await como(db, ADMIN);
    E = await estado(db);
    const merma = E.pendientes.find(p => p.estado === 'aplicada')!;
    await rpc(db, { op: 'mermaVista', args: { id: merma.id } });
    for (const p of E.pendientes.filter(x => x.estado === 'pendiente')) await rpc(db, { op: 'validarPendiente', args: { id: p.id, aprobar: true, nota: 'ok' } });
    await rpc(db, { op: 'perfil', args: { id: ALMACEN, nombre: 'Operario Renombrado', rol: 'almacen', activo: true } });
    await rpc(db, { op: 'borrarProducto', args: { sku: 'BORR-8412345678905' } });
    E = await estado(db);
    expect(E.products.find(p => p.sku === 'BF-FIX-SX6')!.stock).toBe(2);
    expect(E.pendientes.find(p => p.id === merma.id)!.estado).toBe('vista');
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
    expect(E.products.find(p => p.sku === '8909080510')).toMatchObject({ propiedad: 'custodia', propietario: 'ESMOVE' });
    expect(E.envios.some(e => e.tipo === 'prueba')).toBe(true);
    expect(E.actas[0]).toMatchObject({ representante: 'Ana', lineas: [{ sku: 'ESM-CPVE-TRI', sistema: E.products.find(p => p.sku === 'ESM-CPVE-TRI')!.stock, contado: 1 }] });
  });

  it('operaciones de E-007/E-011: tallas, correo, preparar, confirmar (con copia), reenviar y anular', async () => {
    await como(db, ADMIN);
    await rpc(db, { op: 'tallas', args: { tecnico: 'T2', tallas: { camiseta: 'M', pantalon: '42' } } });
    await como(db, ALMACEN);
    const e1 = nuevoId(), e2 = nuevoId();
    await rpc(db, { op: 'prepararEntrega', args: { id: e1, equipo: 'F01', receptor: 'T2', obra: 'C/ Eros 10', lineas: [{ tipo: 'stock', sku: 'ROPA-POLO-M', qty: 2, serials: [] }] } });
    await rpc(db, { op: 'prepararEntrega', args: { id: e2, equipo: 'F01', receptor: 'T2', obra: '', lineas: [{ tipo: 'stock', sku: 'BF-FIX-SX8', qty: 1, serials: [] }] } });
    let E = await estado(db);
    expect(E.entregas.find(e => e.id === e1)).toMatchObject({ estado: 'preparada', obra: 'C/ Eros 10' });
    expect(E.tecnicos.find(t => t.id === 'T2')!.tallas).toMatchObject({ camiseta: 'M', pantalon: '42' });
    await rpc(db, { op: 'emailTecnico', args: { tecnico: 'T2', email: 'jorge@bufalatech.es' } });
    await rpc(db, { op: 'confirmarEntrega', args: { id: e1, firma: 'data:image/png;base64,AA' } });
    await rpc(db, { op: 'reenviarCopia', args: { entrega: e1 } });
    await rpc(db, { op: 'anularEntrega', args: { id: e2 } });
    E = await estado(db);
    expect(E.entregas.find(e => e.id === e1)!.estado).toBe('firmada');
    expect(E.entregas.find(e => e.id === e2)!.estado).toBe('anulada');
    expect(E.herramientas.some(h => h.clase === 'ropa' && h.talla === 'M' && h.tecnico === 'T2')).toBe(true);
    // el almacén ve la copia: la primera descartada al reenviar y la nueva pendiente, al correo guardado en la ficha
    expect(E.tecnicos.find(t => t.id === 'T2')!.email).toBe('jorge@bufalatech.es');
    expect(E.envios.filter(x => x.entrega === e1).map(x => [x.estado, x.destinatarios])).toEqual(expect.arrayContaining([['pendiente', ['jorge@bufalatech.es']], ['descartado', ['jorge@bufalatech.es']]]));
  });
});
