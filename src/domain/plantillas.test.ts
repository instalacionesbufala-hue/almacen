/* E-007 · Plantillas: tallas resueltas, modo kit, reservas y confirmación atómica (en local) */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { resolverPlantilla } from './plantillas';
import { applyMovement, find, reservado } from './reglas';
import { aplicarLocal, nuevoId } from '../store/ops';

let S: Estado;
beforeEach(() => { S = fresh(); });
const pl = (n: number) => S.plantillas[n];

describe('resolver plantillas', () => {
  it('la ropa y los EPIs salen con la talla de la ficha del técnico', () => {
    const r = resolverPlantilla(S, pl(1), 'F01', 'T1');   // Luis: pantalón 44, camiseta L, guantes 10, calzado 42
    expect(r.map(x => x.sku)).toEqual(['ROPA-PANT-44', 'ROPA-POLO-L', 'EPI-GUAN-10', 'EPI-BOTA-42']);
    expect(r.find(x => x.sku === 'ROPA-PANT-44')).toMatchObject({ cantidad: 2, pedida: 2 });
    expect(r.find(x => x.sku === 'EPI-GUAN-10')).toMatchObject({ cantidad: 1, disponible: 1 });
  });
  it('avisa si falta la talla en la ficha o no existe la variante', () => {
    const r = resolverPlantilla(S, pl(1), 'F02', 'T3');   // Andrea: sin tallas
    expect(r.every(x => x.cantidad === 0 && /Falta la talla/.test(x.aviso || ''))).toBe(true);
    S.tecnicos.find(t => t.id === 'T3')!.tallas = { pantalon: '46', camiseta: 'M', guantes: '9', calzado: '42' };
    const r2 = resolverPlantilla(S, pl(1), 'F02', 'T3');
    expect(r2[0].aviso).toMatch(/talla 46/);
    expect(r2[1]).toMatchObject({ sku: 'ROPA-POLO-M', cantidad: 3 });
  });
  it('propone entregar solo lo disponible cuando no hay bastante', () => {
    S.tecnicos.find(t => t.id === 'T2')!.tallas!.pantalon = '44';   // hay 2 de la 44
    const r = resolverPlantilla(S, { ...pl(1), lineas: [{ tipo: 'modelo', modelo: 'Pantalón multibolsillos', tipoTalla: 'pantalon', cantidad: 5, editable: true }] }, 'F01', 'T2');
    expect(r[0]).toMatchObject({ sku: 'ROPA-PANT-44', cantidad: 2, pedida: 5 });
    expect(r[0].aviso).toMatch(/Solo hay 2/);
  });
  it('modo kit: solo la diferencia con lo que ya lleva la furgoneta', () => {
    // F01 lleva 150 m de manguera 5G6 (entrega de demostración): objetivo 200 → faltan 50
    const r = resolverPlantilla(S, pl(2), 'F01', 'T1');
    expect(r.find(x => x.sku === 'CAB-RZ1K-5G6')!.pedida).toBe(50);
    expect(r.find(x => x.sku === 'BF-FIX-SX8')!.pedida).toBe(200);
    // si ya lo lleva todo, la línea desaparece
    S.entregas.unshift({ id: 'x', ts: Date.now(), equipo: 'F01', receptor: 'T1', lineas: [{ sku: 'CAB-RZ1K-5G6', qty: 50, serials: [] }], firma: 'f', operator: 'x' });
    expect(resolverPlantilla(S, pl(2), 'F01', 'T1').some(x => x.sku === 'CAB-RZ1K-5G6')).toBe(false);
  });
  it('los cargadores proponen n.º de serie libres', () => {
    const r = resolverPlantilla(S, pl(0), 'F01', 'T1');
    const c = r.find(x => x.sku === 'BF-VE-POL74')!;
    expect(c.serials).toHaveLength(1);
    expect(find(S, 'BF-VE-POL74')!.serials).toContain(c.serials[0]);
  });
});

describe('preparar, reservar y confirmar (local)', () => {
  it('preparar reserva: el resto de salidas no puede usarlo; anular lo libera', () => {
    const id = nuevoId();
    aplicarLocal(S, { op: 'prepararEntrega', args: { id, equipo: 'F01', receptor: 'T1', obra: 'C/ Eros 10', lineas: [{ tipo: 'stock', sku: '7501013532', qty: 5, serials: [] }] } });
    expect(find(S, '7501013532')!.stock).toBe(6);
    expect(reservado(S, '7501013532')).toBe(5);
    expect(() => applyMovement(S, { sku: '7501013532', type: 'salida', qty: 2, reason: 'Obra', ref: 'x' })).toThrow(/reservadas/);
    aplicarLocal(S, { op: 'anularEntrega', args: { id } });
    expect(reservado(S, '7501013532')).toBe(0);
  });
  it('confirmar entrega ropa a la dotación del técnico y es atómica', () => {
    const id = nuevoId();
    aplicarLocal(S, { op: 'prepararEntrega', args: { id, equipo: 'F01', receptor: 'T1', obra: '', lineas: [{ tipo: 'stock', sku: 'ROPA-PANT-44', qty: 2, serials: [] }, { tipo: 'stock', sku: 'CAB-RZ1K-5G6', qty: 20, serials: [] }] } });
    const dotAntes = S.herramientas.length;
    aplicarLocal(S, { op: 'confirmarEntrega', args: { id, firma: 'data:image/png;base64,AA' } });
    expect(find(S, 'ROPA-PANT-44')!.stock).toBe(0);
    expect(S.herramientas.length).toBe(dotAntes + 1);
    expect(S.herramientas.at(-1)).toMatchObject({ clase: 'ropa', talla: '44', cantidad: 2, tecnico: 'T1' });
    expect(S.entregas.find(e => e.id === id)!.estado).toBe('firmada');
    // atómica: si una línea falla, nada cambia
    S.herramientas.push({ id: 'H300', clase: 'herramienta', modelo: 'Fluke T6', nombre: 'Detector', marca: 'Fluke T6', serie: 'FT6-1', cantidad: 1, valor: 90, estado: 'operativa', historial: [] });
    const id2 = nuevoId();
    aplicarLocal(S, { op: 'prepararEntrega', args: { id: id2, equipo: 'F02', receptor: 'T3', obra: '', lineas: [{ tipo: 'stock', sku: 'BF-FIX-SX8', qty: 100, serials: [] }, { tipo: 'herramienta', sku: '', qty: 1, serials: [], dotacion: 'H300' }] } });
    S.herramientas.find(h => h.id === 'H300')!.estado = 'rota';
    expect(() => aplicarLocal(S, { op: 'confirmarEntrega', args: { id: id2, firma: 'f' } })).toThrow(/no está disponible/);
    expect(find(S, 'BF-FIX-SX8')!.stock).toBe(1200);
    expect(S.entregas.find(e => e.id === id2)!.estado).toBe('preparada');
  });
});
