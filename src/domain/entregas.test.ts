/* E-011 · Cesta libre: escaneo repetido, talla editable, serie obligatoria, stock, reserva con caducidad y confirmación atómica */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Estado } from '../data/tipos';
import { fresh } from '../data/semilla';
import { aLineas, anadir, cambiarTalla, cestaVacia, escanear, fijar, problemas, restar, sumar, tallaPreferida, tipoTalla, variantes } from './entregas';
import { applyMovement, find, qrContenido, reservado } from './reglas';
import { aplicarLocal, nuevoId } from '../store/ops';

let S: Estado;
beforeEach(() => { S = fresh(); S.cesta = { ...cestaVacia('F01'), receptor: 'T1' }; });

describe('escáner en modo seguido', () => {
  it('leer dos veces el mismo código suma cantidad (por EAN, SKU o QR de estantería)', () => {
    expect(escanear(S, S.cesta, '4006209700985').ok).toBe(true);        // EAN de los tacos SX 6
    expect(escanear(S, S.cesta, '4006209700985').ok).toBe(true);
    const sku = S.cesta.lineas[0].sku;
    expect(S.cesta.lineas).toHaveLength(1);
    expect(S.cesta.lineas[0].qty).toBe(2);
    escanear(S, S.cesta, qrContenido(sku));
    expect(S.cesta.lineas[0].qty).toBe(3);
  });
  it('un cargador va por modelo y cantidad (E-013): cada lectura del QR suma uno, sin n.º de serie', () => {
    escanear(S, S.cesta, qrContenido('WBX-PULSAR-22'));
    escanear(S, S.cesta, 'BUF:WBX-PULSAR-22|SN:WBX-22-899281');           // un QR antiguo con serie también vale
    expect(S.cesta.lineas[0]).toMatchObject({ sku: 'WBX-PULSAR-22', qty: 2, serials: [] });
  });
  it('avisa de códigos desconocidos sin tocar la cesta', () => {
    expect(escanear(S, S.cesta, 'NO-EXISTE-123').aviso).toMatch(/no está en el catálogo/);
    expect(S.cesta.lineas).toHaveLength(0);
  });
});

describe('líneas de la cesta', () => {
  it('ropa y EPIs: sale la talla de la ficha del técnico y se puede cambiar en la línea', () => {
    const p42 = find(S, 'ROPA-PANT-42')!;
    expect(tipoTalla(p42)).toBe('pantalon');
    expect(variantes(S, p42).map(p => p.talla)).toEqual(['42', '44']);
    expect(tallaPreferida(S, 'T1', p42).sku).toBe('ROPA-PANT-44');      // Luis: pantalón 44
    anadir(S, S.cesta, 'ROPA-PANT-42');
    expect(S.cesta.lineas[0].sku).toBe('ROPA-PANT-44');
    anadir(S, S.cesta, 'ROPA-PANT-44');
    cambiarTalla(S, S.cesta, 'ROPA-PANT-44', 'ROPA-PANT-42');
    expect(S.cesta.lineas).toEqual([expect.objectContaining({ sku: 'ROPA-PANT-42', qty: 2 })]);
    // sin tallas en la ficha: se queda la que se elige
    S.cesta.receptor = 'T3';
    expect(tallaPreferida(S, 'T3', p42).sku).toBe('ROPA-PANT-42');
  });
  it('+ y − por unidades (o de 10 en 10 metros), y nunca más de lo disponible', () => {
    sumar(S, S.cesta, 'CAB-RZ1K-5G6');
    expect(S.cesta.lineas[0].qty).toBe(10);
    restar(S, S.cesta, 'CAB-RZ1K-5G6');
    expect(S.cesta.lineas).toHaveLength(0);
    const p = find(S, '7501013532')!;                                    // magnetotérmico: 6 ud
    sumar(S, S.cesta, '7501013532', { n: 1 });
    expect(fijar(S, S.cesta, '7501013532', 50).aviso).toMatch(/Solo hay 6 ud/);
    expect(S.cesta.lineas[0].qty).toBe(p.stock);
    expect(sumar(S, S.cesta, '7501013532').aviso).toMatch(/Solo hay/);
  });
  it('formatos enteros (se entrega el bote completo); cargadores y cuadros sin n.º de serie', () => {
    sumar(S, S.cesta, 'WBX-PULSAR-22');
    sumar(S, S.cesta, 'ESM-CPVE-MONO');
    expect(problemas(S, S.cesta)).toEqual([]);
    fijar(S, S.cesta, 'WBX-PULSAR-22', 1.5);                              // se redondea hacia abajo a un formato entero
    expect(S.cesta.lineas.find(l => l.sku === 'WBX-PULSAR-22')!.qty).toBe(1);
    S.cesta.lineas.push({ tipo: 'stock', sku: 'BF-FIX-SX6', qty: 0.5, serials: [] });
    expect(problemas(S, S.cesta)).toContain('Bote 1000 tacos nylon SX 6×30 se entrega por formato entero');
  });
  it('el material de instalación exige que el equipo tenga vehículo; la ropa y los EPIs no', () => {
    aplicarLocal(S, { op: 'asignarVehiculo', args: { vehiculo: 'V-F01' } });
    sumar(S, S.cesta, 'ROPA-PANT-44');
    expect(problemas(S, S.cesta)).toEqual([]);
    sumar(S, S.cesta, 'CAB-RZ1K-5G6');
    expect(problemas(S, S.cesta)[0]).toMatch(/no tiene vehículo asignado/);
  });
  it('pide receptor con equipo y cesta con material', () => {
    S.cesta = cestaVacia('F01');
    expect(problemas(S, S.cesta)).toEqual(['Elige quién recibe el material', 'La cesta está vacía']);
  });
});

describe('preparada (reserva), caducidad y firma atómica (en local)', () => {
  it('guardar preparada reserva el stock hasta que caduca; caducada no cuenta ni se puede firmar', () => {
    sumar(S, S.cesta, '7501013532', { n: 5 });
    const id = nuevoId();
    aplicarLocal(S, { op: 'prepararEntrega', args: { id, equipo: 'F01', receptor: 'T1', obra: 'C/ Eros 10', lineas: aLineas(S.cesta) } });
    expect(reservado(S, '7501013532')).toBe(5);
    expect(() => applyMovement(S, { sku: '7501013532', type: 'salida', qty: 2, reason: 'Obra', ref: 'x' })).toThrow(/reservadas/);
    // otra cesta ya no puede llevárselo
    const otra = cestaVacia('F02');
    expect(sumar(S, otra, '7501013532', { n: 2 }).aviso).toMatch(/Solo hay 1 ud/);
    S.entregas.find(e => e.id === id)!.caduca = Date.now() - 1000;       // pasa el plazo de reserva
    expect(reservado(S, '7501013532')).toBe(0);
    expect(() => aplicarLocal(S, { op: 'confirmarEntrega', args: { id, firma: 'data:image/png;base64,AA' } })).toThrow(/caducad/);
  });
  it('firmar descuenta todo o nada; la ropa pasa a la dotación del técnico con su talla', () => {
    anadir(S, S.cesta, 'ROPA-PANT-42');                                   // → talla 44 de Luis
    sumar(S, S.cesta, 'CAB-RZ1K-5G6', { n: 20 });
    const id = nuevoId(), dot = S.herramientas.length;
    aplicarLocal(S, { op: 'prepararEntrega', args: { id, equipo: 'F01', receptor: 'T1', obra: '', lineas: aLineas(S.cesta) } });
    aplicarLocal(S, { op: 'confirmarEntrega', args: { id, firma: 'data:image/png;base64,AA' } });
    expect(S.entregas.find(e => e.id === id)!.estado).toBe('firmada');
    expect(S.herramientas.length).toBe(dot + 1);
    expect(S.herramientas.at(-1)).toMatchObject({ clase: 'ropa', talla: '44', tecnico: 'T1' });
    // atómica: si falla una línea al firmar, no se descuenta nada
    const id2 = nuevoId(), antes = find(S, 'BF-FIX-SX8')!.stock;
    aplicarLocal(S, { op: 'prepararEntrega', args: { id: id2, equipo: 'F02', receptor: 'T3', obra: '', lineas: [{ tipo: 'stock', sku: 'BF-FIX-SX8', qty: 5, serials: [] }, { tipo: 'stock', sku: 'WBX-PULSAR-22', qty: 1, serials: [] }] } });
    aplicarLocal(S, { op: 'asignarVehiculo', args: { vehiculo: 'V-F02' } });   // el equipo se queda sin vehículo antes de firmar
    expect(() => aplicarLocal(S, { op: 'confirmarEntrega', args: { id: id2, firma: 'f' } })).toThrow();
    expect(find(S, 'BF-FIX-SX8')!.stock).toBe(antes);
    expect(S.entregas.find(e => e.id === id2)!.estado).toBe('preparada');
  });
});

describe('correo del técnico y reenvío de la copia', () => {
  it('el correo se valida y el reenvío deja registro (el intento anterior deja de reintentarse)', () => {
    expect(() => aplicarLocal(S, { op: 'emailTecnico', args: { tecnico: 'T3', email: 'andrea@' } })).toThrow(/no válido/);
    aplicarLocal(S, { op: 'emailTecnico', args: { tecnico: 'T3', email: ' Andrea@Bufalatech.es ' } });
    expect(S.tecnicos.find(t => t.id === 'T3')!.email).toBe('andrea@bufalatech.es');
    const e = S.entregas.find(x => (x.estado ?? 'firmada') === 'firmada')!;
    S.envios.unshift({ id: 'x1', ts: 1, canal: 'correo', tipo: 'entrega', asunto: '', estado: 'error', entrega: e.id, reintentos: 5 });
    aplicarLocal(S, { op: 'reenviarCopia', args: { entrega: e.id, email: 'luis@bufalatech.es' } });
    const copias = S.envios.filter(x => x.entrega === e.id);
    expect(copias.map(x => x.estado)).toEqual(['pendiente', 'descartado']);
  });
});
